import { sql } from 'drizzle-orm';
import { tenants } from './principal_schema.ts';
import { questionRevisions } from './question_schema.ts';
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/** Pinned draft or immutable frozen edition; distribution state changes independently. */
export const bankReleases = pgTable('bank_releases', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  label: text('label').notNull(),
  version: integer('version').notNull(),
  state: text('state').notNull(),
  distribution: text('distribution').notNull(),
  replacementId: uuid('replacement_id'),
  manifest: jsonb('manifest').$type<unknown>().notNull(),
  digest: text('digest').notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  frozenAt: timestamp('frozen_at', { withTimezone: true }),
  evidence: jsonb('evidence').$type<unknown>(),
}, (t) => ({
  identity: unique().on(t.id, t.tenantId),
  replacementWorkspace: foreignKey({
    columns: [t.replacementId, t.tenantId],
    foreignColumns: [t.id, t.tenantId],
    name: 'bank_release_replacement_workspace',
  }),
  replacementNotSelf: check(
    'bank_release_replacement_not_self',
    sql`${t.replacementId} IS NULL OR ${t.replacementId} <> ${t.id}`,
  ),
  label: unique().on(t.tenantId, t.label),
  labelCheck: check(
    'bank_releases_label_check',
    sql`char_length(btrim(${t.label})) BETWEEN 1 AND 160`,
  ),
  versionCheck: check('bank_releases_version_check', sql`${t.version} > 0`),
  stateCheck: check('bank_releases_state_check', sql`${t.state} IN ('draft','frozen')`),
  distributionCheck: check(
    'bank_releases_distribution_check',
    sql`${t.distribution} IN ('available','withdrawn')`,
  ),
  manifestCheck: check('bank_releases_manifest_check', sql`jsonb_typeof(${t.manifest}) = 'object'`),
  digestCheck: check('bank_releases_digest_check', sql`${t.digest} ~ '^[0-9a-f]{64}$'`),
  lifecycleCheck: check(
    'bank_releases_check',
    sql`(${t.state} = 'draft' AND ${t.frozenAt} IS NULL AND ${t.evidence} IS NULL AND ${t.distribution} = 'available') OR (${t.state} = 'frozen' AND ${t.frozenAt} IS NOT NULL AND ${t.evidence} IS NOT NULL)`,
  ),
}));
/** Relational retention pins prevent deleting revisions referenced by an edition. */
export const bankReleaseRevisions = pgTable(
  'bank_release_revisions',
  {
    tenantId: uuid('tenant_id').notNull(),
    releaseId: uuid('release_id').notNull(),
    questionId: uuid('question_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
  },
  (t) => ({
    identity: primaryKey({ columns: [t.releaseId, t.questionId] }),
    release: foreignKey({
      columns: [t.releaseId, t.tenantId],
      foreignColumns: [bankReleases.id, bankReleases.tenantId],
    }),
    revision: foreignKey({
      columns: [t.revisionId, t.questionId, t.tenantId],
      foreignColumns: [
        questionRevisions.id,
        questionRevisions.questionId,
        questionRevisions.tenantId,
      ],
    }),
  }),
);
/** Actor-bound operation receipts fence retries and retain a readable history. */
export const bankReleaseEvents = pgTable(
  'bank_release_events',
  {
    tenantId: uuid('tenant_id').notNull(),
    operationId: uuid('operation_id').notNull(),
    releaseId: uuid('release_id').notNull(),
    actorId: uuid('actor_id').notNull(),
    actorLabel: text('actor_label').notNull(),
    command: jsonb('command').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    identity: primaryKey({ columns: [t.tenantId, t.operationId] }),
    release: foreignKey({
      columns: [t.releaseId, t.tenantId],
      foreignColumns: [bankReleases.id, bankReleases.tenantId],
    }),
  }),
);
/** Durable reservation exists before any object write; adopted objects cannot be cleaned up. */
export const bankReleasePreparations = pgTable('bank_release_preparations', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  releaseId: uuid('release_id').notNull(),
  baseDigest: text('base_digest').notNull(),
  state: text('state').notNull(),
  objectKey: text('object_key').notNull(),
  sha256: text('sha256'),
  byteLength: integer('byte_length'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => ({
  release: foreignKey({
    columns: [t.releaseId, t.tenantId],
    foreignColumns: [bankReleases.id, bankReleases.tenantId],
  }),
  key: unique().on(t.objectKey),
  stateCheck: check(
    'bank_release_preparations_state_check',
    sql`${t.state} IN ('reserved','ready','adopted','deleting','deleted')`,
  ),
  identityCheck: check(
    'bank_release_preparations_check',
    sql`(${t.sha256} IS NULL AND ${t.byteLength} IS NULL) OR (${t.sha256} ~ '^[0-9a-f]{64}$' AND ${t.byteLength} >= 0)`,
  ),
}));
