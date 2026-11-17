import type { Draft } from './types/draft.ts';
import type { QuestionTypeId } from './types/registry.ts';
import {
  buildItemXmlFromPreparedDraft,
  prepareDriverDraft,
  type QtiBuildIssue,
} from './qti_build.ts';

export type QtiPreviewIssue = QtiBuildIssue;

export type QtiPreviewXmlResult =
  | {
    ok: true;
    xml: string;
    typeId: QuestionTypeId;
    title: string;
  }
  | {
    ok: false;
    typeId?: QuestionTypeId;
    title?: string;
    issues: QtiPreviewIssue[];
  };

export type QtiPreviewXmlOptions = {
  identifier?: string;
};

export function buildQtiPreviewXml(
  rawDraft: Draft,
  options: QtiPreviewXmlOptions = {},
): QtiPreviewXmlResult {
  const prepared = prepareDriverDraft(rawDraft);
  if (!prepared.ok) {
    return {
      ok: false,
      typeId: prepared.typeId,
      title: prepared.title,
      issues: prepared.issues,
    };
  }

  const built = buildItemXmlFromPreparedDraft(prepared.prepared, {
    identifier: options.identifier ?? `preview-${prepared.prepared.typeId}`,
  });
  if (!built.ok) {
    return {
      ok: false,
      typeId: built.typeId,
      title: built.title,
      issues: built.issues,
    };
  }

  return {
    ok: true,
    typeId: built.typeId,
    title: built.title,
    xml: built.xml,
  };
}
