import type { AIGenerationReference } from './ai/generation_reference.ts';
import { parseAIGenerationReference } from './ai/generation_reference.ts';
import { parseEvidenceAnchors } from './conversion/source_codec.ts';
import type { EvidenceAnchor } from './conversion/source_model.ts';
import {
  parseNonEmptyString,
  parseNonNegativeInteger,
  parsePositiveInteger,
  parseSha256,
  parseTimestamp,
} from './persistence_parse.ts';
import { isQuestionTypeId, type QuestionTypeId } from './types/registry.ts';

/** Safe identity facts captured when an actor contributes to question history. */
export type QuestionActorSnapshot = {
  readonly id: string;
  readonly displayName: string | null;
  readonly email: string;
};

/** Deterministic conversion details preserved with an imported question origin. */
export type DeterministicImportAssistance = {
  readonly _tag: 'DeterministicImport';
  readonly adapter: {
    readonly id: string;
    readonly label: string;
    readonly version: string;
  };
};

/** AI generation details preserved with an imported question origin. */
export type AiGeneratedAssistance = {
  readonly _tag: 'AiGenerated';
  readonly jobId: string;
  readonly generation: AIGenerationReference;
};

/** The conversion method that produced an imported question. */
export type ImportedQuestionAssistance =
  | DeterministicImportAssistance
  | AiGeneratedAssistance;

/** Whether one revision still uses source-owned XML or QFlow-authored content. */
export type QuestionContentBasis = 'source' | 'qflow';

/** One accepted review decision preserved from the conversion workbench. */
export type QuestionProvenanceReview = {
  readonly decision: 'accepted';
  readonly reviewer: QuestionActorSnapshot;
  readonly reviewedAt: string;
  readonly note: string | null;
  readonly contentHash: string;
  readonly contextHash: string;
};

/** Immutable facts describing how a question first entered the workspace. */
export type QuestionOrigin =
  | {
    readonly _tag: 'Authored';
  }
  | {
    readonly _tag: 'Imported';
    readonly artifact: {
      readonly id: string;
      readonly filename: string;
      readonly mimeType: string;
      readonly size: number;
      readonly sha256: string;
    };
    readonly migrationRunId: string;
    readonly migrationItemId: string;
    readonly href: string;
    readonly identifier: string;
    readonly providedBy: QuestionActorSnapshot;
    readonly assistance: ImportedQuestionAssistance;
    readonly evidence: readonly EvidenceAnchor[];
    readonly review: QuestionProvenanceReview;
  }
  | {
    readonly _tag: 'Variant';
    readonly source: {
      readonly questionId: string;
      readonly revision: number;
    };
    readonly transformation: {
      readonly kind: 'construct_preserving_variant' | 'compatible_type_transform';
      readonly fromType: QuestionTypeId;
      readonly toType: QuestionTypeId;
    };
  };

/** The event that created one immutable question revision. */
export type QuestionRevisionEvent =
  | {
    readonly operation: 'created';
    readonly author: QuestionActorSnapshot;
    readonly parentRevision: null;
    readonly contentBasis: QuestionContentBasis;
  }
  | {
    readonly operation: 'revised' | 'transformed';
    readonly author: QuestionActorSnapshot;
    readonly parentRevision: number;
    readonly contentBasis: QuestionContentBasis;
  }
  | {
    readonly operation: 'restored';
    readonly author: QuestionActorSnapshot;
    readonly parentRevision: number;
    readonly restoredFromRevision: number;
    readonly contentBasis: QuestionContentBasis;
  };

/** Complete history facts projected for one question revision. */
export type QuestionProvenance = {
  readonly version: 1;
  readonly origin: QuestionOrigin;
  readonly event: QuestionRevisionEvent;
};

/** Intent accepted by question persistence instead of caller-authored history facts. */
export type QuestionProvenanceCommand =
  | { readonly _tag: 'Authored' }
  | {
    readonly _tag: 'Revision';
    readonly operation: 'revised' | 'transformed';
    readonly expectedParentRevision: number;
  }
  | {
    readonly _tag: 'Revision';
    readonly operation: 'restored';
    readonly expectedParentRevision: number;
    readonly restoredFromRevision: number;
  };

