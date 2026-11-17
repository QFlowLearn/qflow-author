import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const userSettingsTable = pgTable('user_settings', {
  userId: uuid('user_id').primaryKey(),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  action: text('action').notNull(),
  actorUserId: uuid('actor_user_id'),
  targetUserId: uuid('target_user_id'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const uploadsTable = pgTable('uploads', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  path: text('path').notNull(),
  url: text('url').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
