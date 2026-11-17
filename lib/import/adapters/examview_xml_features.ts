import {
  childElements,
  findAllDescendantsByAnyLocalName,
  findChildrenByLocalName,
  localName,
  serializer,
} from '../xml_dom.ts';
import type { MigrationWarningCode } from '../migration_warning_catalog.ts';

const MEDIA_ELEMENT_NAMES = ['equation', 'graph', 'image', 'media', 'object', 'picture'];
const DYNAMIC_ELEMENT_NAMES = ['algorithm', 'condition', 'definition', 'variable'];
const REVIEW_ONLY_ITEM_ELEMENT_NAMES = [
  'answer-space',
  'difficulty',
  'keywords',
  'misc',
  'notes',
  'objective',
  'reference',
  'state-objective',
  'topic',
];
const HANDLED_ITEM_ELEMENT_NAMES = new Set([
  'answer',
  'choices',
  'info',
  'rationale',
  'text',
  ...MEDIA_ELEMENT_NAMES,
  ...DYNAMIC_ELEMENT_NAMES,
  ...REVIEW_ONLY_ITEM_ELEMENT_NAMES,
]);
const HANDLED_ROOT_ELEMENT_NAMES = new Set([
  'header',
  'matching-group',
  'narrative',
  'question',
]);
const REVIEW_ONLY_ROOT_ELEMENT_NAMES = new Set([
  'font-table',
  'instruction',
  'preferences',
  'test-footer',
  'test-header',
]);
const HANDLED_HEADER_ELEMENT_NAMES = new Set(['title', 'version']);
const SINGLETON_HEADER_ELEMENT_NAMES = ['title', 'version'];
const SINGLETON_ITEM_ELEMENT_NAMES = ['answer', 'choices', 'info', 'rationale', 'text'];

/** Exact source evidence retained while parsing an ExamView XML export. */
export type ExamViewFeatureEvidence = {
  readonly blockId: string;
  readonly quote: string;
};

/** One classified ExamView source feature that needs review or correction. */
export type ExamViewFeatureDiagnostic = {
  readonly code: Extract<MigrationWarningCode, `EXAMVIEW_${string}`>;
  readonly message: string;
};

/** Document-level features found before item parsing begins. */
export type ExamViewDocumentFeatures = {
  readonly diagnostics: readonly ExamViewFeatureDiagnostic[];
  readonly evidence: readonly ExamViewFeatureEvidence[];
  readonly unsupportedElementNames: readonly string[];
};

/** Item-level diagnostics and evidence that cannot be mapped directly. */
export type ExamViewItemFeatures = {
  readonly diagnostics: readonly ExamViewFeatureDiagnostic[];
  readonly evidenceLines: readonly string[];
};

/** One structural ambiguity that prevents deterministic ExamView XML parsing. */
export type ExamViewStructureIssue = {
  readonly message: string;
};

/**
 * Reject repeated semantic fields and text outside the published element structure.
 *
 * Parsing only begins after this refinement succeeds, so first-match helpers cannot silently
 * discard a second recognized field.
 */
export function inspectExamViewDocumentStructure(
  root: Element,
): readonly ExamViewStructureIssue[] {
  const issues: ExamViewStructureIssue[] = [];
  inspectContainer(root, 'ExamView document', ['header'], issues);

  for (const element of childElements(root)) {
    const elementName = localName(element);
    if (elementName === 'header') {
      inspectContainer(element, 'ExamView header', SINGLETON_HEADER_ELEMENT_NAMES, issues);
      continue;
    }
    if (elementName !== 'question' && elementName !== 'matching-group') continue;

    const sourceId = elementName === 'question'
      ? element.getAttribute('question-id')?.trim()
      : element.getAttribute('group-id')?.trim() || element.getAttribute('name')?.trim();
    const context = sourceId ? `ExamView ${elementName} ${sourceId}` : `ExamView ${elementName}`;
    inspectContainer(element, context, SINGLETON_ITEM_ELEMENT_NAMES, issues);

    for (const choices of findChildrenByLocalName(element, 'choices')) {
      inspectUnexpectedText(choices, `${context} <choices>`, issues);
      inspectDuplicateChoiceLabels(choices, context, issues);
    }
    for (const info of findChildrenByLocalName(element, 'info')) {
      inspectUnexpectedText(info, `${context} <info>`, issues);
    }
  }

  return issues;
}

