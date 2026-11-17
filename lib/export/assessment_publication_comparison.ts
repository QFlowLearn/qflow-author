import { parseQtiXml } from '@longsightgroup/qti3-core';
import { strFromU8, unzipSync } from 'fflate';
import type { AssessmentPublicationReview } from '../assessment_publication_review.ts';

/** Compare canonical XML in the verified published package with current export sources. */
export function comparePublishedAssessmentPackage(
  bytes: Uint8Array,
  current: { assessmentXml: string; itemsXml: Readonly<Record<string, string>> },
): AssessmentPublicationReview {
  const entries = unzipSync(bytes);
  if (!entries['assessment.xml']) return { status: 'unavailable' };
  const published: Record<string, string> = {};
  for (const [path, data] of Object.entries(entries)) {
    const match = /^items\/([^/]+)\.xml$/.exec(path);
    if (match) published[match[1]] = strFromU8(data);
  }
  const added: string[] = [], removed: string[] = [], edited: string[] = [];
  for (const [id, xml] of Object.entries(current.itemsXml)) {
    if (!(id in published)) added.push(questionTitle(xml));
    else if (published[id] !== xml) edited.push(questionTitle(xml));
  }
  for (const [id, xml] of Object.entries(published)) {
    if (!(id in current.itemsXml)) removed.push(questionTitle(xml));
  }
  return {
    status: 'changed',
    structureChanged: strFromU8(entries['assessment.xml']) !== current.assessmentXml,
    added,
    removed,
    edited,
  };
}
function questionTitle(xml: string): string {
  const parsed = parseQtiXml(xml);
  if (!parsed.ok || !parsed.document?.item.title) {
    throw new Error('Published question title could not be read.');
  }
  return parsed.document.item.title;
}
