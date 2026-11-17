/** Maps a data-sized collection with a fixed maximum number of owned operations. */
export async function mapConcurrentBounded<Input, Output>(
  inputs: readonly Input[],
  options: { readonly concurrency: number },
  transform: (input: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error('Bounded concurrency must be a positive integer.');
  }
  if (inputs.length === 0) return [];

  const outputs = new Array<Output>(inputs.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      const input = inputs[index];
      if (input === undefined) throw new Error('Bounded concurrency input is missing.');
      outputs[index] = await transform(input, index);
    }
  }

  const workerCount = Math.min(options.concurrency, inputs.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return outputs;
}
