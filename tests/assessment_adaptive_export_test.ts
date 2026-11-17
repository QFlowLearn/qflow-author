import { expect, test as testCase } from 'vitest';

import { unzipSync } from 'fflate';
import { compileAdaptiveAssessment } from '../lib/assessment_adaptive_export.ts';
import { parseQtiTest } from '@longsightgroup/qti3-core';
import { convertQti3AssessmentPackage } from '../lib/export/assessment.ts';
import { resolveAssessmentExportTarget } from '../lib/export/assessment_export_targets.ts';
import { adaptiveExportFixture } from './helpers/adaptive_export_fixture.ts';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';
import { createAssessmentExportFidelityReceipt } from '../lib/export/assessment_export_receipt.ts';
import {
  createAssessmentCanonicalRevisionId,
  createAssessmentExportPreflight,
} from '../lib/export/assessment_export_preflight.ts';
import { authorizeAssessmentExport } from '../lib/export/assessment_export_authorization.ts';
import {
  exportActorIdFromAuthenticatedUser,
  strictAssessmentExportRequirements,
} from '../lib/export/assessment_export_requirements.ts';
import { validateQti3Accessibility } from '../lib/qti3_accessibility.ts';

testCase('100-answer canonical adaptive export preserves the frozen graph', async () => {
  const fixture = adaptiveExportFixture();
  const parsed = parseQtiTest(fixture.xml);
  if (!(parsed.ok)) expect.unreachable('Expected parsed.ok');
  expect(parsed.value.sections.length).toStrictEqual(57);
  expect(parsed.value.sections.flatMap((section) => section.items).length).toStrictEqual(285);
  expect(
    parsed.value.outcomeDeclarations.find((value) => value.identifier === 'QFLOW_ADAPTIVE_TARGET')
      ?.defaultValue,
  ).toStrictEqual(100);
  expect(() =>
    compileAdaptiveAssessment(fixture.assessment, [{
      ...fixture.part,
      placements: fixture.part.placements.slice(1),
    }], fixture.plan)
  ).toThrowError(Error);
  const target = resolveAssessmentExportTarget('qti3-conformant');
  if (!(target.ok)) expect.unreachable('Expected target.ok');
  const result = await convertQti3AssessmentPackage({
    document: { assessment: fixture.assessment, parts: [fixture.part], adaptivePlan: fixture.plan },
    assessmentXml: fixture.xml,
    itemsXml: {},
    assets: [],
  }, target.target);
  if (!(result.ok)) expect.unreachable('Expected result.ok');
  expect(result.artifact).toStrictEqual(result.canonicalPackage);
  expect(result.transcodeEvidence).toStrictEqual(null);
  const files = unzipSync(result.artifact);
  expect(new TextDecoder().decode(files['assessment.xml'])).toStrictEqual(fixture.xml);
});

