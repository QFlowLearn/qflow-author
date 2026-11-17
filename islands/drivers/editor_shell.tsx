import { Fragment } from 'preact';
import {
  applyDraftListField,
  type DraftListKeyFor,
  type DraftListUpdaterFor,
} from './draft_list_field.ts';
import type { CommonContentProps, DriverEditorShell } from './types.ts';

export function commonContentProps(editor: DriverEditorShell): CommonContentProps {
  return {
    // eslint-disable-next-line react/jsx-no-useless-fragment -- The empty editor render slot requires a VNode.
    renderPromptField: editor.renderPromptField ?? (() => <Fragment />),
    fieldHasIssue: editor.fieldHasIssue ?? (() => false),
    fieldIssueText: editor.fieldIssueText ?? (() => undefined),
  };
}

export function appendInsertedHtml(existing: string | undefined, html: string): string {
  const current = existing ?? '';
  return `${current}${current.trim() ? ' ' : ''}${html}`;
}

export function insertBodyHtml(
  editor: DriverEditorShell,
  setBodyHtml: (value: string | ((prev: string) => string)) => void,
  html: string,
) {
  if (editor.bodyEditorApi?.current?.insertHtml) {
    editor.bodyEditorApi.current.insertHtml(html);
    return;
  }
  setBodyHtml((prev) => appendInsertedHtml(prev, html));
}

export function setDraftFieldValue<D extends object, K extends keyof D>(
  editor: DriverEditorShell<D>,
  draft: D,
  update: (next: D) => void,
  key: K,
  value: D[K] | ((prev: D[K]) => D[K]),
) {
  if (editor.setDraftField) {
    editor.setDraftField(key, value);
    return;
  }
  const prevValue = draft[key];
  const nextValue = typeof value === 'function'
    // SAFETY: Draft fields are data, not callable values; a function here is the updater variant.
    ? (value as (prev: D[K]) => D[K])(prevValue)
    : value;
  if (prevValue === nextValue) return;
  update({ ...draft, [key]: nextValue });
}

export function setDraftListFieldValue<
  D extends object,
  K extends DraftListKeyFor<D>,
>(
  editor: DriverEditorShell<D>,
  draft: D,
  update: (next: D) => void,
  key: K,
  value: DraftListUpdaterFor<D, K>,
): void {
  if (editor.setDraftListField) {
    editor.setDraftListField(key, value);
    return;
  }
  update(applyDraftListField(draft, key, value));
}
