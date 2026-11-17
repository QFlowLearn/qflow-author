import { useEffect, useRef, useState } from 'preact/hooks';

import type { AssessmentExportSelection } from '../../lib/client/assessment_export_workflow.ts';
import {
  type CanvasConnectionView,
  type CanvasPublishClientErrorCode,
  type CanvasPublishDestinationInput,
  type CanvasPublishTerminalCursorToken,
  type CanvasPublishView,
  createCanvasPublish,
  loadCanvasConnections,
  loadCanvasPublishes,
  resolveCanvasRemoteIdentity,
  resumeCanvasPublish,
} from '../../lib/client/canvas_publish.ts';
import { createCanvasPublishOperationGate } from '../../lib/client/canvas_publish_operation_gate.ts';
import type { AssessmentExportPreflightView } from '../../lib/export/assessment_export_preflight_client.ts';
import type { CanvasPublishTargetId } from '../../lib/lms/canvas_connection_types.ts';
import { isCanvasPublishActionRequired } from '../../lib/lms/canvas_publish_wire.ts';

export type CanvasConnectionsState =
  | { readonly _tag: 'Loading' }
  | {
    readonly _tag: 'Ready';
    readonly connections: readonly CanvasConnectionView[];
  }
  | { readonly _tag: 'Failed'; readonly code: CanvasPublishClientErrorCode };

export type CanvasPublishesLoadState =
  | { readonly _tag: 'Loading' }
  | { readonly _tag: 'Loaded' }
  | { readonly _tag: 'Failed'; readonly code: CanvasPublishClientErrorCode };

export type CanvasPublishesPaginationState =
  | { readonly _tag: 'Complete' }
  | { readonly _tag: 'Available'; readonly cursor: CanvasPublishTerminalCursorToken }
  | { readonly _tag: 'Loading'; readonly cursor: CanvasPublishTerminalCursorToken }
  | {
    readonly _tag: 'Failed';
    readonly cursor: CanvasPublishTerminalCursorToken;
    readonly code: CanvasPublishClientErrorCode;
  };

export type CanvasPublishesState = {
  readonly load: CanvasPublishesLoadState;
  readonly actionRequired: readonly CanvasPublishView[];
  readonly terminal: readonly CanvasPublishView[];
  readonly pagination: CanvasPublishesPaginationState;
};

export type CanvasPublishCommand = {
  readonly publishId: string;
  readonly connectionId: string;
  readonly destination: CanvasPublishDestinationInput;
};

export type CanvasPublishUiState =
  | { readonly _tag: 'Idle' }
  | { readonly _tag: 'Submitting'; readonly command: CanvasPublishCommand }
  | {
    readonly _tag: 'RequestFailed';
    readonly command: CanvasPublishCommand;
    readonly code: CanvasPublishClientErrorCode;
  }
  | { readonly _tag: 'Resolved'; readonly publish: CanvasPublishView }
  | { readonly _tag: 'Resuming'; readonly publish: CanvasPublishView }
  | { readonly _tag: 'ResolvingUnknown'; readonly publish: CanvasPublishView }
  | {
    readonly _tag: 'ResumeFailed';
    readonly publish: CanvasPublishView;
    readonly code: CanvasPublishClientErrorCode;
  }
  | {
    readonly _tag: 'ResolutionFailed';
    readonly publish: CanvasPublishView;
    readonly code: CanvasPublishClientErrorCode;
  };

type Input = {
  readonly assessmentId: string;
  readonly selection: AssessmentExportSelection & { readonly targetId: CanvasPublishTargetId };
  readonly preflight: Extract<AssessmentExportPreflightView, { readonly _tag: 'Evaluated' }>;
};

