export function normalizeLinkInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