/** Classify every direct document child as handled, review-only, or unsupported. */
export function inspectExamViewDocumentFeatures(root: Element): ExamViewDocumentFeatures {
  const rootChildren = childElements(root);
  const presentationElements = rootChildren.filter((element) =>
    REVIEW_ONLY_ROOT_ELEMENT_NAMES.has(localName(element))
  );
  const unsupportedElementNames = rootChildren
    .filter((element) => {
      const elementName = localName(element);
      return !HANDLED_ROOT_ELEMENT_NAMES.has(elementName) &&
        !REVIEW_ONLY_ROOT_ELEMENT_NAMES.has(elementName);
    })
    .map((element) => localName(element));
  const header = rootChildren.find((element) => localName(element) === 'header');
  if (header) {
    unsupportedElementNames.push(
      ...childElements(header)
        .filter((element) => !HANDLED_HEADER_ELEMENT_NAMES.has(localName(element)))
        .map((element) => `header/${localName(element)}`),
    );
  }

  const evidence = presentationElements.map((element, index) => ({
    blockId: `examview-document-${localName(element)}-${index + 1}`,
    quote: `ExamView document source:\n${serializeElement(element)}`,
  }));
  const headerVersion = header
    ? childElements(header).find((element) => localName(element) === 'version')
    : undefined;
  if (headerVersion) {
    evidence.push({
      blockId: 'examview-document-header-version',
      quote: `ExamView document source:\n${serializeElement(headerVersion)}`,
    });
  }

  return {
    diagnostics: presentationElements.length > 0 || headerVersion
      ? [{
        code: 'EXAMVIEW_DOCUMENT_PRESENTATION_NOT_MAPPED',
        message:
          'The ExamView file includes instructions or document presentation settings. QFlowLearn kept them in source evidence but did not add them to QTI items.',
      }]
      : [],
    evidence,
    unsupportedElementNames: [...new Set(unsupportedElementNames)],
  };
}

/** Classify recognized, review-only, and unsupported content within one item container. */
export function inspectExamViewItemFeatures(input: {
  readonly element: Element;
  readonly context: string;
  readonly hasFormatting: boolean;
  readonly hasRationale: boolean;
}): ExamViewItemFeatures {
  const diagnostics: ExamViewFeatureDiagnostic[] = [];
  const unknownElements = collectUnknownItemElements(input.element);

  if (input.hasFormatting) {
    diagnostics.push({
      code: 'EXAMVIEW_FORMATTING_FLATTENED',
      message: `${input.context} contains formatting that was flattened to visible text.`,
    });
  }
  if (hasNamedDescendant(input.element, MEDIA_ELEMENT_NAMES)) {
    diagnostics.push({
      code: 'EXAMVIEW_MEDIA_REQUIRES_REBUILD',
      message: `${input.context} references media without a verified asset binding.`,
    });
  }
  if (hasNamedDescendant(input.element, DYNAMIC_ELEMENT_NAMES)) {
    diagnostics.push({
      code: 'EXAMVIEW_DYNAMIC_CONTENT_UNSUPPORTED',
      message: `${input.context} contains dynamic content that XML 4 cannot preserve safely.`,
    });
  }
  if (input.hasRationale) {
    diagnostics.push({
      code: 'EXAMVIEW_RATIONALE_NOT_MAPPED',
      message:
        `${input.context} has a rationale preserved in source evidence but not mapped to QTI.`,
    });
  }
  if (hasNamedDescendant(input.element, REVIEW_ONLY_ITEM_ELEMENT_NAMES)) {
    diagnostics.push({
      code: 'EXAMVIEW_METADATA_NOT_MAPPED',
      message:
        `${input.context} has metadata or response-layout guidance preserved in source evidence but not mapped.`,
    });
  }
  if (unknownElements.length > 0) {
    const names = [...new Set(unknownElements.map((element) => localName(element)))];
    diagnostics.push({
      code: 'EXAMVIEW_UNRECOGNIZED_CONTENT',
      message: `${input.context} contains unrecognized ExamView XML: ${
        names.map((name) => `<${name}>`).join(', ')
      }. QFlowLearn did not infer its meaning.`,
    });
  }

  const reviewElements = findAllDescendantsByAnyLocalName(input.element, [
    ...REVIEW_ONLY_ITEM_ELEMENT_NAMES,
    ...MEDIA_ELEMENT_NAMES,
    ...DYNAMIC_ELEMENT_NAMES,
  ]);
  return {
    diagnostics,
    evidenceLines: [
      ...reviewElements.map(readableElementEvidence),
      ...unknownElements.map((element) =>
        `unrecognized ${localName(element)}: ${serializeElement(element)}`
      ),
    ],
  };
}