/** Owns cancellation and request state for one preflight-bound Canvas publishing panel. */
export function useCanvasPublish(input: Input) {
  const [connectionsState, setConnectionsState] = useState<CanvasConnectionsState>({
    _tag: 'Loading',
  });
  const [publishesState, setPublishesState] = useState<CanvasPublishesState>(emptyPublishesState);
  const [publishState, setPublishState] = useState<CanvasPublishUiState>({ _tag: 'Idle' });
  const [operationGate] = useState(createCanvasPublishOperationGate);
  const historyLoadController = useRef<AbortController | null>(null);
  const paginationController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    operationGate.cancel();
    historyLoadController.current?.abort();
    historyLoadController.current = null;
    paginationController.current?.abort();
    paginationController.current = null;
    setConnectionsState({ _tag: 'Loading' });
    setPublishesState(emptyPublishesState());
    setPublishState({ _tag: 'Idle' });
    Promise.all([
      loadCanvasConnections({ signal: controller.signal }),
      loadCanvasPublishes(input.assessmentId, input.selection.targetId, {
        signal: controller.signal,
      }),
    ]).then(([connections, publishes]) => {
      if (controller.signal.aborted) return;
      setConnectionsState(
        connections.ok
          ? {
            _tag: 'Ready',
            connections: connections.value.filter((connection) =>
              connection.supportedTargetIds.includes(input.selection.targetId)
            ),
          }
          : { _tag: 'Failed', code: connections.error.code },
      );
      setPublishesState(
        publishes.ok
          ? {
            load: { _tag: 'Loaded' },
            actionRequired: publishes.value.actionRequired,
            terminal: publishes.value.terminal,
            pagination: paginationFromCursor(publishes.value.nextTerminalCursor),
          }
          : {
            ...emptyPublishesState(),
            load: { _tag: 'Failed', code: publishes.error.code },
          },
      );
    }).catch((cause: unknown) => {
      if (isAbort(cause)) return;
      setConnectionsState({
        _tag: 'Failed',
        code: 'CanvasPublishRequestFailed',
      });
      setPublishesState({
        ...emptyPublishesState(),
        load: { _tag: 'Failed', code: 'CanvasPublishRequestFailed' },
      });
    });
    return () => controller.abort();
  }, [input.assessmentId, input.preflight.preflightId, input.selection.targetId, operationGate]);

  useEffect(() => () => {
    operationGate.cancel();
    historyLoadController.current?.abort();
    paginationController.current?.abort();
  }, [operationGate]);

  const send = async (command: CanvasPublishCommand) => {
    const lease = beginMutation();
    if (lease === null) return;
    setPublishState({ _tag: 'Submitting', command });
    try {
      const result = await createCanvasPublish({
        assessmentId: input.assessmentId,
        publishId: command.publishId,
        connectionId: command.connectionId,
        targetId: input.selection.targetId,
        destination: command.destination,
        preflightId: input.preflight.preflightId,
        acknowledgement: input.preflight.acknowledgementToken,
        selection: input.selection.requirements,
      }, { signal: lease.signal });
      if (lease.signal.aborted) return;
      if (result.ok) recordPublish(setPublishesState, result.value);
      setPublishState(
        result.ok
          ? { _tag: 'Resolved', publish: result.value }
          : { _tag: 'RequestFailed', command, code: result.error.code },
      );
    } catch (cause: unknown) {
      if (!isAbort(cause)) {
        setPublishState({
          _tag: 'RequestFailed',
          command,
          code: 'CanvasPublishRequestFailed',
        });
      }
    } finally {
      lease.finish();
    }
  };

  const resume = async (publish: CanvasPublishView) => {
    const lease = beginMutation();
    if (lease === null) return;
    setPublishState({ _tag: 'Resuming', publish });
    try {
      const result = await resumeCanvasPublish(input.assessmentId, publish.id, {
        signal: lease.signal,
      });
      if (lease.signal.aborted) return;
      if (result.ok) recordPublish(setPublishesState, result.value);
      setPublishState(
        result.ok ? { _tag: 'Resolved', publish: result.value } : {
          _tag: 'ResumeFailed',
          publish,
          code: result.error.code,
        },
      );
    } catch (cause: unknown) {
      if (!isAbort(cause)) {
        setPublishState({
          _tag: 'ResumeFailed',
          publish,
          code: 'CanvasPublishRequestFailed',
        });
      }
    } finally {
      lease.finish();
    }
  };

  const resolveUnknown = async (
    publish: CanvasPublishView,
    outcome: 'import-found' | 'import-not-found',
  ) => {
    if (publish.state._tag !== 'RemoteIdentityUnknown') return;
    const lease = beginMutation();
    if (lease === null) return;
    setPublishState({ _tag: 'ResolvingUnknown', publish });
    try {
      const result = await resolveCanvasRemoteIdentity(
        input.assessmentId,
        publish.id,
        outcome,
        { signal: lease.signal },
      );
      if (lease.signal.aborted) return;
      if (result.ok) recordPublish(setPublishesState, result.value);
      setPublishState(
        result.ok ? { _tag: 'Resolved', publish: result.value } : {
          _tag: 'ResolutionFailed',
          publish,
          code: result.error.code,
        },
      );
    } catch (cause: unknown) {
      if (!isAbort(cause)) {
        setPublishState({
          _tag: 'ResolutionFailed',
          publish,
          code: 'CanvasPublishRequestFailed',
        });
      }
    } finally {
      lease.finish();
    }
  };

  const beginMutation = () => {
    const lease = operationGate.begin();
    if (lease === null) return null;
    historyLoadController.current?.abort();
    historyLoadController.current = null;
    paginationController.current?.abort();
    paginationController.current = null;
    setPublishesState((state) => ({
      ...state,
      load: state.load._tag === 'Loading' ? { _tag: 'Loaded' } : state.load,
      pagination: state.pagination._tag === 'Loading'
        ? { _tag: 'Available', cursor: state.pagination.cursor }
        : state.pagination,
    }));
    return lease;
  };

  const loadMoreTerminal = async () => {
    const page = publishesState.pagination;
    if (page._tag !== 'Available' && page._tag !== 'Failed') return;
    if (
      paginationController.current !== null || historyLoadController.current !== null ||
      operationGate.isActive()
    ) return;
    const controller = new AbortController();
    paginationController.current = controller;
    setPublishesState((state) => ({
      ...state,
      pagination: { _tag: 'Loading', cursor: page.cursor },
    }));
    try {
      const result = await loadCanvasPublishes(input.assessmentId, input.selection.targetId, {
        terminalCursor: page.cursor,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setPublishesState((state) =>
        result.ok
          ? {
            ...state,
            actionRequired: result.value.actionRequired,
            terminal: mergeTerminalPages(state.terminal, result.value.terminal),
            pagination: paginationFromCursor(result.value.nextTerminalCursor),
          }
          : {
            ...state,
            pagination: {
              _tag: 'Failed',
              cursor: page.cursor,
              code: result.error.code,
            },
          }
      );
    } catch (cause: unknown) {
      if (!isAbort(cause)) {
        setPublishesState((state) => ({
          ...state,
          pagination: {
            _tag: 'Failed',
            cursor: page.cursor,
            code: 'CanvasPublishRequestFailed',
          },
        }));
      }
    } finally {
      if (paginationController.current === controller) paginationController.current = null;
    }
  };

  const reloadPublishes = async () => {
    if (historyLoadController.current !== null || operationGate.isActive()) return;
    paginationController.current?.abort();
    paginationController.current = null;
    const controller = new AbortController();
    historyLoadController.current = controller;
    setPublishesState((state) => ({
      ...state,
      load: { _tag: 'Loading' },
      pagination: state.pagination._tag === 'Loading'
        ? { _tag: 'Available', cursor: state.pagination.cursor }
        : state.pagination,
    }));
    try {
      const result = await loadCanvasPublishes(input.assessmentId, input.selection.targetId, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setPublishesState((state) =>
        result.ok
          ? {
            load: { _tag: 'Loaded' },
            actionRequired: result.value.actionRequired,
            terminal: mergeTerminalPages(result.value.terminal, state.terminal),
            pagination: paginationFromCursor(result.value.nextTerminalCursor),
          }
          : { ...state, load: { _tag: 'Failed', code: result.error.code } }
      );
    } catch (cause: unknown) {
      if (!isAbort(cause)) {
        setPublishesState((state) => ({
          ...state,
          load: { _tag: 'Failed', code: 'CanvasPublishRequestFailed' },
        }));
      }
    } finally {
      if (historyLoadController.current === controller) historyLoadController.current = null;
    }
  };

  return {
    connectionsState,
    publishesState,
    publishState,
    send,
    resume,
    resolveUnknown,
    beginNewIntent: () => {
      if (!operationGate.isActive()) setPublishState({ _tag: 'Idle' });
    },
    reloadPublishes,
    loadMoreTerminal,
    busy: publishState._tag === 'Submitting' || publishState._tag === 'Resuming' ||
      publishState._tag === 'ResolvingUnknown',
  } as const;
}

function recordPublish(
  setState: (update: (state: CanvasPublishesState) => CanvasPublishesState) => void,
  publish: CanvasPublishView,
): void {
  setState((state) =>
    isCanvasPublishActionRequired(publish)
      ? {
        ...state,
        actionRequired: upsertPublish(state.actionRequired, publish),
        terminal: state.terminal.filter((candidate) => candidate.id !== publish.id),
      }
      : {
        ...state,
        actionRequired: state.actionRequired.filter((candidate) => candidate.id !== publish.id),
        terminal: upsertPublish(state.terminal, publish),
      }
  );
}

function emptyPublishesState(): CanvasPublishesState {
  return {
    load: { _tag: 'Loading' },
    actionRequired: [],
    terminal: [],
    pagination: { _tag: 'Complete' },
  };
}

function paginationFromCursor(
  cursor: CanvasPublishTerminalCursorToken | null,
): CanvasPublishesPaginationState {
  return cursor === null ? { _tag: 'Complete' } : { _tag: 'Available', cursor };
}

function upsertPublish(
  publishes: readonly CanvasPublishView[],
  publish: CanvasPublishView,
): readonly CanvasPublishView[] {
  return [publish, ...publishes.filter((candidate) => candidate.id !== publish.id)];
}

function mergeTerminalPages(
  current: readonly CanvasPublishView[],
  older: readonly CanvasPublishView[],
): readonly CanvasPublishView[] {
  const known = new Set(current.map((publish) => publish.id));
  return [...current, ...older.filter((publish) => !known.has(publish.id))];
}

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}
