import type { QflowRuntime } from '../runtime.ts';

/** Parsed HTTP inputs supplied to authentication by the framework adapter. */
export type AuthRequest = {
  readonly req: Request;
  readonly url: URL;
  readonly runtime: QflowRuntime;
};
