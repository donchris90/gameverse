import type { MessageView } from '@gameverse/shared-types';
import { MESSAGE_MAX_LENGTH } from '@gameverse/shared-types';
import { theme } from '@gameverse/design-system';
import * as Crypto from 'expo-crypto';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { chat } from '../../src/api-client';
import { ReportPanel } from '../../src/ReportPanel';
import { realtime } from '../../src/realtime';
import { useReadySession } from '../../src/session';
import { Empty, ErrorText, Loading, Screen, useLoad } from '../../src/ui';

interface Outgoing {
  clientMessageId: string;
  body: string;
  failed: boolean;
}

type Row =
  | { kind: 'sent'; key: string; message: MessageView }
  | { kind: 'outgoing'; key: string; outgoing: Outgoing };

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string; name?: string; userId?: string }>();
  const { user } = useReadySession();

  // Who we are talking to, and whether the chat is muted, comes from the conversation list.
  const loadConversation = useCallback(async () => {
    const page = await chat.list();
    return page.items.find((item) => item.id === id) ?? null;
  }, [id]);
  const conversation = useLoad(loadConversation);
  const other = conversation.data?.user;
  const [muted, setMuted] = useState<boolean | null>(null);
  const isMuted = muted ?? conversation.data?.muted ?? false;

  const [messages, setMessages] = useState<MessageView[]>([]); // newest first
  const [cursor, setCursor] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [draft, setDraft] = useState('');
  const [reportTarget, setReportTarget] = useState<MessageView | null>(null);
  const newestRead = useRef<string | null>(null);

  const markRead = useCallback(
    (messageId: string) => {
      if (newestRead.current === messageId) return;
      newestRead.current = messageId;
      void chat.markRead(id, messageId).catch(() => undefined);
    },
    [id],
  );

  const insert = useCallback((incoming: MessageView) => {
    setMessages((current) =>
      current.some((m) => m.id === incoming.id)
        ? current
        : [incoming, ...current].sort((a, b) => (a.id < b.id ? 1 : -1)),
    );
    setOutbox((current) => current.filter((o) => o.clientMessageId !== incoming.clientMessageId));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    chat
      .messages(id)
      .then((page) => {
        if (cancelled) return;
        setMessages(page.items);
        setCursor(page.nextCursor);
        setError(null);
        const newest = page.items[0];
        if (newest) markRead(newest.id);
      })
      .catch((err: unknown) => !cancelled && setError(err))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id, markRead]);

  // Live delivery. After a reconnect, refetch the newest page to fill any gap while offline.
  useEffect(() => {
    const stopEvents = realtime.subscribe((event) => {
      if (event.type === 'message.new' && event.conversationId === id) {
        insert(event.message);
        if (event.message.senderId !== user.id) markRead(event.message.id);
      }
    });
    const stopConnection = realtime.onConnectionChange((connected) => {
      if (!connected) return;
      chat
        .messages(id)
        .then((page) => page.items.slice().reverse().forEach(insert))
        .catch(() => undefined);
    });
    return () => {
      stopEvents();
      stopConnection();
    };
  }, [id, insert, markRead, user.id]);

  const deliver = useCallback(
    async (outgoing: Outgoing) => {
      setOutbox((current) =>
        current.map((o) =>
          o.clientMessageId === outgoing.clientMessageId ? { ...o, failed: false } : o,
        ),
      );
      try {
        // Same clientMessageId on every retry: the server returns the original instead of a duplicate.
        const sent = await chat.send(id, outgoing.body, outgoing.clientMessageId);
        insert(sent);
        markRead(sent.id);
      } catch (err) {
        setError(err);
        setOutbox((current) =>
          current.map((o) =>
            o.clientMessageId === outgoing.clientMessageId ? { ...o, failed: true } : o,
          ),
        );
      }
    },
    [id, insert, markRead],
  );

  const send = () => {
    const body = draft.trim();
    if (body === '') return;
    setDraft('');
    setError(null);
    const outgoing: Outgoing = { clientMessageId: Crypto.randomUUID(), body, failed: false };
    setOutbox((current) => [outgoing, ...current]);
    void deliver(outgoing);
  };

  const loadOlder = () => {
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true);
    chat
      .messages(id, cursor)
      .then((page) => {
        setMessages((current) => [
          ...current,
          ...page.items.filter((m) => !current.some((c) => c.id === m.id)),
        ]);
        setCursor(page.nextCursor);
      })
      .catch((err: unknown) => setError(err))
      .finally(() => setLoadingOlder(false));
  };

  const rows: Row[] = [
    ...outbox.map((outgoing): Row => ({
      kind: 'outgoing',
      key: outgoing.clientMessageId,
      outgoing,
    })),
    ...messages.map((message): Row => ({ kind: 'sent', key: message.id, message })),
  ];

  const toggleMute = () => {
    const next = !isMuted;
    setMuted(next);
    chat.mute(id, next).catch((err: unknown) => {
      setMuted(!next);
      setError(err);
    });
  };

  const renderRow = ({ item }: { item: Row }) => {
    const mine = item.kind === 'outgoing' || item.message.senderId === user.id;
    const body = item.kind === 'outgoing' ? item.outgoing.body : item.message.body;
    const failed = item.kind === 'outgoing' && item.outgoing.failed;
    return (
      <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginVertical: 2 }}>
        <Pressable
          accessibilityLabel={`${mine ? 'You' : (other?.username ?? 'They')}: ${body}${failed ? '. Failed to send. Tap to retry.' : ''}`}
          accessibilityHint={!mine ? 'Long press to report this message' : undefined}
          onPress={() => {
            if (item.kind === 'outgoing' && item.outgoing.failed) void deliver(item.outgoing);
          }}
          onLongPress={() => {
            if (item.kind === 'sent' && !mine) {
              Alert.alert('Message', undefined, [
                {
                  text: 'Report message',
                  style: 'destructive',
                  onPress: () => setReportTarget(item.message),
                },
                { text: 'Cancel', style: 'cancel' },
              ]);
            }
          }}
          style={{
            maxWidth: '82%',
            borderRadius: theme.radii.md,
            paddingVertical: theme.spacing.sm,
            paddingHorizontal: theme.spacing.md,
            backgroundColor: failed
              ? theme.colors.accentCoral
              : mine
                ? theme.colors.primary
                : theme.colors.surfaceRaised,
            opacity: item.kind === 'outgoing' && !failed ? 0.7 : 1,
          }}
        >
          <Text style={{ color: theme.colors.textOnAccent, fontSize: 16 }}>{body}</Text>
        </Pressable>
        {failed && (
          <Text style={{ color: theme.colors.danger, fontSize: 12 }}>Not sent. Tap to retry.</Text>
        )}
      </View>
    );
  };

  if (reportTarget && other) {
    return (
      <Screen>
        <ReportPanel
          userId={reportTarget.senderId}
          username={other.username}
          messageId={reportTarget.id}
          onClose={() => setReportTarget(null)}
        />
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <Stack.Screen
        options={{
          title: other?.username ?? 'Chat',
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isMuted ? 'Unmute notifications' : 'Mute notifications'}
              onPress={toggleMute}
              style={{
                minHeight: 44,
                justifyContent: 'center',
                paddingHorizontal: theme.spacing.sm,
              }}
            >
              <Text style={{ color: theme.colors.textPrimary }}>{isMuted ? 'Unmute' : 'Mute'}</Text>
            </Pressable>
          ),
        }}
      />
      {loading ? (
        <Loading />
      ) : (
        <FlatList
          inverted
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={renderRow}
          contentContainerStyle={{ padding: theme.spacing.lg }}
          onEndReached={loadOlder}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={<Empty text="Say hello 👋" />}
          style={{ flex: 1 }}
        />
      )}
      <View style={{ paddingHorizontal: theme.spacing.lg }}>
        <ErrorText error={error} />
      </View>
      <View
        style={{
          flexDirection: 'row',
          padding: theme.spacing.md,
          gap: theme.spacing.sm,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
        }}
      >
        <TextInput
          accessibilityLabel="Message"
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          placeholderTextColor={theme.colors.textMuted}
          maxLength={MESSAGE_MAX_LENGTH}
          multiline
          style={{
            flex: 1,
            color: theme.colors.textPrimary,
            backgroundColor: theme.colors.background,
            borderColor: theme.colors.borderStrong,
            borderWidth: 1,
            borderRadius: theme.radii.sm,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            maxHeight: 120,
            fontSize: 16,
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: draft.trim() === '' }}
          disabled={draft.trim() === ''}
          onPress={send}
          style={{
            minHeight: 48,
            minWidth: 64,
            borderRadius: theme.radii.sm,
            backgroundColor: theme.colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: draft.trim() === '' ? 0.5 : 1,
          }}
        >
          <Text style={{ color: theme.colors.textOnAccent, fontWeight: '600' }}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
