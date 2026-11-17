import { importStandaloneHtml } from './standalone_html.ts';
import { organizationGroupsFromParts } from '../organization_groups.ts';
import { parseQuestionTags } from '../../question_tags.ts';
import { findChildByLocalName, findChildrenByLocalName } from '../xml_dom.ts';
import { categoryParts } from '../category_parts.ts';
import { normalizeQtiIdentifier } from '../../qti_identifiers.ts';
import { IMPORT_ADAPTER_DESCRIPTORS } from '../adapter_descriptors.ts';
import { buildImportedItem } from '../imported_item_qti.ts';
import { attr, childElements, findDescendantByLocalName, localName, parseXml } from '../xml_dom.ts';
import type {
  ImportAdapter,
  ImportedAsset,
  ImportedItem,
  ImportedPlacement,
  ImportResult,
  ImportSource,
  ImportWarning,
  SniffResult,
} from '../types.ts';
import {
  extractMoodleFiles,
  normalizeMoodleCategoryTag,
  readMoodleBodyHtml,
  readMoodleQuestionTitle,
  readMoodleRawText,
  readMoodleTextContent,
  uniqueMoodleIdentifier,
} from './moodle_xml_content.ts';
import { readMoodleFeedback } from './moodle_xml_feedback.ts';
import { applyMoodlePoints } from './moodle_xml_scoring.ts';
import { MOODLE_QUESTION_HANDLERS } from './moodle_xml_questions.ts';

export const moodleXmlAdapter: ImportAdapter = {
  ...IMPORT_ADAPTER_DESCRIPTORS.moodleXml,
  sniff: sniffMoodleXml,
  parse: parseMoodleXml,
};

function sniffMoodleXml(source: ImportSource): Promise<SniffResult> {
  const preview = new TextDecoder().decode(source.bytes.slice(0, 4096));
  if (/<quiz[\s>]/i.test(preview) && /<question[\s>]/i.test(preview)) {
    return Promise.resolve({ supported: true, confidence: 0.7, reason: 'moodle-quiz-root' });
  }
  return Promise.resolve({ supported: false, confidence: 0, reason: 'no-moodle-quiz' });
}

function parseMoodleXml(source: ImportSource): Promise<ImportResult> {
  const doc = parseXml(new TextDecoder().decode(source.bytes), 'moodle');
  const root = doc.documentElement;
  if (!root || localName(root) !== 'quiz') {
    throw new Error('Root element is not <quiz>');
  }

  const warnings: ImportWarning[] = [];
  const assets: ImportedAsset[] = [];
  const items: ImportedItem[] = [];
  const categorized: { category: string | null; placement: ImportedPlacement }[] = [];
  const seenIds = new Set<string>();
  let currentCategory: string | null = null;

  const questionElements = childElements(root).filter((element) =>
    localName(element) === 'question'
  );
  questionElements.forEach((questionElement, index) => {
    const type = (attr(questionElement, 'type') ?? '').toLowerCase();
    if (!type) return;

    if (type === 'category') {
      const categoryText = readMoodleTextContent(
        findDescendantByLocalName(questionElement, 'category'),
      );
      currentCategory = categoryText.trim() || null;
      return;
    }

    const title = readMoodleQuestionTitle(questionElement) || `Question ${index + 1}`;
    const identifier = uniqueMoodleIdentifier(
      normalizeQtiIdentifier(title, `ITEM_${index + 1}`),
      seenIds,
    );
    const itemWarnings: ImportWarning[] = [];
    const files = extractMoodleFiles(questionElement, identifier, itemWarnings);
    assets.push(...files.assets);

    const questionTextElement = findDescendantByLocalName(questionElement, 'questiontext');
    if (type === 'description') {
      const passage = importStandaloneHtml(
        readMoodleBodyHtml(questionTextElement, files.context),
        `${identifier}.xml`,
      );
      for (const content of passage.content) {
        categorized.push({ category: currentCategory, placement: { content } });
      }
      itemWarnings.push({
        code: 'LMS_CONTENT_REVIEW',
        message:
          `Description "${title}" is retained as ordered unscored text and images. Formatting is simplified. ${
            passage.omissions.join(' ')
          }`,
      });
      warnings.push(...itemWarnings.map((warning) => ({ ...warning, path: `${identifier}.xml` })));
      return;
    }
    const handler = MOODLE_QUESTION_HANDLERS[type];
    if (!handler) {
      itemWarnings.push({
        code: 'UNSUPPORTED_MOODLE_TYPE',
        message: `Unsupported Moodle question type: ${type}`,
        path: `${identifier}.xml`,
      });
    }

    const explicitTags = findChildrenByLocalName(
      findChildByLocalName(questionElement, 'tags'),
      'tag',
    ).map((tag) => findChildByLocalName(tag, 'text')?.textContent ?? '');
    const tags = parseQuestionTags([
      ...(currentCategory ? [normalizeMoodleCategoryTag(currentCategory)] : []),
      ...explicitTags,
    ]);
    const draft = handler
      ? handler(questionElement, {
        title,
        identifier,
        ...(tags.length ? { tags } : {}),
        bodyHtml: readMoodleBodyHtml(questionTextElement, files.context),
        assetMap: files.context,
      }, itemWarnings)
      : {
        type: 'extended_text' as const,
        externalScored: 'human' as const,
        title,
        bodyHtml: readMoodleBodyHtml(questionTextElement, files.context),
        tags,
      };
    applyMoodlePoints(draft, questionElement, itemWarnings);
    const feedback = readMoodleFeedback(draft.type, questionElement, files.context, itemWarnings);
    const { sourceEvidence } = feedback;
    warnings.push(...itemWarnings.map((warning) => ({ ...warning, path: `${identifier}.xml` })));

    const item = buildImportedItem({
      draft: {
        ...draft,
        ...(feedback.answerFeedback ? { answerFeedback: feedback.answerFeedback } : {}),
      },
      sourceFormat: 'moodle',
      ...(sourceEvidence.length ? { sourceEvidence } : {}),
      identifier,
      title,
      sourceText: readMoodleRawText(questionTextElement),
      href: `${identifier}.xml`,
    });
    items.push(item);
    categorized.push({ category: currentCategory, placement: { href: item.href } });
  });

  if (!items.length && !categorized.length) {
    throw new Error('No Moodle questions could be imported');
  }

  return categoryParts(categorized).then((parts) => ({
    title: 'Imported Moodle Quiz',
    parts,
    organizationGroups: organizationGroupsFromParts(parts),
    items,
    assets,
    warnings: warnings.length ? warnings : undefined,
  }));
}
