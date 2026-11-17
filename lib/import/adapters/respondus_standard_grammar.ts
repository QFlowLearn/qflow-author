/** One line classified by the shared Respondus Standard Format grammar. */
export type RespondusLineSyntax =
  | {
    readonly _tag: 'question';
    readonly number: number;
    readonly body: string;
  }
  | {
    readonly _tag: 'choice';
    readonly label: string;
    readonly body: string;
    readonly markedCorrect: boolean;
  }
  | {
    readonly _tag: 'type_directive';
    readonly code: string;
  }
  | {
    readonly _tag: 'title_directive';
    readonly title: string;
  }
  | {
    readonly _tag: 'points_directive';
    readonly value: string;
  }
  | { readonly _tag: 'answers_directive' }
  | {
    readonly _tag: 'feedback';
    readonly marker: '~' | '@';
    readonly body: string;
  }
  | {
    readonly _tag: 'text';
    readonly body: string;
  };

const QUESTION_PATTERN = /^(\d+)[.)]\s+(.+)$/;
const CHOICE_PATTERN = /^(\*)?([A-Ta-t])[.)]\s+(.+)$/;
const TYPE_PATTERN = /^Type:\s*(\S*)\s*$/i;
const TITLE_PATTERN = /^Title:\s*(.*)$/i;
const POINTS_PATTERN = /^Points:\s*(\S*)\s*$/i;
const ANSWERS_PATTERN = /^Answers:\s*$/i;
const FEEDBACK_PATTERN = /^([~@])\s+(.+)$/;

/**
 * Classify and capture one visible source line for both sniffing and parsing.
 *
 * `Points:` is a sticky Respondus directive: its value applies to every following
 * question until another `Points:` directive replaces it.
 */
export function classifyRespondusLine(text: string): RespondusLineSyntax {
  if (ANSWERS_PATTERN.test(text)) {
    return { _tag: 'answers_directive' };
  }

  const typeMatch = TYPE_PATTERN.exec(text);
  if (typeMatch) {
    return { _tag: 'type_directive', code: typeMatch[1].trim() };
  }

  const titleMatch = TITLE_PATTERN.exec(text);
  if (titleMatch) {
    return { _tag: 'title_directive', title: titleMatch[1].trim() };
  }

  const pointsMatch = POINTS_PATTERN.exec(text);
  if (pointsMatch) {
    return { _tag: 'points_directive', value: pointsMatch[1].trim() };
  }

  const questionMatch = QUESTION_PATTERN.exec(text);
  if (questionMatch) {
    return {
      _tag: 'question',
      number: Number(questionMatch[1]),
      body: questionMatch[2].trim(),
    };
  }

  const choiceMatch = CHOICE_PATTERN.exec(text);
  if (choiceMatch) {
    return {
      _tag: 'choice',
      label: choiceMatch[2].toUpperCase(),
      body: choiceMatch[3].trim(),
      markedCorrect: choiceMatch[1] === '*',
    };
  }

  const feedbackMatch = FEEDBACK_PATTERN.exec(text);
  if (feedbackMatch) {
    return {
      _tag: 'feedback',
      marker: feedbackMatch[1] === '~' ? '~' : '@',
      body: feedbackMatch[2].trim(),
    };
  }

  return { _tag: 'text', body: text };
}
