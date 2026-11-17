import { expect, test as testCase } from 'vitest';

import { parseXmlStrict } from '../lib/import/xml_dom.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { saveQuestionRevisionFixture } from './question_revision_fixture.ts';

import { and, eq } from 'drizzle-orm';
import { unzipSync } from 'fflate';
import { db } from '../lib/db.ts';
import { enrichmentSchemes, enrichmentSchemeVersions } from '../lib/db/bank_enrichment_schema.ts';
import { questionRevisions, questions } from '../lib/db/question_schema.ts';
import { organizationActivation } from '../lib/db/question_organization_schema.ts';
import { loadAssessmentItemExports } from '../lib/export/assessment_loader.ts';
import {
  buildQti3AssessmentPackageEntries,
  buildValidatedQti3Assessment,
} from '../lib/export/assessment.ts';
import { getMigrationRun } from '../lib/import/migration_run_queries.ts';
import { parseQtiPackage } from '../lib/import/adapters/qti3/parse_package.ts';
import {
  type OrganizationTransfer,
  parseOrganizationTransfer,
} from '../lib/organization_transfer.ts';
import { organizationCatalogXml, organizationItemXml } from '../lib/organization_transfer_xml.ts';
import { loadCurrentEnrichmentChanges } from '../lib/services/bank_enrichment_changes.ts';
import {
  queueOrganizationInTransaction,
  saveOrganizationSetup,
} from '../lib/services/question_organization_store.ts';
import { processOrganizationStep } from '../lib/services/question_organization_processor.ts';
import { completeOrganizationUndoForTest } from './helpers/organization_undo.ts';
import { organizationRuns } from '../lib/db/question_organization_schema.ts';
import { writeZip } from '../lib/zip.ts';
import { withImportedOrganizationQuestions } from './helpers/imported_organization_questions.ts';
import { organizationNow, withOrganizationWorkspace } from './helpers/organization_workspace.ts';
import { qtiOrganizationPackage } from './helpers/qti_organization_package.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';

function transfer(
  clear = false,
  schemeId: string = crypto.randomUUID(),
  versionId: string = crypto.randomUUID(),
): OrganizationTransfer {
  return parseOrganizationTransfer({
    schema: 'qflow.organization.v1',
    vocabularies: [{ schemeId, versionId, definition: enrichmentDefinitionFixture() }],
    assignments: [
      {
        schemeId,
        versionId,
        dimension: 'subject',
        value: { state: 'assigned', valueIds: [clear ? 'physical' : 'life'] },
      },
      {
        schemeId,
        versionId,
        dimension: 'topic',
        value: clear
          ? { state: 'unassigned', reason: 'outside_scheme' }
          : { state: 'assigned', valueIds: ['cells'] },
      },
      {
        schemeId,
        versionId,
        dimension: 'difficulty',
        value: { state: 'assigned', valueIds: ['hard'] },
      },
    ],
  });
}
async function packageWithOrganization(first: OrganizationTransfer, second: OrganizationTransfer) {
  const entries = unzipSync(await qtiOrganizationPackage());
  const encoder = new TextEncoder();
  let manifest = new TextDecoder().decode(entries['imsmanifest.xml']);
  manifest = manifest.replace(
    '<resources>',
    `<metadata>${organizationCatalogXml({ cell: first, energy: second })}</metadata><resources>`,
  )
    .replace(
      '<file href="items/cell.xml"/>',
      `<metadata><lom:lom xmlns:lom="http://ltsc.ieee.org/xsd/LOM">${
        organizationItemXml(first)
      }</lom:lom></metadata><file href="items/cell.xml"/>`,
    )
    .replace(
      '<file href="items/energy.xml"/>',
      `<metadata><lom:lom xmlns:lom="http://ltsc.ieee.org/xsd/LOM">${
        organizationItemXml(second)
      }</lom:lom></metadata><file href="items/energy.xml"/>`,
    );
  entries['imsmanifest.xml'] = encoder.encode(manifest);
  return await writeZip(Object.entries(entries).map(([name, data]) => ({ name, data })));
}
const source = (bytes: Uint8Array) => ({
  filename: 'organized.zip',
  mime: 'application/zip',
  adapterId: 'qti3',
  bytes,
});

