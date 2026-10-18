import { theme } from '@gameverse/design-system';
import { isVoiceActive, voiceRows, voiceStatusText, type MatchView } from '@gameverse/shared-types';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { social } from './api-client';
import { ReportPanel } from './ReportPanel';
import { openAppSettings } from './voice/mic';
import { useVoice } from './voice/use-voice';
import { Avatar, Body, Button, ErrorText, useAction } from './ui';

const c = theme.colors;
const s = theme.spacing;

/**
 * Optional voice for a match with another human. Off until the player taps Join voice; no audio is
 * ever recorded. Shows who is in the channel and who is speaking, and lets the player mute, leave,
 * report or block the other player without leaving the match.
 */
export function VoicePanel({ match }: { match: MatchView }) {
  const me = match.players.find((player) => player.seat === match.mySeat);
  // Everyone else who is a person (bots have no voice). A Ludo table can have up to three.
  const others = match.players.flatMap((player) =>
    player.seat !== match.mySeat && player.userId !== null && !player.out
      ? [{ userId: player.userId, username: player.username }]
      : [],
  );
  const open = ['WAITING', 'READY', 'ACTIVE'].includes(match.status);
  const { controller, state } = useVoice(match.id, open);
  const [reporting, setReporting] = useState<{ userId: string; username: string } | null>(null);
  const act = useAction();

  // Bots have no voice, and a finished match has nothing to join.
  if (!me?.userId || others.length === 0 || !open) return null;
  const active = isVoiceActive(state);
  const rows = voiceRows(state, me.userId);

  if (reporting) {
    return (
      <ReportPanel
        userId={reporting.userId}
        username={reporting.username}
        context="voice"
        onClose={() => setReporting(null)}
      />
    );
  }

  const block = (other: { userId: string; username: string }) =>
    Alert.alert(
      `Block ${other.username}?`,
      'Voice ends now and you will not see each other in games or chat.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () =>
            void act.run(async () => {
              await controller.leave();
              await social.block(other.userId);
            }),
        },
      ],
    );

  return (
    <View style={styles.card} accessibilityLabel="Voice chat">
      <Text accessibilityRole="header" style={styles.heading}>
        Voice
      </Text>
      <Body muted>{voiceStatusText(state)}</Body>

      {state.phase === 'denied' && !state.canAskAgain ? (
        <Button label="Open settings" tone="secondary" onPress={openAppSettings} />
      ) : null}

      {rows.length > 0 && active
        ? rows.map((row) => (
            <View
              key={row.uid}
              style={styles.row}
              accessibilityLabel={`${row.name}${row.speaking ? ', speaking' : ''}${row.muted ? ', muted' : ''}`}
            >
              <View style={[styles.ring, row.speaking && { borderColor: c.success }]}>
                <Avatar avatarId={row.avatarId} name={row.name} size={36} />
              </View>
              <Text style={styles.name}>{row.name}</Text>
              <Text style={styles.tag}>
                {!row.inChannel
                  ? 'not in voice'
                  : row.muted
                    ? 'muted'
                    : row.speaking
                      ? 'speaking'
                      : ''}
              </Text>
            </View>
          ))
        : null}

      {!active ? (
        <Button
          label={
            state.phase === 'denied' && state.canAskAgain
              ? 'Allow microphone and join'
              : 'Join voice'
          }
          tone="secondary"
          onPress={() => void controller.join()}
        />
      ) : (
        <>
          <Button
            label={state.muted ? 'Unmute' : 'Mute'}
            tone="secondary"
            onPress={() => controller.toggleMute()}
          />
          <Button label="Leave voice" tone="secondary" onPress={() => void controller.leave()} />
        </>
      )}

      <ErrorText error={act.error} />
      <View style={styles.safety}>
        {others.map((other) => (
          <View key={other.userId}>
            <Button
              label={others.length === 1 ? 'Report player' : `Report ${other.username}`}
              tone="secondary"
              onPress={() => setReporting(other)}
            />
            <Button
              label={others.length === 1 ? 'Block player' : `Block ${other.username}`}
              tone="danger"
              busy={act.busy}
              onPress={() => block(other)}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: c.surface,
    borderRadius: theme.radii.md,
    borderColor: c.border,
    borderWidth: 1,
    padding: s.lg,
    marginBottom: s.lg,
  },
  heading: { color: c.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: s.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: s.md, marginVertical: s.sm },
  ring: { borderWidth: 3, borderColor: 'transparent', borderRadius: 24, padding: 1 },
  name: { color: c.textPrimary, flex: 1, fontSize: 16 },
  tag: { color: c.textSecondary, fontSize: 13 },
  safety: { marginTop: s.md },
});
