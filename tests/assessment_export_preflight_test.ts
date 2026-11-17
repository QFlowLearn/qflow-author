import { expect, test as testCase } from 'vitest';

import {
  type AssessmentExportDocument,
  buildValidatedQti3Assessment,
  convertQti3AssessmentPackage,
} from '../lib/export/assessment.ts';
import { createAssessmentExportReceipt } from '../lib/export/assessment_export_final_receipt.ts';
import { authorizeAssessmentExport } from '../lib/export/assessment_export_authorization.ts';
import {
  type AssessmentExportPreflight,
  createAssessmentCanonicalRevisionId,
  createAssessmentExportPreflight,
  createBuildBlockedAssessmentExportPreflight,
} from '../lib/export/assessment_export_preflight.ts';
import { createAssessmentExportFidelityReceipt } from '../lib/export/assessment_export_receipt.ts';
import {
  acceptDiagnosedAssessmentExportFallbacks,
  acceptManualAssessmentExportScoring,
  type AssessmentExportRequirements,
  exportActorIdFromAuthenticatedUser,
  strictAssessmentExportRequirements,
} from '../lib/export/assessment_export_requirements.ts';
import {
  resolveAssessmentExportTarget,
  type SelectableAssessmentExportTarget,
  type SelectableAssessmentExportTargetId,
} from '../lib/export/assessment_export_targets.ts';
import { sha256Hex } from '../lib/sha256.ts';
import { validateQti3Accessibility } from '../lib/qti3_accessibility.ts';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

const DOCUMENT: AssessmentExportDocument = {
  assessment: { id: 'assessment-preflight', title: 'Destination preflight' },
  parts: [{
    id: 'part-1',
    title: 'Part 1',
    placements: [
      { id: 'placement-single', itemId: 'single' },
      { id: 'placement-match', itemId: 'matching' },
    ],
  }],
};

const ITEMS_XML = {
  single: exportQti3TestItemXml(
    'single_select',
    {
      type: 'single_select',
      title: 'Single select',
      bodyHtml: '<p>Pick one.</p>',
      choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
      correctId: 'A',
    },
    { identifier: 'item-single' },
  ),
  matching: exportQti3TestItemXml(
    'match',
    {
      type: 'match',
      title: 'Match terms',
      bodyHtml: '<p>Match each term.</p>',
      promptHtml: '<p>Match.</p>',
      sources: [
        { id: 'A', text: 'Dog', matchMax: 1 },
        { id: 'B', text: 'Cat', matchMax: 1 },
      ],
      targets: [
        { id: 'T1', text: 'Barks' },
        { id: 'T2', text: 'Meows' },
      ],
      correctPairs: [
        { sourceId: 'A', targetId: 'T1' },
        { sourceId: 'B', targetId: 'T2' },
      ],
      maxAssociations: 0,
    },
    { identifier: 'item-matching' },
  ),
} as const;

testCase(
  'destination preflight blocks required scoring and behavior loss, then exposes explicit repairs',
  async () => {
    const strict = strictAssessmentExportRequirements();
    const first = await buildPreflight('moodle', strict);
    const second = await buildPreflight('moodle', strict);

    expect(first.preflight).toStrictEqual(second.preflight);
    expect(first.preflight.overallOutcome).toStrictEqual('blocked');
    expect(first.preflight.items.length).toStrictEqual(Object.keys(ITEMS_XML).length);
    expect(first.preflight.acknowledgementToken).toStrictEqual(null);
    expect(first.preflight.preflightId).toMatch(/^[a-f0-9]{64}$/);

    const single = requirePreflightItem(first.preflight, 'single');
    expect(single._tag).toStrictEqual('Preserved');
    expect(single.mappings[0]?.sourceScoring).toStrictEqual('automatic');
    expect(single.mappings[0]?.scoring).toStrictEqual('automatic');

    const matching = requirePreflightItem(first.preflight, 'matching');
    expect(matching._tag).toStrictEqual('Blocked');
    expect(matching.mappings[0]?.sourceScoring).toStrictEqual('automatic');
    expect(matching.mappings[0]?.scoring).toStrictEqual('manual');
    expect(matching.mappings[0]?.emittedInteraction).toStrictEqual('essay');
    if (!(matching.mappings[0]?.fallback)) {
      expect.unreachable('Expected matching.mappings[0]?.fallback');
    }
    if (!(matching.diagnosticCodes.includes('qflow.requirement.automatic_scoring_lost'))) {
      expect.unreachable(
        "Expected matching.diagnosticCodes.includes('qflow.requirement.automatic_scoring_lost')",
      );
    }
    if (!(matching.diagnosticCodes.includes('qflow.requirement.interaction_not_preserved'))) {
      expect.unreachable(
        "Expected matching.diagnosticCodes.includes('qflow.requirement.interaction_not_preserved')",
      );
    }
    expect(first.preflight.repairs.map((repair) => repair.id)).toStrictEqual([
      'accept-manual-scoring',
      'accept-diagnosed-fallbacks',
    ]);
    if (
      !(first.preflight.repairs.every((repair) =>
        repair.consequence.length > 0 && repair.affectedItemIds.includes('matching')
      ))
    ) {
      expect.unreachable(
        'Expected first.preflight.repairs.every((repair) => repair.consequence.length > 0 && repair.affected',
      );
    }
  },
);

