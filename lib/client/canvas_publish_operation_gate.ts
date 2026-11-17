/** Exclusive ownership returned for one active browser-side Canvas publish command. */
export type CanvasPublishOperationLease = {
  readonly signal: AbortSignal;
  finish(): void;
};

/** Synchronous single-flight gate for Canvas publish and resume mutations. */
export type CanvasPublishOperationGate = {
  begin(): CanvasPublishOperationLease | null;
  isActive(): boolean;
  cancel(): void;
};

/** Creates a gate that rejects overlap without cancelling the command already in flight. */
export function createCanvasPublishOperationGate(): CanvasPublishOperationGate {
  let active: AbortController | null = null;
  return {
    begin() {
      if (active !== null) return null;
      const controller = new AbortController();
      active = controller;
      return {
        signal: controller.signal,
        finish() {
          if (active === controller) active = null;
        },
      };
    },
    isActive() {
      return active !== null;
    },
    cancel() {
      active?.abort();
      active = null;
    },
  };
}
