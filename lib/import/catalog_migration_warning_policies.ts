import type { MigrationWarningPolicy } from './migration_warning_policy.ts';

function blockingCorrection(
  title: string,
  meaning: string,
  reviewAction: string,
): MigrationWarningPolicy {
  return {
    title,
    severity: 'correction',
    blocksAcceptance: true,
    meaning,
    reviewAction,
  };
}

/** Policies owned by QTI catalog and stylesheet validation. */
export const CATALOG_WARNING_POLICIES = {
  CATALOG_CARD_CONTENT_CONFLICT: blockingCorrection(
    'QTI catalog card content conflicts',
    'A catalog card uses both direct content and language entries.',
    'Keep one catalog content model, then validate the item again.',
  ),
  CATALOG_CARD_REQUIRED: blockingCorrection(
    'QTI catalog card missing',
    'A QTI catalog does not contain a support card.',
    'Add at least one support card or remove the empty catalog.',
  ),
  CATALOG_CONTENT_CHOICE: blockingCorrection(
    'QTI catalog content is ambiguous',
    'Catalog content combines HTML and file references where only one form is allowed.',
    'Keep the intended HTML or file content, then validate the item again.',
  ),
  CATALOG_CONTENT_REQUIRED: blockingCorrection(
    'QTI catalog content missing',
    'A catalog card or entry does not contain usable HTML or a file reference.',
    'Add the required support content before accepting the item.',
  ),
  CATALOG_DEFAULT_CONFLICT: blockingCorrection(
    'QTI catalog defaults conflict',
    'A catalog support card identifies more than one default entry.',
    'Choose one default entry for the support card.',
  ),
  CATALOG_FILE_REQUIRED: blockingCorrection(
    'QTI catalog file missing',
    'A catalog file entry does not include a file reference.',
    'Add the package-local file reference or remove the empty entry.',
  ),
  CATALOG_FILE_UNSAFE: blockingCorrection(
    'QTI catalog file reference unsafe',
    'A catalog file points outside the package or uses an unsafe reference.',
    'Replace it with a verified package-local file before accepting the item.',
  ),
  CATALOG_ID_DUPLICATE: blockingCorrection(
    'QTI catalog ID repeated',
    'More than one catalog uses the same QTI identifier.',
    'Give every catalog a unique QTI identifier.',
  ),
  CATALOG_ID_INVALID: blockingCorrection(
    'QTI catalog ID invalid',
    'A catalog ID does not satisfy QTI identifier rules.',
    'Replace the ID with a valid, unique QTI identifier.',
  ),
  CATALOG_REFERENCE_MISSING: blockingCorrection(
    'QTI catalog reference missing',
    'Item content references a catalog that is not defined.',
    'Restore the referenced catalog or remove the broken content reference.',
  ),
  CATALOG_SUPPORT_DUPLICATE: blockingCorrection(
    'QTI catalog support repeated',
    'A catalog contains more than one card for the same support.',
    'Combine the duplicate cards or assign each card a distinct support.',
  ),
  CATALOG_SUPPORT_INVALID: blockingCorrection(
    'QTI catalog support invalid',
    'A catalog card marks an unknown value as a predefined QTI support.',
    'Choose a defined QTI support or declare the value as custom.',
  ),
  CATALOG_SUPPORT_PATH_INVALID: blockingCorrection(
    'QTI catalog support path invalid',
    'A predefined QTI support is represented through the custom support path.',
    'Use the predefined support value before accepting the item.',
  ),
  CATALOG_SUPPORT_REQUIRED: blockingCorrection(
    'QTI catalog support missing',
    'A catalog card does not identify the support it provides.',
    'Set the card support before accepting the item.',
  ),
  KEYWORD_TRANSLATION_LANGUAGE_REQUIRED: blockingCorrection(
    'Keyword translation language missing',
    'A keyword translation entry does not identify its language.',
    'Set a language for every keyword translation.',
  ),
  LANGUAGE_TAG_INVALID: blockingCorrection(
    'QTI language tag invalid',
    'Catalog metadata contains a language tag that is not valid BCP 47.',
    'Replace it with a valid language tag.',
  ),
  STYLESHEET_HREF_REQUIRED: blockingCorrection(
    'QTI stylesheet reference missing',
    'An imported stylesheet does not include a file reference.',
    'Add a package-local stylesheet reference or remove the empty stylesheet.',
  ),
  STYLESHEET_REFERENCE_UNSAFE: blockingCorrection(
    'QTI stylesheet reference unsafe',
    'An imported stylesheet points outside the package or uses an unsafe reference.',
    'Replace it with a verified package-local stylesheet before accepting the item.',
  ),
  CATALOG_UNUSED: {
    title: 'QTI catalog is unused',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'The item defines a QTI catalog that no item content references.',
    reviewAction: 'Confirm the catalog is intentional or remove it.',
  },
} as const satisfies Readonly<Record<string, MigrationWarningPolicy>>;
