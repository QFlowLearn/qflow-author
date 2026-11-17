# Published QTI migration support

QFlow pins the published QTI packages at version 0.13.4. This release includes the fixes previously
carried in local migrator, writer and core patches; those patches have been removed. Frozen installs
and production builds use the same unpatched published packages.

The migrator recognizes Sakai Content Packaging's `imsqti_xmlv1p1` resource label only when its
referenced XML contains a `questestinterop` document with questions. The resource is then selected
for QTI 1.x conversion. This does not assert that every question's content or scoring is supported;
normal item diagnostics and review restrictions still apply.

QTI 1.x questions also retain their own identifiers and titles when conversion fails. Metadata from
the surrounding assessment must not become every failed question's title or cause a review identity
mismatch after whitespace trimming.

Canvas multiple-choice and true/false questions use an explicit percentage-to-points conversion: the
supported source program awards SCORE=100, and valid `points_possible` metadata supplies the
canonical maximum. Missing/invalid points or unsupported programs remain blocked. Other QTI 1.x
scoring is not reinterpreted as Canvas percentage scoring. Regression:
`pnpm test -- canvas_scoring_import_test`.

Canvas essays and explicit Common Cartridge manual-essay profiles retain their prompt and human
grading. The writer supports an explicit `externalScored: 'human'` declaration, which QFlow retains
through persistence, preview and export. No automatic score is produced. Source essay points are
retained in scorer guidance, with an explicit notice to configure the manual point ceiling in
delivery; the essay editor does not model that ceiling as machine scoring. Unsupported scoring
actions are still blocked. Regression: `pnpm test -- canvas_essay_import_test`.

When upgrading the published packages, verify these behaviors with the existing regressions:
`pnpm test -- sakai_content_package_import_test qti_migrator_warnings_test qti_migrator_identity_test qti_migration_acceptance_test`.

Canvas native `.xml.qti` payloads are treated as assessment XML rather than binary assets. The
cartridge adapter follows the quiz's declared associated-content dependency, selects the richer
native rendition once, and retains per-question diagnostics and delivery-setting review notices. A
missing or invalid declared native file cannot switch silently to the reduced CC file. Regression:
`pnpm test -- canvas_cartridge_import_test imscc_import_test`.

Canvas media references are resolved against declared `webcontent` resources, including the
`web_resources` file-base namespace used by Classic and New Quizzes. Only referenced media is added
to the question resource. Ambiguous, escaping, undeclared or missing references stop that resource
with an explicit review notice. Original package bytes remain unchanged.

The published `@longsightgroup/qti3-core@0.13.4` package decodes package-content URL paths before
asset lookup, while retaining query/fragment suffixes in question XML and validating decoded paths.
This lets URI-escaped filenames resolve to their actual ZIP entries without accepting encoded
absolute paths or traversal. Regression: `pnpm test -- canvas_media_import_test`.

Resource review projects the authoritative per-item migration result, even when its blocked items
prevent creation of a launchable package. Each generated item is still structurally validated and
its media references checked against the bounded resource files. Item errors stay on their own
review records; unmatched resource diagnostics remain package findings. This retains usable siblings
without approving unsupported scoring or missing media.

Explicit Canvas `text_only_question` / `passage=true` items with zero points and no responses or
processing are projected as ordered standalone assessment content. The migrator carries normalized
`standaloneHtml` through finalization without creating an essay or response declaration. The host
converts it into validated literal text and packaged images, records formatting changes and any
omissions in the receipt, and excludes passages from question counts and organization membership.
Resource packaging is not the authority for these host-owned standalone placements. Regression:
`pnpm test -- canvas_passage_import_test`.

Canvas object-bank choice questions with blank or absent `points_possible` retain their prompt,
choices, answer key and explicitly authored 0–100 percentage program as a blocked review question.
The original 100-unit scale is retained rather than replacing missing points with an invented
one-point default. `CANVAS_BANK_POINTS_UNASSIGNED` prevents acceptance: assign points in the source
bank/assessment and import again. Missing quiz points, malformed point values, duplicate fields and
unsupported scoring still fail conversion. Regression:
`pnpm test -- canvas_bank_points_import_test`.
