import { unzlibSync, zlibSync } from 'fflate';

export const PRINT_IMAGE_MAX_BYTES = 500000;
export const PRINT_IMAGE_MAX_PIXELS = 1500000;

/** A static derivative with no free-form metadata, attachments, scripts or outbound references. */
export type PrintImage = {
  readonly bytes: Uint8Array;
  readonly mediaType: 'image/png' | 'image/jpeg';
  readonly width: number;
  readonly height: number;
};

/** Parse real image structure and create one metadata-free derivative; unsupported formats block. */
export function preparePrintImage(bytes: Uint8Array):
  | { readonly ok: true; readonly value: PrintImage }
  | {
    readonly ok: false;
    readonly code:
      | 'image_format'
      | 'image_limit'
      | 'image_invalid'
      | 'image_orientation'
      | 'image_color'
      | 'image_animation';
  } {
  if (bytes.length > PRINT_IMAGE_MAX_BYTES) return { ok: false, code: 'image_limit' };
  try {
    if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) {
      return png(bytes);
    }
    if (bytes[0] === 255 && bytes[1] === 216) return jpeg(bytes);
    return { ok: false, code: 'image_format' };
  } catch {
    return { ok: false, code: 'image_invalid' };
  }
}

function png(bytes: Uint8Array): ReturnType<typeof preparePrintImage> {
  if (bytes.slice(0, 8).join(',') !== '137,80,78,71,13,10,26,10') return invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: { kind: string; data: Uint8Array }[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const size = view.getUint32(offset),
      kind = new TextDecoder().decode(bytes.slice(offset + 4, offset + 8));
    if (size > PRINT_IMAGE_MAX_BYTES || offset + size + 12 > bytes.length) return invalid();
    const data = bytes.slice(offset + 8, offset + 8 + size);
    if (
      crc32(bytes.subarray(offset + 4, offset + 8 + size)) !== view.getUint32(offset + size + 8)
    ) return invalid();
    chunks.push({ kind, data });
    offset += size + 12;
    if (kind === 'IEND') break;
  }
  const header = chunks[0];
  if (
    header?.kind !== 'IHDR' || header.data.length !== 13 || chunks.at(-1)?.kind !== 'IEND' ||
    offset !== bytes.length
  ) return invalid();
  const h = new DataView(header.data.buffer, header.data.byteOffset, header.data.byteLength);
  const width = h.getUint32(0), height = h.getUint32(4), color = header.data[9];
  if (!width || !height || width * height > PRINT_IMAGE_MAX_PIXELS) {
    return { ok: false, code: 'image_limit' };
  }
  if (
    header.data[8] !== 8 || header.data[10] !== 0 || header.data[11] !== 0 ||
    header.data[12] !== 0 || ![0, 2, 3, 4, 6].includes(color)
  ) return { ok: false, code: 'image_format' };
  if (chunks.some((chunk) => ['acTL', 'fcTL', 'fdAT'].includes(chunk.kind))) {
    return { ok: false, code: 'image_animation' };
  }
  if (chunks.some((chunk) => chunk.kind === 'iCCP')) return { ok: false, code: 'image_color' };
  if (
    chunks.some((chunk) =>
      /^[A-Z]/.test(chunk.kind) && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(chunk.kind)
    )
  ) return invalid();
  const channels = color === 2 ? 3 : color === 4 ? 2 : color === 6 ? 4 : 1;
  const compressed = concatenate(
    chunks.filter((chunk) => chunk.kind === 'IDAT').map((chunk) => chunk.data),
  );
  const expected = (width * channels + 1) * height;
  // Supplying the bounded output buffer prevents a compressed stream from expanding arbitrarily.
  const output = new Uint8Array(expected);
  const decoded = unzlibSync(compressed, { out: output });
  if (decoded.length !== expected) return invalid();
  let a = 1, b = 0;
  for (const value of decoded) {
    a = (a + value) % 65521;
    b = (b + a) % 65521;
  }
  const checksum = new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength)
    .getUint32(compressed.length - 4);
  if ((((b << 16) | a) >>> 0) !== checksum) return invalid();
  for (let y = 0; y < height; y++) if (decoded[y * (width * channels + 1)] > 4) return invalid();
  const palette = chunks.filter((chunk) => chunk.kind === 'PLTE');
  if (
    palette.length > 1 ||
    (color === 3 &&
      (palette.length !== 1 || palette[0].data.length === 0 || palette[0].data.length > 768 ||
        palette[0].data.length % 3 !== 0))
  ) return invalid();
  const typedLengths: Readonly<Record<string, number>> = {
    gAMA: 4,
    cHRM: 32,
    sRGB: 1,
    sBIT: color === 3 ? 3 : channels,
    bKGD: color === 3 ? 1 : (color === 2 || color === 6) ? 6 : 2,
  };
  for (const [kind, length] of Object.entries(typedLengths)) {
    const retained = chunks.filter((chunk) => chunk.kind === kind);
    if (retained.length > 1 || retained.some((chunk) => chunk.data.length !== length)) {
      return invalid();
    }
  }
  const alpha = chunks.filter((chunk) => chunk.kind === 'tRNS');
  if (
    alpha.length > 1 || (alpha.length && (color === 4 || color === 6 ||
      (color === 0 && alpha[0].data.length !== 2) || (color === 2 && alpha[0].data.length !== 6) ||
      (color === 3 &&
        (!alpha[0].data.length || alpha[0].data.length > palette[0].data.length / 3))))
  ) return invalid();
  if (
    chunks.filter((chunk) => chunk.kind === 'IHDR').length !== 1 || chunks.at(-1)?.data.length !== 0
  ) return invalid();
  if (chunks.some((chunk) => chunk.kind === 'sRGB' && chunk.data[0] > 3)) return invalid();
  if (
    chunks.some((chunk) =>
      chunk.kind === 'sBIT' && [...chunk.data].some((value) => value < 1 || value > 8)
    )
  ) return invalid();
  const derivative = concatenate([
    bytes.slice(0, 8),
    encodeChunk('IHDR', header.data),
    ...chunks.filter((chunk) => ['gAMA', 'cHRM', 'sRGB', 'sBIT'].includes(chunk.kind)).map((
      chunk,
    ) => encodeChunk(chunk.kind, chunk.data)),
    ...palette.map((chunk) => encodeChunk(chunk.kind, chunk.data)),
    ...chunks.filter((chunk) => chunk.kind === 'bKGD').map((chunk) =>
      encodeChunk(chunk.kind, chunk.data)
    ),
    ...chunks.filter((chunk) => chunk.kind === 'tRNS').map((chunk) =>
      encodeChunk(chunk.kind, chunk.data)
    ),
    encodeChunk('IDAT', zlibSync(decoded)),
    encodeChunk('IEND', new Uint8Array()),
  ]);
  return derivative.length > PRINT_IMAGE_MAX_BYTES
    ? { ok: false, code: 'image_limit' }
    : { ok: true, value: { bytes: derivative, mediaType: 'image/png', width, height } };
}

