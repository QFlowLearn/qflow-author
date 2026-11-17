import { expect, test as testCase } from 'vitest';

import { assessmentQuestionPlacements } from '../lib/assessment_content.ts';

import { parseQtiFixedTestOrdering, prepareQtiFixedTestOrder } from '@longsightgroup/qti3-core';
import { parseAssessmentPartOptions } from '../lib/assessment_arrangement.ts';
import {
  createPartSettingsDraft,
  parsePartSettingsDraft,
} from '../lib/assessment_part_settings_draft.ts';
import { buildAssessmentTestXml } from '../lib/test_export.ts';
import {
  type AssessmentExportDocument,
  buildValidatedQti3Assessment,
  convertQti3AssessmentPackage,
  toAssessmentExportSelectionDocument,
} from '../lib/export/assessment.ts';
import {
  listSelectableAssessmentExportTargets,
  resolveAssessmentExportTarget,
} from '../lib/export/assessment_export_targets.ts';
import { createAssessmentExportFidelityReceipt } from '../lib/export/assessment_export_receipt.ts';
import { authorizeAssessmentExport } from '../lib/export/assessment_export_authorization.ts';
import { createAssessmentExportReceipt } from '../lib/export/assessment_export_final_receipt.ts';
import {
  createAssessmentCanonicalRevisionId,
  createAssessmentExportPreflight,
} from '../lib/export/assessment_export_preflight.ts';
import {
  exportActorIdFromAuthenticatedUser,
  strictAssessmentExportRequirements,
} from '../lib/export/assessment_export_requirements.ts';
import { validateQti3Accessibility } from '../lib/qti3_accessibility.ts';
import { ZipArchive } from '../lib/zip_archive.ts';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';
import { UNSPECIFIED_ASSESSMENT_BLUEPRINT } from '../lib/assessment_blueprint.ts';

// Synthetic independent choices; literal expectations are independent of omission classifiers.
const itemIds = ['one', 'two', 'three', 'four', 'five', 'six'];
const document: AssessmentExportDocument = {
  assessment: { id: 'question-shuffle', title: 'Question shuffle' },
  parts: [0, 1].map((index) => ({
    id: `part-${index + 1}`,
    title: `Part ${index + 1}`,
    options: { shuffleQuestions: true },
    placements: itemIds.slice(index * 3, index * 3 + 3).map((id, position) => ({
      id: `place-${id}`,
      itemId: id,
      fixed: position === 1,
    })),
  })),
};
const itemsXml = Object.fromEntries(
  itemIds.map((id) => [
    id,
    exportQti3TestItemXml('single_select', {
      type: 'single_select',
      title: id,
      bodyHtml: `<p>${id}: choose Alpha.</p>`,
      choices: [{ id: 'A', text: 'Alpha' }, { id: 'B', text: 'Beta' }],
      correctId: 'A',
    }, { identifier: `item-${id}` }),
  ]),
);
const OMITTED = 'qflow.export.part_question_shuffle_omitted';
const FIXED_OMITTED = 'qflow.export.part_fixed_positions_omitted';

testCase(
  'question shuffle is one closed part policy and raw part forms retain unrelated settings',
  () => {
    for (const shuffleQuestions of [true, false]) {
      expect(parseAssessmentPartOptions({ shuffleQuestions })).toStrictEqual({
        ok: true,
        options: { shuffleQuestions },
      });
      const source = {
        shuffleQuestions,
        instructionsHtml: '<p>Keep instructions.</p>',
        timeLimits: { maxTime: 45 },
      };
      expect(parsePartSettingsDraft(createPartSettingsDraft(source))).toStrictEqual({
        ok: true,
        options: source,
      });
    }
    expect(parseAssessmentPartOptions({})).toStrictEqual({ ok: true, options: {} });
    for (const shuffleQuestions of ['true', 'false', 0, 1, null, {}, []]) {
      expect(parseAssessmentPartOptions({ shuffleQuestions }).ok).toStrictEqual(false);
    }
    expect(parseAssessmentPartOptions({ shuffleQuestions: true, shuffle: true }).ok).toStrictEqual(
      false,
    );
  },
);

