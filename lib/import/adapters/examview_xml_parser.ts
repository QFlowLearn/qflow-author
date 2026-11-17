import {
  attr,
  childElements,
  findChildByLocalName,
  findChildrenByLocalName,
  localName,
  parseXmlStrict,
} from '../xml_dom.ts';
import {
  type ExamViewFeatureDiagnostic,
  type ExamViewFeatureEvidence,
  inspectExamViewDocumentFeatures,
  inspectExamViewDocumentStructure,
  inspectExamViewItemFeatures,
} from './examview_xml_features.ts';

const SUPPORTED_APP_VERSION = /^4\./;

/** Exact source evidence retained while parsing an ExamView XML export. */
export type ExamViewEvidenceRef = ExamViewFeatureEvidence;

/** One answer choice recovered from ExamView XML. */
export type ExamViewParsedChoice = {
  readonly key: string;
  readonly text: string;
};

/** Supported and explicitly unsupported ExamView XML question kinds. */
export type ExamViewQuestionKind =
  | 'choice'
  | 'completion'
  | 'matching_member'
  | 'numeric'
  | 'open_response'
  | 'short_answer'
  | 'true_false'
  | 'unknown'
  | 'yes_no';

/** A source feature that could not be mapped without loss or guessing. */
export type ExamViewParsedDiagnostic = ExamViewFeatureDiagnostic;

/** One question recovered from an ExamView XML export. */
export type ExamViewParsedQuestion = {
  readonly sequence: number;
  readonly sourceId: string;
  readonly typeCode: string;
  readonly kind: ExamViewQuestionKind;
  readonly prompt: string;
  readonly answerLines: readonly string[];
  readonly choices: readonly ExamViewParsedChoice[];
  readonly groupName: string | null;
  readonly diagnostics: readonly ExamViewParsedDiagnostic[];
  readonly evidence: ExamViewEvidenceRef;
};

/** A matching group and its member questions. */
export type ExamViewParsedMatchingGroup = {
  readonly sequence: number;
  readonly sourceId: string;
  readonly name: string;
  readonly prompt: string;
  readonly choices: readonly ExamViewParsedChoice[];
  readonly members: readonly ExamViewParsedQuestion[];
  readonly diagnostics: readonly ExamViewParsedDiagnostic[];
  readonly evidence: ExamViewEvidenceRef;
};

/** One item-producing entry in source order. */
export type ExamViewParsedEntry =
  | { readonly _tag: 'question'; readonly question: ExamViewParsedQuestion }
  | { readonly _tag: 'matching_group'; readonly group: ExamViewParsedMatchingGroup };

/** Fully parsed ExamView XML 4 document. */
export type ParsedExamViewDocument = {
  readonly title: string | null;
  readonly appVersion: string;
  readonly entries: readonly ExamViewParsedEntry[];
  readonly diagnostics: readonly ExamViewParsedDiagnostic[];
  readonly documentEvidence: readonly ExamViewEvidenceRef[];
};

/** File-level failure that prevents a deterministic ExamView XML import. */
export type ExamViewDocumentIssue = {
  readonly code:
    | 'EXAMVIEW_DUPLICATE_MATCH_GROUP'
    | 'EXAMVIEW_MATCH_GROUP_NAME_MISSING'
    | 'EXAMVIEW_NARRATIVE_UNSUPPORTED'
    | 'EXAMVIEW_NO_QUESTIONS'
    | 'EXAMVIEW_ROOT_INVALID'
    | 'EXAMVIEW_ROOT_ELEMENT_UNSUPPORTED'
    | 'EXAMVIEW_STRUCTURE_INVALID'
    | 'EXAMVIEW_XML_INVALID'
    | 'EXAMVIEW_VERSION_UNSUPPORTED';
  readonly message: string;
};

/** Typed result from the ExamView XML 4 parser. */
export type ExamViewParseResult =
  | { readonly _tag: 'parsed'; readonly value: ParsedExamViewDocument }
  | { readonly _tag: 'invalid'; readonly issues: readonly ExamViewDocumentIssue[] };