function collectUnknownItemElements(element: Element): Element[] {
  const unknown: Element[] = childElements(element).filter((child) =>
    !HANDLED_ITEM_ELEMENT_NAMES.has(localName(child))
  );
  for (const choices of findChildrenByLocalName(element, 'choices')) {
    unknown.push(
      ...childElements(choices).filter((choice) => !/^choice-[a-z]$/i.test(localName(choice))),
    );
  }
  for (const info of findChildrenByLocalName(element, 'info')) {
    unknown.push(
      ...childElements(info).filter((child) => {
        const elementName = localName(child);
        return !REVIEW_ONLY_ITEM_ELEMENT_NAMES.includes(elementName) &&
          !MEDIA_ELEMENT_NAMES.includes(elementName) &&
          !DYNAMIC_ELEMENT_NAMES.includes(elementName);
      }),
    );
  }
  return [...new Set(unknown)];
}

function hasNamedDescendant(element: Element, names: readonly string[]): boolean {
  return findAllDescendantsByAnyLocalName(element, [...names]).length > 0;
}

function readableElementEvidence(element: Element): string {
  const elementName = localName(element);
  const text = readCollapsedText(element);
  const attributes = readAttributes(element);
  const value = [attributes, text].filter(Boolean).join(' ');
  return value ? `${elementName}: ${value}` : `${elementName}: ${serializeElement(element)}`;
}

function readAttributes(element: Element): string {
  const attributes: string[] = [];
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);
    if (attribute) attributes.push(`${attribute.name}="${attribute.value}"`);
  }
  return attributes.join(' ');
}

function readCollapsedText(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function serializeElement(element: Element): string {
  return serializer.serializeToString(element);
}

function inspectContainer(
  element: Element,
  context: string,
  singletonNames: readonly string[],
  issues: ExamViewStructureIssue[],
): void {
  inspectUnexpectedText(element, context, issues);
  for (const elementName of singletonNames) {
    const count = findChildrenByLocalName(element, elementName).length;
    if (count > 1) {
      issues.push({
        message: `${context} must not repeat <${elementName}>; found ${count}.`,
      });
    }
  }
}

function inspectUnexpectedText(
  element: Element,
  context: string,
  issues: ExamViewStructureIssue[],
): void {
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes[index];
    if ((child.nodeType === 3 || child.nodeType === 4) && child.nodeValue?.trim()) {
      issues.push({
        message: `${context} contains text outside recognized field elements.`,
      });
      return;
    }
  }
}

function inspectDuplicateChoiceLabels(
  choices: Element,
  context: string,
  issues: ExamViewStructureIssue[],
): void {
  const counts = new Map<string, number>();
  for (const choice of childElements(choices)) {
    const match = /^choice-([a-z])$/i.exec(localName(choice));
    if (!match) continue;
    const label = match[1].toUpperCase();
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  for (const [label, count] of counts) {
    if (count > 1) {
      issues.push({
        message: `${context} must not repeat <choice-${label.toLowerCase()}>; found ${count}.`,
      });
    }
  }
}
