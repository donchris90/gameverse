import {
  REPORT_REASONS,
  REPORT_DETAILS_MAX_LENGTH,
  type ReportReason,
} from '@gameverse/shared-types';
import { theme } from '@gameverse/design-system';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { social } from './api-client';
import { Body, Button, ErrorText, TextField, useAction } from './ui';

const LABELS: Record<ReportReason, string> = {
  HARASSMENT: 'Harassment or bullying',
  HATE: 'Hate speech',
  SEXUAL_CONTENT: 'Sexual content',
  SPAM: 'Spam or scams',
  IMPERSONATION: 'Pretending to be someone else',
  UNDERAGE: 'Seems under 16',
  CHEATING: 'Cheating',
  OTHER: 'Something else',
};

/** Report a player, or one of their chat messages (pass messageId). Moderators review every report. */
export function ReportPanel(props: {
  userId: string;
  username: string;
  messageId?: string;
  /** Set when reporting from the voice panel, so moderators know the report is about voice. */
  context?: 'voice';
  onClose: (sent: boolean) => void;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAction();

  if (sent) {
    return (
      <View style={{ padding: theme.spacing.lg }}>
        <Body>Thanks. A moderator will review your report. You can also block this player.</Body>
        <Button label="Done" onPress={() => props.onClose(true)} />
      </View>
    );
  }

  return (
    <View
      style={{
        padding: theme.spacing.lg,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radii.md,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{
          color: theme.colors.textPrimary,
          fontSize: 20,
          fontWeight: '700',
          marginBottom: theme.spacing.md,
        }}
      >
        {props.messageId ? 'Report message' : `Report ${props.username}`}
      </Text>
      {REPORT_REASONS.map((value) => (
        <Pressable
          key={value}
          accessibilityRole="radio"
          accessibilityState={{ selected: reason === value }}
          onPress={() => setReason(value)}
          style={{
            minHeight: 44,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
          }}
        >
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              borderWidth: 2,
              borderColor: theme.colors.borderStrong,
              backgroundColor: reason === value ? theme.colors.primary : 'transparent',
            }}
          />
          <Text style={{ color: theme.colors.textPrimary, flex: 1 }}>{LABELS[value]}</Text>
        </Pressable>
      ))}
      <TextField
        label="Details (optional)"
        value={details}
        onChangeText={setDetails}
        maxLength={REPORT_DETAILS_MAX_LENGTH}
        multiline
      />
      <ErrorText error={error} />
      <Button
        label="Send report"
        busy={busy}
        disabled={reason === null}
        onPress={() => {
          if (!reason) return;
          void run(async () => {
            const text = details.trim();
            const withContext = props.context === 'voice' ? `[voice] ${text}`.trim() : text;
            await social.report(props.userId, reason, withContext || null, props.messageId);
            setSent(true);
          });
        }}
      />
      <Button
        label="Cancel"
        tone="secondary"
        disabled={busy}
        onPress={() => props.onClose(false)}
      />
    </View>
  );
}
