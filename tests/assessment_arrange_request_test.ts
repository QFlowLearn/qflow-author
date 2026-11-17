import { expect, test as testCase } from 'vitest';

import { parseAssessmentPartOptions } from '../lib/assessment_arrangement.ts';
import type { PartOptions } from '../lib/test_export.ts';
import { parseAssessmentArrangeHttpRequest } from '../lib/http/assessment_arrange_request.ts';
import { arrangeApiRoute as arrangeHandlerEndpoint } from '../lib/http/routes/assessment_api/arrange.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';

const arrangeHandler = arrangeHandlerEndpoint.handle;

const PART_ID = '10000000-0000-4000-8000-000000000001';
const PLACEMENT_ID = '10000000-0000-4000-8000-000000000002';
const QUESTION_ID = '10000000-0000-4000-8000-000000000003';
const FEEDBACK_ID = '10000000-0000-4000-8000-000000000004';

testCase('assessment arrange parser returns one exact service command', async () => {
  const result = await parseAssessmentArrangeHttpRequest(request({
    expectedVersion: '1'.repeat(64),
    parts: [{
      id: PART_ID.toUpperCase(),
      title: '  Part 1  ',
      placements: [{
        id: PLACEMENT_ID,
        itemId: QUESTION_ID,
        snapshotRev: 3,
        blueprintTargetId: 'fractions_apply',
      }],
      options: {
        navigationMode: 'linear',
        submissionMode: 'simultaneous',
        timeLimits: { minTime: 30, maxTime: 300 },
        instructionsHtml: '<p>Read carefully.</p>',
        feedback: [{
          id: FEEDBACK_ID,
          access: 'atEnd',
          showHide: 'show',
          outcomeIdentifier: 'TEST_FEEDBACK',
          html: '<p>Finished.</p>',
        }],
      },
    }],
  }));

  expect(result).toStrictEqual({
    ok: true,
    request: {
      expectedVersion: '1'.repeat(64),
      parts: [{
        id: PART_ID,
        title: 'Part 1',
        placements: [{
          id: PLACEMENT_ID,
          itemId: QUESTION_ID,
          snapshotRev: 3,
          blueprintTargetId: 'fractions_apply',
          fixed: false,
        }],
        options: {
          navigationMode: 'linear',
          submissionMode: 'simultaneous',
          timeLimits: { minTime: 30, maxTime: 300 },
          instructionsHtml: '<p>Read carefully.</p>',
          feedback: [{
            id: FEEDBACK_ID,
            access: 'atEnd',
            showHide: 'show',
            outcomeIdentifier: 'TEST_FEEDBACK',
            html: '<p>Finished.</p>',
          }],
        },
      }],
    },
  });
});

testCase('assessment arrange parser rejects malformed and ambiguous structures', async () => {
  const validPart = {
    id: PART_ID,
    title: 'Part 1',
    placements: [{ id: PLACEMENT_ID, itemId: QUESTION_ID }],
  };
  const invalidBodies = [
    {},
    { parts: [null] },
    { parts: [{ ...validPart, extra: true }] },
    { parts: [{ ...validPart, placements: [{ id: PLACEMENT_ID, itemId: 'question-1' }] }] },
    { parts: [{ ...validPart, placements: [{ ...validPart.placements[0], snapshotRev: '3' }] }] },
    { parts: [{ ...validPart, options: { navigationMode: 'free' } }] },
    { parts: [{ ...validPart, options: { timeLimits: { minTime: 30, maxTime: 10 } } }] },
    { parts: [validPart, { ...validPart, title: 'Part 2' }] },
    {
      parts: [{
        ...validPart,
        placements: [validPart.placements[0], { ...validPart.placements[0], itemId: PART_ID }],
      }],
    },
    { parts: Array.from({ length: 101 }, () => validPart) },
    {
      parts: [{
        ...validPart,
        placements: Array.from({ length: 501 }, () => validPart.placements[0]),
      }],
    },
  ];

  for (const body of invalidBodies) {
    const result = await parseAssessmentArrangeHttpRequest(
      request({ expectedVersion: '1'.repeat(64), ...body }),
    );
    expect(result.ok, JSON.stringify(body)).toStrictEqual(false);
  }
});

testCase('assessment arrange route reports invalid JSON without entering persistence', async () => {
  const response = await invokeHttpRoute(
    arrangeHandler,
    makeHttpRequest(
      new Request('http://local/api/assessments/assessment-id/arrange', {
        ...{ duplex: 'half' },
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      }),
      { params: { id: 'assessment-id' } },
    ),
  );
  const body = await response.json();

  expect(response.status).toStrictEqual(400);
  expect(body.error).toStrictEqual('InvalidAssessmentArrangeRequest');
  expect(body.message).toContain('valid JSON');
});

function request(body: unknown): Request {
  return new Request('http://local/api/assessments/assessment-id/arrange', {
    ...{ duplex: 'half' },
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

testCase(
  'saved part settings reject unknown and malformed fields before reaching Arrange controls',
  () => {
    const source = {
      navigationMode: 'linear',
      timeLimits: { minTime: 30, maxTime: 300 },
      instructionsHtml: '<p>Keep instructions.</p>',
      feedback: [{
        id: FEEDBACK_ID,
        access: 'atEnd',
        showHide: 'show',
        outcomeIdentifier: 'SCORE',
        html: '<p>Done.</p>',
      }],
    } satisfies PartOptions;
    const result = parseAssessmentPartOptions(source);
    if (!(result.ok)) expect.unreachable('Expected result.ok');
    expect(result.options).toStrictEqual(source);
    for (
      const value of [
        null,
        [],
        { ...source, unsupported: true },
        { ...source, navigationMode: 'free' },
        { ...source, timeLimits: { minTime: 300, maxTime: 30 } },
        { ...source, feedback: [source.feedback[0], source.feedback[0]] },
      ]
    ) {
      expect(parseAssessmentPartOptions(value).ok).toStrictEqual(false);
    }
    expect(source.navigationMode).toStrictEqual('linear');
    expect(source.feedback.length).toStrictEqual(1);
  },
);
