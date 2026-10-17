import { theme } from '@gameverse/design-system';
import {
  ChannelProfileType,
  ClientRoleType,
  createAgoraRtcEngine,
  type IRtcEngine,
} from 'react-native-agora';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { fetchSpikeGrant, signIn } from '../src/voice-spike-session';

type Phase = 'signed-out' | 'idle' | 'joining' | 'joined';

/**
 * Phase 0 spike screen. It reports only what the Agora SDK actually emits; every line in the log
 * is an SDK callback or an error, so the results can be copied into docs/voice-spike.md.
 */
export default function VoiceSpike() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [channel, setChannel] = useState('spike-test');
  const [phase, setPhase] = useState<Phase>('signed-out');
  const [muted, setMuted] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const engine = useRef<IRtcEngine | null>(null);

  const note = useCallback((line: string) => {
    setLog((previous) =>
      [`${new Date().toISOString().slice(11, 19)} ${line}`, ...previous].slice(0, 60),
    );
  }, []);

  useEffect(
    () => () => {
      engine.current?.release();
      engine.current = null;
    },
    [],
  );

  const handleSignIn = async () => {
    try {
      setAccessToken(await signIn(email.trim(), password));
      setPassword('');
      setPhase('idle');
      note('signed in');
    } catch (error) {
      note(`sign-in failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  };

  const ensureMicrophone = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true; // iOS prompts when the engine first opens the mic
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    return result === PermissionsAndroid.RESULTS.GRANTED;
  };

  const join = async () => {
    if (!accessToken) return;
    try {
      if (!(await ensureMicrophone())) {
        Alert.alert('Microphone permission is required to join voice.');
        note('microphone permission denied');
        return;
      }
      setPhase('joining');
      const grant = await fetchSpikeGrant(accessToken, channel.trim());
      note(`token received for uid ${String(grant.uid)}, expires ${grant.expiresAt}`);

      const rtc = createAgoraRtcEngine();
      engine.current = rtc;
      rtc.initialize({
        appId: grant.appId,
        channelProfile: ChannelProfileType.ChannelProfileCommunication,
      });
      rtc.registerEventHandler({
        onJoinChannelSuccess: (connection, elapsed) => {
          setPhase('joined');
          note(`joined ${connection.channelId ?? ''} after ${String(elapsed)} ms`);
        },
        onUserJoined: (_connection, remoteUid) => note(`remote user ${String(remoteUid)} joined`),
        onUserOffline: (_connection, remoteUid, reason) =>
          note(`remote user ${String(remoteUid)} left (reason ${String(reason)})`),
        onConnectionStateChanged: (_connection, state, reason) =>
          note(`connection state ${String(state)} (reason ${String(reason)})`),
        onTokenPrivilegeWillExpire: () => note('token will expire soon'),
        onLeaveChannel: () => note('left channel'),
        onError: (code, message) => note(`SDK error ${String(code)}: ${message}`),
      });
      rtc.enableAudio();
      rtc.joinChannel(grant.token, grant.channel, grant.uid, {
        clientRoleType: ClientRoleType.ClientRoleBroadcaster,
        publishMicrophoneTrack: true,
        autoSubscribeAudio: true,
      });
      note('join requested');
    } catch (error) {
      setPhase('idle');
      note(`join failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  };

  const toggleMute = () => {
    const next = !muted;
    engine.current?.muteLocalAudioStream(next);
    setMuted(next);
    note(next ? 'muted' : 'unmuted');
  };

  const leave = () => {
    engine.current?.leaveChannel();
    engine.current?.release();
    engine.current = null;
    setMuted(false);
    setPhase('idle');
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Voice spike</Text>
      {phase === 'signed-out' ? (
        <>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={theme.colors.textMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <Button label="Sign in" onPress={() => void handleSignIn()} />
        </>
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder="Channel (spike-name)"
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            value={channel}
            onChangeText={setChannel}
            editable={phase === 'idle'}
          />
          {phase === 'idle' ? <Button label="Join" onPress={() => void join()} /> : null}
          {phase === 'joining' ? <Text style={styles.status}>Joining…</Text> : null}
          {phase === 'joined' ? (
            <View style={styles.row}>
              <Button label={muted ? 'Unmute' : 'Mute'} onPress={toggleMute} />
              <Button label="Leave" onPress={leave} />
            </View>
          ) : null}
        </>
      )}
      <Text style={styles.logTitle}>Event log</Text>
      {log.map((line, index) => (
        <Text key={`${String(index)}-${line}`} style={styles.logLine}>
          {line}
        </Text>
      ))}
    </ScrollView>
  );
}

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.button}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: theme.spacing.lg, gap: theme.spacing.md },
  title: { color: theme.colors.textPrimary, fontSize: 24, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: theme.radii.md,
    color: theme.colors.textPrimary,
    padding: theme.spacing.md,
  },
  button: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radii.md,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  buttonText: { color: theme.colors.textOnAccent, fontWeight: '600', fontSize: 16 },
  row: { flexDirection: 'row', gap: theme.spacing.md },
  status: { color: theme.colors.textSecondary },
  logTitle: { color: theme.colors.textSecondary, marginTop: theme.spacing.lg, fontWeight: '600' },
  logLine: { color: theme.colors.textMuted, fontSize: 12, fontFamily: 'monospace' },
});
