import { expect, test as testCase } from 'vitest';

import { parseQuestionProvenanceHistory } from '../lib/question_provenance_history.ts';

import {
  createAuthoredQuestionProvenance,
  createDerivedQuestionProvenance,
  createImportedQuestionProvenance,
  hydrateQuestionProvenance,
  parseQuestionProvenanceEntry,
  type QuestionActorSnapshot,
  questionOriginFromEntry,
  resolveQuestionRevisionProvenance,
} from '../lib/question_provenance.ts';

const ARTIFACT_HASH = 'a'.repeat(64);
const CONTENT_HASH = 'b'.repeat(64);
const CONTEXT_HASH = 'c'.repeat(64);

const author: QuestionActorSnapshot = {
  id: 'user-1',
  displayName: 'Avery Author',
  email: 'avery@example.com',
};
const reviewer: QuestionActorSnapshot = {
  id: 'reviewer-1',
  displayName: 'Riley Reviewer',
  email: 'riley@example.com',
};

testCase('authored origin stores its creator once in the creation event', () => {
  const initial = createAuthoredQuestionProvenance(author);
  expect(initial.origin).toStrictEqual({ _tag: 'Authored' });
  expect(initial.event.author).toStrictEqual(author);
  expect(parseQuestionProvenanceEntry(initial)).toStrictEqual(initial);
  expect(() =>
    parseQuestionProvenanceEntry({
      ...initial,
      origin: { _tag: 'Authored', createdBy: author },
    })
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('unknown: createdBy')
    ),
  );
});

testCase(
  'same-type variants retain source basis while compatible transforms require generated basis',
  () => {
    const origin = {
      _tag: 'Variant' as const,
      source: { questionId: 'imported-source', revision: 1 },
      transformation: {
        kind: 'construct_preserving_variant' as const,
        fromType: 'text_entry' as const,
        toType: 'text_entry' as const,
      },
    };
    const initial = resolveQuestionRevisionProvenance(
      author,
      { _tag: 'Explicit', command: { _tag: 'Variant', origin, contentBasis: 'source' } },
      { parent: null, origin: null, entries: new Map() },
    );
    const history = parseQuestionProvenanceHistory([{ revision: 1, provenance: initial }]);
    expect(hydrateQuestionProvenance(history.origin, initial).event.contentBasis).toStrictEqual(
      'source',
    );
    expect(() =>
      parseQuestionProvenanceEntry({
        ...initial,
        origin: {
          ...origin,
          transformation: {
            kind: 'compatible_type_transform',
            fromType: 'single_select',
            toType: 'multi_select',
          },
        },
      })
    ).toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('contradictory content basis')
      ),
    );
  },
);

testCase('one canonical history parser validates and hydrates imported revision chains', () => {
  const initial = importedInitial();
  const transformed = createDerivedQuestionProvenance({
    operation: 'transformed',
    author,
    parentRevision: 1,
    parentContentBasis: 'source',
  });
  const revised = createDerivedQuestionProvenance({
    operation: 'revised',
    author,
    parentRevision: 2,
    parentContentBasis: 'qflow',
  });
  const history = parseQuestionProvenanceHistory([
    { revision: 3, provenance: revised },
    { revision: 1, provenance: initial },
    { revision: 2, provenance: transformed },
  ]);
  const origin = questionOriginFromEntry(initial);

  expect(history.origin).toStrictEqual(origin);
  expect(hydrateQuestionProvenance(origin, history.entries.get(3)!)).toStrictEqual({
    version: 1,
    origin,
    event: revised.event,
  });
  expect(Object.hasOwn(revised, 'origin')).toStrictEqual(false);
  expect(JSON.stringify(revised).includes('source.docx')).toStrictEqual(false);
});

testCase('canonical history parser rejects missing revisions and impossible transitions', () => {
  const initial = importedInitial();
  const transformed = createDerivedQuestionProvenance({
    operation: 'transformed',
    author,
    parentRevision: 1,
    parentContentBasis: 'source',
  });
  expect(() =>
    parseQuestionProvenanceHistory([
      { revision: 1, provenance: initial },
      {
        revision: 3,
        provenance: { ...transformed, event: { ...transformed.event, parentRevision: 2 } },
      },
    ])
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('missing or contradictory revision')
    ),
  );
  expect(() =>
    parseQuestionProvenanceHistory([
      { revision: 1, provenance: initial },
      {
        revision: 2,
        provenance: {
          ...transformed,
          event: { ...transformed.event, operation: 'revised', contentBasis: 'qflow' },
        },
      },
    ])
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('contradictory content transition')
    ),
  );
});

