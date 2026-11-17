-- Retain tenant-leading unique indexes and primary keys for these lookups.
-- Keep question_revisions_tenant_idx and migration_items_run_idx: both remain
-- selected by production query plans despite their prefix overlap.
SET LOCAL lock_timeout = '5s';

DROP INDEX public.draft_sessions_tenant_idx;
DROP INDEX public.migration_assets_run_idx;
DROP INDEX public.oidc_tenant_configs_tenant_idx;
DROP INDEX public.sso_domain_routes_tenant_idx;
DROP INDEX public.sso_domain_verifications_tenant_idx;

-- Current enrichment reads use change/operation identities; domain verification
-- reads use the retained (tenant_id, domain) primary key.
DROP INDEX public.enrichment_change_history_idx;
DROP INDEX public.sso_domain_verifications_verified_idx;