testCase(
  'structured organization survives approved import, protected processing, undo and cross-workspace reimport',
  async () => {
    const first = transfer(),
      second = transfer(true, first.vocabularies[0].schemeId, first.vocabularies[0].versionId);
    const bytes = await packageWithOrganization(first, second);
    await withOrganizationWorkspace(async (f) => {
      await withImportedOrganizationQuestions(f.ctx, f.originId, async (initial) => {
        const run = await getMigrationRun(f.ctx, initial.id);
        if (!run) expect.unreachable('Expected run');
        const ids = run.items.map((item) => {
          if (!(item.createdQuestionId)) expect.unreachable('Expected item.createdQuestionId');
          return item.createdQuestionId;
        });
        const [scheme] = await db.select().from(enrichmentSchemes).where(
          and(
            eq(enrichmentSchemes.tenantId, f.ctx.tenantId),
            eq(enrichmentSchemes.portableId, first.vocabularies[0].schemeId),
          ),
        );
        const [version] = await db.select().from(enrichmentSchemeVersions).where(
          eq(enrichmentSchemeVersions.schemeId, scheme.id),
        );
        const before = await loadCurrentEnrichmentChanges(db, f.ctx.tenantId, scheme.id, ids);
        expect(before.get(ids[0])?.topic?.value).toStrictEqual(first.assignments[1].value);
        expect(before.get(ids[1])?.topic?.value).toStrictEqual(second.assignments[1].value);
        if (
          !([...before.values()].every((values) =>
            Object.values(values).every((change) => change?.origin === 'source')
          ))
        ) {
          expect.unreachable(
            'Expected [...before.values()].every((values) => Object.values(values).every((change) => change?.ori',
          );
        }
        expect(
          (await db.select().from(organizationActivation).where(
            eq(organizationActivation.collectionId, f.originId),
          )).length,
        ).toStrictEqual(0);
        const rows = await db.select().from(questionRevisions).where(
          eq(questionRevisions.tenantId, f.ctx.tenantId),
        );
        if (!(rows.every((r) => !Object.hasOwn(r.body, 'importOrganization')))) {
          expect.unreachable(
            'Transfer data must be consumed, not become a second assignment store',
          );
        }
        const setupId = crypto.randomUUID();
        const setup = await saveOrganizationSetup(db, f.ctx, {
          id: setupId,
          collectionId: f.originId,
          expectedVersion: 1,
          policy: {
            versionId: version.id,
            classifier: { kind: 'source_only' },
            filing: [{ topicId: 'cells', collectionId: f.destinationId }],
            sourceMappings: [],
          },
        }, organizationNow());
        if (!(setup.ok)) expect.unreachable('Expected setup.ok');
        const jobId = crypto.randomUUID();
        const queued = await db.transaction((tx) =>
          queueOrganizationInTransaction(tx, f.ctx, {
            id: jobId,
            setupId,
            mode: 'apply',
            questionIds: ids,
          }, organizationNow())
        );
        if (!(queued.ok)) expect.unreachable('Expected queued.ok');
        const [job] = await db.select().from(organizationRuns).where(
          eq(organizationRuns.id, jobId),
        );
        const processed = await processOrganizationStep({
          jobId,
          workflowExecutionId: job.executionId,
        }, {
          database: db,
          now: organizationNow,
          newId: () => crypto.randomUUID(),
          provider: () => {
            throw new Error('Imported assignments must not use AI');
          },
        });
        if (!(processed.ok)) expect.unreachable('Expected processed.ok');
        expect(await loadCurrentEnrichmentChanges(db, f.ctx.tenantId, scheme.id, ids))
          .toStrictEqual(before);
        if (!((await completeOrganizationUndoForTest(db, f.ctx, jobId, organizationNow())).ok)) {
          expect.unreachable(
            'Expected (await completeOrganizationUndoForTest(db, f.ctx, jobId, organizationNow())).ok',
          );
        }
        expect(await loadCurrentEnrichmentChanges(db, f.ctx.tenantId, scheme.id, ids))
          .toStrictEqual(before);
        const loaded = await loadAssessmentItemExports(db, f.ctx, {
          assessment: { id: crypto.randomUUID(), title: 'Organization round trip' },
          parts: [{
            id: 'part',
            title: 'Science',
            placements: ids.map((id) => ({ id: crypto.randomUUID(), itemId: id, snapshotRev: 1 })),
          }],
        });
        expect(Object.values(loaded.organizationByItem).length).toStrictEqual(2);
        const assessment = await buildValidatedQti3Assessment(loaded.document);
        if (!(assessment.validation.ok)) expect.unreachable('Expected assessment.validation.ok');
        const exported = await writeZip(
          buildQti3AssessmentPackageEntries({
            ...loaded,
            assessmentXml: assessment.xml,
            assets: [],
          }),
        );
        const manifest = parseXmlStrict(
          new TextDecoder().decode(unzipSync(exported)['imsmanifest.xml']),
          'Exported metadata',
        );
        for (
          const metadata of Array.from(manifest.getElementsByTagNameNS(
            'http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1',
            'metadata',
          ))
        ) {
          expect(metadata.getElementsByTagNameNS('http://ltsc.ieee.org/xsd/LOM', 'lom').length)
            .toStrictEqual(1);
        }
        const parsed = await parseQtiPackage(exported);
        if (!(parsed.items.every((item) => item.draft.importOrganization))) {
          expect.unreachable(
            'Expected parsed.items.every((item) => item.draft.importOrganization)',
          );
        }
        for (const item of parsed.items) {
          expect(() => parsePersistedDraft(item.draft, item.draft.type)).toThrowError(
            expect.toSatisfy((caught: unknown) =>
              caught instanceof Error && caught.message.includes('unknown fields')
            ),
          );
        }
        await withOrganizationWorkspace(async (other) => {
          await withImportedOrganizationQuestions(other.ctx, other.originId, async (reimport) => {
            const committed = await getMigrationRun(other.ctx, reimport.id);
            if (!committed) expect.unreachable('Expected committed');
            const newIds = committed.items.map((item) => {
              if (!(item.createdQuestionId)) expect.unreachable('Expected item.createdQuestionId');
              return item.createdQuestionId;
            });
            const [localScheme] = await db.select().from(enrichmentSchemes).where(
              and(
                eq(enrichmentSchemes.tenantId, other.ctx.tenantId),
                eq(enrichmentSchemes.portableId, first.vocabularies[0].schemeId),
              ),
            );
            if (!(localScheme.id !== scheme.id)) {
              expect.unreachable('Expected localScheme.id !== scheme.id');
            }
            const restored = await loadCurrentEnrichmentChanges(
              db,
              other.ctx.tenantId,
              localScheme.id,
              newIds,
            );
            for (let i = 0; i < ids.length; i++) {
              for (const dimension of ['subject', 'topic', 'difficulty'] as const) {
                expect(restored.get(newIds[i])?.[dimension]?.value).toStrictEqual(
                  before.get(ids[i])?.[dimension]?.value,
                );
                expect(restored.get(newIds[i])?.[dimension]?.definition).toStrictEqual(
                  before.get(ids[i])?.[dimension]?.definition,
                );
              }
            }
            const projected = await loadAssessmentItemExports(db, other.ctx, {
              assessment: { id: crypto.randomUUID() },
              parts: [{
                id: 'p',
                title: 'Science',
                placements: newIds.map((id) => ({
                  id: crypto.randomUUID(),
                  itemId: id,
                  snapshotRev: 1,
                })),
              }],
            });
            expect(Object.values(projected.organizationByItem)).toStrictEqual(
              Object.values(loaded.organizationByItem),
            );
          }, source(exported));
        }, { count: 1, activation: 'disabled' });
        const countBefore = await db.select({ id: questions.id }).from(questions).where(
          eq(questions.tenantId, f.ctx.tenantId),
        );
        const changed = parseOrganizationTransfer({
          ...first,
          vocabularies: [{
            ...first.vocabularies[0],
            definition: { ...first.vocabularies[0].definition, name: 'Conflicting definition' },
          }],
        });
        const sourceAwait = source(await packageWithOrganization(changed, changed));
        await expect(
          Promise.resolve().then(() =>
            withImportedOrganizationQuestions(f.ctx, f.destinationId, () => {
              throw new Error('Conflicting import unexpectedly committed');
            }, sourceAwait)
          ),
        ).rejects.toBeInstanceOf(Error);
        expect(
          await db.select({ id: questions.id }).from(questions).where(
            eq(questions.tenantId, f.ctx.tenantId),
          ),
        ).toStrictEqual(countBefore);
        expect(await loadCurrentEnrichmentChanges(db, f.ctx.tenantId, scheme.id, ids))
          .toStrictEqual(before);
        // Re-upload is a new set of questions, but the portable vocabulary is reused unchanged.
        await withImportedOrganizationQuestions(f.ctx, f.destinationId, async () => {
          const versions = await db.select().from(enrichmentSchemeVersions).where(
            eq(enrichmentSchemeVersions.schemeId, scheme.id),
          );
          expect(versions.length).toStrictEqual(1);
        }, source(exported));
        const [revision] = await db.select().from(questionRevisions).where(
          eq(questionRevisions.id, before.get(ids[0])!.topic!.revisionId),
        );
        await saveQuestionRevisionFixture(f.ctx, {
          questionId: ids[0],
          title: 'Cell nucleus',
          body: revision.body,
          qtiXml: revision.qtiXml,
          tags: ['imported'],
          provenance: { _tag: 'Revision', operation: 'revised', expectedParentRevision: 1 },
        });
        const staleExport = await loadAssessmentItemExports(db, f.ctx, {
          assessment: { id: crypto.randomUUID() },
          parts: [{
            id: 'p',
            title: 'Stale',
            placements: [{ id: 'p1', itemId: ids[0], snapshotRev: null }],
          }],
        });
        expect(Object.values(staleExport.itemsXml)).toStrictEqual([revision.qtiXml]);
        expect(staleExport.organizationByItem).toStrictEqual({});
        expect(staleExport.omittedOrganizationItemIds).toStrictEqual(
          Object.keys(staleExport.itemsXml),
        );
      }, source(bytes));
    }, { count: 1, activation: 'disabled' });
  },
);

