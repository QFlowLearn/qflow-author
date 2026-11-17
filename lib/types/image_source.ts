const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.svgz': 'image/svg+xml',
  '.webp': 'image/webp',
};

/** Infer an image MIME type from a data URL or a source filename. */
export function inferImageMimeFromSource(source?: string): string | undefined {
  const normalized = source?.trim().toLowerCase() ?? '';
  if (!normalized) return undefined;

  const dataMime = /^data:(image\/[a-z0-9.+-]+)(?:[;,])/i.exec(normalized)?.[1];
  if (dataMime) return dataMime === 'image/jpg' ? 'image/jpeg' : dataMime;

  const path = normalized.split(/[?#]/, 1)[0];
  const dot = path.lastIndexOf('.');
  if (dot === -1) return undefined;
  return IMAGE_MIME_BY_EXTENSION[path.slice(dot)];
}
