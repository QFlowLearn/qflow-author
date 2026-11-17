/** Canonical BCP 47 language of authored item content. */
export type ItemLanguage = string & { readonly __brand: 'ItemLanguage' };

export type ItemLanguageValidationCode = 'required' | 'invalid';
export type ItemLanguageCommitResult =
  | { readonly ok: true; readonly value: ItemLanguage }
  | { readonly ok: false; readonly code: ItemLanguageValidationCode };

/** Validate untrusted editor input without exposing parser exception prose to callers. */
export function validateItemLanguage(value: unknown): ItemLanguageCommitResult {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, code: 'required' };
  }
  try {
    return { ok: true, value: parseItemLanguage(value) };
  } catch (_error: unknown) {
    return { ok: false, code: 'invalid' };
  }
}

/** Explicit policy for newly authored content before an author chooses another language. */
export function newAuthoringItemLanguage(): ItemLanguage {
  return parseItemLanguage('en-US');
}

/** Closed source formats whose specifications do not carry an item language. */
export type UnlabeledImportSource =
  | 'aiken'
  | 'blackboard'
  | 'examview'
  | 'gift'
  | 'moodle'
  | 'respondus';

/** Explicit language policy for imports that have no source-language metadata. */
export function unlabeledImportItemLanguage(_source: UnlabeledImportSource): ItemLanguage {
  return newAuthoringItemLanguage();
}

/** Parse and canonicalize a required QTI item language at an external boundary. */
export function parseItemLanguage(value: unknown): ItemLanguage {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Item language must be a non-empty BCP 47 language tag.');
  }
  try {
    const locale = new Intl.Locale(value.trim());
    // SAFETY: Intl.Locale accepted the string and toString returns canonical BCP 47 syntax.
    return locale.toString() as ItemLanguage;
  } catch (cause: unknown) {
    throw new Error('Item language must be a valid BCP 47 language tag.', { cause });
  }
}
