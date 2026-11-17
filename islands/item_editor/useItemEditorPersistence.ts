import { useEffect, useRef } from 'preact/hooks';
import type { Draft } from '../../lib/types/draft.ts';
import { type FieldIssue, parseFieldKey } from '../../lib/validation_fields.ts';
import {
  createRevisionDraftSessionQueue,
  type RevisionDraftSessionQueue,
} from '../../lib/client/revision_draft_session.ts';
import type {
  ItemEditorPersistence,
  ItemEditorPublishResult,
  ItemEditorSaveCommand,
} from './types.ts';

export type UseItemEditorPersistenceConfig = ItemEditorPersistence & {
  readonly tagsCsv?: string;
  readonly onAutosaveError?: (code: ItemEditorFailureCode) => void;
};

/** Closed failures that may cross the persistence boundary into editor UI. */
export type ItemEditorFailureCode = 'save_failed' | 'stale_revision';

/** Translate recognized HTTP save failures into safe editor reasons without displaying server text. */
export function parseItemEditorFailureCode(
  status: number,
  payload: unknown,
): ItemEditorFailureCode {
  return status === 409 && payload !== null && typeof payload === 'object' &&
      !Array.isArray(payload) && Reflect.get(payload, 'error') === 'stale_parent_revision'
    ? 'stale_revision'
    : 'save_failed';
}

export type PersistedEditorFieldIssue = {
  readonly field: FieldIssue['field'];
  readonly code: 'invalid_field';
};

export type ItemEditorPersistenceController = {
  readonly save: (command: ItemEditorSaveCommand) => Promise<ItemEditorPublishResult>;
};

/** Owns assessment saves or revision-draft autosave and publication behind one editor operation. */
export function useItemEditorPersistence(
  config: UseItemEditorPersistenceConfig,
  buildPayload: () => Draft,
  draft: Draft,
): ItemEditorPersistenceController {
  const initialMode = useRef(config._tag);
  if (initialMode.current !== config._tag) {
    throw new Error('Item editor persistence mode cannot change after mounting.');
  }

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configRef = useRef(config);
  const buildPayloadRef = useRef(buildPayload);
  configRef.current = config;
  buildPayloadRef.current = buildPayload;

  const queueRef = useRef<RevisionDraftSessionQueue | null>(null);
  if (config._tag !== 'Assessment' && queueRef.current === null) {
    queueRef.current = createRevisionDraftSessionQueue(async () => {
      const current = configRef.current;
      if (current._tag === 'Assessment') {
        throw new Error('Revision persistence configuration is unavailable.');
      }
      const response = await fetch(`/api/drafts/${current.draftSessionId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildPayloadRef.current()),
      });
      if (!response.ok) throw new Error('revision_autosave_failed');
    }, () => configRef.current.onAutosaveError?.('save_failed'));
  }
  const queue = queueRef.current;

  useEffect(() => {
    if (config._tag === 'Assessment' || queue === null) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      autosaveTimer.current = null;
      queue.enqueueAutosave();
    }, 800);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    };
  }, [draft, config._tag, config.tagsCsv, queue]);

  async function save(command: ItemEditorSaveCommand): Promise<ItemEditorPublishResult> {
    const current = configRef.current;
    if (current._tag === 'Assessment') return await current.save(command);
    if (queue === null) throw new Error('Revision persistence queue is unavailable.');

    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
    await queue.beginPublish();
    let published = false;
    try {
      const result = current._tag === 'Bank'
        ? await publishDraftRequest(`/api/drafts/${current.draftSessionId}/create-question`, {
          draft: command.draft,
        })
        : await publishDraftRequest(`/api/drafts/${current.draftSessionId}/publish`, {
          sourceRevisionId: current.sourceRevisionId,
          draft: command.draft,
        });
      published = true;
      globalThis.location.assign(
        current._tag === 'Bank' ? `/items/${result.itemId}` : current.returnHref,
      );
      return result;
    } finally {
      queue.finishPublish(published);
    }
  }

  return { save };
}

export async function publishDraftRequest(
  endpoint: string,
  body: unknown,
): Promise<ItemEditorPublishResult> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const json = parsePublishResponse(text);
  if (!response.ok) {
    throw new PublishRequestFailure(
      parseItemEditorFailureCode(response.status, json),
      parsePersistedFieldIssues(json?.issues),
    );
  }
  if (!json || typeof json.itemId !== 'string' || typeof json.rev !== 'number') {
    throw new PublishRequestFailure('save_failed', []);
  }
  return {
    itemId: json.itemId,
    rev: json.rev,
    identifier: typeof json.identifier === 'string' ? json.identifier : String(json.itemId),
  };
}

function parsePublishResponse(text: string): {
  readonly itemId?: string;
  readonly rev?: number;
  readonly identifier?: string;
  readonly error?: string;
  readonly message?: string;
  readonly issues?: unknown;
} | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    // SAFETY: The object shape is checked above and each consumed field is parsed below.
    const record = parsed as Record<string, unknown>;
    return {
      itemId: typeof record.itemId === 'string' ? record.itemId : undefined,
      rev: typeof record.rev === 'number' ? record.rev : undefined,
      identifier: typeof record.identifier === 'string' ? record.identifier : undefined,
      error: typeof record.error === 'string' ? record.error : undefined,
      message: typeof record.message === 'string' ? record.message : undefined,
      issues: record.issues,
    };
  } catch (_cause: unknown) {
    return null;
  }
}

/** Refine server field hints without trusting response text as author-facing copy. */
export function parsePersistedFieldIssues(value: unknown): PersistedEditorFieldIssue[] {
  if (!Array.isArray(value)) return [];
  const issues: PersistedEditorFieldIssue[] = [];
  for (const input of value) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) continue;
    const field = parseFieldKey(Reflect.get(input, 'field')) ?? 'general';
    if (!issues.some((issue) => issue.field === field)) {
      issues.push({ field, code: 'invalid_field' });
    }
  }
  return issues;
}

/** Publication failure with field-level issues that the item editor can render. */
export class PublishRequestFailure extends Error {
  constructor(
    readonly code: ItemEditorFailureCode,
    readonly issues: readonly PersistedEditorFieldIssue[],
  ) {
    super(code);
  }
}