/** Server-verified variant lineage accepted only by the dedicated persistence entry point. */
export type VariantQuestionProvenanceCommand = {
  readonly _tag: 'Variant';
  readonly origin: Extract<QuestionOrigin, { readonly _tag: 'Variant' }>;
  readonly contentBasis: QuestionContentBasis;
};

/** Accepted migration item bound to the import content being committed. */
export type ImportedQuestionProvenanceCommand = {
  readonly _tag: 'Migration';
  readonly origin: Extract<QuestionOrigin, { readonly _tag: 'Imported' }>;
};

/** Provenance intent resolved only by the appropriate question persistence entry point. */
export type QuestionProvenanceResolutionCommand =
  | QuestionProvenanceCommand
  | ImportedQuestionProvenanceCommand
  | VariantQuestionProvenanceCommand;

/** Immediate persisted parent required to resolve one legal provenance transition. */
export type QuestionProvenanceParent = {
  readonly revision: number;
  readonly event: QuestionRevisionEvent;
};

/** Complete-history facts needed by trusted revision intent resolution. */
export type QuestionProvenanceHistoryState = {
  readonly entries: ReadonlyMap<number, QuestionProvenanceEntry>;
  readonly origin: QuestionOrigin | null;
  readonly parent: QuestionProvenanceParent | null;
};

/** Provenance intent accepted by the canonical revision engine. */
export type QuestionRevisionProvenanceIntent =
  | {
    readonly _tag: 'Explicit';
    readonly command: QuestionProvenanceResolutionCommand;
  }
  | {
    readonly _tag: 'EnsureAuthoredRevision';
  };

/** Raised when an author attempts to save against a revision that is no longer current. */
export class StaleQuestionRevisionError extends Error {
  readonly expectedParentRevision: number;
  readonly actualParentRevision: number;

  constructor(expectedParentRevision: number, actualParentRevision: number) {
    super('The question changed after this edit was prepared.');
    this.name = 'StaleQuestionRevisionError';
    this.expectedParentRevision = expectedParentRevision;
    this.actualParentRevision = actualParentRevision;
  }
}

/** Provenance stored on the first revision, which owns the immutable question origin. */
export type InitialQuestionProvenanceEntry = {
  readonly version: 1;
  readonly origin: QuestionOrigin;
  readonly event: Extract<QuestionRevisionEvent, { readonly operation: 'created' }>;
};

/** Provenance stored on a later revision, which references the first revision's origin. */
export type DerivedQuestionProvenanceEntry = {
  readonly version: 1;
  readonly event: Exclude<QuestionRevisionEvent, { readonly operation: 'created' }>;
};

/** Exact provenance payload persisted in one revision metadata envelope. */
export type QuestionProvenanceEntry =
  | InitialQuestionProvenanceEntry
  | DerivedQuestionProvenanceEntry;

/** Build an immutable actor snapshot from a verified workspace user. */
export function createQuestionActorSnapshot(input: {
  readonly id: string;
  readonly displayName: string | null;
  readonly email: string;
}): QuestionActorSnapshot {
  const displayName = input.displayName?.trim() ?? null;
  return {
    id: parseNonEmptyString(input.id, 'Question history actor ID is required.'),
    displayName: displayName || null,
    email: parseNonEmptyString(input.email, 'Question history actor email is required.'),
  };
}

/** Parse a question actor snapshot from persistence. */
export function parseQuestionActorSnapshot(value: unknown): QuestionActorSnapshot {
  return parseActor(value);
}

/** Build the first revision's authored origin and creation event. */
export function createAuthoredQuestionProvenance(
  author: QuestionActorSnapshot,
): InitialQuestionProvenanceEntry {
  return {
    version: 1,
    origin: {
      _tag: 'Authored',
    },
    event: {
      operation: 'created',
      author: createQuestionActorSnapshot(author),
      parentRevision: null,
      contentBasis: 'qflow',
    },
  };
}

