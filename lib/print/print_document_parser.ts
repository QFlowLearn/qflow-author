import { parseInterfaceLocale } from '../i18n/locale.ts';
import type { PaperDocument } from './print_projection.ts';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, fields: string): boolean {
  const expected = fields.split(' ');
  return Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key));
}
function oneOf(value: unknown, values: readonly string[]): boolean {
  return typeof value === 'string' && values.includes(value);
}
function integer(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum &&
    value <= maximum;
}

/** Parse the private RPC document; reject extra staff fields, executable source and unbounded trees. */
export function parsePaperDocument(input: unknown): PaperDocument | null {
  let nodes = 0, characters = 0, binaryBytes = 0;
  const text = (value: unknown): value is string => {
    if (typeof value !== 'string') return false;
    characters += value.length;
    return characters <= 2000000;
  };
  const visit = (depth: number) => depth <= 32 && ++nodes <= 20000;
  function math(value: unknown, depth: number): boolean {
    if (!visit(depth) || !record(value)) return false;
    if (oneOf(value.kind, ['identifier', 'number', 'operator'])) {
      return keys(value, 'kind value') && text(value.value);
    }
    if (value.kind === 'row') {
      return keys(value, 'kind children') && Array.isArray(value.children) &&
        value.children.every((child) => math(child, depth + 1));
    }
    if (value.kind === 'sqrt') return keys(value, 'kind body') && math(value.body, depth + 1);
    return oneOf(value.kind, ['sup', 'sub', 'fraction']) && keys(value, 'kind left right') &&
      math(value.left, depth + 1) && math(value.right, depth + 1);
  }
  function content(values: unknown, depth = 0): boolean {
    return Array.isArray(values) && values.length <= 20000 && values.every((value) => {
      if (!visit(depth) || !record(value)) return false;
      if (value.kind === 'text') return keys(value, 'kind text') && text(value.text);
      if (value.kind === 'break') return keys(value, 'kind');
      if (value.kind === 'response') {
        return keys(value, 'kind prompt') && content(value.prompt, depth + 1);
      }
      if (!text(value.language)) return false;
      if (value.kind === 'math') {
        return keys(value, 'kind expression block language') && typeof value.block === 'boolean' &&
          math(value.expression, depth + 1);
      }
      if (value.kind === 'image') {
        return keys(value, 'kind asset alt language') && integer(value.asset, 0, imageCount - 1) &&
          text(value.alt);
      }
      return oneOf(value.kind, [
        'paragraph',
        'strong',
        'emphasis',
        'list',
        'ordered-list',
        'list-item',
        'quote',
        'group',
      ]) && keys(value, 'kind children language') && content(value.children, depth + 1);
    });
  }
  let imageCount = 0;
  function valid(value: unknown): value is PaperDocument {
    if (
      !record(value) ||
      !keys(value, 'kind title form createdAt paper locale instructions labels images parts') ||
      !oneOf(value.kind, ['student', 'marking']) || !oneOf(value.paper, ['a4', 'us-letter']) ||
      !parseInterfaceLocale(value.locale) ||
      !['title', 'form', 'createdAt', 'instructions'].every((key) => text(value[key])) ||
      typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) ||
      !record(value.labels) ||
      !keys(value.labels, 'document question response marking continued') ||
      !Object.values(value.labels).every(text) || !Array.isArray(value.images) ||
      value.images.length > 8
    ) return false;
    imageCount = value.images.length;
    if (
      !value.images.every((image) => {
        if (
          !record(image) || !keys(image, 'bytes format') || !(image.bytes instanceof Uint8Array) ||
          !oneOf(image.format, ['png', 'jpeg'])
        ) return false;
        binaryBytes += image.bytes.length;
        return binaryBytes <= 500000;
      })
    ) return false;
    return Array.isArray(value.parts) && value.parts.length <= 100 && value.parts.every((part) => {
      if (
        !record(part) || !keys(part, 'title instructions entries') || !text(part.title) ||
        !content(part.instructions) || !Array.isArray(part.entries) || part.entries.length > 300
      ) return false;
      return part.entries.every((entry) => {
        if (!visit(0) || !record(entry)) return false;
        if (entry.kind === 'content') return keys(entry, 'kind content') && content(entry.content);
        const fields = 'kind number language content choices responseLines selection';
        if (
          entry.kind !== 'question' ||
          !keys(entry, fields + (value.kind === 'marking' ? ' marking' : '')) ||
          !integer(entry.number, 1, 100) || !text(entry.language) || !content(entry.content) ||
          !integer(entry.responseLines, 0, 18) || !text(entry.selection) ||
          !Array.isArray(entry.choices) || entry.choices.length > 1000 ||
          !entry.choices.every((choice) =>
            record(choice) && keys(choice, 'label content') && text(choice.label) &&
            content(choice.content)
          )
        ) return false;
        if (value.kind === 'student') return true;
        return record(entry.marking) && keys(entry.marking, 'rules guidance') &&
          Array.isArray(entry.marking.rules) && entry.marking.rules.length <= 2000 &&
          entry.marking.rules.every(text) && content(entry.marking.guidance);
      });
    });
  }
  return valid(input) ? input : null;
}
