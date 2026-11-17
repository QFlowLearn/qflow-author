# Local development

QFlow runs locally in Cloudflare's workerd runtime. Node and pnpm run the tools. Both development
and built preview use the configured browser origin and the `qflow_local` database. Native
development uses https://127.0.0.1:5173; Codespaces uses its private forwarded HTTPS URL. Tests use
`qflow_test`; CI uses `qflow_ci_test`. Keep manual work out of test databases.

Vite also runs the private print compiler Worker through the configured `QFLOW_PRINT_RENDERER`
service binding. `pnpm build` writes the application to
`.cloudflare/output/v1/workers/default/bundle` and the compiler to
`.cloudflare/output/v1/workers/qflow-print-renderer/bundle`; built preview starts both. Build before
running Worker tests, which use the same compiler artifact under an explicit test-only service name.
During development, Vite evaluates modules in a request context. The print adapter supplies static
versions of Typst's five fixed startup callbacks there; production uses the pinned compiler
unchanged.

## Dev Containers and GitHub Codespaces

The repository implements the [Development Container specification](https://containers.dev/). Its
configuration lives in `.devcontainer/`. The workspace image pins Node 26.12.0 and pnpm 12.21.0 on
Debian Bookworm. Compose supplies PostgreSQL 17; the normal frozen install supplies the Cloudflare
CLI, workerd and Playwright. Container creation installs Chromium and its Linux dependencies,
prepares local configuration, migrates both databases and runs doctor.

### GitHub Codespaces

1. Create a codespace from this repository, using the committed Dev Container configuration.
2. Wait for the creation commands to finish. Run `pnpm dev` in its terminal.
3. Open the port 5173 preview from the Ports panel. Keep its visibility **Private**.
4. Sign up for a local QFlow account, then use onboarding for demo content.

Codespaces supplies `CODESPACE_NAME` and `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN`. Container setup
uses these to write the browser-facing `QFLOW_APP_ORIGIN`; it does not guess a domain or read HTTP
forwarding headers. HTTPS terminates at the Codespaces proxy. `QFLOW_DEV_ORIGIN` is the internal
`http://127.0.0.1:5173` listener, and the Ports panel uses the HTTP backend protocol. Cookies and
app links still use the configured HTTPS browser origin. No mkcert certificate is required in
Codespaces. Keep the app port private; do not forward PostgreSQL or workerd inspector ports.

### VS Code on your machine

Use **Dev Containers: Clone Repository in Container Volume** for a fresh checkout, or **Reopen in
Container** in a clean checkout. The same configuration runs locally with Docker. Existing native
`.env.local` files are deliberately rejected; use a fresh clone or move that file outside the
checkout before rebuilding. Host `node_modules` is hidden by a dedicated container volume so Linux
and macOS dependencies cannot overwrite each other.

Local Dev Containers use the normal `https://127.0.0.1:5173` browser origin. Setup creates and
trusts a CA **inside the container only**. Your browser on the host still needs to trust its public
root certificate. In the container, copy it with `cp "$(mkcert -CAROOT)/rootCA.pem"
.artifacts/local-dev/rootCA.pem`, then export that public file and trust it through your host's
certificate settings. Never export `rootCA-key.pem`. Forward port 5173 locally without changing its
number; use HTTPS when opening the forwarded address (set the port protocol to HTTPS in the Ports
panel if necessary). If your host already uses 5173, stop that app before starting this workspace.

### Docker build troubleshooting

During validation, Docker Compose 5.5.0 with Buildx 0.37.2 rejected the Dev Container CLI's
generated Dockerfile with an `additional privileges requested` / `fs.read` error. This is tracked in
[Docker Compose #14285](https://github.com/docker/compose/issues/14285). On an affected host, the
verified CLI workaround is:

```sh
BUILDX_BAKE_ENTITLEMENTS_FS=0 npm exec --yes --package=@devcontainers/cli@0.90.0 -- \
  devcontainer up --workspace-folder .
```

This disables Bake's filesystem entitlement check for that command only. Do not put it in your shell
profile or app configuration. VS Code also needs the variable in the editor process's environment
when building with affected Docker tooling. The container CI build scopes this same workaround to
its creation step. The Docker build context contains only `.devcontainer/`, not local application
secrets.

### Ownership and persistence

Compose shares the workspace's network with PostgreSQL, keeping the database on loopback and
preserving development/QA database checks. It publishes no database ports on the host. The container
uses its own PostgreSQL volume, independent of native development and `docker-compose.db.yml`. Named
volumes retain database data, pnpm packages, installed dependencies and the local container CA
across rebuilds. Do not remove database volumes to repair a failed migration.

The application starts only when you run `pnpm dev` or `pnpm preview`. Ctrl+C stops it. Closing the
Dev Container stops its Compose services; no host service or auto-restart job is installed. On a
normal workspace restart, run `pnpm dev` again. Rebuild the container after toolchain/config
changes; repeated creation preserves existing container secrets and data. If the forwarded workspace
domain changes, rerun `node --import tsx tools/setup_devcontainer.ts`, then restart the app.

Use `pnpm run doctor`, `pnpm test` and `pnpm verify` inside the container just as you would
natively. Doctor checks the declared proxy configuration; opening the private cloud preview verifies
the actual proxy and browser session. Cloud workspace compute/storage is billed by your provider.

## Native first setup

1. Install the versions in `.node-version` and `package.json`: Node 26.12.0 and pnpm 12.21.0.
2. Install PostgreSQL 17, mkcert and xmllint. Install Playwright's Chromium for browser checks:
   `pnpm exec playwright install chromium` after installing dependencies.
3. Trust your development CA once with `mkcert -install`. This changes your machine's certificate
   trust, so run it yourself. QFlow's setup only creates a leaf certificate using that CA.
4. Run `pnpm install --frozen-lockfile` and `cp .env.example .env.local`.
5. Start your chosen PostgreSQL instance. Edit `DATABASE_URL` in `.env.local` to use its loopback
   address, port and app role. Setup explicitly selects the `qflow_local` pathname on that instance.
6. Run `pnpm setup:local`, then `pnpm run doctor`, then `pnpm dev`.
7. Open https://127.0.0.1:5173 in a browser that trusts your CA. Create a local account, then use
   authenticated onboarding for demo data. Setup does not create shared login credentials.

### PostgreSQL

Use one PostgreSQL 17 instance. If you use the repository's Docker configuration, start it manually:

```sh
docker compose -f docker-compose.db.yml up -d
```

It exposes port 5433 and stores data in `.volumes/postgres17`. The sample connection matches it.
Stop it with `docker compose -f docker-compose.db.yml down`; do not remove the volume to fix setup.
An existing volume retains its existing databases even when Compose's initial database name changes.

An existing native PostgreSQL 17 instance also works. Point `.env.local` at it explicitly; there is
no automatic switch between native and Docker instances. Native QFlow setup does not install or
start services.

Setup creates missing databases only with the configured role's existing CREATEDB permission. If
that role lacks permission, a local database administrator should create the missing databases and
assign them to the configured app role. For an app role named `qflow`, run only the statements for
databases that do not exist:

```sql
CREATE DATABASE qflow_local OWNER qflow;
CREATE DATABASE qflow_test OWNER qflow;
```

Run `pnpm setup:local` again afterward. Existing databases and questions are preserved. A failed
schema migration needs investigation; setup never resets data or grants itself privileges.

## Tooling

Use the Node and pnpm versions pinned in `.node-version` and `package.json`. CI and the development
container use the same versions. Package-manager policy lives in `pnpm-workspace.yaml`, including
explicit dependency build permissions and reviewed release-age exceptions.

Vite uses its native Oxc and Rolldown configuration. Vitest uses the same JSX transform.
TypeScript's native compiler checks the Node, Worker, and Worker-test scopes; verification scripts
use its pinned native API to inspect source and emitted modules.

Tailwind and DaisyUI configuration lives in `static/tailwind.css`. The stylesheet declares source
directories and both application themes. `pnpm tw:build` generates `static/tw.css`; `pnpm dev` owns
the stylesheet watcher alongside Vite. Use `pnpm format`, `pnpm lint`, and `pnpm typecheck` before
full verification.

## Configuration ownership

- `.env.local` owns local connection settings, app variables, secrets and certificate paths.
- `cloudflare.config.ts` defines the public resource template, seven Workflows, three schedules, and
  the local development configuration. Vite supplies static assets from `static/` and the client
  build. Setup writes local values to the ignored `.env.local` file.
- Cloudflare's TypeScript configuration uses `cf` and version 2 of its Vite plugin. These packages
  are pinned to release candidates; Node 26.12.0 is required.
- Hosted production configuration is outside this repository. Setup only manages local
  configuration.
- `DATABASE_URL` is the only local database URL you configure. Development projects it to the
  Hyperdrive override at the Vite boundary. Tests select their guarded pathname explicitly.
- Do not add `.env` or `.dev.vars`. Competing local environment files make runtime ownership
  unclear; doctor reports them. Never commit secrets, private resource IDs or generated local
  configuration.

Exported shell variables take precedence over `.env.local`. If a setting still differs after you
edit the file, clear the conflicting shell export and restart the command.

Setup preserves existing secrets and supplied certificates. It generates missing secrets once;
repeat runs do not rotate encryption keys. For an expired or mismatched certificate, replace the
configured pair deliberately with mkcert, then rerun doctor. Setup never replaces half a pair.

Local R2 and Workflows use emulated bindings. AI and external LMS/delivery integrations require
explicit provider configuration and credentials; setup does not provision cloud resources or prove
those integrations work. Local email uses Cloudflare's local email binding rather than sending
production messages. Do not point local integration settings at production while experimenting.

## Daily use

`pnpm dev` owns Vite and the Tailwind watcher in the foreground. Ctrl+C closes both. The host and
port come from `QFLOW_DEV_ORIGIN`; an occupied port fails instead of moving the app.

To inspect the production build locally, stop dev, run `pnpm build`, then `pnpm preview`. Preview
uses the same browser origin, listener and development database. It starts the built Worker with
explicit local request provenance, so forwarded headers cannot masquerade as trusted Cloudflare
client metadata.

Run `pnpm run doctor` when setup fails. It checks tool versions, environment consistency,
certificate validity and its configured signing CA, both database schemas, xmllint and the installed
Chromium executable. Use `pnpm run doctor` explicitly: pnpm reserves bare `pnpm doctor` for its own
package-manager check. QFlow’s doctor does not change configuration, migrate data, start PostgreSQL
or install tools. Native/local-container browser certificate trust must still be established on your
machine.

## Verification

- `pnpm typecheck`, `pnpm lint` and `pnpm format:check` need no database.
- `pnpm test` runs ordinary suites on `qflow_test`.
- `pnpm test:e2e` builds and runs browser acceptance. `pnpm test:e2e:built` reuses a current build.
- `pnpm test:cloudflare` builds and checks Worker behavior.
- `pnpm verify` runs the full mandatory matrix, including accessibility and QTI schemas.

For daily feedback, select an ordinary filename or path substring:

```sh
pnpm test -- tests/local_development_test.ts
pnpm test -- local_development
pnpm test -- --watch local_development
```

Watch mode reruns the selected files when they or their dependencies change. Press `q` to quit, or
Ctrl+C to cancel. It inherits terminal input, so Vitest's interactive help and rerun controls work
normally. Run the command again to select newly added files. One-shot runs remain the default,
including CI. `pnpm test -- --help` lists supported options (`--watch` / `-w` and `--run`).

File filters stay within the selected lane. Build first, then focus browser suites with:

```sh
pnpm build
pnpm test:e2e:built -- tests/hono/runtime.test.ts
```

Every supplied filter must match a registered file; a typo or unsupported option fails before
connecting to the database. Test commands keep using the guarded QA database and isolated test
environment. Independent one-shot runs write separate JSON receipts under `output/ci/` so a focused
run cannot overwrite another run's verification results. Watch mode uses Vitest's interactive
results; `pnpm verify` still checks all required tests and permits only documented optional skips.

Automation that deliberately selects files from multiple lanes can use the existing explicit batch
command:

```sh
pnpm test:qa -- --database=qflow_test tests/hono/bank_api.test.ts
```

Tests may create, update and delete fixtures in the QA database. They never use the interactive app
database. Optional Harbor, populated-upgrade, ARC and enrichment-scale lanes are listed in
`tools/testing/optional.json`; their external prerequisites remain explicit.

Commands load connection and tool settings from `.env.local`. Before launching tests, runners remove
local application settings so missing-configuration tests and fixture bindings behave the same on
your machine and CI. CI supplies settings through the process environment and builds the production
mode of `cloudflare.config.ts`; it does not need local certificates or mkcert.

## Request diagnostics

Each dynamic request handled by Hono gets a server-generated UUID in the `x-request-id` response
header. Use that value to find its structured `http_request` event, or `http_request_error` when an
exception reached the HTTP error handler. The event records the registered route pattern, HTTP
method, final status and `durationMs`; exceptions use the existing safe error classification. Server
errors use the error log level. Incoming request IDs are ignored.

These diagnostic events omit raw URLs, path parameter values, queries, headers, cookies and bodies.
An unmatched route is `null`, and unrecognized HTTP methods are `OTHER`. No question content or
credentials enter these events. Timings end when the response is ready; they exclude streamed body
consumption and background Workflow execution. Static assets served directly by the platform bypass
this Hono middleware. This is HTTP request correlation, not cross-service tracing.