testCase(
  'Canvas Classic exports all 285 adaptive pool questions with scoring and a sequencing warning',
  async () => {
    const fixture = adaptiveExportFixture();
    const itemsXml = Object.fromEntries(fixture.part.placements.map((placement, index) => [
      placement.itemId,
      exportQti3TestItemXml('single_select', {
        type: 'single_select',
        title: `Pool question ${index + 1}`,
        bodyHtml: '<p>Pick one.</p>',
        choices: [{ id: 'A', text: 'Correct answer' }, { id: 'B', text: 'Other answer' }],
        correctId: 'A',
      }, { identifier: `pool_item_${index + 1}` }),
    ]));
    const target = resolveAssessmentExportTarget('canvas-classic');
    if (!(target.ok)) expect.unreachable('Expected target.ok');
    const result = await convertQti3AssessmentPackage({
      document: {
        assessment: fixture.assessment,
        parts: [fixture.part],
        adaptivePlan: fixture.plan,
      },
      assessmentXml: fixture.xml,
      itemsXml,
      assets: [],
    }, target.target);
    if (!(result.ok)) expect.unreachable(JSON.stringify(result));
    expect(result.transcodeEvidence?.fidelity).toStrictEqual('lossy');
    expect(result.transcodeEvidence?.reports.length).toStrictEqual(285);
    if (
      !(result.transcodeEvidence?.reports.every((report) =>
        report.mappings.every((mapping) => mapping.scoring === 'automatic')
      ))
    ) {
      expect.unreachable(
        'Expected result.transcodeEvidence?.reports.every((report) => report.mappings.every((mapping) => map',
      );
    }
    const diagnostic = result.transcodeEvidence?.diagnostics.find((value) =>
      value.code === 'qflow.export.adaptive_sequence_omitted'
    );
    expect(diagnostic?.severity).toStrictEqual('warning');
    expect(diagnostic?.message ?? '').toContain('285 saved questions');
    expect(diagnostic?.message ?? '').toContain('100-question adaptive path');

    const decoder = new TextDecoder();
    const files = unzipSync(result.artifact);
    const quiz = decoder.decode(files['assessment_qti.xml']);
    expect((quiz.match(/<item\s/g) ?? []).length).toStrictEqual(285);
    let previousPosition = -1;
    for (let index = 1; index <= 285; index++) {
      const position = quiz.indexOf(`ident="pool_item_${index}"`);
      if (!(position > previousPosition)) {
        expect.unreachable(`Question ${index} must retain its saved position.`);
      }
      previousPosition = position;
    }
    expect(quiz).toContain('<resprocessing>');
    if (quiz.includes('branch-rule')) {
      expect.unreachable("Expected !quiz.includes('branch-rule')");
    }
    const canonical = unzipSync(result.canonicalPackage);
    expect(decoder.decode(canonical['assessment.xml'])).toStrictEqual(fixture.xml);

    const artifact = {
      bytes: result.artifact,
      filename: 'adaptive-canvas-classic.zip',
      mediaType: 'application/zip',
    };
    const receipt = await createAssessmentExportFidelityReceipt({
      assessmentId: fixture.assessment.id,
      target: target.target,
      canonicalPackage: result.canonicalPackage,
      artifact,
      transcodeEvidence: result.transcodeEvidence,
      accessibility: validateQti3Accessibility(itemsXml),
    });
    const preflight = await createAssessmentExportPreflight({
      target: target.target,
      requirements: strictAssessmentExportRequirements(),
      receipt,
      canonicalRevisionId: await createAssessmentCanonicalRevisionId({
        assessmentId: fixture.assessment.id,
        assessmentXml: fixture.xml,
        itemsXml,
      }),
      itemsXml,
      transcodeEvidence: result.transcodeEvidence,
    });
    expect(preflight._tag).toStrictEqual('Evaluated');
    expect(preflight.overallOutcome).toStrictEqual('warning');
    if (!(preflight.items.every((item) => item._tag !== 'Blocked'))) {
      expect.unreachable("Expected preflight.items.every((item) => item._tag !== 'Blocked')");
    }
    if (!(preflight.warningCodes.includes('qflow.export.adaptive_sequence_omitted'))) {
      expect.unreachable(
        "Expected preflight.warningCodes.includes('qflow.export.adaptive_sequence_omitted')",
      );
    }
    if (!(receipt.packageDiagnosticCodes.includes('qflow.export.adaptive_sequence_omitted'))) {
      expect.unreachable(
        "Expected receipt.packageDiagnosticCodes.includes('qflow.export.adaptive_sequence_omitted')",
      );
    }
    const candidate = { artifact, fidelityReceipt: receipt, preflight };
    const authorizedBy = exportActorIdFromAuthenticatedUser('adaptive-author');
    expect(
      (await authorizeAssessmentExport({
        candidate,
        authorizedBy,
        approvedPreflightId: preflight.preflightId,
        acknowledgementToken: null,
      }))._tag,
    ).toStrictEqual('WarningsNotAcknowledged');
    expect(
      (await authorizeAssessmentExport({
        candidate,
        authorizedBy,
        approvedPreflightId: preflight.preflightId,
        acknowledgementToken: preflight.acknowledgementToken,
      }))._tag,
    ).toStrictEqual('Authorized');
  },
);