testCase('provenance rejects secret fields and unsupported assistance', () => {
  const initial = importedInitial();
  expect(() =>
    parseQuestionProvenanceEntry({
      ...initial,
      origin: {
        ...initial.origin,
        providedBy: { ...author, storageKey: 'private/source/key' },
      },
    })
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('unknown: storageKey')
    ),
  );
  expect(() =>
    parseQuestionProvenanceEntry({
      ...initial,
      origin: { ...initial.origin, assistance: { _tag: 'HumanAuthored' } },
    })
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('Unsupported imported question assistance')
    ),
  );
  expect(() =>
    parseQuestionProvenanceEntry({
      version: 1,
      event: {
        operation: 'duplicated',
        author,
        parentRevision: 1,
        contentBasis: 'qflow',
      },
    })
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('Unsupported question revision operation')
    ),
  );
});

function importedInitial() {
  return createImportedQuestionProvenance({
    author,
    origin: {
      _tag: 'Imported',
      artifact: {
        id: 'artifact-1',
        filename: 'source.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 2048,
        sha256: ARTIFACT_HASH,
      },
      migrationRunId: 'run-1',
      migrationItemId: 'migration-item-1',
      href: 'generated/question-1.xml',
      identifier: 'generated-1',
      providedBy: author,
      assistance: {
        _tag: 'AiGenerated',
        jobId: 'job-1',
        generation: {
          provider: 'openrouter_chat_completions',
          model: 'example/model',
          mode: 'thorough',
          promptVersion: 'qflow.assessment-generation.v1',
        },
      },
      evidence: [{
        kind: 'block',
        artifactId: 'normalized-artifact-1',
        artifactHash: ARTIFACT_HASH,
        blockId: 'block-3',
        quote: 'The source supports this answer.',
      }],
      review: {
        decision: 'accepted',
        reviewer,
        reviewedAt: '2026-07-30T14:00:00.000Z',
        note: 'Corrected one distractor before approval.',
        contentHash: CONTENT_HASH,
        contextHash: CONTEXT_HASH,
      },
    },
  });
}

testCase(
  'restoration lineage returns to the exact source content basis and rejects contradictions',
  () => {
    const initial = importedInitial();
    const transformed = createDerivedQuestionProvenance({
      operation: 'transformed',
      author,
      parentRevision: 1,
      parentContentBasis: 'source',
    });
    const restored = {
      version: 1,
      event: {
        operation: 'restored' as const,
        author,
        parentRevision: 2,
        restoredFromRevision: 1,
        contentBasis: 'source' as const,
      },
    };
    const rows = [
      { revision: 1, provenance: initial },
      { revision: 2, provenance: transformed },
      { revision: 3, provenance: restored },
    ];
    expect(parseQuestionProvenanceHistory(rows).entries.get(3)?.event).toStrictEqual(
      restored.event,
    );
    expect(() =>
      parseQuestionProvenanceHistory([...rows.slice(0, 2), {
        revision: 3,
        provenance: { ...restored, event: { ...restored.event, contentBasis: 'qflow' } },
      }])
    ).toThrowError(Error);
    expect(() =>
      parseQuestionProvenanceEntry({
        ...restored,
        event: { ...restored.event, restoredFromRevision: 2 },
      })
    ).toThrowError(Error);
  },
);

testCase(
  'restore intent derives content basis from persisted source without caller-supplied basis',
  () => {
    const initial = importedInitial();
    const parent = createDerivedQuestionProvenance({
      operation: 'transformed',
      author,
      parentRevision: 1,
      parentContentBasis: 'source',
    });
    const history = parseQuestionProvenanceHistory([
      { revision: 1, provenance: initial },
      { revision: 2, provenance: parent },
    ]);
    const intent = {
      _tag: 'Explicit' as const,
      command: {
        _tag: 'Revision' as const,
        operation: 'restored' as const,
        expectedParentRevision: 2,
        restoredFromRevision: 1,
      },
    };
    const restored = resolveQuestionRevisionProvenance(author, intent, {
      origin: history.origin,
      entries: history.entries,
      parent: { revision: 2, event: parent.event },
    });
    expect(restored.event.contentBasis).toStrictEqual('source');
    expect(() =>
      resolveQuestionRevisionProvenance(author, intent, {
        origin: history.origin,
        entries: new Map(),
        parent: { revision: 2, event: parent.event },
      })
    ).toThrowError(Error);
  },
);
