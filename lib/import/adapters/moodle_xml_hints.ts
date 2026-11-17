import type { ImportedSourceEvidence, ImportWarning } from '../types.ts';
import {
  attr,
  childElements,
  findChildrenByLocalName,
  findDescendantByLocalName,
  localName,
} from '../xml_dom.ts';
import { type MoodleAssetContext, readMoodleBodyHtml } from './moodle_xml_content.ts';

/** Retain hint content and settings without inventing a hint-release or retry policy. */
export function readMoodleHints(
  question: Element,
  context: MoodleAssetContext,
  warnings: ImportWarning[],
): ImportedSourceEvidence[] {
  return findChildrenByLocalName(question, 'hint').map((hint, index) => {
    const raw = findDescendantByLocalName(hint, 'text')?.textContent?.trim() ?? '';
    const resolved = readMoodleBodyHtml(hint, context);
    const settings = childElements(hint).filter((child) =>
      !['text', 'file'].includes(localName(child))
    )
      .map((child) => `${localName(child)}=${child.textContent?.trim() || 'true'}`);
    warnings.push({
      code: 'LMS_CONTENT_REVIEW',
      message:
        'Source hints and their retry/clear-answer settings are retained in review evidence. Configure hint release and supported retry behavior before delivery.',
    });
    return {
      kind: 'block',
      blockId: `hint-${index + 1}`,
      quote: `Hint (${attr(hint, 'format') ?? 'html'}): ${raw}\nSettings: ${
        settings.join(', ') || 'none'
      }\nResolved content: ${resolved}`,
    };
  });
}
