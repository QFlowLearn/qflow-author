/** Uniform bounded integer, with rejection sampling to avoid modulo bias. */
export function randomQuestionIndex(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 0x100000000) {
    throw new Error('Invalid sample bound.');
  }
  const cutoff = Math.floor(0x100000000 / limit) * limit;
  const word = new Uint32Array(1);
  do {
    crypto.getRandomValues(word);
  } while (word[0] >= cutoff);
  return word[0] % limit;
}

/** Partial Fisher–Yates draws distinct candidates without disturbing the source pool. */
export function sampleQuestions<T>(
  pool: readonly T[],
  count: number,
  randomIndex: (limit: number) => number,
): T[] {
  if (!Number.isSafeInteger(count) || count < 0 || count > pool.length) {
    throw new Error('Invalid sample size.');
  }
  const remaining = [...pool], result: T[] = [];
  for (let i = 0; i < count; i++) {
    const index = randomIndex(remaining.length);
    if (!Number.isSafeInteger(index) || index < 0 || index >= remaining.length) {
      throw new Error('Invalid random index.');
    }
    result.push(remaining[index]);
    remaining[index] = remaining[remaining.length - 1];
    remaining.pop();
  }
  return result;
}