testCase(
  'accepted destination consequences become revision-bound warnings and immutable receipt evidence',
  async () => {
    const acceptingUser = exportActorIdFromAuthenticatedUser(
      '10000000-0000-4000-8000-000000000001',
    );
    const requirements = acceptDiagnosedAssessmentExportFallbacks(
      acceptManualAssessmentExportScoring(
        strictAssessmentExportRequirements(),
        acceptingUser,
      ),
      acceptingUser,
    );
    const built = await buildPreflight('moodle', requirements);
    const matching = requirePreflightItem(built.preflight, 'matching');

    expect(matching._tag).toStrictEqual('Warning');
    expect(built.preflight.overallOutcome).toStrictEqual('warning');
    const acknowledgementToken = built.preflight.acknowledgementToken;
    if (!acknowledgementToken) expect.unreachable('Expected acknowledgementToken');
    expect(acknowledgementToken).toMatch(/^[a-f0-9]{64}$/);
    if (
      !(built.preflight.packageDiagnosticCodes.includes(
        'profile_release_evidence.not_recorded',
      ))
    ) {
      expect.unreachable(
        "Expected built.preflight.packageDiagnosticCodes.includes( 'profile_release_evidence.not_recorded', ",
      );
    }
    if (
      !(built.preflight.packageDiagnosticCodes.includes(
        'product_import_evidence.not_recorded',
      ))
    ) {
      expect.unreachable(
        "Expected built.preflight.packageDiagnosticCodes.includes( 'product_import_evidence.not_recorded', )",
      );
    }

    const rejected = await authorizeBuiltExport(built, acceptingUser, null);
    expect(rejected._tag).toStrictEqual('WarningsNotAcknowledged');
    const authorization = await authorizeBuiltExport(
      built,
      acceptingUser,
      acknowledgementToken,
    );
    if (!(authorization._tag === 'Authorized')) {
      expect.unreachable("Expected authorization._tag === 'Authorized'");
    }
    const createdAt = new Date('2026-07-27T12:00:00.000Z');
    const receipt = await createAssessmentExportReceipt({
      authorizedExport: authorization.value,
      createdAt,
    });

    expect(receipt.schema).toStrictEqual('qflow.export-receipt.v1');
    expect(receipt.createdAt).toStrictEqual(createdAt.toISOString());
    expect(receipt.overallOutcome).toStrictEqual('warning');
    expect(receipt.items.length).toStrictEqual(Object.keys(ITEMS_XML).length);
    expect(receipt.acknowledgements).toStrictEqual([{
      token: acknowledgementToken,
      warningCodes: built.preflight.warningCodes,
      acceptedBy: acceptingUser,
    }]);
    expect(receipt.package.sha256).toStrictEqual(await sha256Hex(built.artifact));
    const invalidAuthorization = {
      ...authorization.value,
      preflight: {
        ...authorization.value.preflight,
        assessmentId: undefined,
      },
    } as unknown as typeof authorization.value;
    await expect(
      Promise.resolve().then(() =>
        createAssessmentExportReceipt({
          authorizedExport: invalidAuthorization,
          createdAt,
        })
      ),
    ).rejects.toSatisfy((caught: unknown) =>
      caught instanceof Error &&
      caught.message.includes('cannot represent undefined at $.assessment.id')
    );

    const wrongActor = await authorizeBuiltExport(
      built,
      exportActorIdFromAuthenticatedUser(
        '10000000-0000-4000-8000-000000000002',
      ),
      acknowledgementToken,
    );
    expect(wrongActor._tag).toStrictEqual('EvidenceMismatch');

    const laterReceipt = await createAssessmentExportReceipt({
      authorizedExport: authorization.value,
      createdAt: new Date('2026-07-27T12:00:01.000Z'),
    });
    if (!(receipt.receiptId !== laterReceipt.receiptId)) {
      expect.unreachable('Expected receipt.receiptId !== laterReceipt.receiptId');
    }
  },
);

