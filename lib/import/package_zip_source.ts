/** Immutable random-access bytes supplied by object storage or a local file. */
export type PackageByteSource = {
  readonly size: number;
  readonly read: (offset: number, length: number) => Promise<Uint8Array>;
};

/** Limits enforced before allocating archive metadata or extracting an entry. */
export type PackageZipLimits = {
  readonly maxCompressedBytes: number;
  readonly maxDirectoryBytes: number;
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
};

/** A compact ZIP inventory with bounded, CRC-checked entry reads. */
export type PackageZipSource = {
  readonly entries: readonly { readonly path: string; readonly size: number }[];
  readonly readEntry: (path: string, maxBytes: number) => Promise<Uint8Array>;
};

type Entry = {
  readonly path: string;
  readonly size: number;
  readonly compressedSize: number;
  readonly offset: number;
  readonly method: number;
  readonly flags: number;
  readonly crc: number;
};

/** Invalid packages are rejected before their contents can enter an import. */
export class PackageZipError extends Error {
  readonly _tag = 'PackageZipError';
  constructor(readonly code: 'invalid' | 'limit' | 'unsupported' | 'integrity') {
    super(`Package ZIP ${code}.`);
    this.name = 'PackageZipError';
  }
}

/**
 * Open an ordinary single-disk ZIP without buffering the archive or heavy entry wrappers.
 * ZIP64 and encrypted archives are explicitly unsupported. The caller owns the source;
 * each read is awaited and no open stream survives a readEntry invocation.
 */
