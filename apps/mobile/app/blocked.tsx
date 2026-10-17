import { theme } from '@gameverse/design-system';
import { useCallback } from 'react';
import { FlatList, Text, View } from 'react-native';
import { social } from '../src/api-client';
import { Avatar, Button, Empty, ErrorText, Loading, Screen, useAction, useLoad } from '../src/ui';

export default function Blocked() {
  const load = useCallback(() => social.blocks(), []);
  const { data, error, loading, reload } = useLoad(load);
  const action = useAction();

  return (
    <Screen>
      <ErrorText error={error ?? action.error} />
      {loading && !data ? (
        <Loading />
      ) : (
        <FlatList
          data={data?.items ?? []}
          keyExtractor={(item) => item.userId}
          ListEmptyComponent={<Empty text="You have not blocked anyone." />}
          renderItem={({ item }) => (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                minHeight: 64,
                gap: theme.spacing.md,
              }}
            >
              <Avatar avatarId={item.avatarId} name={item.username} />
              <Text style={{ color: theme.colors.textPrimary, fontSize: 16, flex: 1 }}>
                {item.username}
              </Text>
              <Button
                label="Unblock"
                tone="secondary"
                busy={action.busy}
                onPress={() =>
                  void action.run(async () => {
                    await social.unblock(item.userId);
                    await reload();
                  })
                }
              />
            </View>
          )}
        />
      )}
    </Screen>
  );
}
