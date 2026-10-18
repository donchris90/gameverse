import { ludoColors, theme } from '@gameverse/design-system';
import type { GameId } from '@gameverse/shared-types';
import { StyleSheet, Text, View } from 'react-native';

const c = theme.colors;
const ludo = ludoColors.players;

export interface GameInfo {
  id: GameId;
  name: string;
  tagline: string;
  tags: string[];
  /** Background of the artwork banner. */
  banner: string;
}

/** What the games home and each game's screen say about a game. Only games listed by the server show. */
export const GAME_INFO: Record<GameId, GameInfo> = {
  tictactoe: {
    id: 'tictactoe',
    name: 'Tic-tac-toe',
    tagline: 'Three in a row wins. Best of 3, 20 seconds a turn.',
    tags: ['2 players', '2 min'],
    banner: '#2A1F7A',
  },
  ludo: {
    id: 'ludo',
    name: 'Ludo',
    tagline: 'Roll, race your four tokens home and capture rivals.',
    tags: ['2 to 4 players', '15 min'],
    banner: '#10304F',
  },
  draughts: {
    id: 'draughts',
    name: 'Draughts',
    tagline: 'Jump your rivals, crown your kings. 20 seconds a turn.',
    tags: ['2 players', '10 min'],
    banner: '#4A2E14',
  },
};

/** Decorative artwork drawn with plain views; hidden from screen readers. */
export function GameArt({ gameId, size = 96 }: { gameId: GameId; size?: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}
    >
      {gameId === 'tictactoe' ? (
        <TicTacToeArt size={size} />
      ) : gameId === 'draughts' ? (
        <DraughtsArt size={size} />
      ) : (
        <LudoArt size={size} />
      )}
    </View>
  );
}

function DraughtsArt({ size }: { size: number }) {
  const cell = size / 4;
  const pieces: Record<number, string> = {
    1: '#F4EBD9',
    4: '#F4EBD9',
    6: '#B3261E',
    11: '#B3261E',
  };
  return (
    <View style={[styles.grid, { width: size, height: size, borderRadius: 6, overflow: 'hidden' }]}>
      {Array.from({ length: 16 }, (_unused, index) => {
        const dark = (Math.floor(index / 4) + (index % 4)) % 2 === 1;
        const piece = pieces[index];
        return (
          <View
            key={index}
            style={{
              width: cell,
              height: cell,
              backgroundColor: dark ? '#6B4A2B' : '#E8D3B0',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {piece ? (
              <View
                style={{
                  width: cell * 0.7,
                  height: cell * 0.7,
                  borderRadius: cell * 0.35,
                  backgroundColor: piece,
                  borderWidth: 2,
                  borderColor: '#00000055',
                }}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function TicTacToeArt({ size }: { size: number }) {
  const cell = size / 3;
  const marks = ['X', '', 'O', '', 'X', '', 'O', '', 'X'];
  return (
    <View style={[styles.grid, { width: size, height: size }]}>
      {marks.map((mark, index) => (
        <View
          key={index}
          style={[
            styles.tttCell,
            {
              width: cell,
              height: cell,
              borderRightWidth: index % 3 === 2 ? 0 : 2,
              borderBottomWidth: index >= 6 ? 0 : 2,
            },
          ]}
        >
          <Text
            style={[
              styles.mark,
              { fontSize: cell * 0.7, color: mark === 'X' ? c.accentCoral : c.accentBlue },
            ]}
          >
            {mark}
          </Text>
        </View>
      ))}
    </View>
  );
}

function LudoArt({ size }: { size: number }) {
  const quarter = size / 2;
  const radius = size * 0.09;
  return (
    <View style={[styles.grid, { width: size, height: size, borderRadius: size * 0.14 }]}>
      {[0, 1, 3, 2].map((colour) => (
        <View
          key={colour}
          style={[
            styles.ludoQuarter,
            { width: quarter, height: quarter, backgroundColor: ludo[colour] },
          ]}
        >
          <View style={styles.ludoDots}>
            {[0, 1, 2, 3].map((dot) => (
              <View
                key={dot}
                style={{
                  width: radius * 2,
                  height: radius * 2,
                  borderRadius: radius,
                  backgroundColor: 'rgba(255,255,255,0.85)',
                }}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', overflow: 'hidden' },
  tttCell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: 'rgba(255,255,255,0.35)',
  },
  mark: { fontWeight: '800' },
  ludoQuarter: { alignItems: 'center', justifyContent: 'center' },
  ludoDots: {
    width: '60%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    justifyContent: 'center',
  },
});
