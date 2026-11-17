import { expect, test as testCase } from 'vitest';

import { parseAssessmentQuestionCommand } from '../lib/assessment_question_command.ts';
import {
  assessmentPlacementFollowing,
  insertAssessmentPlacements,
} from '../lib/assessment_insertion.ts';

testCase(
  'question commands reject inherited type names and malformed persistence identities',
  () => {
    const create = {
      operation: 'create',
      partId: crypto.randomUUID(),
      draft: { type: 'single_select' },
    };
    const revise = {
      operation: 'revise',
      expectedParentRevision: 1,
      placementId: crypto.randomUUID(),
      itemId: crypto.randomUUID(),
      draft: create.draft,
    };
    const variant = {
      operation: 'variant',
      requestId: crypto.randomUUID(),
      partId: create.partId,
      sourcePlacementId: revise.placementId,
      sourceItemId: revise.itemId,
      sourceRevision: 1,
      targetType: 'single_select',
    };
    for (const command of [create, revise, variant]) {
      expect(parseAssessmentQuestionCommand(command).ok).toStrictEqual(true);
    }
    const parsedRevision = parseAssessmentQuestionCommand(revise);
    expect(
      parsedRevision.ok && parsedRevision.command._tag === 'Revise'
        ? parsedRevision.command.expectedParentRevision
        : null,
    ).toStrictEqual(1);
    for (
      const value of [
        undefined,
        null,
        '',
        '1',
        0,
        -1,
        1.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
      ]
    ) {
      expect(parseAssessmentQuestionCommand({ ...revise, expectedParentRevision: value }).ok)
        .toStrictEqual(false);
    }
    for (const type of ['constructor', 'toString', '__proto__', 'unsupported', null, 1]) {
      for (const command of [create, revise]) {
        expect(parseAssessmentQuestionCommand({ ...command, draft: { type } }).ok).toStrictEqual(
          false,
        );
      }
    }
    for (const value of [undefined, null, '', 'not-a-uuid', 1]) {
      for (
        const [command, key] of [
          [create, 'partId'],
          [revise, 'itemId'],
          [revise, 'placementId'],
          [variant, 'requestId'],
          [variant, 'partId'],
          [variant, 'sourceItemId'],
          [variant, 'sourcePlacementId'],
        ] as const
      ) {
        expect(parseAssessmentQuestionCommand({ ...command, [key]: value }).ok).toStrictEqual(
          false,
        );
      }
    }
  },
);

testCase(
  'assessment copies require an explicit source placement and reject caller-supplied order or content',
  () => {
    const sourcePlacementId = crypto.randomUUID();
    const sourceItemId = crypto.randomUUID();
    const input = {
      operation: 'variant',
      requestId: crypto.randomUUID(),
      partId: crypto.randomUUID(),
      sourcePlacementId,
      sourceItemId,
      sourceRevision: 3,
      targetType: 'single_select',
    };
    expect(parseAssessmentQuestionCommand(input)).toStrictEqual({
      ok: true,
      command: {
        _tag: 'Variant',
        requestId: input.requestId,
        partId: input.partId,
        sourcePlacementId,
        sourceItemId,
        sourceRevision: 3,
        targetType: 'single_select',
      },
    });
    for (const value of [undefined, null, '', 'invalid', 1]) {
      expect(parseAssessmentQuestionCommand({ ...input, sourcePlacementId: value }).ok)
        .toStrictEqual(false);
    }
    for (
      const patch of [
        { sourceRevision: 0 },
        { sourceRevision: 1.5 },
        { sourceRevision: '3' },
        { beforePlacementId: crypto.randomUUID() },
        { draft: {} },
        { targetType: 'invalid' },
      ]
    ) expect(parseAssessmentQuestionCommand({ ...input, ...patch }).ok).toStrictEqual(false);
  },
);
testCase(
  'an adjacent copy stays in its part and missing sources never become implicit append',
  () => {
    const source = { id: 'source' }, next = { id: 'next' }, copy = { id: 'copy' };
    expect(insertAssessmentPlacements(
      [source, next],
      [copy],
      assessmentPlacementFollowing([source, next], source.id),
    )).toStrictEqual([source, copy, next]);
    expect(insertAssessmentPlacements(
      [source],
      [copy],
      assessmentPlacementFollowing([source], source.id),
    )).toStrictEqual([source, copy]);
    expect(() => assessmentPlacementFollowing([next], source.id)).toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('Duplication source is missing')
      ),
    );
  },
);
