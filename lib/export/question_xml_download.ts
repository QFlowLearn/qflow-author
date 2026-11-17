import {
  buildItemXmlFromPreparedDraft,
  prepareDriverDraft,
  type QtiBuildIssue,
} from '../qti_build.ts';
import type { Draft } from '../types/draft.ts';

/** Download preparation preserves the working draft and reports every omitted empty style row. */
export type QuestionXmlDownload =
  | { readonly ok: true; readonly xml: string; readonly omittedStylesheetCount: number }
  | { readonly ok: false; readonly issues: readonly QtiBuildIssue[] };

/** Build a useful XML derivative without unfinished optional stylesheets; saved XML stays strict. */
export function prepareQuestionXmlDownload(draft: Draft, identifier: string): QuestionXmlDownload {
  const stylesheets = draft.stylesheets?.filter((stylesheet) => stylesheet.href.trim().length > 0);
  const omittedStylesheetCount = (draft.stylesheets?.length ?? 0) - (stylesheets?.length ?? 0);
  const prepared = prepareDriverDraft({ ...draft, stylesheets });
  if (!prepared.ok) return { ok: false, issues: prepared.issues };
  const built = buildItemXmlFromPreparedDraft(prepared.prepared, { identifier });
  return built.ok
    ? { ok: true, xml: built.xml, omittedStylesheetCount }
    : { ok: false, issues: built.issues };
}
