import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { runCommand } from './process_command.ts';
import { hasFileErrorCode } from './file_errors.ts';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';
import * as _url from 'node:url';
// Validate QTI 3 XML against local XSDs using xmllint.
// Usage:
//   node --import tsx tools/validate.ts --tenant-id <uuid>   # validate all stored question revisions
//   node --import tsx tools/validate.ts --file path  # validate a single XML file
//   node --import tsx tools/validate.ts --dir dir    # validate all *.xml under dir
//   node --import tsx tools/validate.ts --corpus     # validate deterministic serializer output + fixtures

import { eq } from 'drizzle-orm';
import { db } from '../lib/db.ts';
import { assessments, questionRevisions } from '../lib/db/schema.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { type RequestContext, SYSTEM_USER_ID } from '../lib/tenants.ts';
import { buildAssessmentTestXml } from '../lib/test_export.ts';
import { exportQti3AssessmentItemXml } from '../lib/types/qti3_authoring.ts';
import { QUESTION_TYPE_IDS, TYPE_DRIVERS } from '../lib/types/registry.ts';
import { prepareDriverDraftForBuild } from '../lib/types/buildable_driver_draft.ts';

const XSD_UMBRELLA =
  new URL('../vendor/qti/qti3-xsd/imsqti_asiv3p0p1_v1p0.xsd', import.meta.url).pathname;
const QTI_FIXTURE_DIR = new URL('../tests/fixtures/qti3/', import.meta.url).pathname;

type Mode = { kind: 'db' } | { kind: 'file'; path: string } | { kind: 'dir'; dir: string } | {
  kind: 'tests';
} | {
  kind: 'corpus';
};

type Args = { mode: Mode; tenantId?: string };

function parseArgs(): Args {
  let tenantId: string | undefined = undefined;
  for (let i = 0; i < process.argv.slice(2).length; i++) {
    const k = process.argv.slice(2)[i];
    const v = process.argv.slice(2)[i + 1];
    if ((k === '--tenant' || k === '--tenant-id') && v) tenantId = v;
    if (k === '--file' && v) return { mode: { kind: 'file', path: v }, tenantId };
    if (k === '--dir' && v) return { mode: { kind: 'dir', dir: v }, tenantId };
    if (k === '--tests') return { mode: { kind: 'tests' }, tenantId };
    if (k === '--corpus') return { mode: { kind: 'corpus' }, tenantId };
  }
  return { mode: { kind: 'db' }, tenantId };
}

async function validateFile(path: string): Promise<{ ok: boolean; out: string }> {
  return await validateFiles([path]);
}

async function validateFiles(paths: readonly string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const res = await runCommand('xmllint', ['--noout', '--schema', XSD_UMBRELLA, ...paths]);
    const err = new TextDecoder().decode(res.stderr);
    return { ok: res.code === 0, out: err.trim() };
  } catch (e) {
    if (hasFileErrorCode(e, 'ENOENT')) {
      console.error(
        'xmllint not found. Install libxml2 (e.g., `brew install libxml2`), ensure xmllint is on PATH.',
      );
      process.exit(2);
    }
    throw e;
  }
}

function buildSchemaCorpus(): ReadonlyArray<{ readonly name: string; readonly xml: string }> {
  const items = QUESTION_TYPE_IDS.map((typeId) => ({
    name: `item-${typeId}.xml`,
    xml: exportQti3AssessmentItemXml(
      typeId,
      prepareDriverDraftForBuild(typeId, {
        ...TYPE_DRIVERS[typeId].defaults(),
        itemLanguage: newAuthoringItemLanguage(),
      }),
      { identifier: `item-${typeId}` },
    ),
  }));
  const assessmentXml = buildAssessmentTestXml(
    { id: 'schema-corpus', title: 'Schema corpus' },
    [{
      id: 'part-1',
      title: 'Part 1',
      placements: QUESTION_TYPE_IDS.map((typeId) => ({
        id: `placement-${typeId}`,
        itemId: `item-${typeId}`,
      })),
    }],
  );
  return [...items, { name: 'assessment-test.xml', xml: assessmentXml }];
}

async function qtiFixturePaths(): Promise<readonly string[]> {
  const entries = [];
  for await (const entry of await _fs.opendir(QTI_FIXTURE_DIR)) {
    if (entry.isFile() && entry.name.endsWith('.xml')) entries.push(entry.name);
  }
  entries.sort();
  return entries.map((name) => `${QTI_FIXTURE_DIR}${name}`);
}

async function validateSchemaCorpus(): Promise<{ ok: boolean; out: string; count: number }> {
  const generated = buildSchemaCorpus();
  const temporaryDirectory = await _fs.mkdtemp(_path.join(_os.tmpdir(), 'qti-schema-corpus-'));
  try {
    const generatedPaths = await Promise.all(generated.map(async ({ name, xml }) => {
      const path = `${temporaryDirectory}/${name}`;
      await _fs.writeFile(path, xml, 'utf8');
      return path;
    }));
    const paths = [...await qtiFixturePaths(), ...generatedPaths];
    return { ...await validateFiles(paths), count: paths.length };
  } finally {
    await _fs.rm(temporaryDirectory, { recursive: true });
  }
}

