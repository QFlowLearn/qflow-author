import { expect, test as testCase } from 'vitest';

import {
  prepareQuestionPublication,
  prepareQuestionPublicationFromSource,
  type PrepareQuestionPublicationResult,
} from '../lib/services/publish.ts';
import type { RequestContext } from '../lib/tenants.ts';
import type { Draft } from '../lib/types/draft.ts';
import type { QuestionPublicationBaseline } from '../lib/services/questions.ts';
import { openPreparedQuestionRevision } from '../lib/question_revision_preparation.ts';
import { questionXmlFixture } from './question_xml_fixture.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';
import { scoreQtiItemServerSide } from '@longsightgroup/qti3-core';
import { buildQtiPreviewXml } from '../lib/qti_preview.ts';

const auth: RequestContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  role: 'owner',
};

const validDraft: Draft = {
  itemId: 'item-1',
  type: 'single_select',
  itemLanguage: newAuthoringItemLanguage(),
  title: 'Capital',
  bodyHtml: '<p>Geography</p>',
  promptHtml: 'What is the capital of France?',
  choices: [
    { id: 'A', text: 'Paris' },
    { id: 'B', text: 'Berlin' },
  ],
  correctId: 'A',
  tags: ['geo'],
};

testCase('prepareQuestionPublication prepares a new published revision', async () => {
  const result = await prepareQuestionPublication(auth, validDraft, {
    getQuestionPublicationBaseline: () => Promise.resolve(null),
    validateQtiXml: () => Promise.resolve({ ok: true, errors: [] }),
  });

  const prepared = requirePrepared(result);
  const saveInput = openPreparedQuestionRevision(prepared.saveInput);
  expect(prepared.itemId).toStrictEqual('item-1');
  expect(prepared.revision).toStrictEqual(1);
  expect(prepared.identifier).toStrictEqual('item-item-1-r1');
  expect(saveInput.questionId).toStrictEqual('item-1');
  expect(saveInput.draftState).toStrictEqual('published');
  expect(saveInput.metadata?.identifier).toStrictEqual('item-item-1-r1');
  expect(saveInput.metadata?.preservedSourceXml).toStrictEqual(false);
  expect(saveInput.provenance).toStrictEqual({ _tag: 'Authored' });
});

testCase(
  'copy preparation retains saved XML and explicitly refuses unavailable or repaired sources',
  async () => {
    const xml = await readQtiFixture('choice-points/single.xml');
    const draft = { ...validDraft, itemId: undefined, maximumScore: 3, preserveSourceXml: true };
    const source = { _tag: 'Copy' as const, itemId: 'copy-1', qtiXml: xml };
    const result = await prepareQuestionPublicationFromSource(draft, source);
    const prepared = requirePrepared(result);
    const saved = openPreparedQuestionRevision(prepared.saveInput);
    expect(prepared.identifier).toStrictEqual('item-copy-1-r1');
    expect(saved.metadata?.preservedSourceXml).toStrictEqual(true);
    const score = scoreQtiItemServerSide({
      itemXml: saved.qtiXml,
      trustedResponses: { RESPONSE: 'A' },
    });
    if (!(score.ok)) expect.unreachable('Expected score.ok');
    expect(score.score).toStrictEqual(3);
    for (const qtiXml of ['', '<qti-assessment-item>']) {
      const refused = await prepareQuestionPublicationFromSource(draft, { ...source, qtiXml });
      if (refused.ok) expect.unreachable('Expected !refused.ok');
      expect(refused.error.status).toStrictEqual(422);
      expect(refused.error.body.error).toStrictEqual('invalid_source_xml');
    }
    expect(source.qtiXml).toStrictEqual(xml);
  },
);

