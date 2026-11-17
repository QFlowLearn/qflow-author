import { expect } from 'vitest';

import { validateQtiXml } from '../lib/qti_validate.ts';

/** Assert that generated QTI is well-formed XML, with optional caller context. */
export async function assertQtiXmlWellFormed(xml: string, context?: string): Promise<void> {
  const result = await validateQtiXml(xml);
  const detail = JSON.stringify(result.errors, null, 2);
  expect(result.ok, context ? `${context}: ${detail}` : detail).toStrictEqual(true);
}