/** Build the first revision's imported origin and creation event. */
export function createImportedQuestionProvenance(input: {
  readonly author: QuestionActorSnapshot;
  readonly origin: Extract<QuestionOrigin, { readonly _tag: 'Imported' }>;
}): InitialQuestionProvenanceEntry {
  const provenance = parseQuestionProvenanceEntry({
    version: 1,
    origin: input.origin,
    event: {
      operation: 'created',
      author: input.author,
      parentRevision: null,
      contentBasis: 'source',
    },
  });
  if (!('origin' in provenance)) {
    throw new Error('Imported question provenance must own its origin.');
  }
  return provenance;
}

/** Build the first revision's construct-preserving variant origin. */
function createVariantQuestionProvenance(input: {
  readonly author: QuestionActorSnapshot;
  readonly origin: Extract<QuestionOrigin, { readonly _tag: 'Variant' }>;
  readonly contentBasis: QuestionContentBasis;
}): InitialQuestionProvenanceEntry {
  const provenance = parseQuestionProvenanceEntry({
    version: 1,
    origin: input.origin,
    event: {
      operation: 'created',
      author: input.author,
      parentRevision: null,
      contentBasis: input.contentBasis,
    },
  });
  if (!('origin' in provenance)) {
    throw new Error('Variant question provenance must own its origin.');
  }
  return provenance;
}

/** Build the provenance event for a later revision. */
export function createDerivedQuestionProvenance(input: {
  readonly operation: 'revised' | 'transformed';
  readonly author: QuestionActorSnapshot;
  readonly parentRevision: number;
  readonly parentContentBasis: QuestionContentBasis;
}): DerivedQuestionProvenanceEntry {
  if (input.operation === 'transformed' && input.parentContentBasis !== 'source') {
    throw new Error('Only a source-backed question revision can be transformed.');
  }
  return {
    version: 1,
    event: {
      operation: input.operation,
      author: createQuestionActorSnapshot(input.author),
      parentRevision: parsePositiveInteger(
        input.parentRevision,
        'Parent question revision must be positive.',
      ),
      contentBasis: input.operation === 'transformed' ? 'qflow' : input.parentContentBasis,
    },
  };
}

/** Resolve one trusted persistence intent from verified actor and complete history facts. */
export function resolveQuestionRevisionProvenance(
  author: QuestionActorSnapshot,
  intent: QuestionRevisionProvenanceIntent,
  history: QuestionProvenanceHistoryState,
): QuestionProvenanceEntry {
  const command = resolveQuestionProvenanceCommand(intent, history);
  const parent = history.parent;
  if (parent === null) {
    if (command._tag === 'Revision') {
      throw new Error('The first question revision requires authored or migration provenance.');
    }
    if (command._tag === 'Authored') return createAuthoredQuestionProvenance(author);
    if (command._tag === 'Variant') {
      return createVariantQuestionProvenance({
        author,
        origin: command.origin,
        contentBasis: command.contentBasis,
      });
    }
    return createImportedQuestionProvenance({ author, origin: command.origin });
  }
  if (command._tag !== 'Revision') {
    throw new Error('Later question revisions require explicit revision provenance.');
  }
  if (command.expectedParentRevision !== parent.revision) {
    throw new StaleQuestionRevisionError(command.expectedParentRevision, parent.revision);
  }
  if (command.operation === 'restored') {
    if (command.restoredFromRevision >= parent.revision || command.restoredFromRevision < 1) {
      throw new Error('Restore source must precede the current revision.');
    }
    const source = history.entries.get(command.restoredFromRevision);
    if (!source) throw new Error('Restore source is missing from persisted history.');
    return {
      version: 1,
      event: {
        operation: 'restored',
        author,
        parentRevision: parent.revision,
        restoredFromRevision: command.restoredFromRevision,
        contentBasis: source.event.contentBasis,
      },
    };
  }
  return createDerivedQuestionProvenance({
    operation: command.operation,
    author,
    parentRevision: parent.revision,
    parentContentBasis: parent.event.contentBasis,
  });
}

