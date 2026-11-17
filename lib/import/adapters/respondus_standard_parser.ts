import type { RespondusSourceLine } from './respondus_standard_source.ts';
import { classifyRespondusLine } from './respondus_standard_grammar.ts';

/** Exact source evidence retained while parsing Respondus syntax. */
export type RespondusEvidenceRef = {
  readonly blockId: string;
  readonly quote: string;
};

/** One answer choice recovered from Respondus Standard Format. */
export type RespondusParsedChoice = {
  readonly label: string;
  readonly text: string;
  readonly markedCorrect: boolean;
  readonly feedback: string | null;
  readonly evidence: RespondusEvidenceRef;
};

/** A keyed answer recovered from the terminal Answers section. */
export type RespondusAnswerEntry = {
  readonly value: string;
  readonly evidence: RespondusEvidenceRef;
};

/** A deterministic parser diagnostic associated with one question. */
export type RespondusQuestionIssue = {
  readonly code:
    | 'RESPONDUS_DUPLICATE_CHOICE'
    | 'RESPONDUS_FEEDBACK_POSITION_INVALID';
  readonly message: string;
  readonly line: number;
};

/** Supported and explicitly unsupported Respondus question kinds. */
export type RespondusQuestionKind =
  | 'choice'
  | 'essay'
  | 'fill_blank'
  | 'matching'
  | 'multiple_answer'
  | 'unsupported';

/** One structurally bounded question recovered from the source grammar. */
export type RespondusParsedQuestion = {
  readonly number: number;
  readonly kind: RespondusQuestionKind;
  readonly typeCode: string | null;
  readonly title: string | null;
  readonly prompt: string;
  readonly points: number | null;
  readonly choices: readonly RespondusParsedChoice[];
  readonly correctFeedback: string | null;
  readonly incorrectFeedback: string | null;
  readonly appendixAnswers: readonly RespondusAnswerEntry[];
  readonly evidence: RespondusEvidenceRef;
  readonly issues: readonly RespondusQuestionIssue[];
};

/** Fully parsed Respondus document. */
export type ParsedRespondusDocument = {
  readonly questions: readonly RespondusParsedQuestion[];
};

/** File-level syntax failure that prevents deterministic question boundaries. */
export type RespondusDocumentIssue = {
  readonly code:
    | 'RESPONDUS_ANSWERS_DUPLICATE'
    | 'RESPONDUS_ANSWER_WITHOUT_QUESTION'
    | 'RESPONDUS_DIRECTIVE_INCOMPLETE'
    | 'RESPONDUS_DUPLICATE_QUESTION_NUMBER'
    | 'RESPONDUS_INVALID_ANSWER_ENTRY'
    | 'RESPONDUS_INVALID_POINTS'
    | 'RESPONDUS_NO_QUESTIONS'
    | 'RESPONDUS_TEXT_OUTSIDE_QUESTION';
  readonly message: string;
  readonly line: number;
};

/** Typed result from the pure Respondus Standard Format parser. */
export type RespondusParseResult =
  | { readonly _tag: 'parsed'; readonly value: ParsedRespondusDocument }
  | { readonly _tag: 'invalid'; readonly issues: readonly RespondusDocumentIssue[] };

type MutableChoice = {
  label: string;
  text: string;
  markedCorrect: boolean;
  feedback: string | null;
  evidence: RespondusEvidenceRef;
};

type MutableQuestion = {
  number: number;
  kind: RespondusQuestionKind;
  typeCode: string | null;
  title: string | null;
  promptParts: string[];
  points: number | null;
  choices: MutableChoice[];
  correctFeedbackParts: string[];
  incorrectFeedbackParts: string[];
  evidence: RespondusEvidenceRef;
  issues: RespondusQuestionIssue[];
  active:
    | { kind: 'prompt' }
    | { kind: 'choice'; index: number }
    | { kind: 'choice_feedback'; index: number }
    | { kind: 'correct_feedback' }
    | { kind: 'incorrect_feedback' };
};

type MutableAnswerEntry = {
  number: number;
  valueParts: string[];
  evidence: RespondusEvidenceRef;
};

