import { test as testCase } from 'vitest';
import { writeZip } from '../lib/zip.ts';

testCase('writeZip produces valid PK signatures', async () => {
  const files = [
    { name: 'a.txt', data: new TextEncoder().encode('hello') },
    { name: 'b/b.txt', data: new TextEncoder().encode('world') },
  ];
  const zip = await writeZip(files);
  // Local file header signature
  const sig = new DataView(zip.buffer, zip.byteOffset, zip.byteLength).getUint32(0, true);
  if (sig !== 0x04034b50) throw new Error('missing local header signature');
  // End of central directory signature at the end
  const tail = new DataView(zip.buffer, zip.byteOffset + zip.byteLength - 22, 22);
  const endSig = tail.getUint32(0, true);
  if (endSig !== 0x06054b50) throw new Error('missing end of central directory');
});