testCase(
  'preflight identity changes with requirements and blocks missing reports or error diagnostics',
  async () => {
    const strict = await buildPreflight('moodle', strictAssessmentExportRequirements());
    const actor = exportActorIdFromAuthenticatedUser(
      '10000000-0000-4000-8000-000000000003',
    );
    const acceptedRequirements = acceptDiagnosedAssessmentExportFallbacks(
      acceptManualAssessmentExportScoring(strictAssessmentExportRequirements(), actor),
      actor,
    );
    const accepted = await buildPreflight('moodle', acceptedRequirements);
    if (!(strict.preflight.preflightId !== accepted.preflight.preflightId)) {
      expect.unreachable(
        'Expected strict.preflight.preflightId !== accepted.preflight.preflightId',
      );
    }

    const transcodeEvidence = accepted.receipt.transcodeEvidence;
    if (!transcodeEvidence) expect.unreachable('Expected transcodeEvidence');
    const missingReport = await createAssessmentExportPreflight({
      target: accepted.target,
      requirements: acceptedRequirements,
      receipt: accepted.receipt,
      canonicalRevisionId: accepted.preflight.canonicalRevisionId,
      itemsXml: ITEMS_XML,
      transcodeEvidence: {
        ...transcodeEvidence,
        reports: transcodeEvidence.reports.filter((report) =>
          report.sourcePath !== 'items/matching.xml'
        ),
      },
    });
    expect(missingReport.overallOutcome).toStrictEqual('blocked');
    expect(requirePreflightItem(missingReport, 'matching')._tag).toStrictEqual('Blocked');
    expect(requirePreflightItem(missingReport, 'matching').diagnosticCodes).toStrictEqual([
      'qflow.preflight.item_report_missing',
    ]);

    const errorEvidence = {
      ...transcodeEvidence,
      diagnostics: [{
        code: 'profile.package.invalid',
        severity: 'error' as const,
        message: 'The generated package is invalid.',
      }],
    };
    const errorReceipt = await createAssessmentExportFidelityReceipt({
      assessmentId: DOCUMENT.assessment.id,
      target: accepted.target,
      canonicalPackage: accepted.canonicalPackage,
      artifact: {
        bytes: accepted.artifact,
        filename: accepted.receipt.artifact.filename,
        mediaType: accepted.receipt.artifact.mediaType,
      },
      transcodeEvidence: errorEvidence,
      accessibility: validateQti3Accessibility(ITEMS_XML),
    });
    const errorPreflight = await createAssessmentExportPreflight({
      target: accepted.target,
      requirements: acceptedRequirements,
      receipt: errorReceipt,
      canonicalRevisionId: accepted.preflight.canonicalRevisionId,
      itemsXml: ITEMS_XML,
      transcodeEvidence: errorEvidence,
    });
    expect(errorPreflight.overallOutcome).toStrictEqual('blocked');
    if (!(errorPreflight.packageDiagnosticCodes.includes('profile.package.invalid'))) {
      expect.unreachable(
        "Expected errorPreflight.packageDiagnosticCodes.includes('profile.package.invalid')",
      );
    }
    expect(errorPreflight.acknowledgementToken).toStrictEqual(null);
  },
);

testCase(
  'canonical QTI 3 preflight preserves every item while disclosing missing conformance evidence',
  async () => {
    const built = await buildPreflight(
      'qti3-conformant',
      strictAssessmentExportRequirements(),
    );
    expect(built.preflight.items.map((item) => item._tag)).toStrictEqual([
      'Preserved',
      'Preserved',
    ]);
    expect(built.preflight.overallOutcome).toStrictEqual('preserved');
    expect(built.preflight.packageDiagnosticCodes).toStrictEqual([
      'qti3_conformance.not_run',
    ]);
    expect(built.preflight.warningCodes).toStrictEqual([]);
    expect(built.preflight.acknowledgementToken).toStrictEqual(null);
    const actor = exportActorIdFromAuthenticatedUser('10000000-0000-4000-8000-000000000004');
    expect((await authorizeBuiltExport(built, actor, null))._tag).toStrictEqual('Authorized');
    if (!(built.preflight.canonicalRevisionId !== built.preflight.canonicalPackageSha256)) {
      expect.unreachable(
        'Expected built.preflight.canonicalRevisionId !== built.preflight.canonicalPackageSha256',
      );
    }
  },
);

