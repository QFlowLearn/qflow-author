# Architecture map

HTTP adapters live under `lib/http/routes/`; `lib/http/routes.ts` registers their URLs and methods.
Hono owns dispatch and authentication boundaries.

Preact pages live in `components/`; browser interactions live in `islands/`. The client root
registry declares lazy hydration entrypoints. Reuse controls from `components/ui/`.

Application operations live under `lib/services/`. PostgreSQL and Drizzle own persistence; immutable
revisions preserve question content. QTI type drivers serialize drafts through the shared QTI
packages.

Cloudflare runtime composition lives under `deploy/cloudflare/`. Workflows coordinate jobs; R2
stores assets. Local and test bindings are explicitly configured.

Authoring, rendering and scoring, and learner delivery remain separate responsibilities. See
[CONTRIBUTING.md](../CONTRIBUTING.md) for extension conventions.
