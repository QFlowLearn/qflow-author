DELETE FROM sso_domain_routes WHERE provider = 'saml';

ALTER TABLE sso_domain_routes
  DROP CONSTRAINT IF EXISTS sso_domain_routes_provider_check;

ALTER TABLE sso_domain_routes
  ADD CONSTRAINT sso_domain_routes_provider_check
  CHECK (provider IN ('google', 'microsoft'));

DROP TABLE IF EXISTS saml_login_states;
DROP TABLE IF EXISTS saml_tenant_configs;
