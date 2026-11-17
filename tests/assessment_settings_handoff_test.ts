import { expect, test as testCase } from 'vitest';

import { runCommand } from '../tools/process_command.ts';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';

import { unzipSync } from 'fflate';
import { db, shutdownDb } from '../lib/db.ts';
import { loadAssessmentItemExports } from '../lib/export/assessment_loader.ts';
import {
  buildValidatedQti3Assessment,
  convertQti3AssessmentPackage,
  toAssessmentExportSelectionDocument,
} from '../lib/export/assessment.ts';
import { resolveAssessmentExportTarget } from '../lib/export/assessment_export_targets.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { saveAssessmentArrangementFixture } from './helpers/assessment_arrangement.ts';
import { buildAssessmentTestXml } from '../lib/test_export.ts';

testCase(
  'part instructions and feedback preserve valid block markup in schema-conformant QTI',
  async () => {
    const directory = await _fs.mkdtemp(_path.join(_os.tmpdir(), 'qflow-part-settings-schema-'));
    try {
      for (
        const content of [
          '<p>Read <strong>carefully</strong>.</p><ul><li>Keep all answers.</li></ul>',
          'Read carefully.',
        ]
      ) {
        const xml = buildAssessmentTestXml(
          { id: 'schema-test', title: 'Instructions and feedback' },
          [{
            id: 'part',
            title: 'Part title',
            placements: [{ id: 'placement', itemId: 'question' }],
            options: {
              navigationMode: 'linear',
              submissionMode: 'simultaneous',
              timeLimits: { minTime: 60, maxTime: 300 },
              instructionsHtml: content,
              feedback: [{
                id: 'feedback',
                access: 'atEnd',
                showHide: 'show',
                outcomeIdentifier: 'SCORE',
                html: content,
              }],
            },
          }],
        );
        const path = `${directory}/assessment.xml`;
        await _fs.writeFile(path, xml, 'utf8');
        const validated = await runCommand('xmllint', [
          '--noout',
          '--schema',
          new URL('../vendor/qti/qti3-xsd/imsqti_asiv3p0p1_v1p0.xsd', import.meta.url).pathname,
          path,
        ], {});
        expect(validated.code, new TextDecoder().decode(validated.stderr)).toStrictEqual(0);
        expect(xml).toContain(`<qti-content-body>${content}</qti-content-body>`);
      }
    } finally {
      await _fs.rm(directory, { recursive: true });
    }
  },
);

testCase(
  'canonical part settings export a QTI package without changing placement identities',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, {
          title: 'Synthetic part settings handoff',
        });
        try {
          const initial = await getAssessment(ctx, assessment.id);
          if (!initial) expect.unreachable('Expected initial');
          for (const title of ['First question', 'Second question']) {
            const created = await saveAssessmentQuestion(ctx, assessment.id, {
              _tag: 'Create',
              partId: initial.parts[0].id,
              draft: {
                type: 'single_select',
                title,
                itemLanguage: newAuthoringItemLanguage(),
                bodyHtml: '<p>Which city is in France?</p>',
                choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin' }],
                correctId: 'A',
              },
            });
            if (!(created.ok)) expect.unreachable('Expected created.ok');
          }
          const populated = await getAssessment(ctx, assessment.id);
          if (!populated) expect.unreachable('Expected populated');
          await saveAssessmentArrangementFixture(
            ctx,
            assessment.id,
            populated.parts.map((part) => ({
              ...part,
              options: {
                navigationMode: 'linear',
                submissionMode: 'simultaneous',
                timeLimits: { minTime: 60, maxTime: 300 },
                instructionsHtml: '<p>Read every question before submitting.</p>',
              },
            })),
          );
          const saved = await getAssessment(ctx, assessment.id);
          if (!saved) expect.unreachable('Expected saved');
          const resolved = await loadAssessmentItemExports(
            db,
            ctx,
            toAssessmentExportSelectionDocument(saved),
          );
          const exported = await buildValidatedQti3Assessment(resolved.document);
          if (!(exported.validation.ok)) expect.unreachable('Expected exported.validation.ok');
          expect(exported.xml).toContain('min-time="60"');
          expect(exported.xml).toContain('max-time="300"');
          const destination = resolveAssessmentExportTarget('qti3-conformant');
          if (!(destination.ok)) expect.unreachable('Expected destination.ok');
          const packaged = await convertQti3AssessmentPackage({
            document: resolved.document,
            assessmentXml: exported.xml,
            itemsXml: resolved.itemsXml,
            assets: [],
          }, destination.target);
          if (!(packaged.ok)) expect.unreachable('Expected packaged.ok');
          const entries = unzipSync(packaged.artifact);
          expect(new TextDecoder().decode(entries['assessment.xml'])).toStrictEqual(exported.xml);
          for (const [itemId, xml] of Object.entries(resolved.itemsXml)) {
            expect(new TextDecoder().decode(entries[`items/${itemId}.xml`])).toStrictEqual(xml);
          }
          expect((await getAssessment(ctx, assessment.id))?.parts).toStrictEqual(saved.parts);
          // Explicit opt-in synthetic integration artifact; no application storage/configuration path.
          const output = process.env['QFLOW_SETTINGS_HANDOFF'];
          if (output) await _fs.writeFile(output, packaged.artifact);
        } finally {
          await deleteAssessment(ctx, assessment.id);
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);