export async function openPackageZip(
  source: PackageByteSource,
  limits: PackageZipLimits,
): Promise<PackageZipSource> {
  if (Object.values(limits).some((n) => !Number.isSafeInteger(n) || n <= 0)) {
    throw new PackageZipError('limit');
  }
  if (!Number.isSafeInteger(source.size) || source.size < 22) throw new PackageZipError('invalid');
  if (source.size > limits.maxCompressedBytes) throw new PackageZipError('limit');
  const read = async (offset: number, length: number): Promise<Uint8Array> => {
    if (
      !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 ||
      offset + length > source.size
    ) throw new PackageZipError('invalid');
    if (length === 0) return new Uint8Array();
    const bytes = await source.read(offset, length);
    if (bytes.byteLength !== length) throw new PackageZipError('integrity');
    return bytes;
  };
  const tailOffset = Math.max(0, source.size - 65_557);
  const tail = await read(tailOffset, source.size - tailOffset);
  const tailView = view(tail);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (
      tailView.getUint32(i, true) === 0x06054b50 &&
      i + 22 + tailView.getUint16(i + 20, true) === tail.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new PackageZipError('invalid');
  const count = tailView.getUint16(end + 10, true);
  const directorySize = tailView.getUint32(end + 12, true);
  const directoryOffset = tailView.getUint32(end + 16, true);
  if (
    tailView.getUint16(end + 4, true) !== 0 || tailView.getUint16(end + 6, true) !== 0 ||
    tailView.getUint16(end + 8, true) !== count || count === 0xffff ||
    directorySize === 0xffffffff || directoryOffset === 0xffffffff
  ) {
    throw new PackageZipError('unsupported');
  }
  if (count > limits.maxEntries || directorySize > limits.maxDirectoryBytes) {
    throw new PackageZipError('limit');
  }
  if (directoryOffset + directorySize !== tailOffset + end) throw new PackageZipError('invalid');
  const directory = await read(directoryOffset, directorySize);
  const directoryView = view(directory);
  const byPath = new Map<string, Entry>();
  const paths = new Set<string>();
  let cursor = 0;
  let totalBytes = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > directorySize || directoryView.getUint32(cursor, true) !== 0x02014b50) {
      throw new PackageZipError('invalid');
    }
    const flags = directoryView.getUint16(cursor + 8, true);
    const method = directoryView.getUint16(cursor + 10, true);
    const compressedSize = directoryView.getUint32(cursor + 20, true);
    const size = directoryView.getUint32(cursor + 24, true);
    const nameSize = directoryView.getUint16(cursor + 28, true);
    const extraSize = directoryView.getUint16(cursor + 30, true);
    const commentSize = directoryView.getUint16(cursor + 32, true);
    const offset = directoryView.getUint32(cursor + 42, true);
    const next = cursor + 46 + nameSize + extraSize + commentSize;
    if (!nameSize || next > directorySize || offset + 30 > directoryOffset) {
      throw new PackageZipError('invalid');
    }
    if (
      (flags & ~0x080e) !== 0 || (method !== 0 && method !== 8) ||
      directoryView.getUint16(cursor + 34, true) !== 0 ||
      size === 0xffffffff || compressedSize === 0xffffffff || offset === 0xffffffff
    ) {
      throw new PackageZipError('unsupported');
    }
    const name = decodePath(directory.subarray(cursor + 46, cursor + 46 + nameSize), flags);
    const isDirectory = name.endsWith('/');
    const path = isDirectory ? name.slice(0, -1) : name;
    if (
      !path || path.startsWith('/') || path.includes('\\') || path.includes(':') ||
      [...path].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      path.split('/').some((part) => !part || part === '.' || part === '..') || paths.has(path)
    ) {
      throw new PackageZipError('invalid');
    }
    paths.add(path);
    totalBytes += size;
    if (
      size > limits.maxEntryBytes || compressedSize > limits.maxEntryBytes ||
      totalBytes > limits.maxTotalBytes
    ) throw new PackageZipError('limit');
    if (isDirectory && size !== 0) throw new PackageZipError('invalid');
    if (!isDirectory) {
      byPath.set(path, {
        path,
        size,
        compressedSize,
        offset,
        method,
        flags,
        crc: directoryView.getUint32(cursor + 16, true),
      });
    }
    cursor = next;
  }
  if (cursor !== directorySize) throw new PackageZipError('invalid');
  return {
    entries: [...byPath.values()].map(({ path, size }) => ({ path, size })),
    async readEntry(path, maxBytes) {
      const entry = byPath.get(path);
      if (!entry) throw new PackageZipError('invalid');
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || entry.size > maxBytes) {
        throw new PackageZipError('limit');
      }
      const header = await read(entry.offset, 30);
      const headerView = view(header);
      if (
        headerView.getUint32(0, true) !== 0x04034b50 ||
        headerView.getUint16(6, true) !== entry.flags ||
        headerView.getUint16(8, true) !== entry.method
      ) throw new PackageZipError('integrity');
      const nameSize = headerView.getUint16(26, true);
      const extraSize = headerView.getUint16(28, true);
      const dataOffset = entry.offset + 30 + nameSize + extraSize;
      if (dataOffset + entry.compressedSize > directoryOffset) throw new PackageZipError('invalid');
      if (decodePath(await read(entry.offset + 30, nameSize), entry.flags) !== path) {
        throw new PackageZipError('integrity');
      }
      if (
        (entry.flags & 8) === 0 && (headerView.getUint32(14, true) !== entry.crc ||
          headerView.getUint32(18, true) !== entry.compressedSize ||
          headerView.getUint32(22, true) !== entry.size)
      ) throw new PackageZipError('integrity');
      const compressed = await read(dataOffset, entry.compressedSize);
      const bytes = entry.method === 0 ? compressed : await inflateBounded(compressed, entry.size);
      if (bytes.length !== entry.size || crc32(bytes) !== entry.crc) {
        throw new PackageZipError('integrity');
      }
      return bytes;
    },
  };
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function decodePath(bytes: Uint8Array, flags: number): string {
  // Unflagged legacy ZIP names are accepted only when their encoding is unambiguous ASCII.
  if ((flags & 0x800) === 0 && bytes.some((value) => value > 127)) {
    throw new PackageZipError('unsupported');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new PackageZipError('invalid');
  }
}

async function inflateBounded(bytes: Uint8Array, size: number): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes).buffer);
      controller.close();
    },
  });
  const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const output = new Uint8Array(size);
  let offset = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (offset + chunk.value.length > size) throw new PackageZipError('limit');
      output.set(chunk.value, offset);
      offset += chunk.value.length;
    }
    if (offset !== size) throw new PackageZipError('integrity');
    return output;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