testCase(
  'prepareQuestionPublication reuses one generated identity across lookup and save',
  async () => {
    const { itemId: _itemId, ...draftWithoutItemId } = validDraft;
    let lookedUpItemId: string | null = null;
    const result = await prepareQuestionPublication(auth, draftWithoutItemId, {
      getQuestionPublicationBaseline: (_auth, itemId) => {
        lookedUpItemId = itemId;
        return Promise.resolve(null);
      },
      validateQtiXml: () => Promise.resolve({ ok: true, errors: [] }),
    });

    const prepared = requirePrepared(result);
    const saveInput = openPreparedQuestionRevision(prepared.saveInput);
    expect(prepared.itemId).toStrictEqual(lookedUpItemId);
    expect(saveInput.questionId).toStrictEqual(lookedUpItemId);
    expect(saveInput.body.itemId).toStrictEqual(undefined);
  },
);

testCase('prepareQuestionPublication increments the identifier from current metadata', async () => {
  const result = await prepareQuestionPublication(auth, validDraft, {
    getQuestionPublicationBaseline: () => Promise.resolve(baselineFixture({ revision: 2 })),
    validateQtiXml: () => Promise.resolve({ ok: true, errors: [] }),
  });

  const prepared = requirePrepared(result);
  const saveInput = openPreparedQuestionRevision(prepared.saveInput);
  expect(prepared.revision).toStrictEqual(3);
  expect(prepared.identifier).toStrictEqual('item-item-1-r3');
  expect(saveInput.provenance).toStrictEqual({
    _tag: 'Revision',
    operation: 'revised',
    expectedParentRevision: 2,
  });
});

testCase('prepareQuestionPublication preserves requested source XML', async () => {
  const sourceXml = questionXmlFixture('source');
  const result = await prepareQuestionPublication(
    auth,
    { ...validDraft, preserveSourceXml: true },
    {
      getQuestionPublicationBaseline: () => Promise.resolve(baselineFixture({ qtiXml: sourceXml })),
      validateQtiXml: (xml) => {
        expect(xml).toStrictEqual(sourceXml);
        return Promise.resolve({ ok: true, errors: [] });
      },
    },
  );

  const saveInput = openPreparedQuestionRevision(requirePrepared(result).saveInput);
  expect(saveInput.qtiXml).toStrictEqual(sourceXml);
  expect(saveInput.metadata?.preservedSourceXml).toStrictEqual(true);
});

testCase('prepareQuestionPublication marks edited imported content as transformed', async () => {
  const source = buildQtiPreviewXml(validDraft);
  if (!(source.ok)) expect.unreachable('Expected source.ok');
  const result = await prepareQuestionPublication(auth, validDraft, {
    getQuestionPublicationBaseline: () =>
      Promise.resolve(baselineFixture({ contentBasis: 'source', qtiXml: source.xml })),
    validateQtiXml: () => Promise.resolve({ ok: true, errors: [] }),
  });

  expect(openPreparedQuestionRevision(requirePrepared(result).saveInput).provenance).toStrictEqual({
    _tag: 'Revision',
    operation: 'transformed',
    expectedParentRevision: 1,
  });
});

testCase(
  'prepareQuestionPublication marks descendants of transformed content as revised',
  async () => {
    const result = await prepareQuestionPublication(auth, validDraft, {
      getQuestionPublicationBaseline: () =>
        Promise.resolve(baselineFixture({
          revision: 2,
          operation: 'transformed',
          contentBasis: 'qflow',
        })),
      validateQtiXml: () => Promise.resolve({ ok: true, errors: [] }),
    });

    expect(openPreparedQuestionRevision(requirePrepared(result).saveInput).provenance)
      .toStrictEqual({
        _tag: 'Revision',
        operation: 'revised',
        expectedParentRevision: 2,
      });
  },
);

testCase('prepareQuestionPublication returns field issues for invalid drafts', async () => {
  const result = await prepareQuestionPublication(auth, {
    ...validDraft,
    choices: [{ id: 'A', text: 'Only one option' }],
  }, {
    getQuestionPublicationBaseline: () => Promise.resolve(null),
    validateQtiXml: () => Promise.resolve({ ok: true, errors: [] }),
  });

  expect(result.ok).toStrictEqual(false);
  if (result.ok) throw new Error('Expected draft validation to fail.');
  expect(result.error.status).toStrictEqual(422);
  expect(result.error.body.error).toStrictEqual('invalid_draft');
  expect(result.error.body.issues[0].field).toStrictEqual('general');
});

