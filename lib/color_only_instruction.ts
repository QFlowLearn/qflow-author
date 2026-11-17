const COLOR_TERM =
  '(?:red|green|blue|yellow|orange|purple|pink|brown|gray|grey|black|white|color|colour)';

/** Detect instructions that appear to identify a response only through color. */
export function usesColorOnlyInstruction(value: string): boolean {
  return instructionClauses(value).some((clause) => {
    const instructionUsesColor = new RegExp(
      `\\b(?:select|choose|click|tap|pick|identify|mark|drag|drop|match|use|follow)\\b.{0,80}\\b${COLOR_TERM}\\b`,
    ).test(clause);
    const colorIdentifiesObject = new RegExp(
      `\\b${COLOR_TERM}\\b.{0,40}\\b(?:option|choice|answer|area|region|shape|item|box|button|text|line|label)\\b`,
    ).test(clause);
    const describedOnlyByColor = new RegExp(
      `\\b(?:shown|highlighted|marked|displayed|colored|coloured)\\b.{0,40}\\b${COLOR_TERM}\\b`,
    ).test(clause);
    if (!instructionUsesColor && !colorIdentifiesObject && !describedOnlyByColor) return false;
    return !/\b(?:label|letter|number|shape|pattern|position|left|right|above|below|first|second|third)\b/
      .test(clause);
  });
}

function instructionClauses(value: string): string[] {
  return value
    .replaceAll(/<\/?(?:br|div|li|ol|p|table|td|th|tr|ul)\b[^>]*>/gi, '. ')
    .replaceAll(/<[^>]*>/g, ' ')
    .toLocaleLowerCase()
    .split(/[.!?;:\n]+/)
    .map((clause) => clause.replaceAll(/\s+/g, ' ').trim())
    .filter((clause) => clause.length > 0);
}
