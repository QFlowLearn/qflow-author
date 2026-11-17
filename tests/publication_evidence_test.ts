import { expect, test as testCase } from 'vitest';

import {
  approvedReviewEvidence,
  projectRevisionEligibility,
  type RevisionReviewDecision,
  validateManifestAttestation,
} from '../lib/publication_evidence.ts';

const questionId = crypto.randomUUID(),
  revisionId = crypto.randomUUID(),
  author = crypto.randomUUID();
const decision: RevisionReviewDecision = {
  revisionId,
  requestId: crypto.randomUUID(),
  state: 'approved',
  decidedBy: author,
  decidedAt: '2026-09-09T12:00:00Z',
  note: null,
};
const revision = { questionId, revisionId, revisionAuthorId: author, intake: null };
testCase(
  'exact review evidence labels self-review using revision authorship and rejects another revision',
  () => {
    const self = projectRevisionEligibility({ ...revision, review: decision });
    if (!(self.kind === 'reviewed')) expect.unreachable("Expected self.kind === 'reviewed'");
    expect(self.evidence.independence).toStrictEqual('self_review');
    const independent = projectRevisionEligibility({
      ...revision,
      review: { ...decision, decidedBy: crypto.randomUUID() },
    });
    if (!(independent.kind === 'reviewed')) {
      expect.unreachable("Expected independent.kind === 'reviewed'");
    }
    expect(independent.evidence.independence).toStrictEqual('independent_review');
    expect(() =>
      projectRevisionEligibility({ ...revision, revisionId: crypto.randomUUID(), review: decision })
    ).toThrowError(Error);
  },
);
testCase('conversion acceptance carries intake evidence but creates no editorial approval', () => {
  const result = projectRevisionEligibility({
    ...revision,
    intake: {
      migrationRunId: crypto.randomUUID(),
      artifactId: crypto.randomUUID(),
      contentHash: 'a'.repeat(64),
    },
    review: null,
  });
  expect(result.kind).toStrictEqual('attestation_required');
});
testCase('one confirmation covers all 200 exact revisions regardless of preview pagination', () => {
  const rows = Array.from(
    { length: 200 },
    () =>
      projectRevisionEligibility({
        ...revision,
        questionId: crypto.randomUUID(),
        revisionId: crypto.randomUUID(),
        review: null,
      }),
  );
  const manifest = { digest: 'a'.repeat(64), revisions: rows, technicalBlockers: [] };
  const input = {
    operationId: crypto.randomUUID(),
    manifestDigest: manifest.digest,
    reason: 'Verified owned source',
    revisionIds: rows.map((row) => row.revisionId),
    overrides: [],
  };
  if (!(validateManifestAttestation(input, manifest).ok)) {
    expect.unreachable('Expected validateManifestAttestation(input, manifest).ok');
  }
  expect(validateManifestAttestation(
    { ...input, revisionIds: input.revisionIds.slice(0, 50) },
    manifest,
  )).toStrictEqual({ ok: false, code: 'wrong_revision_set' });
  expect(validateManifestAttestation({ ...input, manifestDigest: 'b'.repeat(64) }, manifest))
    .toStrictEqual({ ok: false, code: 'manifest_changed' });
  expect(
    validateManifestAttestation(input, { ...manifest, technicalBlockers: ['unsupported_target'] }),
  ).toStrictEqual({ ok: false, code: 'technical_blocker' });
});
testCase('changes requested stays visible and requires an exact reasoned override', () => {
  const row = projectRevisionEligibility({
    ...revision,
    review: { ...decision, state: 'changes_requested', note: 'Correct the diagram' },
  });
  const manifest = { digest: 'a'.repeat(64), revisions: [row], technicalBlockers: [] };
  const input = {
    operationId: crypto.randomUUID(),
    manifestDigest: manifest.digest,
    reason: 'Release decision',
    revisionIds: [revisionId],
    overrides: [],
  };
  expect(validateManifestAttestation(input, manifest)).toStrictEqual({
    ok: false,
    code: 'override_required',
  });
  if (
    !(validateManifestAttestation({
      ...input,
      overrides: [{ revisionId, reason: 'Verified the diagram against the source' }],
    }, manifest).ok)
  ) {
    expect.unreachable(
      "Expected validateManifestAttestation({ ...input, overrides: [{ revisionId, reason: 'Verified the di",
    );
  }
  expect(row.kind).toStrictEqual('attestation_required');
});

testCase(
  'approved evidence rejects missing recorded actor or timestamp for display and publication',
  () => {
    for (const review of [{ ...decision, decidedBy: null }, { ...decision, decidedAt: null }]) {
      expect(() => approvedReviewEvidence(author, review)).toThrowError(
        expect.toSatisfy((caught: unknown) =>
          caught instanceof Error && caught.message.includes('missing its recorded decision')
        ),
      );
      expect(() => projectRevisionEligibility({ ...revision, review })).toThrowError(
        expect.toSatisfy((caught: unknown) =>
          caught instanceof Error && caught.message.includes('missing its recorded decision')
        ),
      );
    }
  },
);
