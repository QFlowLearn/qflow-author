# QFlowLearn translation guide

This guide is the operating contract for the five interface locales shipped by QFlowLearn. The
catalogs live in `lib/i18n/messages/{locale}/*.json`; player strings are the typed catalogs in
`lib/i18n/player_messages/`. `en-US` is the canonical source. Every release must ship complete
catalogs for `en-US`, `en-GB`, `es-ES`, `es-419`, and `sv-SE`.

## Release and review status

All locales must pass the catalog, functional, layout, and accessibility checks in
`RELEASE_ACCEPTANCE.md`. Beta locales may ship while independent language and sensitive-copy
sign-offs are pending, provided the release record identifies the outstanding reviews and their
owners. Keep the `Beta` marker visible until those reviews are complete. Known errors that change
meaning, security guidance, or accessibility must be fixed before release, including Beta releases.

Promotion out of Beta requires an independent language review and the relevant product,
accessibility, legal, and security sign-offs for the sensitive inventory below. Record evidence for
each locale separately; approval of one locale does not approve another. After promotion, changed
translations require those reviews before release wherever applicable.

## Terminology

Use the following terms consistently in interface copy. These are product concepts, not a reason to
translate authored assessment content.

| Concept       | en-US         | en-GB         | es-ES              | es-419             |
| ------------- | ------------- | ------------- | ------------------ | ------------------ |
| assessment    | assessment    | assessment    | evaluación         | evaluación         |
| item          | item          | item          | ítem               | ítem               |
| question      | question      | question      | pregunta           | pregunta           |
| question bank | question bank | question bank | banco de preguntas | banco de preguntas |
| workspace     | workspace     | workspace     | espacio de trabajo | espacio de trabajo |
| publish       | publish       | publish       | publicar           | publicar           |
| delivery      | delivery      | delivery      | entrega            | entrega            |
| attempt       | attempt       | attempt       | intento            | intento            |
| import        | import        | import        | importación        | importación        |
| export        | export        | export        | exportación        | exportación        |

`en-GB` follows UK spelling where it is visible (for example, “organise” and “authorisation”);
product nouns remain the same. `es-ES` uses Spain vocabulary and second-person forms appropriate to
Spain. `es-419` uses neutral Latin American vocabulary and avoids region-specific idioms. The locale
labels in `auth.json` (`locale.us`, `locale.gb`, `locale.es`, `locale.latam`, `locale.sv`) are
self-names and must remain understandable in every locale.

Keep QTI, QTI 3.0, Question and Test Interoperability, Canvas, OIDC, Google, Microsoft Entra, MIME
types, URLs, IDs, XML element/attribute names, action values, and stable API error codes technical
or brand vocabulary. Do not localise authored titles, item text, captions, source-file names,
standards, tags, or customer-provided metadata.

## Swedish terminology

`sv-SE` uses Swedish as written in Sweden and the self-name “Svenska”. It ships as Beta, like the
Spanish catalogs, pending independent language and sensitive-copy review.

| Concept       | sv-SE                   |
| ------------- | ----------------------- |
| assessment    | prov                    |
| item          | uppgift                 |
| question      | fråga                   |
| question bank | frågebank               |
| workspace     | arbetsyta               |
| publish       | publicera               |
| delivery      | genomförande            |
| attempt       | försök                  |
| import        | import                  |
| export        | export                  |
| collection    | samling                 |
| edition       | utgåva                  |
| revision      | version                 |
| commit        | importera               |
| portability   | flyttbarhet             |
| lossy         | med informationsförlust |

Use direct, neutral Swedish with “du”. Preserve technical names, ICU branches and variables, URLs,
and customer-authored content. Swedish browser tags, including `sv` and `sv-FI`, select this one
supported Swedish catalog. Account preferences still take precedence.

Keep `genomförande` for delivery as a concept. Do not use it as a countable noun, and do not use
`genomföra` for committing an import — that action is `importera`. The hosted product name stays
`QFlowLearn Delivery`. Match and associate entries are `alternativ` or `begrepp`, not `uppgift`. AI
organization schemes are `ämnesstruktur`. QTI shared vocabulary in the right rail is
`visningsinställningar`. For accessibility, prefer `tillgänglighet` over the ambiguous
`tillgänglig`.

## Translator rules

- Use semantic message IDs (`delivery.canvas.publish`, not a screen position or English sentence).
  Put interface copy in the appropriate namespace and keep the same key in all five locale catalogs.
- Preserve every ICU variable name, select/plural branch, and number/date meaning. A translator may
  reorder a sentence but must not rename or remove a placeholder. `tools/check_i18n.ts` validates
  catalog parity and ICU shape.
- The interface locale is independent from item language and caption language. A player or authored
  item may be Spanish while the authoring shell is in English. Never infer an item translation from
  the shell locale.
- There is no silent locale fallback. Resolve exactly one supported locale and fail clearly during
  development if a catalog key is missing. Do not copy a source string into a peer catalog to hide
  missing translation work.
- Translate labels, help, empty states, validation, errors, loading states, status text, and
  accessible names. Check the spoken result, not only the visual layout.