function resolveQuestionProvenanceCommand(
  intent: QuestionRevisionProvenanceIntent,
  history: QuestionProvenanceHistoryState,
): QuestionProvenanceResolutionCommand {
  if (intent._tag === 'Explicit') return intent.command;
  if (history.parent === null) return { _tag: 'Authored' };
  if (history.origin?._tag !== 'Authored') {
    throw new Error('Authored refresh cannot replace a question with a different origin.');
  }
  return {
    _tag: 'Revision',
    operation: 'revised',
    expectedParentRevision: history.parent.revision,
  };
}

/** Combine one persisted revision event with the question's immutable origin. */
export function hydrateQuestionProvenance(
  origin: QuestionOrigin,
  entry: QuestionProvenanceEntry,
): QuestionProvenance {
  if (!canOwnSourceContent(origin) && entry.event.contentBasis !== 'qflow') {
    throw new Error('This question origin cannot own source-backed revisions.');
  }
  return {
    version: 1,
    origin,
    event: entry.event,
  };
}

/** Return the immutable origin owned by a first-revision provenance entry. */
export function questionOriginFromEntry(entry: QuestionProvenanceEntry): QuestionOrigin {
  if (!('origin' in entry)) {
    throw new Error('The first question revision is missing its origin.');
  }
  return entry.origin;
}

/** Parse a persisted provenance entry without repairing contradictory fields. */
export function parseQuestionProvenanceEntry(value: unknown): QuestionProvenanceEntry {
  const record = parseRecord(value, 'Question provenance entry must be an object.');
  if (Object.hasOwn(record, 'origin')) {
    assertExactKeys(record, ['version', 'origin', 'event'], 'initial question provenance');
    if (record.version !== 1) throw new Error('Question provenance version must be 1.');
    const event = parseRevisionEvent(record.event);
    if (event.operation !== 'created') {
      throw new Error('Only the first question revision can own an origin.');
    }
    const origin = parseQuestionOrigin(record.origin);
    if (
      (!canOwnSourceContent(origin) && event.contentBasis !== 'qflow') ||
      (origin._tag === 'Imported' && event.contentBasis !== 'source')
    ) {
      throw new Error('Initial question provenance has a contradictory content basis.');
    }
    return {
      version: 1,
      origin,
      event,
    };
  }
  assertExactKeys(record, ['version', 'event'], 'derived question provenance');
  if (record.version !== 1) throw new Error('Question provenance version must be 1.');
  const event = parseRevisionEvent(record.event);
  if (event.operation === 'created') {
    throw new Error('Created question provenance must include an origin.');
  }
  return { version: 1, event };
}

/** Imported origins and exact same-type copies can retain a source-owned scoring program. */
export function canOwnSourceContent(origin: QuestionOrigin): boolean {
  return origin._tag === 'Imported' ||
    (origin._tag === 'Variant' && origin.transformation.kind === 'construct_preserving_variant');
}