function jpeg(bytes: Uint8Array): ReturnType<typeof preparePrintImage> {
  const segments: Uint8Array[] = [bytes.slice(0, 2)];
  let width = 0, height = 0, offset = 2;
  let scan = false;
  let scanBytes = 0, hasScan = false;
  while (offset + 1 < bytes.length) {
    if (scan) {
      const start = offset;
      while (offset + 1 < bytes.length) {
        if (bytes[offset] !== 255) {
          offset++;
          continue;
        }
        const next = bytes[offset + 1];
        if (next === 0 || (next >= 0xd0 && next <= 0xd7)) {
          offset += 2;
          continue;
        }
        break;
      }
      scanBytes += offset - start;
      segments.push(bytes.slice(start, offset));
      scan = false;
    }
    if (bytes[offset] !== 255) return invalid();
    while (bytes[offset + 1] === 255) offset++;
    const marker = bytes[offset + 1];
    if (marker === 0xd9) {
      return width && height && hasScan && scanBytes
        ? {
          ok: true,
          value: {
            bytes: concatenate([...segments, bytes.slice(offset, offset + 2)]),
            mediaType: 'image/jpeg',
            width,
            height,
          },
        }
        : invalid();
    }
    if (offset + 4 > bytes.length) return invalid();
    const length = bytes[offset + 2] * 256 + bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) return invalid();
    if (marker === 0xc0 || marker === 0xc2) {
      if (length < 8 || length !== 8 + bytes[offset + 9] * 3 || bytes[offset + 4] !== 8) {
        return invalid();
      }
      height = bytes[offset + 5] * 256 + bytes[offset + 6];
      width = bytes[offset + 7] * 256 + bytes[offset + 8];
      if (![1, 3].includes(bytes[offset + 9])) return { ok: false, code: 'image_color' };
      if (!width || !height || width * height > PRINT_IMAGE_MAX_PIXELS) {
        return { ok: false, code: 'image_limit' };
      }
    }
    if (marker === 0xda) {
      if (!width || !height) return invalid();
      scan = true;
      hasScan = true;
    }
    const payload = bytes.subarray(offset + 4, offset + 2 + length);
    if (marker === 0xe1 && new TextDecoder().decode(payload.subarray(0, 6)) === 'Exif\0\0') {
      const orientation = jpegOrientation(payload.subarray(6));
      if (orientation === null) return invalid();
      if (orientation !== 1) return { ok: false, code: 'image_orientation' };
    }
    if (
      (marker === 0xee && new TextDecoder().decode(payload.subarray(0, 5)) === 'Adobe') ||
      (marker === 0xe2 && new TextDecoder().decode(payload.subarray(0, 11)) === 'ICC_PROFILE')
    ) return { ok: false, code: 'image_color' };
    if (marker === 0xe2 && new TextDecoder().decode(payload.subarray(0, 4)) === 'MPF\0') {
      return { ok: false, code: 'image_animation' };
    }
    if (
      !(marker >= 0xe0 && marker <= 0xef) &&
      ![0xfe, 0xc0, 0xc2, 0xc4, 0xdb, 0xdd, 0xda].includes(marker)
    ) return invalid();
    // APP and COM segments can contain EXIF, XMP, filenames and free-form staff metadata.
    if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe) {
      segments.push(bytes.slice(offset, offset + 2 + length));
    }
    offset += 2 + length;
  }
  return invalid();
}

function jpegOrientation(tiff: Uint8Array): number | null {
  if (tiff.length < 8) return null;
  const little = tiff[0] === 73 && tiff[1] === 73;
  if (!little && !(tiff[0] === 77 && tiff[1] === 77)) return null;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  if (view.getUint16(2, little) !== 42) return null;
  const offset = view.getUint32(4, little);
  if (offset + 2 > tiff.length) return null;
  const count = view.getUint16(offset, little);
  if (offset + 2 + count * 12 > tiff.length) return null;
  for (let index = 0; index < count; index++) {
    const entry = offset + 2 + index * 12;
    if (view.getUint16(entry, little) !== 0x112) continue;
    if (view.getUint16(entry + 2, little) !== 3 || view.getUint32(entry + 4, little) !== 1) {
      return null;
    }
    return view.getUint16(entry + 8, little);
  }
  return 1;
}

function invalid(): Extract<ReturnType<typeof preparePrintImage>, { readonly ok: false }> {
  return { ok: false, code: 'image_invalid' };
}
function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
function encodeChunk(kind: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length + 12), view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  result.set(new TextEncoder().encode(kind), 4);
  result.set(data, 8);
  view.setUint32(data.length + 8, crc32(result.subarray(4, data.length + 8)));
  return result;
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
