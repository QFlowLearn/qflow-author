import { resolvePrintRenderer } from '../deploy/cloudflare/print_renderer_binding.ts';
import { buildPrintPack, PrintBuildStorageError } from '../lib/services/assessment_print_build.ts';
import { expect, it } from 'vitest';
import { printRenderer } from '../deploy/cloudflare/print_renderer.entry.ts';
import { preflightPrint } from '../lib/print/print_preflight.ts';
import { projectMarkingPaper, projectStudentPaper } from '../lib/print/print_projection.ts';
import { exportQti3TestItemXml } from '../tests/qti3_writer_test_helpers.ts';
import type { PrintSource } from '../lib/print/print_snapshot.ts';
import type { PrintConfiguration } from '../lib/print/print_contract.ts';
import { PRINT_RENDERER_ID, PRINT_TEMPLATE_VERSION } from '../lib/print/print_snapshot.ts';

it('private compiler RPC rejects mismatched identities and unparsed source input', async () => {
  const service: unknown = env.QFLOW_PRINT_RENDERER;
  if (!service || typeof service !== 'object') expect.unreachable();
  const render = Reflect.get(service, 'render');
  await expect(
    Promise.resolve(
      Reflect.apply(render, service, [{
        rendererId: 'wrong',
        templateVersion: PRINT_TEMPLATE_VERSION,
        document: {},
      }]),
    ),
  ).rejects.toThrow('identity differs');
  await expect(
    Promise.resolve(
      Reflect.apply(render, service, [{
        rendererId: PRINT_RENDERER_ID,
        templateVersion: PRINT_TEMPLATE_VERSION,
        document: { source: '#eval("private")' },
      }]),
    ),
  ).rejects.toThrow('Invalid print renderer document');
});

it('real workerd renders the product template from separated projections for A4 and Letter', () => {
  const configuration: PrintConfiguration = {
    title: 'Prövning – Español',
    paper: 'a4',
    locale: 'sv-SE',
    instructions: 'Läs frågorna.',
    responseLines: 6,
    responseOverrides: {},
    order: 'authored',
    approvePresentation: true,
  };
  const source: PrintSource = {
    assessmentId: crypto.randomUUID(),
    assessmentTitle: 'STAFF_METADATA',
    assessmentMetadata: { secret: 'STAFF_SECRET' },
    adaptive: false,
    parts: [{
      id: crypto.randomUUID(),
      title: 'Avsnitt',
      options: {},
      placements: [{
        kind: 'question',
        id: crypto.randomUUID(),
        questionId: crypto.randomUUID(),
        revisionId: crypto.randomUUID(),
        revision: 1,
        staffTitle: 'STAFF_TITLE',
        xml: exportQti3TestItemXml('single_select', {
          title: 'STAFF_TITLE',
          bodyHtml:
            '<p>Vilket svar är rätt? <strong>Välj.</strong></p><math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mn>1</mn><mn>2</mn></mfrac></math>',
          choices: [{ id: 'A', text: 'Första' }, { id: 'B', text: 'Andra' }],
          correctId: 'B',
          maximumScore: 2,
        }),
      }],
    }],
  };
  for (const paper of ['a4', 'letter'] as const) {
    const prepared = preflightPrint(source, { ...configuration, paper });
    expect(prepared.preflight.outcome).toBe('ready');
    const input = {
      configuration: { ...configuration, paper },
      form: 'QF-TEST',
      createdAt: '2026-10-29T10:00:00Z',
      parts: prepared.parts,
      assets: new Map(),
    };
    const student = projectStudentPaper(input), marking = projectMarkingPaper(input);
    expect(student.ok && marking.ok).toBe(true);
    if (!student.ok || !marking.ok) return;
    expect(JSON.stringify(student.value)).not.toContain('STAFF_');
    for (const projected of [student.value, marking.value]) {
      const result = printRenderer.render(projected);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(new TextDecoder().decode(result.value.bytes.slice(0, 5))).toBe('%PDF-');
      expect(result.value.pages).toBeGreaterThan(0);
    }
  }
});