testCase(
  'canonical question shuffling preserves authored order and shared generated/restored part boundaries',
  async () => {
    const before = structuredClone(document);
    const built = await buildValidatedQti3Assessment(document);
    if (!(built.validation.ok)) expect.unreachable(JSON.stringify(built.validation));
    const parsed = parseQtiFixedTestOrdering(built.xml);
    if (!(parsed.ok)) expect.unreachable('Expected parsed.ok');
    expect(parsed.value.sections.map((s) => s.shuffle)).toStrictEqual([true, true]);
    expect(parsed.value.sections.map((s) => s.items.map((item) => item.href))).toStrictEqual([
      itemIds.slice(0, 3).map((id) => `items/${id}.xml`),
      itemIds.slice(3).map((id) => `items/${id}.xml`),
    ]);
    const generated = ['first', 'second', 'third'].map((seed) =>
      prepareQtiFixedTestOrder(parsed.value, { kind: 'new', seed })
    );
    const first = generated[0];
    if (!(first.ok)) expect.unreachable('Expected first.ok');
    if (
      !(generated.some((order) =>
        order.ok && JSON.stringify(order.value) !== JSON.stringify(first.value)
      ))
    ) {
      expect.unreachable(
        'Expected generated.some((order) => order.ok && JSON.stringify(order.value) !== JSON.stringify(first',
      );
    }
    const restored = prepareQtiFixedTestOrder(parsed.value, {
      kind: 'restore',
      state: first.value,
    });
    if (!(restored.ok)) expect.unreachable('Expected restored.ok');
    expect(restored.value).toStrictEqual(first.value);
    for (const [index, section] of first.value.sections.entries()) {
      expect(section.partIdentifier).toStrictEqual(parsed.value.sections[index].partIdentifier);
      expect([...section.itemRefs].sort()).toStrictEqual(
        parsed.value.sections[index].items.map((item) => item.identifier).sort(),
      );
    }
    expect(document).toStrictEqual(before);
    const authored = parseQtiFixedTestOrdering(
      buildAssessmentTestXml(
        document.assessment,
        document.parts.map((part) => ({ ...part, options: { shuffleQuestions: false } })),
      ),
    );
    if (!(authored.ok)) expect.unreachable('Expected authored.ok');
    expect(authored.value.sections.map((s) => s.shuffle)).toStrictEqual([false, false]);
  },
);

for (const target of listSelectableAssessmentExportTargets()) {
  testCase(
    `question shuffle export: ${target.id} preserves canonical policy or discloses its actual omission`,
    async () => {
      const built = await buildValidatedQti3Assessment(document);
      if (!(built.validation.ok)) expect.unreachable('Expected built.validation.ok');
      const result = await convertQti3AssessmentPackage({
        document,
        assessmentXml: built.xml,
        itemsXml,
        assets: [],
      }, target);
      if (!(result.ok)) expect.unreachable(JSON.stringify(result));
      const canonical = await ZipArchive.open(result.canonicalPackage);
      try {
        const file = canonical.file('assessment.xml');
        if (!file) expect.unreachable('Expected file');
        expect(await file.async('string')).toStrictEqual(built.xml);
      } finally {
        await canonical.close();
      }
      if (target.id === 'qti3-conformant') {
        expect(result.transcodeEvidence).toStrictEqual(null);
        expect(result.artifact).toStrictEqual(result.canonicalPackage);
        return;
      }
      const omissions = result.transcodeEvidence?.diagnostics.filter((entry) =>
        entry.code === OMITTED
      );
      expect(omissions?.length).toStrictEqual(2);
      if (!(omissions?.every((entry) => entry.severity === 'warning'))) {
        expect.unreachable("Expected omissions?.every((entry) => entry.severity === 'warning')");
      }
      expect(
        result.transcodeEvidence?.diagnostics.filter((entry) => entry.code === FIXED_OMITTED)
          .length,
      ).toStrictEqual(2);
      let text: string;
      if (target.id === 'moodle') text = new TextDecoder().decode(result.artifact);
      else {
        const archive = await ZipArchive.open(result.artifact);
        try {
          text = (await Promise.all(
            Object.values(archive.files).filter((entry) =>
              !entry.dir && entry.name.endsWith('.xml')
            )
              .map((entry) => entry.async('string')),
          )).join('\n');
        } finally {
          await archive.close();
        }
      }
      // Answer-option shuffling is unrelated; no assessment/section ordering instruction is emitted.
      if (/<(?:\w+:)?(?:ordering|qti-ordering)\b/.test(text)) {
        expect.unreachable('Expected !/<(?:\\w+:)?(?:ordering|qti-ordering)\\b/.test(text)');
      }
      if (/\bfixed\s*=/.test(text)) expect.unreachable('Expected !/\\bfixed\\s*=/.test(text)');
      for (const id of itemIds) {
        if (!(text.includes(`${id}: choose Alpha.`))) {
          expect.unreachable('Expected text.includes(`${id}: choose Alpha.`)');
        }
      }
    },
  );
}

