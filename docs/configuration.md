# Configuration reference

- `DATABASE_URL`: Postgres connection string.
- `QFLOW_DEV_ORIGIN`: Development/preview listener origin on `127.0.0.1`, including an explicit
  port. Use HTTPS for direct browser access; use HTTP only behind a configured HTTPS workspace
  proxy. `QFLOW_APP_ORIGIN` owns the browser-facing HTTPS address. This setting is developer tooling
  configuration and does not change production routing.
- `QFLOW_DEV_TLS_CERT`, `QFLOW_DEV_TLS_KEY`, `NODE_EXTRA_CA_CERTS`: Certificate, key and signing CA
  paths for direct development HTTPS. Leave all three empty behind a cloud HTTPS proxy.
- `QFLOW_DEV_CONTAINER`: Container lifecycle marker. The Dev Container supplies `true`; native
  development does not set it. Container setup refuses to overwrite a native `.env.local`.
- `QFLOW_RUNNER_KEY`: Shared secret for package fetches by the delivery runtime.
- `QFLOW_DELIVERY_PUBLISH_URL`: Platform-level delivery publish endpoint, usually
  `https://deliver.example.test/internal/qflow/publish` in production.
- `QFLOW_DELIVERY_CAPABILITY_URL`: Platform-level delivery capability endpoint, usually
  `https://deliver.example.test/internal/qflow/capability` in production. QFlow uses this to hide
  delivery publishing until the workspace is linked to QFlowLearn Delivery.
- `QFLOW_DELIVERY_STATE_URL`: Platform-level delivery assignment state endpoint, usually
  `https://deliver.example.test/internal/qflow/state` in production. QFlow uses this to verify
  QFlowLearn Delivery assignment ownership before minting SSO launch tokens.
- `QFLOW_DELIVERY_SSO_LAUNCH_URL`: Platform-level delivery SSO launch endpoint, usually
  `https://deliver.example.test/api/qflow/sso/launch` in production.
- `QFLOW_DELIVERY_SIGNING_SECRET`: Shared HMAC secret used to sign publish requests to the delivery
  runtime.
- `QFLOW_CREDENTIAL_ENCRYPTION_KEY_V1`: Base64url-encoded 256-bit key used to encrypt tenant Canvas
  credentials, tenant OIDC client secrets, and pending password-reset tokens. Store it as a runtime
  secret.
- `QFLOW_ROOT_DOMAIN`: Root domain used for tenant resolution (e.g., `qflowlearn.com`).

### LMS integration boundary

QFlow owns assessment authoring, validation, revision history, export, and direct content imports.
Workspace admins add a tenant-owned Canvas developer key. Each author then connects their own Canvas
account through OAuth. The connector sends a preserved, validated package to a course or Classic
question bank through the Canvas Content Migrations API. See
[Configure direct Canvas publishing](canvas-direct-publishing.md).

QFlowLearn Delivery owns LMS-facing LTI registration, launches, Deep Linking, grade passback, and
roster access. QFlow connects to QFlowLearn Delivery through signed delivery and authoring handoff
flows. Direct package publishing does not replace QFlowLearn Delivery and does not expose LTI routes
or LMS registration settings.

- `QFLOW_PUBLIC_OIDC_TENANT_SLUG`: Optional tenant slug whose Google/Microsoft OIDC settings broker
  the root-domain social login flow.
- `QFLOW_APP_ORIGIN`: Canonical HTTPS origin used to build password-reset links, for example
  `https://author.example.test`. Production does not derive reset links from request host headers.
- `QFLOW_EMAIL_FROM`: Sender address for Cloudflare Email Service transactional mail, for example
  `QFlowLearn <hello@qflowlearn.com>`.
- `QFLOW_LOCAL_TRANSACTIONAL_EMAIL_DISABLED`: Set to `true` only for isolated local email adapter
  tests. The Worker requires its native email and rate-limit bindings in development and production.
- `QFLOW_SIGNUP_NOTIFY_BCC`: Optional BCC address for signup welcome emails. No copy is sent unless
  you explicitly configure this setting.
- `QFLOW_PASSWORD_RESET_ACCOUNT_RATE_LIMIT`: Cloudflare rate-limit binding for reset requests keyed
  by an opaque account identifier.
- `QFLOW_PASSWORD_RESET_ORIGIN_RATE_LIMIT`: Cloudflare rate-limit binding for reset requests keyed
  by an opaque request-origin identifier.
- `QFLOW_SECURE_COOKIES`: Set to `true` when HTTPS is terminated upstream of the app.
- `QFLOW_STORAGE_BACKEND`: Upload object storage backend. Use `r2-binding` with the `QFLOW_UPLOADS`
  binding for the Worker. Explicit storage adapter tests may select `s3-compatible`; it requires the
  R2 API variables below.
- `R2_ENDPOINT`: Cloudflare R2 S3 endpoint URL (for example
  `https://ACCOUNT_ID.r2.cloudflarestorage.com`). Required when `QFLOW_STORAGE_BACKEND` is
  `s3-compatible`.
- `R2_ACCESS_KEY_ID`: Access key ID for the R2 API token.
- `R2_SECRET_ACCESS_KEY`: Secret access key for the R2 API token.
- `R2_BUCKET`: Bucket used for upload object storage.
- `QFLOW_UPLOAD_BASE`: Optional public route prefix for upload URLs (defaults to `/uploads`).

Upload database rows own the authoritative object path. New objects use the filename-free key
`uploads/{tenantId}/{uploadId}`; callers must not reconstruct keys from filenames. The stored object
must exactly match the row's byte length and MIME type. A mismatch is logged as an operator-visible
integrity failure and returns HTTP 500.

OIDC provider setup:

- Google and Microsoft credential walkthrough: `docs/auth/google-microsoft-oidc.md`
