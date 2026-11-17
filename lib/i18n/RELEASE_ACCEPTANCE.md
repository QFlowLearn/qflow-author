# i18n release acceptance

Use this checklist for every locale release and for promotion of Spanish or Swedish out of Beta.
Record failures with locale, route, message ID, browser, viewport, and severity. The
translation/release owner role triages feedback; assign that role explicitly for the release rather
than assuming a named individual.

## Catalog and source gates

- [ ] Exactly `en-US`, `en-GB`, `es-ES`, `es-419`, and `sv-SE` are present and selected by the
      locale resolver; no unsupported locale silently falls back.
- [ ] Every namespace and every typed player catalog is complete, valid JSON or TypeScript,
      ICU-safe, and free of unresolved IDs.
- [ ] `pnpm run check:i18n`, `pnpm run typecheck`, `pnpm run format:check`, and `pnpm run lint`
      pass.
- [ ] `message_context.json` covers new IDs and the manual literal-text drift scan has been
      reviewed. A green script is not proof of surface coverage.
- [ ] Source freeze is recorded. Any changed `en-US` key has translations, context, screenshots/flow
      coverage, and a new review.

## Product and language QA

- [ ] Test locale labels by their self-name (`English (United States)`, `English (United Kingdom)`,
      `Español (España)`, `Español
      (Latinoamérica)`, `Svenska`).
- [ ] Review terminology against `TRANSLATION_GUIDE.md`: compare `es-ES` and `es-419` regional
      choices and check `sv-SE` assessment terminology in context.
- [ ] Keep Spanish and Swedish marked as Beta until each locale meets the promotion requirements.
      For a Beta release, record pending independent language and sensitive-copy reviews with
      assigned owners. Known meaning, security, or accessibility errors block release.
- [ ] Exercise authoring, item bank, import/migration, preview, assessment export, delivery,
      settings, account, and help surfaces in each locale.
- [ ] Confirm authored QTI/item text, customer captions/metadata, stable IDs, action values,
      standards, and technical vocabulary remain unchanged.
- [ ] Exercise QTI/player flows with an item language different from the interface locale; verify
      player controls and feedback use the player catalog, not the authoring-shell catalog.

## Dates and time zones

- [ ] Check Spain and Sweden date formats with browser zones `Europe/Madrid`, `Europe/Stockholm`,
      and `America/New_York`. Changing the zone must not change the selected interface language.
- [ ] Check timestamps near midnight and both daylight-saving transitions. Their displayed date and
      time must reflect the browser's zone while their underlying instant stays unchanged.
- [ ] Verify that SSR and disabled-JavaScript views explicitly label UTC, hydration updates the
      timestamp without reloading, and returning to the tab picks up a changed browser zone.
- [ ] Check calendar dates remain the same calendar day in every zone, including leap days.
- [ ] If scheduling or scheduled-event emails are introduced, verify an explicit assessment zone,
      daylight-saving ambiguity handling, labelled local deadlines, and labelled assessment-zone
      times in emails.

## Layout and accessibility

- [ ] Verify representative flows at 320, 768, and 1440 CSS pixels and at 200% zoom. Include a
      fixture with 40% longer translations.
- [ ] Check no clipped buttons, truncated errors, broken tables, overflowed dialogs, or changed
      keyboard focus order.
- [ ] Complete keyboard-only and screen-reader checks for navigation, dialogs, validation,
      loading/status updates, destructive confirmations, and all translated accessible names.
- [ ] Run the browser suite (`pnpm run test:e2e`) and `pnpm run test:a11y:built`. Add a focused
      browser test when a new interactive surface is introduced.

## Delivery, email, and operations

- [ ] Test Canvas/hosted delivery preflight, publish, retry, failure, and receipt/download responses
      in all locales; stable API codes and headers remain locale-neutral.
- [ ] Render transactional welcome and password-reset emails in all locales, including retry/failure
      snapshots. Check subject, greeting, expiry, one-time-use wording, links, and plain-text
      accessibility.
- [ ] Check locale metrics are aggregate and privacy-preserving: record locale, route, and message
      ID where useful, but never item text, passwords, tokens, client secrets, or unnecessary
      personal data.
- [ ] For migrations and catalog cutover, verify deployment order, compatibility with existing
      locale settings, rollback to the previous complete catalog, and recovery from a failed
      translation deploy. Do not delete old catalogs until rollback is proven.

## Beta promotion

Complete these checks separately for `es-ES`, `es-419`, and `sv-SE` before removing that locale's
`Beta` marker.

- [ ] The designated translation/release owner has triaged every report for the locale into:
      blocking meaning/accessibility/security issue, correction before promotion, or accepted
      wording feedback.
- [ ] Each report links to locale, screen/path, message ID, reproduction, and proposed wording;
      sensitive reports use the private security/legal route.
- [ ] An independent language reviewer proficient in the locale has reviewed the interface and
      player catalogs in context. Record the reviewer, catalog revision, findings, and sign-off.
- [ ] Blocking issues and required corrections are fixed and rechecked in the affected locales. For
      Spanish, check both `es-ES` and `es-419`; document accepted regional differences.
- [ ] For Swedish, the language reviewer has checked assessment terminology against the guide,
      including `uppgift` versus `fråga`, import actions, delivery wording, and player instructions.
- [ ] Product owner, accessibility reviewer, and the appropriate legal/security reviewer have signed
      off the locale's sensitive inventory in the translation guide.
- [ ] All five catalogs are complete, and core browser flows, email snapshots, QTI/player
      separation, responsive checks, and rollback checks pass. Until all promotion checks pass for
      the locale, retain the `Beta` marker from `auth.json` (`locale.beta`).

## Required evidence

Attach the check output, locale/route matrix, responsive and 200% zoom notes, browser/accessibility
results, email snapshots, review sign-offs, and the feedback triage disposition to the release
record. For Beta releases, explicitly list pending independent language and sensitive-copy sign-offs
with their owners; pending reviews do not count as approval. Promotion requires completed sign-offs.
If the full DB-backed suite is run, record its environment and result; do not treat a run blocked by
missing `DATABASE_URL` as a passing release gate.