/** Parse an immutable question origin from persistence. */
export function parseQuestionOrigin(value: unknown): QuestionOrigin {
  const record = parseRecord(value, 'Question origin must be an object.');
  if (record._tag === 'Authored') {
    assertExactKeys(record, ['_tag'], 'authored question origin');
    return { _tag: 'Authored' };
  }
  if (record._tag === 'Variant') {
    assertExactKeys(record, ['_tag', 'source', 'transformation'], 'variant question origin');
    const source = parseRecord(record.source, 'Variant source must be an object.');
    assertExactKeys(source, ['questionId', 'revision'], 'variant question source');
    const transformation = parseRecord(
      record.transformation,
      'Variant transformation must be an object.',
    );
    assertExactKeys(
      transformation,
      ['kind', 'fromType', 'toType'],
      'variant question transformation',
    );
    const fromType = parseQuestionType(
      transformation.fromType,
      'Variant source question type is invalid.',
    );
    const toType = parseQuestionType(
      transformation.toType,
      'Variant target question type is invalid.',
    );
    const kind = transformation.kind;
    if (
      kind !== 'construct_preserving_variant' && kind !== 'compatible_type_transform'
    ) {
      throw new Error(`Unsupported variant transformation: ${String(kind)}`);
    }
    if (
      (kind === 'construct_preserving_variant' && fromType !== toType) ||
      (kind === 'compatible_type_transform' && fromType === toType)
    ) {
      throw new Error('Variant transformation kind contradicts its question types.');
    }
    return {
      _tag: 'Variant',
      source: {
        questionId: parseNonEmptyString(
          source.questionId,
          'Variant source question ID is required.',
        ),
        revision: parsePositiveInteger(
          source.revision,
          'Variant source question revision must be positive.',
        ),
      },
      transformation: { kind, fromType, toType },
    };
  }
  if (record._tag !== 'Imported') {
    throw new Error(`Unsupported question origin: ${String(record._tag)}`);
  }
  assertExactKeys(
    record,
    [
      '_tag',
      'artifact',
      'migrationRunId',
      'migrationItemId',
      'href',
      'identifier',
      'providedBy',
      'assistance',
      'evidence',
      'review',
    ],
    'imported question origin',
  );
  return {
    _tag: 'Imported',
    artifact: parseArtifact(record.artifact),
    migrationRunId: parseNonEmptyString(
      record.migrationRunId,
      'Migration run ID is required.',
    ),
    migrationItemId: parseNonEmptyString(
      record.migrationItemId,
      'Migration item ID is required.',
    ),
    href: parseNonEmptyString(record.href, 'Migration source path is required.'),
    identifier: parseNonEmptyString(
      record.identifier,
      'Migration source identifier is required.',
    ),
    providedBy: parseActor(record.providedBy),
    assistance: parseImportedAssistance(record.assistance),
    evidence: parseEvidenceAnchors(record.evidence),
    review: parseReview(record.review),
  };
}

function parseQuestionType(value: unknown, message: string): QuestionTypeId {
  if (!isQuestionTypeId(value)) throw new Error(message);
  return value;
}

function parseRevisionEvent(value: unknown): QuestionRevisionEvent {
  const record = parseRecord(value, 'Question revision event must be an object.');
  assertExactKeys(
    record,
    record.operation === 'restored'
      ? ['operation', 'author', 'parentRevision', 'restoredFromRevision', 'contentBasis']
      : ['operation', 'author', 'parentRevision', 'contentBasis'],
    'question revision event',
  );
  const author = parseActor(record.author);
  const contentBasis = parseContentBasis(record.contentBasis);
  if (record.operation === 'created') {
    if (record.parentRevision !== null) {
      throw new Error('Created question provenance cannot have a parent revision.');
    }
    return { operation: 'created', author, parentRevision: null, contentBasis };
  }
  if (record.operation === 'restored') {
    const parentRevision = parsePositiveInteger(
      record.parentRevision,
      'Parent question revision must be positive.',
    );
    const restoredFromRevision = parsePositiveInteger(
      record.restoredFromRevision,
      'Restored question revision must be positive.',
    );
    if (restoredFromRevision >= parentRevision) {
      throw new Error('Restore source must precede the parent revision.');
    }
    return { operation: 'restored', author, parentRevision, restoredFromRevision, contentBasis };
  }
  if (record.operation !== 'revised' && record.operation !== 'transformed') {
    throw new Error(`Unsupported question revision operation: ${String(record.operation)}`);
  }
  if (record.operation === 'transformed' && contentBasis !== 'qflow') {
    throw new Error('Transformed question provenance must use QFlow-authored content.');
  }
  return {
    operation: record.operation,
    author,
    parentRevision: parsePositiveInteger(
      record.parentRevision,
      'Parent question revision must be positive.',
    ),
    contentBasis,
  };
}

function parseContentBasis(value: unknown): QuestionContentBasis {
  if (value === 'source' || value === 'qflow') return value;
  throw new Error(`Unsupported question content basis: ${String(value)}`);
}