testCase(
  'question-shuffle omissions participate in revision-bound export acknowledgements',
  async () => {
    const candidate = await canvasCandidate(document);
    const { preflight } = candidate;
    expect(preflight.overallOutcome).toStrictEqual('warning');
    if (!(preflight.warningCodes.includes(OMITTED))) {
      expect.unreachable('Expected preflight.warningCodes.includes(OMITTED)');
    }
    if (!(preflight.warningCodes.includes(FIXED_OMITTED))) {
      expect.unreachable('Expected preflight.warningCodes.includes(FIXED_OMITTED)');
    }
    if (!(preflight.acknowledgementToken)) {
      expect.unreachable('Expected preflight.acknowledgementToken');
    }
    const authorization = {
      candidate,
      authorizedBy: exportActorIdFromAuthenticatedUser('10000000-0000-4000-8000-000000000001'),
      approvedPreflightId: preflight.preflightId,
    };
    expect(
      (await authorizeAssessmentExport({
        ...authorization,
        acknowledgementToken: null,
      }))._tag,
    ).toStrictEqual('WarningsNotAcknowledged');
    const authorized = await authorizeAssessmentExport({
      ...authorization,
      acknowledgementToken: preflight.acknowledgementToken,
    });
    if (!(authorized._tag === 'Authorized')) {
      expect.unreachable("Expected authorized._tag === 'Authorized'");
    }
    const receipt = await createAssessmentExportReceipt({
      authorizedExport: authorized.value,
      createdAt: new Date('2026-10-08T00:00:00Z'),
    });
    if (!(receipt.packageDiagnosticCodes.includes(OMITTED))) {
      expect.unreachable('Expected receipt.packageDiagnosticCodes.includes(OMITTED)');
    }
    if (!(receipt.packageDiagnosticCodes.includes(FIXED_OMITTED))) {
      expect.unreachable('Expected receipt.packageDiagnosticCodes.includes(FIXED_OMITTED)');
    }
    const changed = await canvasCandidate({
      ...document,
      parts: document.parts.map((part, index) =>
        index === 0 ? { ...part, options: { shuffleQuestions: false } } : part
      ),
    });
    // Source ordering changes even though this destination drops that instruction.
    expect(changed.artifact.bytes).toStrictEqual(candidate.artifact.bytes);
    expect(
      (await authorizeAssessmentExport({
        ...authorization,
        candidate: changed,
        acknowledgementToken: preflight.acknowledgementToken,
      }))._tag,
    ).toStrictEqual('PreflightStale');
    expect(
      (await authorizeAssessmentExport({
        ...authorization,
        candidate: changed,
        approvedPreflightId: changed.preflight.preflightId,
        acknowledgementToken: preflight.acknowledgementToken,
      }))._tag,
    ).toStrictEqual('WarningsNotAcknowledged');
  },
);

testCase(
  'changing a fixed placement invalidates export acknowledgement even when destination bytes do not change',
  async () => {
    const original = await canvasCandidate(document);
    const changed = await canvasCandidate({
      ...document,
      parts: document.parts.map((part) => ({
        ...part,
        placements: assessmentQuestionPlacements(part.placements).map((placement) => ({
          ...placement,
          fixed: false,
        })),
      })),
    });
    expect(original.artifact.bytes).toStrictEqual(changed.artifact.bytes);
    expect(
      (await authorizeAssessmentExport({
        candidate: changed,
        authorizedBy: exportActorIdFromAuthenticatedUser('10000000-0000-4000-8000-000000000001'),
        approvedPreflightId: original.preflight.preflightId,
        acknowledgementToken: original.preflight.acknowledgementToken,
      }))._tag,
    ).toStrictEqual('PreflightStale');
  },
);

async function canvasCandidate(document: AssessmentExportDocument) {
  const resolved = resolveAssessmentExportTarget('canvas-classic');
  if (!(resolved.ok)) expect.unreachable('Expected resolved.ok');
  const built = await buildValidatedQti3Assessment(document);
  if (!(built.validation.ok)) expect.unreachable('Expected built.validation.ok');
  const result = await convertQti3AssessmentPackage({
    document,
    assessmentXml: built.xml,
    itemsXml,
    assets: [],
  }, resolved.target);
  if (!(result.ok)) expect.unreachable('Expected result.ok');
  const artifact = {
    bytes: result.artifact,
    filename: 'shuffle.zip',
    mediaType: 'application/zip',
  };
  const receipt = await createAssessmentExportFidelityReceipt({
    assessmentId: document.assessment.id,
    target: resolved.target,
    canonicalPackage: result.canonicalPackage,
    artifact,
    transcodeEvidence: result.transcodeEvidence,
    accessibility: validateQti3Accessibility(itemsXml),
  });
  const preflight = await createAssessmentExportPreflight({
    target: resolved.target,
    requirements: strictAssessmentExportRequirements(),
    receipt,
    canonicalRevisionId: await createAssessmentCanonicalRevisionId({
      assessmentId: document.assessment.id,
      assessmentXml: built.xml,
      itemsXml,
    }),
    itemsXml,
    transcodeEvidence: result.transcodeEvidence,
  });
  return { artifact, fidelityReceipt: receipt, preflight };
}

testCase(
  'export projections refine persisted part options instead of asserting raw storage values',
  () => {
    const base = {
      id: 'unused',
      title: 'Policy',
      targetCount: 0,
      tags: [],
      metadata: {},
      blueprint: UNSPECIFIED_ASSESSMENT_BLUEPRINT,
      createdAt: '2026-10-07T00:00:00Z',
      updatedAt: '2026-10-07T00:00:00Z',
      parts: [{ id: 'part', title: 'Part', placements: [], options: { shuffleQuestions: true } }],
    };
    expect(toAssessmentExportSelectionDocument(base).parts[0].options).toStrictEqual({
      shuffleQuestions: true,
    });
    expect(() =>
      toAssessmentExportSelectionDocument({
        ...base,
        parts: [{ ...base.parts[0], options: { shuffleQuestions: 'true' } }],
      })
    ).toThrowError(Error);
  },
);
