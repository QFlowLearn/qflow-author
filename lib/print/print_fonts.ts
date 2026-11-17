/** Read Unicode coverage from the exact pinned OpenType fonts, without loading another font engine. */
export function printFontCoverage(fonts: readonly ArrayBuffer[]): (value: string) => boolean {
  const tables = fonts.flatMap(unicodeTables);
  if (!tables.length) throw Error('Pinned paper fonts have no supported Unicode cmap.');
  return (value) => {
    for (const character of value) {
      const code = character.codePointAt(0);
      if (code === undefined || code === 9 || code === 10 || code === 13) continue;
      if (!tables.some((table) => table(code))) return false;
    }
    return true;
  };
}

/** Validate every string in the data-only projection, skipping the separate binary image catalog. */
export function printDocumentFontsSupported(
  document: object,
  supports: (value: string) => boolean,
): boolean {
  const pending: unknown[] = [document];
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === 'string') { if (!supports(value)) return false; }
    else if (Array.isArray(value)) pending.push(...value);
    else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (key !== 'images' && key !== 'alt') pending.push(child);
      }
    }
  }
  return true;
}

function unicodeTables(bytes: ArrayBuffer): ((code: number) => boolean)[] {
  if (bytes.byteLength < 12) throw Error('Invalid pinned font header.');
  const view = new DataView(bytes), result: ((code: number) => boolean)[] = [];
  const count = view.getUint16(4);
  if (count > 128 || 12 + count * 16 > bytes.byteLength) {
    throw Error('Invalid pinned font table directory.');
  }
  let cmap = -1;
  for (let index = 0; index < count; index++) {
    const entry = 12 + index * 16;
    if (view.getUint32(entry) === 0x636d6170) cmap = view.getUint32(entry + 8);
  }
  if (cmap < 0 || cmap + 4 > bytes.byteLength) throw Error('Pinned font is missing cmap.');
  if (cmap + 4 + view.getUint16(cmap + 2) * 8 > bytes.byteLength) {
    throw Error('Invalid pinned font cmap directory.');
  }
  for (let index = 0; index < view.getUint16(cmap + 2); index++) {
    const entry = cmap + 4 + index * 8,
      platform = view.getUint16(entry),
      encoding = view.getUint16(entry + 2);
    if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;
    const start = cmap + view.getUint32(entry + 4);
    if (start + 2 > bytes.byteLength) throw Error('Invalid pinned font cmap offset.');
    const format = view.getUint16(start);
    if (format === 12) result.push(format12(view, start));
    else if (format === 4) result.push(format4(view, start));
  }
  return result;
}
function format12(view: DataView, start: number): (code: number) => boolean {
  if (start + 16 > view.byteLength) throw Error('Invalid pinned font format12 header.');
  const limit = start + view.getUint32(start + 4), count = view.getUint32(start + 12);
  if (count > 100000 || start + 16 + count * 12 > limit || limit > view.byteLength) {
    throw Error('Invalid pinned font coverage groups.');
  }
  return (code) => {
    let low = 0, high = count - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1,
        entry = start + 16 + middle * 12,
        first = view.getUint32(entry),
        last = view.getUint32(entry + 4);
      if (code < first) high = middle - 1;
      else if (code > last) low = middle + 1;
      else return view.getUint32(entry + 8) + code - first !== 0;
    }
    return false;
  };
}
function format4(view: DataView, start: number): (code: number) => boolean {
  if (start + 8 > view.byteLength) throw Error('Invalid pinned font format4 header.');
  const limit = start + view.getUint16(start + 2);
  const count = view.getUint16(start + 6) / 2,
    end = start + 14,
    first = end + count * 2 + 2,
    delta = first + count * 2,
    ranges = delta + count * 2;
  if (
    !Number.isSafeInteger(count) || count < 1 || ranges + count * 2 > limit ||
    limit > view.byteLength
  ) throw Error('Invalid pinned font coverage segments.');
  return (code) => {
    if (code > 0xffff) return false;
    for (let index = 0; index < count; index++) {
      if (code > view.getUint16(end + index * 2)) continue;
      if (code < view.getUint16(first + index * 2)) return false;
      const offset = view.getUint16(ranges + index * 2),
        adjustment = view.getInt16(delta + index * 2);
      if (!offset) return ((code + adjustment) & 0xffff) !== 0;
      const address = ranges + index * 2 + offset + (code - view.getUint16(first + index * 2)) * 2;
      if (address + 2 > limit) throw Error('Invalid pinned font glyph address.');
      const glyph = view.getUint16(address);
      return glyph !== 0 && ((glyph + adjustment) & 0xffff) !== 0;
    }
    return false;
  };
}