/** Header classification shared by sniffing and parsing. */
export type ExamViewXmlClassification =
  | {
    readonly _tag: 'supported';
    readonly root: Element;
    readonly appVersion: string;
  }
  | { readonly _tag: 'invalid_xml' }
  | { readonly _tag: 'not_examview' }
  | { readonly _tag: 'unsupported_version'; readonly appVersion: string };

/** Classify the actual XML root and version; comments and embedded strings do not count. */
export function classifyExamViewXml(xml: string): ExamViewXmlClassification {
  let document: Document;
  try {
    document = parseXmlStrict(xml, 'ExamView XML');
  } catch (_cause: unknown) {
    return { _tag: 'invalid_xml' };
  }
  const root = document.documentElement;
  if (!root || localName(root) !== 'examview') return { _tag: 'not_examview' };

  const appVersion = attr(root, 'app-version')?.trim() ?? '';
  if (!SUPPORTED_APP_VERSION.test(appVersion)) {
    return { _tag: 'unsupported_version', appVersion };
  }
  return { _tag: 'supported', root, appVersion };
}

/** Parse the published ExamView XML 4 interchange format without semantic guessing. */
export function parseExamViewXml(xml: string): ExamViewParseResult {
  const classification = classifyExamViewXml(xml);
  if (classification._tag === 'invalid_xml') {
    return invalid('EXAMVIEW_XML_INVALID', 'ExamView XML must be well-formed XML.');
  }
  if (classification._tag === 'not_examview') {
    return invalid('EXAMVIEW_ROOT_INVALID', 'The XML root must be <examview>.');
  }
  if (classification._tag === 'unsupported_version') {
    return invalid(
      'EXAMVIEW_VERSION_UNSUPPORTED',
      `ExamView XML app-version "${
        classification.appVersion || 'missing'
      }" is not supported. QFlowLearn supports the published 4.x XML format.`,
    );
  }
  const { appVersion, root } = classification;
  const documentFeatures = inspectExamViewDocumentFeatures(root);
  if (documentFeatures.unsupportedElementNames.length > 0) {
    return invalid(
      'EXAMVIEW_ROOT_ELEMENT_UNSUPPORTED',
      `ExamView XML contains unsupported document content: ${
        documentFeatures.unsupportedElementNames.map((name) => `<${name}>`).join(', ')
      }. QFlowLearn did not infer its meaning.`,
    );
  }

  if (findChildrenByLocalName(root, 'narrative').length > 0) {
    return invalid(
      'EXAMVIEW_NARRATIVE_UNSUPPORTED',
      'ExamView XML narratives are not imported because their item associations cannot be verified from the published 4.x grammar.',
    );
  }

  const structureIssues = inspectExamViewDocumentStructure(root);
  if (structureIssues.length > 0) {
    return {
      _tag: 'invalid',
      issues: structureIssues.map((issue) => ({
        code: 'EXAMVIEW_STRUCTURE_INVALID',
        message: issue.message,
      })),
    };
  }

  const rootChildren = childElements(root);
  const questions = rootChildren
    .filter((element) => localName(element) === 'question')
    .map((element, index) => parseQuestion(element, index + 1));
  const membersByGroup = groupMatchingMembers(questions);
  const declaredGroupNames = new Set(
    rootChildren
      .filter((element) => localName(element) === 'matching-group')
      .map((element) => attr(element, 'name')?.trim() ?? '')
      .filter(Boolean),
  );
  const issues: ExamViewDocumentIssue[] = [];
  const seenGroupNames = new Set<string>();
  const entries: ExamViewParsedEntry[] = [];
  let questionIndex = 0;

  for (let sourceIndex = 0; sourceIndex < rootChildren.length; sourceIndex += 1) {
    const element = rootChildren[sourceIndex];
    const elementName = localName(element);
    if (elementName === 'question') {
      const question = questions[questionIndex];
      questionIndex += 1;
      if (question?.kind !== 'matching_member') {
        if (question) entries.push({ _tag: 'question', question });
        continue;
      }
      if (!question.groupName || !declaredGroupNames.has(question.groupName)) {
        if (question) entries.push({ _tag: 'question', question });
      }
      continue;
    }
    if (elementName !== 'matching-group') continue;

    const name = attr(element, 'name')?.trim() ?? '';
    if (!name) {
      issues.push({
        code: 'EXAMVIEW_MATCH_GROUP_NAME_MISSING',
        message: 'Every <matching-group> must have a non-empty name.',
      });
      continue;
    }
    if (seenGroupNames.has(name)) {
      issues.push({
        code: 'EXAMVIEW_DUPLICATE_MATCH_GROUP',
        message: `ExamView matching group "${name}" appears more than once.`,
      });
      continue;
    }
    seenGroupNames.add(name);
    entries.push({
      _tag: 'matching_group',
      group: parseMatchingGroup(element, sourceIndex + 1, membersByGroup.get(name) ?? []),
    });
  }

  if (issues.length > 0) return { _tag: 'invalid', issues };
  if (entries.length === 0) {
    return invalid(
      'EXAMVIEW_NO_QUESTIONS',
      'The ExamView XML document does not contain any importable question entries.',
    );
  }

  return {
    _tag: 'parsed',
    value: {
      title: readHeaderTitle(root),
      appVersion,
      entries,
      diagnostics: documentFeatures.diagnostics,
      documentEvidence: documentFeatures.evidence,
    },
  };
}