it('binary image worlds recover after a real compiler failure and preserve deterministic PDF bytes', () => {
  const bytes = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAGnRFWHRDb21tZW50AFNUQUZGX1BOR19NRVRBREFUQcRviyMAAAAWSURBVHicY/jPwPCf4T9DA4hiYkACAFriBH9PPaHDAAAAAElFTkSuQmCC',
    ),
    (value) => value.charCodeAt(0),
  );
  const document = {
    kind: 'student' as const,
    title: 'Binary image',
    form: 'QF-BINARY',
    createdAt: '2026-10-29T10:00:00Z',
    paper: 'a4' as const,
    locale: 'en-US',
    instructions: '',
    labels: {
      document: 'Student paper',
      question: 'Question',
      response: 'Response',
      marking: 'Marking',
      continued: 'continued',
    },
    images: [{ format: 'png' as const, bytes }],
    parts: [{
      title: 'Images',
      instructions: [],
      entries: [{
        kind: 'content' as const,
        content: [{
          kind: 'image' as const,
          asset: 0,
          alt: 'Transparent image',
          language: 'en-US',
        }],
      }],
    }],
  };
  const before = printRenderer.render(document);
  expect(before.ok).toBe(true);
  expect(
    printRenderer.render({
      ...document,
      images: [{ format: 'png', bytes: new Uint8Array([137, 80, 78, 71, 0]) }],
    }),
  ).toEqual({ ok: false, code: 'render_failed' });
  const after = printRenderer.render(document);
  expect(after).toEqual(before);
});

import { env } from 'cloudflare:workers';
import { introspectWorkflowInstance } from 'cloudflare:test';
import { getDb } from '../lib/db.ts';
import { resolveStorage } from '../lib/storage.ts';
import { runWithRequestRuntime } from '../lib/server/request_runtime_context.ts';
import { withEnrichmentWorkspace } from '../tests/helpers/enrichment_workspace.ts';
import { createAssessmentDraft, deleteAssessment } from '../tests/assessment_fixture.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { createPrintPreview, getPrintPreview } from '../lib/services/assessment_print_previews.ts';
import { confirmPrintPack } from '../lib/services/assessment_print_confirmation.ts';
import { downloadPrintFile } from '../lib/services/assessment_print_delivery.ts';
import { printPackView } from '../lib/print/print_view.ts';
import { dispatchWorkflowOutbox } from '../deploy/cloudflare/workflows.entry.ts';
import { assessmentPrintPacks, assessments, workspacePublicationGrants } from '../lib/db/schema.ts';
import { eq } from 'drizzle-orm';

