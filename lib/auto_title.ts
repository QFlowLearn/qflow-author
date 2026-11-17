export function autoTitleFromPrompt(promptHtml?: string): string {
  if (!promptHtml) return 'Untitled Question';
  const stripped = promptHtml
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return 'Untitled Question';
  return stripped.length > 80 ? `${stripped.slice(0, 77).trim()}…` : stripped;
}