function parseQuestion(element: Element, sequence: number): ExamViewParsedQuestion {
  const sourceId = attr(element, 'question-id')?.trim() || String(sequence);
  const typeCode = attr(element, 'type')?.trim().toLowerCase() ?? '';
  const textElement = findChildByLocalName(element, 'text');
  const choicesElement = findChildByLocalName(element, 'choices');
  const answerElement = findChildByLocalName(element, 'answer');
  const rationaleElement = findChildByLocalName(element, 'rationale');
  const choices = parseChoices(choicesElement);
  const prompt = readCollapsedText(textElement);
  const answerLines = readAnswerLines(answerElement);
  const rationale = readCollapsedText(rationaleElement) || null;
  const context = `ExamView question ${sourceId}`;
  const sourceFeatures = inspectExamViewItemFeatures({
    element,
    context,
    hasFormatting: hasRichFormatting(textElement) ||
      choices.some((_choice, index) => hasRichFormatting(choiceElementAt(choicesElement, index))) ||
      hasRichFormatting(answerElement),
    hasRationale: rationale !== null,
  });
  return {
    sequence,
    sourceId,
    typeCode,
    kind: questionKind(typeCode),
    prompt,
    answerLines,
    choices,
    groupName: attr(element, 'group')?.trim() || null,
    diagnostics: sourceFeatures.diagnostics,
    evidence: {
      blockId: `examview-question-${sequence}`,
      quote: questionEvidence(
        prompt,
        choices,
        answerLines,
        rationale,
        sourceFeatures.evidenceLines,
      ),
    },
  };
}

function parseMatchingGroup(
  element: Element,
  sequence: number,
  members: readonly ExamViewParsedQuestion[],
): ExamViewParsedMatchingGroup {
  const name = attr(element, 'name')?.trim() ?? '';
  const sourceId = attr(element, 'group-id')?.trim() || String(sequence);
  const textElement = findChildByLocalName(element, 'text');
  const choicesElement = findChildByLocalName(element, 'choices');
  const choices = parseChoices(choicesElement);
  const prompt = readCollapsedText(textElement);
  const rationale = readCollapsedText(findChildByLocalName(element, 'rationale')) || null;
  const sourceFeatures = inspectExamViewItemFeatures({
    element,
    context: `ExamView matching group ${name || sourceId}`,
    hasFormatting: hasRichFormatting(textElement) ||
      choices.some((_choice, index) => hasRichFormatting(choiceElementAt(choicesElement, index))),
    hasRationale: rationale !== null,
  });
  return {
    sequence,
    sourceId,
    name,
    prompt,
    choices,
    members,
    diagnostics: [
      ...sourceFeatures.diagnostics,
      ...members.flatMap((member) => member.diagnostics),
    ],
    evidence: {
      blockId: `examview-matching-group-${sequence}`,
      quote: matchingEvidence(
        prompt,
        choices,
        members,
        rationale,
        sourceFeatures.evidenceLines,
      ),
    },
  };
}

