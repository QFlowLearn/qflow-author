import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { organizationMemberships, users } from '../lib/db/principal_schema.ts';
import { organizationItems, organizationSetups } from '../lib/db/question_organization_schema.ts';
import {
  queueOrganizationInTransaction,
  saveOrganizationSetup,
} from '../lib/services/question_organization_store.ts';
import { processOrganizationStep } from '../lib/services/question_organization_processor.ts';
import { completeOrganizationUndoForTest } from './helpers/organization_undo.ts';
import { addEnrichmentQuestions, withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import {
  organizationNow as now,
  withOrganizationWorkspace,
} from './helpers/organization_workspace.ts';

const services = {
  database: db,
  now,
  newId: () => crypto.randomUUID(),
  provider: () => {
    throw new Error('Source mappings must not call a model.');
  },
};

testCase(
  'organization rejects foreign or unrelated questions and checks current authority instead of the request role',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        await withEnrichmentWorkspace(async (other) => {
          const foreign = await addEnrichmentQuestions(other, 1);
          const unrelated = await addEnrichmentQuestions(f.ctx, 1);
          for (const ids of [foreign, unrelated]) {
            expect(
              await db.transaction((tx) =>
                queueOrganizationInTransaction(tx, f.ctx, {
                  id: crypto.randomUUID(),
                  setupId: f.setupId,
                  mode: 'apply',
                  questionIds: ids,
                }, now())
              ),
            ).toStrictEqual({ ok: false, code: 'invalid_input' });
          }
          expect(await completeOrganizationUndoForTest(db, other, f.runId, now())).toStrictEqual({
            ok: false,
            code: 'not_found',
          });
        });
        await db.update(organizationMemberships).set({ role: 'teaching_assistant' })
          .where(eq(organizationMemberships.userId, f.ctx.userId));
        expect(
          await db.transaction((tx) =>
            queueOrganizationInTransaction(tx, f.ctx, {
              id: crypto.randomUUID(),
              setupId: f.setupId,
              mode: 'apply',
              questionIds: f.ids,
            }, now())
          ),
        ).toStrictEqual({ ok: false, code: 'forbidden' });
        expect(await processOrganizationStep(f.params, services)).toStrictEqual({
          ok: false,
          code: 'forbidden',
        });
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'a changed collection setup leaves queued mappings frozen and another authorized lead can undo a departed author',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        const [old] = await db.select().from(organizationSetups).where(
          eq(organizationSetups.id, f.setupId),
        );
        if (
          !((await saveOrganizationSetup(db, f.ctx, {
            id: crypto.randomUUID(),
            collectionId: f.originId,
            expectedVersion: 1,
            policy: {
              versionId: f.versionId,
              classifier: { kind: 'source_only' },
              filing: [],
              sourceMappings: [{
                sourceId: f.sourceId,
                sectionKey: 'chapter-1',
                topicId: 'energy',
              }],
            },
          }, now())).ok)
        ) {
          expect.unreachable(
            'Expected (await saveOrganizationSetup(db, f.ctx, { id: crypto.randomUUID(), collectionId: f.originI',
          );
        }
        if (!((await processOrganizationStep(f.params, services)).ok)) {
          expect.unreachable('Expected (await processOrganizationStep(f.params, services)).ok');
        }
        const items = await db.select().from(organizationItems).where(
          eq(organizationItems.runId, f.runId),
        );
        if (
          !(items.every((item) =>
            JSON.stringify(item.decision) === '{"kind":"source","topicId":"cells"}'
          ))
        ) {
          expect.unreachable(
            'Expected items.every((item) => JSON.stringify(item.decision) === \'{"kind":"source","topicId":"cells',
          );
        }
        expect(
          (await db.select().from(organizationSetups).where(eq(organizationSetups.id, f.setupId)))[
            0
          ],
        ).toStrictEqual(old);
        const newLead = crypto.randomUUID();
        try {
          await db.insert(users).values({
            id: newLead,
            email: `${newLead}@example.test`,
            emailNormalized: `${newLead}@example.test`,
          });
          await db.insert(organizationMemberships).values({
            id: crypto.randomUUID(),
            tenantId: f.ctx.tenantId,
            userId: newLead,
            role: 'admin',
          });
          await db.delete(organizationMemberships).where(
            eq(organizationMemberships.userId, f.ctx.userId),
          );
          if (
            !((await completeOrganizationUndoForTest(
              db,
              { ...f.ctx, userId: newLead, role: 'admin' },
              f.runId,
              now(),
            )).ok)
          ) {
            expect.unreachable(
              "Expected (await completeOrganizationUndoForTest( db, { ...f.ctx, userId: newLead, role: 'admin' }, ",
            );
          }
        } finally {
          await db.delete(organizationMemberships).where(
            eq(organizationMemberships.userId, newLead),
          );
          await db.delete(users).where(eq(users.id, newLead));
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);
