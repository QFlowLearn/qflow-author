import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const tenantDomains = pgTable('tenant_domains', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  domain: text('domain').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const ssoDomainRoutes = pgTable('sso_domain_routes', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  domain: text('domain').notNull(),
  provider: text('provider').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const ssoDomainVerifications = pgTable(
  'sso_domain_verifications',
  {
    tenantId: uuid('tenant_id').notNull(),
    domain: text('domain').notNull(),
    verificationToken: text('verification_token').notNull(),
    dnsVerifiedAt: timestamp('dns_verified_at', { withTimezone: true }),
    httpsVerifiedAt: timestamp('https_verified_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.domain] }),
  }),
);

export const oidcLoginStates = pgTable('oidc_login_states', {
  state: text('state').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  provider: text('provider').notNull(),
  nonce: text('nonce').notNull(),
  redirectPath: text('redirect_path'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const oidcTenantConfigs = pgTable(
  'oidc_tenant_configs',
  {
    tenantId: uuid('tenant_id').notNull(),
    provider: text('provider').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    clientId: text('client_id'),
    encryptedClientSecret: text('encrypted_client_secret'),
    microsoftTenant: text('microsoft_tenant'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.provider] }),
  }),
);

export const userPasswords = pgTable('user_passwords', {
  userId: uuid('user_id').primaryKey(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const authIdentities = pgTable('auth_identities', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  provider: text('provider').notNull(),
  providerId: text('provider_id').notNull(),
  email: text('email'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const authSessions = pgTable('auth_sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
});

export const passwordResetEmailDeliveries = pgTable(
  'password_reset_email_deliveries',
  {
    id: uuid('id').primaryKey(),
    resetTokenId: uuid('reset_token_id').notNull(),
    userId: uuid('user_id').notNull(),
    tenantId: uuid('tenant_id'),
    email: text('email').notNull(),
    interfaceLocale: text('interface_locale').notNull(),
    encryptedToken: text('encrypted_token'),
    attempts: integer('attempts').notNull().default(0),
    leaseToken: uuid('lease_token'),
    leasedUntil: timestamp('leased_until', { withTimezone: true }),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    resetTokenUnique: uniqueIndex('password_reset_email_deliveries_reset_token_idx').on(
      table.resetTokenId,
    ),
    pendingIndex: index('password_reset_email_deliveries_pending_idx').on(
      table.deliveredAt,
      table.invalidatedAt,
      table.leasedUntil,
      table.createdAt,
    ),
  }),
);

export const authLoginAttempts = pgTable('auth_login_attempts', {
  attemptKey: text('attempt_key').primaryKey(),
  attempts: integer('attempts').notNull().default(0),
  firstAttemptAt: timestamp('first_attempt_at', { withTimezone: true }),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
});