- Allow at least 30–40% expansion in controls, dialogs, tables, email subjects, and narrow
  responsive layouts. Avoid concatenating translated fragments.
- Freeze `en-US` keys before translation. A source change requires a new review of all five
  catalogs: record the key and rationale, update translations, rerun checks, and do not promote a
  locale with stale or missing keys.

## Dates and time zones

The selected interface locale controls date order, month names, and clock formatting. It does not
select a time zone: a Swedish interface can be used anywhere in the world.

- Render activity timestamps with `islands/LocalizedTimestamp.tsx`. It uses the browser's IANA zone
  after hydration and checks it again when the tab regains focus or visibility. There is no account
  preference or time-zone cookie. Server rendering and the first hydration render show explicitly
  labelled UTC; the browser then updates the label without reloading the page. With JavaScript
  disabled, the UTC label remains visible.
- Keep the zone visible and preserve the original instant in the `<time datetime>` attribute. Use
  `i18n.rich` when embedding a timestamp component in a translated sentence, so each language
  retains its own word order. Do not concatenate translated sentence fragments.
- Calendar dates are ISO `YYYY-MM-DD` values, not instants. Use `formatCalendarDate` from `dates.ts`
  to validate and format them without a time-zone conversion.
- The low-level `i18n.formatDate`, `formatTime`, and ICU date/time formats default explicitly to
  UTC. Use them for non-browser output only when UTC is intended and labelled, or supply an explicit
  zone. Browser activity displays use the timestamp component.

QFlow currently has no assessment scheduling fields or scheduled-event emails. When adding them,
require an explicit assessment IANA zone, preserve it with the scheduled instant, and reject
ambiguous or nonexistent local times unless the author resolves them. Show deadlines in the viewer's
zone with the assessment's original zone available. Scheduled-event emails must use and label the
assessment's zone; never infer it from interface language or a recipient's last browser session.

## Sensitive review inventory

These existing message IDs require a second-pass review by the relevant legal, security,
accessibility, or product owner before promotion. The review is a content decision; translators must
not invent legal language or security claims.

| Area                          | Message IDs                                                                                                                                                             | Surface/path                                                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Password and account security | `email.reset.expiry`, `email.reset.ignore`, `login.error.stateExpired`, `settings.password.requirements`                                                                | `lib/i18n/messages/*/{email,auth,settings}.json`; sign-in, reset, and transactional email flows                                              |
| Sessions and audit            | `settings.sessions.revoke`, `settings.sessions.revokeAll`, `settings.audit.title`, `settings.audit.subtitle`                                                            | `routes/settings/sessions.tsx`, `routes/settings/audit.tsx`                                                                                  |
| Secret handling and identity  | `settings.canvas.addSiteHelp`, `settings.canvas.replaceKeyHelp`, `settings.sso.oidc.secretStored`, `settings.sso.oidc.secretKeep`, `settings.sso.oidc.microsoft.secret` | `routes/settings/canvas.tsx`, `routes/settings/sso.tsx`                                                                                      |
| Workspace membership          | `settings.members.remove`, `settings.members.error.lastOwner`, `settings.members.error.selfRemove`                                                                      | `routes/settings/members.tsx`                                                                                                                |
| Publishing and delivery       | `delivery.canvas.publish`, `delivery.canvas.published`, `delivery.package.blocked`, `delivery.package.warningsNotAcknowledged`                                          | `routes/api/assessments/[id]/publish/{canvas,delivery}.ts`, `islands/assessment_builder/{CanvasDirectPublish,AssessmentExportPreflight}.tsx` |
| Import and source fidelity    | `imports.intake.confidenceConfirm`, `settings.migrations.sourcePreserved`, `settings.migrations.failureDetail`                                                          | `routes/imports/*`, `routes/settings/migrations.tsx`                                                                                         |
| QTI/player behavior           | `player_messages` typed interaction, navigation, validation, and result strings                                                                                         | `lib/i18n/player_messages/*.ts`, QTI item/player routes                                                                                      |

Before approving any of these, verify that the translated wording does not change permission scope,
expiry, destructive-action consequence, warning severity, data-retention meaning, or the distinction
between authored and interface content.

## Inventory and drift

The checked-in inventory is `lib/i18n/message_context.json`. It records each semantic ID's screen
and meaning and is reviewed alongside source changes. To inspect usage and find candidates for
inventory updates, run from the repo root:

```sh
rg -n "i18n\.(t|rich)\(|useI18n\(|createI18n\(" routes islands components lib
rg -n "[A-Za-z][A-Za-z ]{2,}" routes islands components --glob '*.{tsx,ts}'
pnpm run check:i18n
```

The first scan finds message consumers; the second is a drift scan for visible literal text and must
be reviewed manually because it also finds authored, technical, and test data. `check:i18n` proves
catalog structure, parity, and placeholder safety; it does not prove that every visible surface is
translated. Update `message_context.json` when adding a key or surface, then run the release
checklist in `RELEASE_ACCEPTANCE.md`.