/** Parse exact Respondus Standard Format without semantic guessing or AI repair. */
export function parseRespondusStandard(
  lines: readonly RespondusSourceLine[],
): RespondusParseResult {
  const issues: RespondusDocumentIssue[] = [];
  const answersIndexes = lines.flatMap((line, index) =>
    classifyRespondusLine(line.text)._tag === 'answers_directive' ? [index] : []
  );
  if (answersIndexes.length > 1) {
    for (const index of answersIndexes.slice(1)) {
      const line = lines[index];
      if (!line) continue;
      issues.push({
        code: 'RESPONDUS_ANSWERS_DUPLICATE',
        message: 'Respondus Standard Format allows one terminal Answers section.',
        line: line.line,
      });
    }
  }

  const answersIndex = answersIndexes[0] ?? lines.length;
  const bodyLines = lines.slice(0, answersIndex);
  const answerLines = answersIndex < lines.length ? lines.slice(answersIndex + 1) : [];
  const questions = parseQuestionBody(bodyLines, issues);
  const answers = parseAnswerAppendix(answerLines, issues);
  const questionNumbers = new Set(questions.map((question) => question.number));
  for (const answer of answers) {
    if (questionNumbers.has(answer.number)) continue;
    issues.push({
      code: 'RESPONDUS_ANSWER_WITHOUT_QUESTION',
      message: `Answers section references question ${answer.number}, which does not exist.`,
      line: answer.evidenceLine,
    });
  }
  if (!questions.length) {
    issues.push({
      code: 'RESPONDUS_NO_QUESTIONS',
      message: 'No numbered Respondus questions were found.',
      line: lines[0]?.line ?? 1,
    });
  }
  if (issues.length) return { _tag: 'invalid', issues };

  const answersByNumber = new Map<number, RespondusAnswerEntry[]>();
  for (const answer of answers) {
    const existing = answersByNumber.get(answer.number) ?? [];
    existing.push({
      value: answer.valueParts.join(' ').trim(),
      evidence: answer.evidence,
    });
    answersByNumber.set(answer.number, existing);
  }
  return {
    _tag: 'parsed',
    value: {
      questions: questions.map((question) => ({
        number: question.number,
        kind: question.kind,
        typeCode: question.typeCode,
        title: question.title,
        prompt: question.promptParts.join(' ').trim(),
        points: question.points,
        choices: question.choices,
        correctFeedback: joinOptional(question.correctFeedbackParts),
        incorrectFeedback: joinOptional(question.incorrectFeedbackParts),
        appendixAnswers: answersByNumber.get(question.number) ?? [],
        evidence: question.evidence,
        issues: question.issues,
      })),
    },
  };
}

function parseQuestionBody(
  lines: readonly RespondusSourceLine[],
  documentIssues: RespondusDocumentIssue[],
): MutableQuestion[] {
  const questions: MutableQuestion[] = [];
  const seenNumbers = new Set<number>();
  let pendingType: { code: string; line: number } | null = null;
  let pendingTitle: { value: string; line: number } | null = null;
  // Respondus defines Points as sticky state: it remains active until another Points directive.
  let currentPoints: number | null = null;
  let current: MutableQuestion | null = null;

  const finishCurrent = (): void => {
    if (!current) return;
    questions.push(current);
    current = null;
  };

  for (const line of lines) {
    const syntax = classifyRespondusLine(line.text);
    switch (syntax._tag) {
      case 'type_directive':
        finishCurrent();
        if (!syntax.code) {
          documentIssues.push({
            code: 'RESPONDUS_DIRECTIVE_INCOMPLETE',
            message: 'Type directive must include a question type code.',
            line: line.line,
          });
        } else {
          pendingType = { code: syntax.code.toUpperCase(), line: line.line };
        }
        break;
      case 'title_directive':
        finishCurrent();
        if (!syntax.title) {
          documentIssues.push({
            code: 'RESPONDUS_DIRECTIVE_INCOMPLETE',
            message: 'Title directive must include a title.',
            line: line.line,
          });
        } else {
          pendingTitle = { value: syntax.title, line: line.line };
        }
        break;
      case 'points_directive': {
        finishCurrent();
        const value = Number(syntax.value);
        if (!syntax.value || !Number.isFinite(value) || value < 0 || value > 100) {
          documentIssues.push({
            code: 'RESPONDUS_INVALID_POINTS',
            message: 'Points must be a number from 0 through 100.',
            line: line.line,
          });
        } else {
          currentPoints = value;
        }
        break;
      }
      case 'question': {
        finishCurrent();
        if (seenNumbers.has(syntax.number)) {
          documentIssues.push({
            code: 'RESPONDUS_DUPLICATE_QUESTION_NUMBER',
            message: `Question number ${syntax.number} appears more than once.`,
            line: line.line,
          });
        }
        seenNumbers.add(syntax.number);
        const typeCode = pendingType?.code ?? null;
        current = {
          number: syntax.number,
          kind: questionKind(typeCode),
          typeCode,
          title: pendingTitle?.value ?? null,
          promptParts: [syntax.body],
          points: currentPoints,
          choices: [],
          correctFeedbackParts: [],
          incorrectFeedbackParts: [],
          evidence: evidenceFor(line),
          issues: [],
          active: { kind: 'prompt' },
        };
        pendingType = null;
        pendingTitle = null;
        break;
      }
      case 'choice':
        if (!current) {
          addTextOutsideQuestionIssue(documentIssues, line);
          break;
        }
        if (current.choices.some((choice) => choice.label === syntax.label)) {
          current.issues.push({
            code: 'RESPONDUS_DUPLICATE_CHOICE',
            message: `Choice ${syntax.label} appears more than once.`,
            line: line.line,
          });
        }
        current.choices.push({
          label: syntax.label,
          text: syntax.body,
          markedCorrect: syntax.markedCorrect,
          feedback: null,
          evidence: evidenceFor(line),
        });
        current.active = { kind: 'choice', index: current.choices.length - 1 };
        break;
      case 'feedback': {
        if (!current) {
          addTextOutsideQuestionIssue(documentIssues, line);
          break;
        }
        if (syntax.marker === '@' && current.choices.length > 0) {
          const index = current.choices.length - 1;
          current.choices[index].feedback = syntax.body;
          current.active = { kind: 'choice_feedback', index };
          break;
        }
        if (syntax.marker === '~' && current.choices.length > 0) {
          current.issues.push({
            code: 'RESPONDUS_FEEDBACK_POSITION_INVALID',
            message: 'General correct feedback must appear before answer choices.',
            line: line.line,
          });
        }
        const parts = syntax.marker === '~'
          ? current.correctFeedbackParts
          : current.incorrectFeedbackParts;
        parts.push(syntax.body);
        current.active = syntax.marker === '~'
          ? { kind: 'correct_feedback' }
          : { kind: 'incorrect_feedback' };
        break;
      }
      case 'answers_directive':
      case 'text':
        if (!current) {
          addTextOutsideQuestionIssue(documentIssues, line);
          break;
        }
        appendContinuation(current, syntax._tag === 'text' ? syntax.body : line.text);
        break;
    }
  }

  finishCurrent();
  const incomplete = pendingType ?? pendingTitle;
  if (incomplete) {
    documentIssues.push({
      code: 'RESPONDUS_DIRECTIVE_INCOMPLETE',
      message: 'The final Respondus directive is not followed by a numbered question.',
      line: incomplete.line,
    });
  }
  return questions;
}

