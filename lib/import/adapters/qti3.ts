import { openQtiPackage, parseQtiPackage } from './qti3/parse_package.ts';
import { IMPORT_ADAPTER_DESCRIPTORS } from '../adapter_descriptors.ts';
import type { ImportAdapter, ImportSource, SniffResult } from '../types.ts';

const ZIP_MAGIC = [0x50, 0x4b];

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === ZIP_MAGIC[0] && bytes[1] === ZIP_MAGIC[1];
}

async function sniffQti3(source: ImportSource): Promise<SniffResult> {
  if (!isZip(source.bytes)) {
    return { supported: false, confidence: 0, reason: 'not-zip' };
  }

  try {
    return await sniffQti3Archive(await openQtiPackage(source.bytes));
  } catch (_err) {
    return { supported: false, confidence: 0, reason: 'invalid-zip' };
  }
}

async function sniffQti3Archive(
  zip: Awaited<ReturnType<typeof openQtiPackage>>,
): Promise<SniffResult> {
  const manifestFile = zip.entries.find((entry) => /(?:^|\/)imsmanifest\.xml$/i.test(entry.path));
  if (!manifestFile) {
    return { supported: false, confidence: 0.1, reason: 'missing-manifest' };
  }

  const manifestXml = new TextDecoder().decode(
    await zip.readEntry(manifestFile.path, 8 * 1024 * 1024),
  );
  const hasQti3 = /imsqti_(test|item)_xmlv3p0/i.test(manifestXml);
  const hasQti2 = /imsqti_(test|item)_xmlv2p(?:0|1|2)/i.test(manifestXml);
  const hasQtiTestResource =
    /<resource[^>]+type=["'][^"']*(qti|imsqti)[^"']*(test|assessment)[^"']*/i
      .test(manifestXml);
  const hasQtiItemResource = /<resource[^>]+type=["'][^"']*(qti|imsqti)[^"']*item[^"']*/i
    .test(manifestXml);

  if (hasQti3 && (hasQtiTestResource || hasQtiItemResource)) {
    return { supported: true, confidence: 0.95, reason: 'manifest-qti3' };
  }
  if (!hasQtiTestResource && !hasQtiItemResource) {
    return { supported: false, confidence: 0.2, reason: 'manifest-no-qti-resource' };
  }
  if (hasQti2) {
    return { supported: false, confidence: 0.1, reason: 'manifest-qti2' };
  }
  return { supported: true, confidence: 0.6, reason: 'manifest-qti-unknown' };
}

export const qti3Adapter: ImportAdapter = {
  ...IMPORT_ADAPTER_DESCRIPTORS.qti3,
  sniff: sniffQti3,
  parse: (source) => {
    return parseQtiPackage(source.bytes);
  },
};
