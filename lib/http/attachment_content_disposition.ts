/** Encode one filename as the ASCII or UTF-8 parameter defined by RFC 6266 section 4.3. */
export function attachmentContentDisposition(filename: string): string {
  let safeFilename = '';
  for (const character of filename) {
    const code = character.charCodeAt(0);
    safeFilename += code < 32 || code === 127 || character === '"' || character === '\\'
      ? '_'
      : character;
  }
  if (Array.from(safeFilename).every((character) => character.charCodeAt(0) < 128)) {
    return `attachment; filename="${safeFilename}"`;
  }
  const encoded = encodeURIComponent(safeFilename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename*=UTF-8''${encoded}`;
}
