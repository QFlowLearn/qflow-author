/** Link a bank scope to one correction form; selection IDs never imply all matching questions. */
export function enrichmentCorrectionHref(
  versionId: string,
  scope:
    | { readonly _tag: 'Filtered'; readonly queryString: string }
    | { readonly _tag: 'Selected'; readonly questionIds: readonly string[] },
): string {
  return `/items/organize/correct?${new URLSearchParams({
    version: versionId,
    scope: JSON.stringify(scope),
  })}`;
}
