import * as _fs from 'node:fs/promises';
const QTI_FIXTURE_DIR = 'tests/fixtures/qti3';

/** Read one required QTI fixture from the tracked test corpus. */
export async function readQtiFixture(filename: string): Promise<string> {
  return await _fs.readFile(`${QTI_FIXTURE_DIR}/${filename}`, 'utf8');
}
