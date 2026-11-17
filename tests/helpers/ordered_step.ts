/** Await a named stage in a retained ordered scenario and preserve the failed stage in diagnostics. */
export async function runStep(
  name: string,
  operation: () => unknown | PromiseLike<unknown>,
): Promise<void> {
  try {
    await operation();
  } catch (cause: unknown) {
    throw new Error(`Scenario stage failed: ${name}`, { cause });
  }
}
