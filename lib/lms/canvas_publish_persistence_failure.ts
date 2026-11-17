/** Expected database failure shared by Canvas publish persistence adapters. */
export type CanvasPublishPersistenceFailure = {
  readonly _tag: 'CanvasPublishPersistenceFailed';
  readonly message: 'QFlowLearn could not record direct Canvas publishing.';
  readonly cause: unknown;
};

/** Classifies an unknown database cause as the Canvas persistence boundary's expected failure. */
export function canvasPublishPersistenceFailure(
  cause: unknown,
): { readonly ok: false; readonly error: CanvasPublishPersistenceFailure } {
  return {
    ok: false,
    error: {
      _tag: 'CanvasPublishPersistenceFailed',
      message: 'QFlowLearn could not record direct Canvas publishing.',
      cause,
    },
  };
}
