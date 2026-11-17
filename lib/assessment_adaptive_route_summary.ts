/** Combine consecutive five-question blocks that use the same difficulty. */
export function summarizeAdaptiveRoute(
  levels: readonly string[],
): readonly { level: string; start: number; end: number }[] {
  const segments: { level: string; start: number; end: number }[] = [];
  levels.forEach((level, index) => {
    const previous = segments.at(-1);
    if (previous?.level === level) previous.end = (index + 1) * 5;
    else segments.push({ level, start: index * 5 + 1, end: (index + 1) * 5 });
  });
  return segments;
}