testCase('prepareQuestionPublication reports driver errors', async () => {
  const result = await prepareQuestionPublication(auth, validDraft, {
    prepareDriverDraft: () => ({
      ok: false,
      reason: 'driver_error',
      issues: [{ field: 'general', message: 'Unsupported question type: example' }],
    }),
    getQuestionPublicationBaseline: () => Promise.resolve(null),
    validateQtiXml: () => Promise.resolve({ ok: true, errors: [] }),
  });

  expect(result.ok).toStrictEqual(false);
  if (result.ok) throw new Error('Expected driver preparation to fail.');
  expect(result.error.status).toStrictEqual(400);
  expect(result.error.body.error).toStrictEqual('driver_error');
});

testCase('prepareQuestionPublication reports invalid QTI', async () => {
  const result = await prepareQuestionPublication(auth, validDraft, {
    getQuestionPublicationBaseline: () => Promise.resolve(null),
    validateQtiXml: () =>
      Promise.resolve({
        ok: false,
        errors: [{ line: 1, col: 1, message: 'bad root element' }],
      }),
  });

  expect(result.ok).toStrictEqual(false);
  if (result.ok) throw new Error('Expected QTI validation to fail.');
  expect(result.error.status).toStrictEqual(422);
  expect(result.error.body.error).toStrictEqual('validation_failed');
  expect(result.error.body.issues[0].message).toStrictEqual('bad root element');
});

testCase('prepareQuestionPublication rejects unavailable preserved source XML', async () => {
  const result = await prepareQuestionPublication(
    auth,
    { ...validDraft, preserveSourceXml: true },
    {
      getQuestionPublicationBaseline: () => Promise.resolve(baselineFixture({ qtiXml: '' })),
      validateQtiXml: () => Promise.resolve({ ok: true, errors: [] }),
    },
  );

  expect(result.ok).toStrictEqual(false);
  if (result.ok) throw new Error('Expected source XML preservation to fail.');
  expect(result.error.status).toStrictEqual(422);
  expect(result.error.body.error).toStrictEqual('missing_source_xml');
});

testCase(
  'choice regeneration refuses unrecognized imported processing with or without explicit points',
  async () => {
    const marked = await readQtiFixture('choice-points/single.xml');
    const sourceXml = marked.replace(' normal-maximum="3"', '').replace(
      /\s*<qti-outcome-declaration identifier="MAXSCORE"[\s\S]*?<\/qti-outcome-declaration>/,
      '',
    );
    const original = scoreQtiItemServerSide({
      itemXml: sourceXml,
      trustedResponses: { RESPONSE: 'A' },
    });
    if (!(original.ok)) expect.unreachable('Expected original.ok');
    expect(original.score).toStrictEqual(3);
    const baseline = baselineFixture({ contentBasis: 'source', qtiXml: sourceXml });
    const before = structuredClone(baseline);
    for (const maximumScore of [2, undefined]) {
      const result = await prepareQuestionPublication(auth, { ...validDraft, maximumScore }, {
        getQuestionPublicationBaseline: () => Promise.resolve(baseline),
        validateQtiXml: () => Promise.resolve({ ok: true, errors: [] }),
      });
      if (result.ok) expect.unreachable('Expected !result.ok');
      expect(result.error.status).toStrictEqual(422);
      expect(result.error.body.error).toStrictEqual('source_points_not_editable');
      expect(baseline).toStrictEqual(before);
    }
  },
);

testCase(
  'omitting imported explicit points cannot silently regenerate a unit-score program',
  async () => {
    const sourceXml = await readQtiFixture('choice-points/single.xml');
    const result = await prepareQuestionPublication(auth, validDraft, {
      getQuestionPublicationBaseline: () =>
        Promise.resolve(baselineFixture({ contentBasis: 'source', qtiXml: sourceXml })),
      validateQtiXml: () => Promise.resolve({ ok: true, errors: [] }),
    });
    if (result.ok) expect.unreachable('Expected !result.ok');
    expect(result.error.body.error).toStrictEqual('source_points_not_preserved');
  },
);