function parseActor(value: unknown): QuestionActorSnapshot {
  const record = parseRecord(value, 'Question history actor must be an object.');
  assertExactKeys(record, ['id', 'displayName', 'email'], 'question history actor');
  if (record.displayName !== null && typeof record.displayName !== 'string') {
    throw new Error('Question history actor display name must be a string or null.');
  }
  return createQuestionActorSnapshot({
    id: parseNonEmptyString(record.id, 'Question history actor ID is required.'),
    displayName: record.displayName,
    email: parseNonEmptyString(record.email, 'Question history actor email is required.'),
  });
}

function parseImportedAssistance(value: unknown): ImportedQuestionAssistance {
  const record = parseRecord(value, 'Imported question assistance must be an object.');
  if (record._tag === 'DeterministicImport') {
    assertExactKeys(record, ['_tag', 'adapter'], 'deterministic import assistance');
    const adapter = parseRecord(record.adapter, 'Conversion adapter must be an object.');
    assertExactKeys(adapter, ['id', 'label', 'version'], 'conversion adapter');
    return {
      _tag: 'DeterministicImport',
      adapter: {
        id: parseNonEmptyString(adapter.id, 'Conversion adapter ID is required.'),
        label: parseNonEmptyString(adapter.label, 'Conversion adapter label is required.'),
        version: parseNonEmptyString(adapter.version, 'Conversion adapter version is required.'),
      },
    };
  }
  if (record._tag === 'AiGenerated') {
    assertExactKeys(record, ['_tag', 'jobId', 'generation'], 'AI generation assistance');
    return {
      _tag: 'AiGenerated',
      jobId: parseNonEmptyString(record.jobId, 'AI generation job ID is required.'),
      generation: parseAIGenerationReference(record.generation),
    };
  }
  throw new Error(`Unsupported imported question assistance: ${String(record._tag)}`);
}

function parseArtifact(
  value: unknown,
): Extract<QuestionOrigin, { readonly _tag: 'Imported' }>['artifact'] {
  const record = parseRecord(value, 'Question source artifact must be an object.');
  assertExactKeys(
    record,
    ['id', 'filename', 'mimeType', 'size', 'sha256'],
    'question source artifact',
  );
  return {
    id: parseNonEmptyString(record.id, 'Source artifact ID is required.'),
    filename: parseNonEmptyString(record.filename, 'Source filename is required.'),
    mimeType: parseNonEmptyString(record.mimeType, 'Source MIME type is required.'),
    size: parseNonNegativeInteger(record.size, 'Source artifact size is invalid.'),
    sha256: parseSha256(record.sha256, 'Source artifact hash is invalid.'),
  };
}

function parseReview(value: unknown): QuestionProvenanceReview {
  const record = parseRecord(value, 'Question origin review must be an object.');
  assertExactKeys(
    record,
    ['decision', 'reviewer', 'reviewedAt', 'note', 'contentHash', 'contextHash'],
    'question origin review',
  );
  if (record.decision !== 'accepted') {
    throw new Error('Committed question provenance requires an accepted review.');
  }
  if (record.note !== null && typeof record.note !== 'string') {
    throw new Error('Question review note must be a string or null.');
  }
  const note = typeof record.note === 'string' ? record.note.trim() : null;
  return {
    decision: 'accepted',
    reviewer: parseActor(record.reviewer),
    reviewedAt: parseTimestamp(record.reviewedAt, 'Question review timestamp is invalid.'),
    note: note || null,
    contentHash: parseSha256(record.contentHash, 'Reviewed question content hash is invalid.'),
    contextHash: parseSha256(record.contextHash, 'Reviewed question context hash is invalid.'),
  };
}

function parseRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  // SAFETY: the runtime checks above establish a non-array object boundary.
  return value as Record<string, unknown>;
}

function assertExactKeys(
  record: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string,
): void {
  const expectedKeys = new Set(expected);
  const unknown = Object.keys(record).filter((key) => !expectedKeys.has(key));
  const missing = expected.filter((key) => !Object.hasOwn(record, key));
  if (unknown.length || missing.length) {
    throw new Error(
      `Invalid ${label} keys. Missing: ${missing.join(', ') || 'none'}; unknown: ${
        unknown.join(', ') || 'none'
      }.`,
    );
  }
}
