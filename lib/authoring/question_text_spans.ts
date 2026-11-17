/** Exact source slices, so interpretation can rejoin stem fragments without losing punctuation. */
export type QuestionTextSpan = {
  readonly text: string;
  readonly start: number;
  readonly end: number;
};

/** Split authoring clauses while preserving quoted phrases and grouped numbers. */
export function questionTextSpans(source: string): readonly QuestionTextSpan[] {
  const type = source.match(/^(?:MCQ|MC|MR|MS|SA)\b(?!\.)/)?.[0] ??
    source.match(/^(?:multiple choice|multiple response|short answer)\b/i)?.[0];
  const suffix = type
    ? source.slice(type.length).match(
      /^(?:\s+(?:\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(?:options|choices))?[:\s,-]*/i,
    )?.[0] ?? ''
    : '';
  const prefixEnd = type ? type.length + suffix.length : 0;
  const spans: QuestionTextSpan[] = [];
  const add = (from: number, to: number) => {
    let start = from, end = to;
    while (start < end && /\s/.test(source[start])) start++;
    while (end > start && /\s/.test(source[end - 1])) end--;
    const text = source.slice(start, end);
    if (/^"(?:[^"\\]|\\.)*"$/.test(text) || /^“[^”]*”$/.test(text)) {
      start++;
      end--;
    }
    if (start < end) spans.push({ text: source.slice(start, end), start, end });
  };
  if (prefixEnd) add(0, source.slice(0, prefixEnd).replace(/[\s,:-]+$/, '').length);
  let start = prefixEnd;
  let closingQuote: '"' | '”' | null = null;
  for (let index = prefixEnd; index < source.length; index++) {
    const character = source[index];
    if (character === closingQuote && source[index - 1] !== '\\') {
      closingQuote = null;
      continue;
    }
    if (closingQuote) continue;
    if (character === '"' || character === '“') {
      closingQuote = character === '“' ? '”' : '"';
      continue;
    }
    // A thousands separator belongs to the number; an ordinary comma separates candidates.
    if (
      character === ',' && /\d/.test(source[index - 1] ?? '') &&
      /^\d{3}(?!\d)/.test(source.slice(index + 1))
    ) continue;
    if (/[,;\n?]/.test(character)) {
      add(start, character === '?' ? index + 1 : index);
      start = index + 1;
    }
  }
  add(start, source.length);
  return spans;
}

/** Keep delimiters between adjacent stem fragments; never reintroduce omitted authoring commands. */
export function questionStemFromSpans(
  source: string,
  spans: readonly QuestionTextSpan[],
  selected: readonly number[],
): string {
  const parts: string[] = [];
  let start = -1, end = -1, previous = -2;
  for (const index of selected) {
    const span = spans[index];
    if (index !== previous + 1) {
      if (start >= 0) parts.push(source.slice(start, end));
      start = span.start;
    }
    end = span.end;
    previous = index;
  }
  if (start >= 0) parts.push(source.slice(start, end));
  return parts.join(' ');
}