it(
  'real PostgreSQL/Workflow/R2 builds once, confirms exact bytes, and rechecks publication authority',
  async () => {
    const runtime = { bindings: env };
    await runWithRequestRuntime(runtime, async () => {
      const database = getDb(runtime), storage = resolveStorage(runtime);
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'Paper Workflow' });
        try {
          const initial = await getAssessment(ctx, assessment.id);
          if (!initial) expect.unreachable();
          const saved = await saveAssessmentQuestion(ctx, assessment.id, {
            _tag: 'Create',
            partId: initial.parts[0].id,
            draft: {
              type: 'single_select',
              title: 'STAFF_PRIVATE_TITLE',
              itemLanguage: newAuthoringItemLanguage(),
              bodyHtml: '<p>Choose one.</p>',
              maximumScore: 2,
              choices: [{ id: 'A', text: 'First' }, { id: 'B', text: 'Second' }],
              correctId: 'B',
            },
          });
          if (!saved.ok) expect.unreachable();
          const configuration: PrintConfiguration = {
            title: 'Retained exam',
            paper: 'a4',
            locale: 'en-US',
            instructions: '',
            responseLines: 6,
            responseOverrides: {},
            order: 'authored',
            approvePresentation: true,
          };
          const deps = {
            database,
            storage,
            now: () => new Date('2026-10-29T10:00:00Z'),
            newId: () => crypto.randomUUID(),
          };
          const result = await createPrintPreview(
            ctx,
            assessment.id,
            crypto.randomUUID(),
            configuration,
            deps,
          );
          if (!result.ok || !result.value.pack?.workflowExecutionId) expect.unreachable();
          const pack = result.value.pack;
          if (!pack.workflowExecutionId) expect.unreachable();
          const instance = await introspectWorkflowInstance(
            env.QFLOW_ASSESSMENT_PRINT_WORKFLOW,
            pack.workflowExecutionId,
          );
          expect((await dispatchWorkflowOutbox(env)).ok).toBe(true);
          await instance.waitForStatus('complete');
          const retry = await createPrintPreview(ctx, assessment.id, crypto.randomUUID(), {
            ...configuration,
            title: 'Storage retry form',
          }, deps);
          if (!retry.ok || !retry.value.pack?.workflowExecutionId) expect.unreachable();
          const retryPack = retry.value.pack;
          if (!retryPack.workflowExecutionId) expect.unreachable();
          let interrupted = false;
          const interruptedStorage = {
            ...storage,
            async putObject(input: Parameters<typeof storage.putObject>[0]) {
              await storage.putObject(input);
              if (!interrupted && input.key.includes('/pdf/marking-')) {
                interrupted = true;
                throw Error('Test-owned interrupted object acknowledgement.');
              }
            },
          };
          await expect(
            buildPrintPack(retryPack.id, retryPack.workflowExecutionId, {
              database,
              storage: interruptedStorage,
              renderer: resolvePrintRenderer(env),
            }),
          ).rejects.toBeInstanceOf(PrintBuildStorageError);
          const interruptedView = await getPrintPreview(ctx, assessment.id, retryPack.id, deps);
          expect(interruptedView.ok && interruptedView.value.state).toBe('building');
          expect(
            await buildPrintPack(retryPack.id, retryPack.workflowExecutionId, {
              database,
              storage,
              renderer: resolvePrintRenderer(env),
            }),
          ).toEqual({ ok: true, value: null });
          const recovered = await getPrintPreview(ctx, assessment.id, retryPack.id, deps);
          expect(recovered.ok && recovered.value.state).toBe('preview-ready');
          expect(recovered.ok && recovered.value.snapshot.form).toBe(retryPack.snapshot.form);
          // The outbox sees an already adopted complete candidate and does not render a new form.
          expect((await dispatchWorkflowOutbox(env)).ok).toBe(true);
          await (await introspectWorkflowInstance(
            env.QFLOW_ASSESSMENT_PRINT_WORKFLOW,
            retryPack.workflowExecutionId,
          )).waitForStatus('complete');
          const built = await getPrintPreview(ctx, assessment.id, pack.id, deps);
          expect(built.ok && built.value.state).toBe('preview-ready');
          if (!built.ok) expect.unreachable();
          const confirmation = printPackView(built.value).confirmation;
          if (!confirmation) expect.unreachable();
          const preview = await downloadPrintFile(
            ctx,
            assessment.id,
            pack.id,
            'student',
            true,
            deps,
          );
          expect(preview.ok).toBe(true);
          expect(await confirmPrintPack(ctx, assessment.id, pack.id, confirmation, deps)).toEqual({
            ok: false,
            code: 'forbidden',
          });
          await database.insert(workspacePublicationGrants).values({
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            grantedBy: ctx.userId,
          });
          const final = await confirmPrintPack(ctx, assessment.id, pack.id, confirmation, deps);
          expect(final.ok && final.value.state).toBe('confirmed');
          await withEnrichmentWorkspace(async (other) => {
            await database.insert(workspacePublicationGrants).values({
              tenantId: other.tenantId,
              userId: other.userId,
              grantedBy: other.userId,
            });
            expect(await getPrintPreview(other, assessment.id, pack.id, deps)).toEqual({
              ok: false,
              code: 'not_found',
            });
            expect(await confirmPrintPack(other, assessment.id, pack.id, confirmation, deps))
              .toEqual({ ok: false, code: 'not_found' });
            for (const kind of ['student', 'marking', 'manifest'] as const) {
              expect(await downloadPrintFile(other, assessment.id, pack.id, kind, false, deps))
                .toEqual({ ok: false, code: 'not_found' });
            }
          }, database);

          await database.update(assessments).set({ title: 'Later live edit' }).where(
            eq(assessments.id, assessment.id),
          );
          const download = await downloadPrintFile(
            ctx,
            assessment.id,
            pack.id,
            'student',
            false,
            deps,
          );
          expect(download).toEqual(preview);
          expect((await downloadPrintFile(ctx, assessment.id, pack.id, 'marking', false, deps)).ok)
            .toBe(true);
          expect((await downloadPrintFile(ctx, assessment.id, pack.id, 'manifest', false, deps)).ok)
            .toBe(true);
          const corrupt = {
            ...retryPack.snapshot,
            source: { ...retryPack.snapshot.source, assessmentTitle: 'CORRUPTED' },
          };
          await database.update(assessmentPrintPacks).set({ snapshot: corrupt }).where(
            eq(assessmentPrintPacks.id, retryPack.id),
          );
          expect(
            await buildPrintPack(retryPack.id, retryPack.workflowExecutionId, {
              database,
              storage,
              renderer: resolvePrintRenderer(env),
            }),
          ).toEqual({ ok: false, code: 'snapshot_corrupt' });
          await database.delete(workspacePublicationGrants).where(
            eq(workspacePublicationGrants.tenantId, ctx.tenantId),
          );
          expect(await downloadPrintFile(ctx, assessment.id, pack.id, 'student', false, deps))
            .toEqual({ ok: false, code: 'forbidden' });
        } finally {
          await database.delete(assessmentPrintPacks).where(
            eq(assessmentPrintPacks.assessmentId, assessment.id),
          );
          await deleteAssessment(ctx, assessment.id);
        }
      }, database);
    });
  },
  60000,
);
