import { DOMParser as XmldomParser } from '@xmldom/xmldom';
import { normalizeXmlForParsing } from './xml.ts';

export type QtiValidationError = { line: number; col: number; message: string };
export type QtiValidationResult = { ok: boolean; errors: QtiValidationError[] };

/**
 * Runtime-safe QTI XML validation.
 *
 * This intentionally checks XML well-formedness only. Strict XSD/DTD validation stays in
 * `tools/validate.ts`, where filesystem and xmllint access are expected operator tooling.
 */
export function validateQtiXml(xml: string): Promise<QtiValidationResult> {
  return Promise.resolve(validateXmlWellFormed(xml));
}

function validateXmlWellFormed(xml: string): QtiValidationResult {
  try {
    const errors: string[] = [];
    const parser = new XmldomParser({
      errorHandler: {
        warning: (message: string) => errors.push(message),
        error: (message: string) => errors.push(message),
        fatalError: (message: string) => errors.push(message),
      },
    });
    const doc = (parser as unknown as {
      parseFromString(source: string, mimeType: string): Document;
    }).parseFromString(normalizeXmlForParsing(xml), 'text/xml');
    if (errors.length) return validationError(errors[0]);
    if (!doc.documentElement) return validationError('XML document is empty.');
    return { ok: true, errors: [] };
  } catch (error) {
    return validationError(error instanceof Error ? error.message : String(error));
  }
}

function validationError(message: string): QtiValidationResult {
  return { ok: false, errors: [{ line: 0, col: 0, message }] };
}