testCase(
  'stale optional labels produce item-specific omissions and an authorized usable export receipt',
  async () => {
    const actor = exportActorIdFromAuthenticatedUser('10000000-0000-4000-8000-000000000005');
    const built = await buildPreflight('qti3-conformant', strictAssessmentExportRequirements());
    const receipt = await createAssessmentExportFidelityReceipt({
      assessmentId: DOCUMENT.assessment.id,
      target: built.target,
      canonicalPackage: built.canonicalPackage,
      artifact: {
        bytes: built.artifact,
        filename: built.receipt.artifact.filename,
        mediaType: built.receipt.artifact.mediaType,
      },
      transcodeEvidence: null,
      accessibility: validateQti3Accessibility(ITEMS_XML),
      additionalPackageDiagnosticCodes: ['qflow.export.stale_organization_omitted'],
    });
    const preflight = await createAssessmentExportPreflight({
      target: built.target,
      requirements: strictAssessmentExportRequirements(),
      receipt,
      canonicalRevisionId: built.preflight.canonicalRevisionId,
      itemsXml: ITEMS_XML,
      transcodeEvidence: null,
      omittedOrganizationItemIds: ['single'],
    });
    expect(preflight.overallOutcome).toStrictEqual('warning');
    expect(preflight.items.map((item) => item._tag)).toStrictEqual(['Warning', 'Preserved']);
    expect(preflight.warningCodes).toStrictEqual(['qflow.export.stale_organization_omitted']);
    if (!(preflight.acknowledgementToken)) {
      expect.unreachable('Expected preflight.acknowledgementToken');
    }
    const authorized = await authorizeBuiltExport(
      { ...built, receipt, preflight },
      actor,
      preflight.acknowledgementToken,
    );
    if (!(authorized._tag === 'Authorized')) {
      expect.unreachable("Expected authorized._tag === 'Authorized'");
    }
    const finalReceipt = await createAssessmentExportReceipt({
      authorizedExport: authorized.value,
      createdAt: new Date('2026-10-03T12:00:00Z'),
    });
    expect(finalReceipt.items[0].diagnosticCodes).toStrictEqual([
      'qflow.export.stale_organization_omitted',
    ]);
    expect(finalReceipt.items[1].diagnosticCodes).toStrictEqual([]);
  },
);

testCase(
  'qti3 response processing declares automatic source scoring without answer-key heuristics',
  async () => {
    const built = await buildPreflight('moodle', strictAssessmentExportRequirements());
    const transcodeEvidence = built.receipt.transcodeEvidence;
    if (!transcodeEvidence) expect.unreachable('Expected transcodeEvidence');
    const customProcessingXml = ITEMS_XML.single
      .replace(
        /\s*<qti-correct-response>[\s\S]*?<\/qti-correct-response>/,
        '',
      )
      .replace(
        /<qti-outcome-declaration identifier="SCORE"[^>]+\/>/,
        '<qti-outcome-declaration identifier="TOTAL" cardinality="single" base-type="float"/>',
      )
      .replace(
        /<qti-response-processing[^>]+\/>/,
        '<qti-response-processing><qti-set-outcome-value identifier="TOTAL"><qti-base-value base-type="float">1</qti-base-value></qti-set-outcome-value></qti-response-processing>',
      );
    const preflight = await createAssessmentExportPreflight({
      target: built.target,
      requirements: strictAssessmentExportRequirements(),
      receipt: built.receipt,
      canonicalRevisionId: built.preflight.canonicalRevisionId,
      itemsXml: { ...ITEMS_XML, single: customProcessingXml },
      transcodeEvidence,
    });

    expect(requirePreflightItem(preflight, 'single').mappings[0]?.sourceScoring).toStrictEqual(
      'automatic',
    );
  },
);

testCase(
  'build failures produce item-level blocked preflight without invented artifact evidence',
  async () => {
    const target = resolveTarget('moodle');
    const canonicalRevisionId = await createAssessmentCanonicalRevisionId({
      assessmentId: DOCUMENT.assessment.id,
      assessmentXml: '<qti-assessment-test identifier="test"/>',
      itemsXml: ITEMS_XML,
    });
    const preflight = await createBuildBlockedAssessmentExportPreflight({
      assessmentId: DOCUMENT.assessment.id,
      target,
      requirements: strictAssessmentExportRequirements(),
      canonicalRevisionId,
      itemsXml: ITEMS_XML,
      diagnosticCodes: ['qflow.preflight.asset_resolution_failed'],
    });

    expect(preflight._tag).toStrictEqual('BuildBlocked');
    expect(preflight.overallOutcome).toStrictEqual('blocked');
    expect(preflight.artifact).toStrictEqual(null);
    expect(preflight.fidelityReceiptId).toStrictEqual(null);
    expect(preflight.items.map((item) => item._tag)).toStrictEqual(['Blocked', 'Blocked']);
  },
);