async function* iterQuestionRevisions(
  ctx: RequestContext,
): AsyncGenerator<{ id: string; rev: number; xml: string }> {
  const revisions = await db.select({
    questionId: questionRevisions.questionId,
    revision: questionRevisions.revision,
    qtiXml: questionRevisions.qtiXml,
  }).from(questionRevisions).where(eq(questionRevisions.tenantId, ctx.tenantId));
  for (const rev of revisions) {
    if (rev.qtiXml) {
      yield { id: rev.questionId, rev: rev.revision, xml: rev.qtiXml };
    }
  }
}

async function* iterAssessmentTests(
  ctx: RequestContext,
): AsyncGenerator<{ id: string; xml: string }> {
  const { toAssessmentExportSelectionDocument } = await import('../lib/export/assessment.ts');
  const { loadAssessmentItemExports } = await import('../lib/export/assessment_loader.ts');
  const { buildAssessmentTestXml } = await import('../lib/test_export.ts');
  const rows = await db.select({ id: assessments.id })
    .from(assessments)
    .where(eq(assessments.tenantId, ctx.tenantId));
  for (const { id } of rows) {
    const assessment = await getAssessment(ctx, id);
    if (!assessment) continue;
    const { document } = await loadAssessmentItemExports(
      db,
      ctx,
      toAssessmentExportSelectionDocument(assessment),
    );
    const xml = buildAssessmentTestXml(document.assessment, [...document.parts]);
    yield { id: String(assessment.id), xml };
  }
}

async function main() {
  const { mode, tenantId } = parseArgs();
  let failures = 0;
  if (mode.kind === 'file') {
    const r = await validateFile(mode.path);
    if (!r.ok) {
      failures++;
      console.error(r.out);
    } else console.log('OK', mode.path);
  } else if (mode.kind === 'dir') {
    const entries = [];
    for await (const entry of await _fs.opendir(mode.dir)) {
      if (entry.isFile() && entry.name.endsWith('.xml')) entries.push(entry.name);
    }
    entries.sort();
    for (const name of entries) {
      const p = `${mode.dir}/${name}`;
      const r = await validateFile(p);
      if (!r.ok) {
        failures++;
        console.error(`FAIL ${p}\n${r.out}`);
      } else console.log('OK', p);
    }
  } else if (mode.kind === 'db') {
    if (!tenantId) {
      console.error('Missing --tenant-id (required for DB validation in multi-tenant mode).');
      process.exit(2);
    }
    const auth: RequestContext = { tenantId, userId: SYSTEM_USER_ID, role: 'owner' };
    const tmp = await _fs.mkdtemp(_path.join(_os.tmpdir(), 'qti-validate-'));
    console.log('Validating question revisions using', XSD_UMBRELLA);
    for await (const s of iterQuestionRevisions(auth)) {
      const file = `${tmp}/item-${s.id}-r${s.rev}.xml`;
      await _fs.writeFile(file, s.xml, 'utf8');
      const r = await validateFile(file);
      if (!r.ok) {
        failures++;
        console.error(`FAIL item ${s.id} r${s.rev}\n${r.out}`);
      } else console.log(`OK item ${s.id} r${s.rev}`);
    }
  } else if (mode.kind === 'tests') {
    if (!tenantId) {
      console.error('Missing --tenant-id (required for test validation in multi-tenant mode).');
      process.exit(2);
    }
    const auth: RequestContext = { tenantId, userId: SYSTEM_USER_ID, role: 'owner' };
    const tmp = await _fs.mkdtemp(_path.join(_os.tmpdir(), 'qti-tests-'));
    console.log('Validating assessment tests using', XSD_UMBRELLA);
    for await (const t of iterAssessmentTests(auth)) {
      const file = `${tmp}/test-${t.id}.xml`;
      await _fs.writeFile(file, t.xml, 'utf8');
      const r = await validateFile(file);
      if (!r.ok) {
        failures++;
        console.error(`FAIL test ${t.id}\n${r.out}`);
      } else console.log(`OK test ${t.id}`);
    }
  } else if (mode.kind === 'corpus') {
    console.log('Validating deterministic QTI schema corpus using', XSD_UMBRELLA);
    const result = await validateSchemaCorpus();
    if (!result.ok) {
      failures++;
      console.error(result.out);
    } else {
      console.log(`OK ${result.count} generated and fixture documents`);
    }
  }
  if (failures > 0) {
    console.error(`Validation finished with ${failures} failure(s).`);
    process.exit(1);
  }
  console.log('Validation passed.');
}

if ((process.argv[1] && _path.resolve(process.argv[1]) === _url.fileURLToPath(import.meta.url))) {
  await main();
}
