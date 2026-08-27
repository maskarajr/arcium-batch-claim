export function nextBatchSize(current: number, tooLarge: boolean): number {
  if (!tooLarge) return current;
  if (current <= 1) return 0;
  return Math.floor(current / 2);
}

export function isTxTooLarge(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("too large") ||
    m.includes("transaction too large") ||
    m.includes("encoding overruns") ||
    m.includes("index out of range") ||
    m.includes("out of range index")
  );
}

export function sequentialChunks<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
