import { expect, test as testCase } from 'vitest';

import { parseReleaseHistoryQuery } from '../lib/banks/bank_release_history.ts';

import {
  parseReleaseCreateForm,
  parseReleaseMutationForm,
} from '../lib/banks/bank_release_http.ts';
import { parseReleasePreviewQuery } from '../lib/services/bank_release_preview.ts';
import type { ReleaseManifest } from '../lib/banks/bank_release.ts';
testCase('release forms reject duplicates and attest the entire server manifest', () => {
  const id = crypto.randomUUID(), actor = crypto.randomUUID();
  const manifest: ReleaseManifest = {
    schema: 'qflow.bank-release.v1',
    label: 'Edition',
    notes: '',
    collections: [],
    exclusions: [],
    preparation: null,
    items: Array.from({ length: 400 }, (_, i) => {
      const questionId = crypto.randomUUID(), revisionId = crypto.randomUUID();
      return {
        questionId,
        revisionId,
        revision: 1,
        title: `Question ${i}`,
        selection: 'current',
        previouslyShipped: false,
        eligibility: {
          kind: 'attestation_required',
          questionId,
          revisionId,
          revisionAuthorId: actor,
          intake: null,
          review: null,
        },
      };
    }),
  };
  const form = new FormData();
  for (
    const [key, value] of Object.entries({
      action: 'freeze',
      operationId: crypto.randomUUID(),
      version: '1',
      digest: 'a'.repeat(64),
      attest: 'yes',
      reason: 'Whole edition checked',
    })
  ) form.set(key, value);
  const command = parseReleaseMutationForm(form, id, manifest);
  if (!(command?.action === 'freeze')) expect.unreachable("Expected command?.action === 'freeze'");
  const attestation = command.attestation;
  expect(attestation).toStrictEqual({ reason: 'Whole edition checked', overrides: [] });
  const first = manifest.items[0].revisionId, second = manifest.items[1].revisionId;
  form.set(`override:${first}`, 'First correction accepted for this edition');
  form.set(`override:${second}`, 'Second correction has a different justification');
  const individual = parseReleaseMutationForm(form, id, manifest);
  if (!(individual?.action === 'freeze')) {
    expect.unreachable("Expected individual?.action === 'freeze'");
  }
  expect(individual.attestation?.overrides).toStrictEqual([
    { revisionId: first, reason: 'First correction accepted for this edition' },
    { revisionId: second, reason: 'Second correction has a different justification' },
  ]);
  form.append(`override:${first}`, 'Duplicate');
  expect(parseReleaseMutationForm(form, id, manifest)).toStrictEqual(null);
  form.delete(`override:${first}`);
  form.delete(`override:${second}`);
  form.append('questionId', manifest.items[0].questionId);
  expect(parseReleaseMutationForm(form, id, manifest)).toStrictEqual(null);
  form.delete('questionId');
  form.append('digest', 'b'.repeat(64));
  expect(parseReleaseMutationForm(form, id, manifest)).toStrictEqual(null);
  form.delete('digest');
  form.set('digest', 'a'.repeat(64));
  form.delete('attest');
  expect(parseReleaseMutationForm(form, id, manifest)).toStrictEqual(null);
  const create = new FormData();
  for (
    const [key, value] of Object.entries({
      id,
      operationId: crypto.randomUUID(),
      label: 'Name',
      notes: '',
    })
  ) create.set(key, value);
  create.append('questionId', manifest.items[0].questionId);
  if (!(parseReleaseCreateForm(create))) {
    expect.unreachable('Expected parseReleaseCreateForm(create)');
  }
  create.append('label', 'Other');
  expect(parseReleaseCreateForm(create)).toStrictEqual(null);
});
testCase('release pagination must name the version and accepts only exact bounded inputs', () => {
  expect(parseReleasePreviewQuery(new URLSearchParams())).toStrictEqual({
    version: null,
    page: 1,
    filter: 'all',
  });
  expect(parseReleasePreviewQuery(new URLSearchParams('version=2&page=8&filter=attest')))
    .toStrictEqual({
      version: 2,
      page: 8,
      filter: 'attest',
    });
  for (
    const query of [
      'page=2',
      'filter=attest',
      'version=0',
      'version=2&page=1.5',
      'version=1&version=2',
      'view=all',
    ]
  ) expect(parseReleasePreviewQuery(new URLSearchParams(query))).toStrictEqual(null);
});

testCase(
  'edition history accepts one exact cursor and rejects malformed or duplicate anchors',
  () => {
    const before = crypto.randomUUID();
    expect(parseReleaseHistoryQuery(new URLSearchParams())).toStrictEqual({ before: null });
    expect(parseReleaseHistoryQuery(new URLSearchParams({ before }))).toStrictEqual({ before });
    for (const query of ['before=bad', `before=${before}&before=${before}`, 'page=2']) {
      expect(parseReleaseHistoryQuery(new URLSearchParams(query))).toStrictEqual(null);
    }
    expect(parseReleasePreviewQuery(new URLSearchParams({ comparisonBefore: before })))
      .toStrictEqual(null);
    expect(
      parseReleasePreviewQuery(new URLSearchParams({ version: '1', comparisonBefore: before })),
    ).toStrictEqual({ version: 1, page: 1, filter: 'all', comparisonBefore: before });
  },
);
