import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js';

const ZIP_WRITER_OPTIONS = { useWebWorkers: false } as const;

export type ZipEntry = { name: string; data: Uint8Array; date?: Date };

export async function writeZip(entries: ZipEntry[]): Promise<Uint8Array> {
  const writer = new Uint8ArrayWriter();
  const zip = new ZipWriter(writer, ZIP_WRITER_OPTIONS);
  for (const entry of entries) {
    await zip.add(entry.name, new Uint8ArrayReader(entry.data), {
      lastModDate: entry.date,
    });
  }
  return await zip.close();
}
