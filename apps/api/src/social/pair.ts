/** Orders two user ids so that (low < high). UUIDs are lower-case hex, so string order is stable. */
export function orderedPair(a: string, b: string): { low: string; high: string } {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? { low: x, high: y } : { low: y, high: x };
}
