# QFlow Author

QFlow Author is an open-source environment for creating, reviewing, importing, and exporting
assessments. It supports question banks, immutable question revisions, and QTI assessment packages.

Use Author independently or connect it to
[QFlow Deliver](https://github.com/QFlowLearn/qflow-deliver). The
[QTI library](https://github.com/LongsightGroup/qti3) provides the reusable standards
implementation.

## Run locally

Use Node 26.12.0 and pnpm 12.21.0. Install PostgreSQL 17, mkcert, and xmllint. For native HTTPS,
trust your mkcert CA once with `mkcert -install`.

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
# Configure DATABASE_URL for your local PostgreSQL instance.
pnpm setup:local
pnpm run doctor
pnpm dev
```

Open **https://127.0.0.1:5173**. Create a local account and use onboarding for demo content. Stop
the foreground server with Ctrl+C.

The app uses Cloudflare Workers locally through workerd. Local bindings are emulated; external
services require explicitly configured credentials. Setup prepares `qflow_local` and guarded
`qflow_test` databases without resetting existing data or changing privileges.

A [Dev Container](.devcontainer/devcontainer.json) is also available. See
[local development](docs/development.md) and the [configuration reference](docs/configuration.md).

## Architecture

Hono handles HTTP routes; Preact renders pages and hydrates interactive islands. PostgreSQL and
Drizzle store assessment data. R2 stores media; Workflows coordinate durable jobs. The shared QTI
packages handle assessment standards; learner delivery belongs to a separate application.

Cloudflare runtime entrypoints under `deploy/cloudflare/` are application code. This repository
includes generic configuration and isolated test/local settings, without production account settings
or deployment automation.

## Development

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

Tests use the guarded local database. Install browser support with `pnpm exec playwright install
chromium`. Run `pnpm verify` for the full matrix.

Oxlint checks JavaScript and TypeScript; dprint formats source files. Python is optional and
confined to the [Respondus fixture generator](tools/respondus-fixtures/).

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately through the repository’s
**Security → Report a vulnerability** form.

## License

Licensed under the **GNU Affero General Public License v3 (AGPL v3)**. See [LICENSE](LICENSE).
Third-party components retain their own license notices.