testCase(
  'authorization rejects mismatched preflight, fidelity, and artifact evidence',
  async () => {
    const actor = exportActorIdFromAuthenticatedUser(
      '10000000-0000-4000-8000-000000000004',
    );
    const built = await buildPreflight('qti3-conformant', strictAssessmentExportRequirements());
    const acknowledgementToken = built.preflight.acknowledgementToken;
    expect(acknowledgementToken).toStrictEqual(null);
    const result = await authorizeAssessmentExport({
      candidate: {
        artifact: {
          bytes: built.artifact,
          filename: built.receipt.artifact.filename,
          mediaType: built.receipt.artifact.mediaType,
        },
        fidelityReceipt: {
          ...built.receipt,
          artifact: { ...built.receipt.artifact, filename: 'different.zip' },
        },
        preflight: built.preflight,
      },
      authorizedBy: actor,
      approvedPreflightId: built.preflight.preflightId,
      acknowledgementToken,
    });

    expect(result._tag).toStrictEqual('EvidenceMismatch');
  },
);

async function buildPreflight(
  targetId: SelectableAssessmentExportTargetId,
  requirements: AssessmentExportRequirements,
) {
  const target = resolveTarget(targetId);
  const assessment = await buildValidatedQti3Assessment(DOCUMENT);
  if (!(assessment.validation.ok)) expect.unreachable('Expected assessment.validation.ok');
  const converted = await convertQti3AssessmentPackage(
    {
      document: DOCUMENT,
      assessmentXml: assessment.xml,
      itemsXml: ITEMS_XML,
      assets: [],
    },
    target,
  );
  if (!(converted.ok)) expect.unreachable(JSON.stringify(converted));
  const artifact = converted.artifact;
  const receipt = await createAssessmentExportFidelityReceipt({
    assessmentId: DOCUMENT.assessment.id,
    target,
    canonicalPackage: converted.canonicalPackage,
    artifact: {
      bytes: artifact,
      filename: `assessment-${DOCUMENT.assessment.id}-${target.artifact.filenameSuffix}`,
      mediaType: target.artifact.mediaType,
    },
    transcodeEvidence: converted.transcodeEvidence,
    accessibility: validateQti3Accessibility(ITEMS_XML),
  });
  const preflight = await createAssessmentExportPreflight({
    target,
    requirements,
    receipt,
    canonicalRevisionId: await createAssessmentCanonicalRevisionId({
      assessmentId: DOCUMENT.assessment.id,
      assessmentXml: assessment.xml,
      itemsXml: ITEMS_XML,
    }),
    itemsXml: ITEMS_XML,
    transcodeEvidence: converted.transcodeEvidence,
  });
  return {
    target,
    artifact,
    canonicalPackage: converted.canonicalPackage,
    receipt,
    preflight,
  };
}

function authorizeBuiltExport(
  built: Awaited<ReturnType<typeof buildPreflight>>,
  actor: ReturnType<typeof exportActorIdFromAuthenticatedUser>,
  acknowledgementToken: AssessmentExportPreflight['acknowledgementToken'],
) {
  return authorizeAssessmentExport({
    candidate: {
      artifact: {
        bytes: built.artifact,
        filename: built.receipt.artifact.filename,
        mediaType: built.receipt.artifact.mediaType,
      },
      fidelityReceipt: built.receipt,
      preflight: built.preflight,
    },
    authorizedBy: actor,
    approvedPreflightId: built.preflight.preflightId,
    acknowledgementToken,
  });
}

function requirePreflightItem(
  preflight: AssessmentExportPreflight,
  itemId: string,
): AssessmentExportPreflight['items'][number] {
  const item = preflight.items.find((candidate) => candidate.itemId === itemId);
  if (!item) expect.unreachable('Expected item');
  return item;
}

function resolveTarget(
  targetId: SelectableAssessmentExportTargetId,
): SelectableAssessmentExportTarget {
  const resolved = resolveAssessmentExportTarget(targetId);
  if (!(resolved.ok)) expect.unreachable(JSON.stringify(resolved));
  return resolved.target;
}