function parseAnswerAppendix(
  lines: readonly RespondusSourceLine[],
  issues: RespondusDocumentIssue[],
): Array<MutableAnswerEntry & { readonly evidenceLine: number }> {
  const answers: Array<MutableAnswerEntry & { evidenceLine: number }> = [];
  let current: (MutableAnswerEntry & { evidenceLine: number }) | null = null;
  for (const line of lines) {
    const syntax = classifyRespondusLine(line.text);
    if (syntax._tag === 'question') {
      current = {
        number: syntax.number,
        valueParts: [syntax.body],
        evidence: evidenceFor(line),
        evidenceLine: line.line,
      };
      answers.push(current);
      continue;
    }
    if (!current) {
      issues.push({
        code: 'RESPONDUS_INVALID_ANSWER_ENTRY',
        message: 'Every Answers entry must begin with its question number.',
        line: line.line,
      });
      continue;
    }
    if (
      syntax._tag === 'type_directive' ||
      syntax._tag === 'title_directive' ||
      syntax._tag === 'points_directive' ||
      syntax._tag === 'answers_directive'
    ) {
      issues.push({
        code: 'RESPONDUS_INVALID_ANSWER_ENTRY',
        message: 'Question directives are not valid inside the terminal Answers section.',
        line: line.line,
      });
      continue;
    }
    current.valueParts.push(line.text);
  }
  return answers;
}

function addTextOutsideQuestionIssue(
  issues: RespondusDocumentIssue[],
  line: RespondusSourceLine,
): void {
  issues.push({
    code: 'RESPONDUS_TEXT_OUTSIDE_QUESTION',
    message:
      `Text outside a numbered question is not valid Respondus Standard Format: "${line.text}".`,
    line: line.line,
  });
}

function appendContinuation(question: MutableQuestion, text: string): void {
  switch (question.active.kind) {
    case 'prompt':
      question.promptParts.push(text);
      return;
    case 'choice':
      question.choices[question.active.index].text += ` ${text}`;
      return;
    case 'choice_feedback': {
      const choice = question.choices[question.active.index];
      choice.feedback = `${choice.feedback ?? ''} ${text}`.trim();
      return;
    }
    case 'correct_feedback':
      question.correctFeedbackParts.push(text);
      return;
    case 'incorrect_feedback':
      question.incorrectFeedbackParts.push(text);
      return;
  }
}

function questionKind(typeCode: string | null): RespondusQuestionKind {
  switch (typeCode) {
    case null:
      return 'choice';
    case 'E':
      return 'essay';
    case 'F':
      return 'fill_blank';
    case 'MT':
      return 'matching';
    case 'MA':
      return 'multiple_answer';
    default:
      return 'unsupported';
  }
}

function evidenceFor(line: RespondusSourceLine): RespondusEvidenceRef {
  return { blockId: line.blockId, quote: line.text };
}

function joinOptional(parts: readonly string[]): string | null {
  const value = parts.join(' ').trim();
  return value || null;
}
