import { theme } from '@gameverse/design-system';
import type { ColorValue } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

export type TabIconName = 'play' | 'chats' | 'friends' | 'settings';

/**
 * Tab bar icons drawn as SVG so they need no font or image files. Every icon is a 24x24 outline
 * in the colour the tab bar gives it (active or inactive).
 */
export function TabIcon({
  name,
  color,
  size,
  focused,
}: {
  name: TabIconName;
  color: ColorValue;
  size: number;
  focused: boolean;
}) {
  const common = {
    stroke: color,
    strokeWidth: focused ? 2.4 : 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      {name === 'play' ? (
        <>
          <Rect x="2.5" y="7" width="19" height="11" rx="5" {...common} />
          <Line x1="7.5" y1="10.5" x2="7.5" y2="14.5" {...common} />
          <Line x1="5.5" y1="12.5" x2="9.5" y2="12.5" {...common} />
          <Circle cx="15.5" cy="11.5" r="0.8" {...common} fill={color} />
          <Circle cx="18" cy="13.5" r="0.8" {...common} fill={color} />
        </>
      ) : null}
      {name === 'chats' ? (
        <Path
          d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H11l-4.5 3.5V17H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"
          {...common}
        />
      ) : null}
      {name === 'friends' ? (
        <>
          <Circle cx="9" cy="8" r="3.2" {...common} />
          <Path d="M2.8 20c0-3.4 2.8-5.6 6.2-5.6s6.2 2.2 6.2 5.6" {...common} />
          <Circle cx="17" cy="9" r="2.5" {...common} />
          <Path d="M17.5 14.6c2.4 0.2 3.9 2 3.9 4.6" {...common} />
        </>
      ) : null}
      {name === 'settings' ? (
        <>
          <Line x1="3" y1="7" x2="21" y2="7" {...common} />
          <Line x1="3" y1="12" x2="21" y2="12" {...common} />
          <Line x1="3" y1="17" x2="21" y2="17" {...common} />
          <Circle cx="9" cy="7" r="2.2" {...common} fill={focused ? color : theme.colors.surface} />
          <Circle
            cx="16"
            cy="12"
            r="2.2"
            {...common}
            fill={focused ? color : theme.colors.surface}
          />
          <Circle
            cx="8"
            cy="17"
            r="2.2"
            {...common}
            fill={focused ? color : theme.colors.surface}
          />
        </>
      ) : null}
    </Svg>
  );
}
