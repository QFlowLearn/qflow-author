import { parse, type ParseError } from 'jsonc-parser';

/** Parse configuration as unknown and reject syntax errors rather than accepting partial output. */
export function parseJsonc(source: string): unknown {
  const errors: ParseError[] = [];
  const value: unknown = parse(source, errors, { allowTrailingComma: true });
  if (errors.length) throw new Error('Invalid JSONC configuration.');
  return value;
}
