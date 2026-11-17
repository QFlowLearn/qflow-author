# Contributing to QFlow

Start with the [local development guide](docs/development.md). The application stack is Hono,
Preact, Vite and Cloudflare Workers; PostgreSQL and Drizzle own transactional persistence.

## Add a feature through the existing boundaries

Follow a nearby feature rather than creating another application framework or rendering path.

1. Put the HTTP adapter in the feature family under `lib/http/routes/`. Declare its URL and methods
   with `defineHttpRoute`, then register it in `lib/http/routes.ts`. Folder names do not define
   URLs. Keep parsing, authentication and HTTP responses at this boundary.
2. Call an operation in `lib/services/` for application behavior. Keep tenant-scoped persistence
   behind that service, using the existing Drizzle schema and immutable question revisions. Routes
   do not import the database or issue SQL.
3. Render a Preact page with `ctx.render(...)`. Keep shared views in `components/`, and use the
   controls from `components/ui/`. Authoring stays in the assessment builder.
4. For browser interaction, add an island under `islands/`, register its lazy import in
   `lib/client/root_registry.ts`, and mount it with `mountIsland({ component, View })` from
   `lib/rendering/mount_island.ts`. Pass plain JSON props. Do not add eager island imports or prop
   codecs to the bootstrap.
5. Add behavior tests using Vitest's `expect`. Use the real HTTP, persistence or browser seam
   appropriate to the change. Fixtures belong in the guarded QA database and clean up their data.

Concrete examples to read:

- Small endpoint: `lib/http/routes/bank_api/meta.ts`, which resolves auth and calls
  `getQuestionMeta` in `lib/services/questions.ts` before returning the HTTP response.
- Page and interaction: `lib/http/routes/assessment_pages/new.tsx`, which renders the intake page
  and mounts the registered `BringFilesIntake` island.
- HTTP tests: `tests/hono/bank_api.test.ts`, which exercises the built Worker using owned workspace
  and session fixtures.
- Browser tests: `tests/hono/bank_overview_browser.test.ts` and the ownership registry
  `tools/ci_browser_inventory.json`.

Test runners remove local application configuration before launching suites. Declare runtime
settings in the owning fixture; keep orchestration switches in `tools/testing/environment.ts`.

Add a browser suite to that browser ownership registry so CI runs it in the right lane. Ordinary
suites are discovered by filename (`*_test.ts(x)` or `*.test.ts(x)`); no per-test name inventory
exists.

## Focused feedback

Use `pnpm test -- <file-or-filter>` for ordinary tests, or `pnpm test -- --watch <filter>` while
editing. Browser tests use `pnpm test:e2e:built -- <file-or-filter>` after a current build. Every
filter must match the chosen lane; missing files and unsupported flags are errors. Database guards
apply in every mode.

For request failures, correlate the response's `x-request-id` with the structured HTTP log event.
Keep telemetry fields non-sensitive: use registered route patterns and `safeErrorSummary`, and never
add request bodies, raw URLs, query strings or credentials to diagnostic events.

## Before submitting

Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and the focused tests for your change. Run
`pnpm verify` for the complete mandatory matrix before release. Format edits with `pnpm format`. Use
the pinned Node/pnpm versions and frozen dependency installation; commit intentional lockfile
changes with dependency updates.

Keep platform bindings at the Worker composition boundary, required configuration explicit, and
errors free of secret values. Fix the configured path when it fails. Do not add alternate storage,
background execution, assertion shims or compatibility branches.

See [the architecture map](docs/architecture-map.md) for component ownership.

## License

Contributions are provided under AGPL-3.0-only. Preserve third-party notices and exclude production
data, credentials, and private operational material.