testCase(
  'preserved source XML cannot retain an old maximum under a newly recorded point value',
  async () => {
    const sourceXml = await readQtiFixture('choice-points/single.xml');
    for (const contentBasis of ['source', 'qflow'] as const) {
      const result = await prepareQuestionPublication(
        auth,
        { ...validDraft, maximumScore: 0, preserveSourceXml: true },
        {
          getQuestionPublicationBaseline: () =>
            Promise.resolve(baselineFixture({ contentBasis, qtiXml: sourceXml })),
          validateQtiXml: () => Promise.resolve({ ok: true, errors: [] }),
        },
      );
      if (result.ok) expect.unreachable('Expected !result.ok');
      expect(result.error.status).toStrictEqual(422);
      expect(result.error.body.error).toStrictEqual('preserved_points_mismatch');
    }
  },
);

testCase(
  'explicit points cannot request source preservation without a source revision',
  async () => {
    const result = await prepareQuestionPublication(
      auth,
      { ...validDraft, maximumScore: 3, preserveSourceXml: true },
      {
        getQuestionPublicationBaseline: () => Promise.resolve(null),
        validateQtiXml: () => Promise.resolve({ ok: true, errors: [] }),
      },
    );
    if (result.ok) expect.unreachable('Expected !result.ok');
    expect(result.error.body.error).toStrictEqual('missing_source_xml');
  },
);

testCase(
  'recognized imported point programs may be edited explicitly or preserved at their exact maximum',
  async () => {
    const sourceXml = await readQtiFixture('choice-points/single.xml');
    for (
      const [maximumScore, preserveSourceXml] of [[0, false], [2.5, false], [3, true]] as const
    ) {
      const result = await prepareQuestionPublication(
        auth,
        { ...validDraft, maximumScore, preserveSourceXml },
        {
          getQuestionPublicationBaseline: () =>
            Promise.resolve(baselineFixture({ contentBasis: 'source', qtiXml: sourceXml })),
          validateQtiXml: () => Promise.resolve({ ok: true, errors: [] }),
        },
      );
      const saved = openPreparedQuestionRevision(requirePrepared(result).saveInput);
      expect(saved.body.maximumScore).toStrictEqual(maximumScore);
      if (preserveSourceXml) expect(saved.qtiXml).toStrictEqual(sourceXml);
      const scored = scoreQtiItemServerSide({
        itemXml: saved.qtiXml,
        trustedResponses: { RESPONSE: 'A' },
      });
      if (!(scored.ok)) expect.unreachable('Expected scored.ok');
      expect(scored.score).toStrictEqual(maximumScore);
    }
  },
);

function requirePrepared(result: PrepareQuestionPublicationResult) {
  if (!result.ok) throw new Error(`Expected preparation to succeed: ${result.error.body.message}`);
  return result.prepared;
}

function baselineFixture(input: {
  readonly revision?: number;
  readonly qtiXml?: string;
  readonly operation?: 'revised' | 'transformed';
  readonly contentBasis?: 'source' | 'qflow';
} = {}): QuestionPublicationBaseline {
  const revision = input.revision ?? 1;
  const actor = {
    id: auth.userId,
    displayName: 'Test Author',
    email: 'author@example.com',
  };
  const event = revision === 1
    ? {
      operation: 'created' as const,
      author: actor,
      parentRevision: null,
      contentBasis: input.contentBasis ?? 'qflow',
    }
    : {
      operation: input.operation ?? 'revised',
      author: actor,
      parentRevision: revision - 1,
      contentBasis: input.contentBasis ?? 'qflow',
    };
  return {
    questionId: 'item-1',
    title: 'Existing',
    tags: ['old'],
    revision: {
      id: 'revision-1',
      number: revision,
      qtiXml: input.qtiXml ?? '<qti-assessment-item/>',
      event,
    },
  };
}