function groupMatchingMembers(
  questions: readonly ExamViewParsedQuestion[],
): Map<string, ExamViewParsedQuestion[]> {
  const members = new Map<string, ExamViewParsedQuestion[]>();
  for (const question of questions) {
    if (question.kind !== 'matching_member' || !question.groupName) continue;
    const groupMembers = members.get(question.groupName) ?? [];
    groupMembers.push(question);
    members.set(question.groupName, groupMembers);
  }
  return members;
}

function parseChoices(choicesElement: Element | null): ExamViewParsedChoice[] {
  if (!choicesElement) return [];
  return childElements(choicesElement).flatMap((element) => {
    const match = /^choice-([a-z])$/i.exec(localName(element));
    if (!match) return [];
    return [{ key: match[1].toUpperCase(), text: readCollapsedText(element) }];
  });
}

function choiceElementAt(choicesElement: Element | null, index: number): Element | null {
  if (!choicesElement) return null;
  return childElements(choicesElement)
    .filter((element) => /^choice-[a-z]$/i.test(localName(element)))[index] ?? null;
}

function readHeaderTitle(root: Element): string | null {
  const header = findChildByLocalName(root, 'header');
  const title = readCollapsedText(findChildByLocalName(header, 'title'));
  return title || null;
}

function readCollapsedText(element: Element | null): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function readAnswerLines(element: Element | null): string[] {
  return (element?.textContent ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function hasRichFormatting(element: Element | null): boolean {
  return element !== null && childElements(element).length > 0;
}

function questionKind(typeCode: string): ExamViewQuestionKind {
  switch (typeCode) {
    case 'tf':
      return 'true_false';
    case 'yn':
      return 'yes_no';
    case 'mc':
      return 'choice';
    case 'co':
      return 'completion';
    case 'sa':
      return 'short_answer';
    case 'nr':
      return 'numeric';
    case 'es':
    case 'pr':
    case 'ca':
    case 'ot':
      return 'open_response';
    case 'ma':
      return 'matching_member';
    default:
      return 'unknown';
  }
}

function questionEvidence(
  prompt: string,
  choices: readonly ExamViewParsedChoice[],
  answerLines: readonly string[],
  rationale: string | null,
  sourceFeatureLines: readonly string[],
): string {
  const quote = [
    prompt,
    ...choices.map((choice) => `${choice.key}. ${choice.text}`),
    ...(answerLines.length > 0 ? [`Answer: ${answerLines.join(' | ')}`] : []),
    ...(rationale ? [`Rationale: ${rationale}`] : []),
    ...sourceFeatureLines,
  ].filter(Boolean).join('\n');
  return quote || '[No visible question content]';
}

function matchingEvidence(
  prompt: string,
  choices: readonly ExamViewParsedChoice[],
  members: readonly ExamViewParsedQuestion[],
  rationale: string | null,
  sourceFeatureLines: readonly string[],
): string {
  const quote = [
    prompt,
    ...choices.map((choice) => `${choice.key}. ${choice.text}`),
    ...(rationale ? [`Rationale: ${rationale}`] : []),
    ...sourceFeatureLines,
    ...members.map((member) => `Matching member:\n${member.evidence.quote}`),
  ].filter(Boolean).join('\n');
  return quote || '[No visible matching content]';
}

function invalid(
  code: ExamViewDocumentIssue['code'],
  message: string,
): ExamViewParseResult {
  return { _tag: 'invalid', issues: [{ code, message }] };
}
