import {
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { bankReleases } from './bank_release_schema.ts';

/** One compilation identity per frozen edition, compiler and destination policy. */
export const releaseArtifacts = pgTable('release_artifacts', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  releaseId: uuid('release_id').notNull(),
  releaseDigest: text('release_digest').notNull(),
  destination: text('destination').notNull(),
  compiler: text('compiler').notNull(),
  policy: text('policy').notNull(),
  currentAttemptId: uuid('current_attempt_id').notNull(),
  receipt: jsonb('receipt').$type<unknown>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => ({
  identity: unique().on(t.id, t.tenantId),
  compilation: unique().on(t.tenantId, t.releaseId, t.destination, t.compiler, t.policy),
  release: foreignKey({
    columns: [t.releaseId, t.tenantId],
    foreignColumns: [bankReleases.id, bankReleases.tenantId],
  }),
}));

/** Each explicit attempt owns a permanent token and storage reservation; retries never reuse keys. */
export const releaseBuildAttempts = pgTable('release_build_attempts', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  artifactId: uuid('artifact_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  previousAttemptId: uuid('previous_attempt_id'),
  state: text('state').notNull(),
  objectKey: text('object_key').notNull(),
  report: jsonb('report').$type<unknown>(),
  sha256: text('sha256'),
  byteLength: integer('byte_length'),
  candidateDigest: text('candidate_digest'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }),
}, (t) => ({
  identity: unique().on(t.id, t.artifactId, t.tenantId),
  artifact: foreignKey({
    columns: [t.artifactId, t.tenantId],
    foreignColumns: [releaseArtifacts.id, releaseArtifacts.tenantId],
  }),
  key: unique().on(t.objectKey),
}));
