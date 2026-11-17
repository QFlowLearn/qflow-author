import { zlibSync } from 'fflate';

/** Build valid PDFs with compressed content streams for extraction tests in Deno and workerd. */
export function pdfFixture(
  pages: readonly { readonly text?: string; readonly image?: boolean }[],
): Uint8Array {
  const encode = (text: string) => new TextEncoder().encode(text);
  const objects: Uint8Array[] = [];
  const pageIds = pages.map((_, index) => 5 + index * 2);
  objects.push(encode('<< /Type /Catalog /Pages 2 0 R >>'));
  objects.push(
    encode(
      `<< /Type /Pages /Count ${pages.length} /Kids [${
        pageIds.map((id) => `${id} 0 R`).join(' ')
      }] >>`,
    ),
  );
  objects.push(encode('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'));
  objects.push(
    stream(
      ' /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8',
      new Uint8Array([0, 0, 0]),
    ),
  );
  for (const [index, page] of pages.entries()) {
    const id = pageIds[index];
    if (id === undefined) throw new Error('PDF fixture page ID is missing.');
    objects.push(
      encode(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> /Contents ${
          id + 1
        } 0 R >>`,
      ),
    );
    const literal = page.text?.replace(/[\\()]/g, '\\$&');
    const commands = [
      literal === undefined ? '' : `BT /F1 12 Tf 72 720 Td (${literal}) Tj ET`,
      page.image ? 'q 400 0 0 600 72 72 cm /Im1 Do Q' : '',
    ].join('\n');
    objects.push(stream('', encode(commands)));
  }
  const parts: Uint8Array[] = [encode('%PDF-1.7\n')];
  const offsets = [0];
  let length = parts[0]?.length ?? 0;
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const part = concatenate([encode(`${index + 1} 0 obj\n`), object, encode('\nendobj\n')]);
    parts.push(part);
    length += part.length;
  }
  parts.push(
    encode(
      `xref\n0 ${offsets.length}\n0000000000 65535 f \n${
        offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
      }trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  );
  return concatenate(parts);
}

function stream(dictionary: string, bytes: Uint8Array): Uint8Array {
  const compressed = zlibSync(bytes);
  const encode = (text: string) => new TextEncoder().encode(text);
  return concatenate([
    encode(`<< /Length ${compressed.length} /Filter /FlateDecode${dictionary} >>\nstream\n`),
    compressed,
    encode('\nendstream'),
  ]);
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
