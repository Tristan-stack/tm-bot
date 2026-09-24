/** `items` cut in slices of `size` at most, in order: the grouped RPC reads (V1-07, V1-28). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}
