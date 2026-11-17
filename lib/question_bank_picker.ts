import { isQuestionTypeId, type QuestionTypeId } from './types/registry.ts';
import { isCanonicalUuid } from './uuid.ts';
import type { EnrichmentQuestionsView } from './services/bank_enrichment_browse_contract.ts';
import { parseEnrichmentQuestionsView } from './bank_enrichment_browse_response.ts';

export type LibraryItem = {
  readonly id: string;
  readonly title: string;
  readonly excerpt: string;
  readonly tags: readonly string[];
  readonly latestRev: number;
  readonly updatedAt: string;
  readonly type: QuestionTypeId;
};
export type LibrarySearch = {
  readonly items: LibraryItem[];
  readonly hasMore: boolean;
  readonly total: number;
  readonly collections: readonly { readonly id: string; readonly name: string }[];
  readonly enrichment: EnrichmentQuestionsView;
};

/** Strictly parse the item-search response before it reaches the picker. */
export function parseLibrarySearchResponse(input: unknown): LibrarySearch | null {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ['items', 'hasMore', 'total', 'collections', 'enrichment']) ||
    !Array.isArray(input.items) || input.items.length > 50
  ) return null;
  if (
    typeof input.hasMore !== 'boolean' || typeof input.total !== 'number' ||
    !Number.isSafeInteger(input.total) || input.total < 0
  ) return null;
  const items: LibraryItem[] = [];
  for (const raw of input.items) {
    const item = parseLibraryItem(raw);
    if (!item) return null;
    items.push(item);
  }
  if (new Set(items.map((item) => item.id)).size !== items.length || input.total < items.length) {
    return null;
  }
  const enrichment = parseEnrichmentQuestionsView(input.enrichment, items.map((item) => item.id));
  if (!enrichment || !Array.isArray(input.collections)) return null;
  const collections: LibrarySearch['collections'][number][] = [];
  for (const raw of input.collections) {
    if (
      !isRecord(raw) || !hasExactKeys(raw, ['id', 'name']) || !isCanonicalUuid(raw.id) ||
      typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 160
    ) return null;
    collections.push({ id: raw.id, name: raw.name });
  }
  if (new Set(collections.map((c) => c.id)).size !== collections.length) return null;
  return { items, hasMore: input.hasMore, total: input.total, collections, enrichment };
}
function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  const actual = Object.keys(record);
  return actual.length === keys.length && actual.every((key) => allowed.has(key));
}

/** Parse the shared question summary used by search results and proposals. */
export function parseLibraryItem(raw: unknown): LibraryItem | null {
  if (
    !isRecord(raw) ||
    !hasExactKeys(raw, ['id', 'title', 'excerpt', 'tags', 'latestRev', 'updatedAt', 'type'])
  ) return null;
  if (
    typeof raw.id !== 'string' || !isCanonicalUuid(raw.id) ||
    typeof raw.title !== 'string' || raw.title.length > 2000 ||
    typeof raw.excerpt !== 'string' || raw.excerpt.length > 240 ||
    typeof raw.latestRev !== 'number' || !Number.isSafeInteger(raw.latestRev) || raw.latestRev < 1
  ) return null;
  if (
    !Array.isArray(raw.tags) || raw.tags.length > 100 ||
    raw.tags.some((tag) => typeof tag !== 'string' || tag.length > 200)
  ) return null;
  if (
    typeof raw.updatedAt !== 'string' || Number.isNaN(Date.parse(raw.updatedAt)) ||
    new Date(raw.updatedAt).toISOString() !== raw.updatedAt
  ) return null;
  if (typeof raw.type !== 'string' || !isQuestionTypeId(raw.type)) return null;
  return {
    id: raw.id,
    title: raw.title,
    excerpt: raw.excerpt,
    tags: raw.tags,
    latestRev: raw.latestRev,
    updatedAt: raw.updatedAt,
    type: raw.type,
  };
}