testCase(
  'transfer parser rejects contradictory and dangling labels and excludes private examples',
  () => {
    const good = transfer();
    expect(() =>
      parseOrganizationTransfer({
        ...good,
        assignments: [...good.assignments, good.assignments[0]],
      })
    ).toThrowError(Error);
    expect(() => parseOrganizationTransfer({ ...good, assignments: good.assignments.slice(1) }))
      .toThrowError(Error);
    expect(() => parseOrganizationTransfer({ ...good, vocabularies: [] })).toThrowError(Error);
    expect(() =>
      parseOrganizationTransfer({
        ...good,
        vocabularies: [{
          ...good.vocabularies[0],
          definition: { ...good.vocabularies[0].definition, instructions: 'Private prompt' },
        }],
      })
    ).toThrowError(Error);
  },
);

testCase(
  'native QTI import rejects missing organization catalogs and ignores foreign namespaces',
  async () => {
    const first = transfer();
    const entries = unzipSync(await packageWithOrganization(first, first));
    const original = new TextDecoder().decode(entries['imsmanifest.xml']);
    const missingCatalog = original.replace(
      /<qflow:organization-catalog[\s\S]*?<\/qflow:organization-catalog>/,
      '',
    );
    entries['imsmanifest.xml'] = new TextEncoder().encode(missingCatalog);
    const missingPackage = await writeZip(
      Object.entries(entries).map(([name, data]) => ({ name, data })),
    );
    await expect(Promise.resolve().then(() => parseQtiPackage(missingPackage))).rejects
      .toBeInstanceOf(Error);
    entries['imsmanifest.xml'] = new TextEncoder().encode(original.replaceAll(
      'https://qflowlearn.com/ns/organization/v1',
      'urn:unrelated',
    ));
    const parsed = await parseQtiPackage(
      await writeZip(Object.entries(entries).map(([name, data]) => ({ name, data }))),
    );
    if (!(parsed.items.every((item) => item.draft.importOrganization === undefined))) {
      expect.unreachable(
        'Expected parsed.items.every((item) => item.draft.importOrganization === undefined)',
      );
    }
  },
);
