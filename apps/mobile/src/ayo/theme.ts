// The Ayo table has its own look (dark wood and gold), taken from the RRYDA game, and it does not
// follow the app theme. Every colour of the Ayo screen comes from here so text is always readable.
export const AYO = {
  bg: '#1C1009',
  surface: 'rgba(255,232,190,0.06)',
  surfaceStrong: 'rgba(255,232,190,0.10)',
  border: 'rgba(255,214,150,0.16)',
  text: '#FFF4E2',
  muted: '#CDB898',
  gold: '#F5B841',
  onGold: '#2A1505',
  wood: '#E3BB80',
  woodEdge: '#B98A4F',
  woodInk: '#6B4420',
  green: '#2F9E5B',
  danger: '#FF7A5C',
  /** Grey-cream stones like the real seeds. */
  seeds: ['#C9CFC8', '#DAD6C8', '#B9C0B4', '#E4DECF', '#C2C6BD', '#D3CFC0'],
} as const;
