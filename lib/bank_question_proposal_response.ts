import type {
  BankProposalRequest,
  BankProposalResponse,
  ProposalLevel,
  ProposalVersion,
  ProposedQuestion,
} from './bank_question_proposal.ts';
import { parseLibraryItem } from './question_bank_picker.ts';
import { isCanonicalUuid } from './uuid.ts';

/** Check identities, exact bucket totals and exclusions before a response enters the selection. */
export function parseBankProposalResponse(
  raw: unknown,
  command: BankProposalRequest,
): BankProposalResponse | null {
  if (!record(raw) || raw.mode !== command.mode) return null;
  if (
    raw.kind === 'availability' && command.kind === 'inspect' &&
    exact(raw, ['kind', 'mode', 'versions']) &&
    Array.isArray(raw.versions)
  ) {
    const versions: ProposalVersion[] = [];
    for (const value of raw.versions) {
      const version = parseVersion(value);
      if (!version) return null;
      versions.push(version);
    }
    return new Set(versions.map((v) => v.id)).size === versions.length
      ? { kind: 'availability', mode: command.mode, versions }
      : null;
  }
  if (command.kind === 'inspect') return null;
  const version = parseVersion(raw.version);
  if (
    !version || version.id !== command.versionId ||
    command.counts.some((count) => !version.levels.some((level) => level.id === count.categoryId))
  ) return null;
  const short = command.counts.some((count) =>
    version.levels.some((level) => level.id === count.categoryId && level.available < count.count)
  );
  if (raw.kind === 'shortfall') {
    return exact(raw, ['kind', 'mode', 'version', 'available']) && nonnegative(raw.available) &&
        raw.available < command.counts.reduce((sum, c) => sum + c.count, 0) &&
        raw.available <=
          command.counts.reduce((sum, c) =>
            sum + Math.min(
              c.count,
              version.levels.find((l) => l.id === c.categoryId)?.available ?? 0,
            ), 0)
      ? { kind: 'shortfall', mode: command.mode, version, available: raw.available }
      : null;
  }
  if (
    raw.kind !== 'proposal' || !exact(raw, ['kind', 'mode', 'version', 'items']) ||
    !Array.isArray(raw.items) || short ||
    raw.items.length !== command.counts.reduce((sum, row) => sum + row.count, 0)
  ) return null;
  const items: ProposedQuestion[] = [];
  for (const value of raw.items) {
    if (
      !exact(value, ['question', 'categoryId']) || typeof value.categoryId !== 'string' ||
      !version.levels.some((level) => level.id === value.categoryId)
    ) return null;
    const question = parseLibraryItem(value.question);
    if (!question || command.excludedQuestions.some((item) => item.itemId === question.id)) {
      return null;
    }
    items.push({ question, categoryId: value.categoryId });
  }
  if (
    new Set(items.map((entry) => entry.question.id)).size !== items.length ||
    command.counts.some((count) =>
      items.filter((item) => item.categoryId === count.categoryId).length !== count.count
    )
  ) return null;
  return { kind: 'proposal', mode: command.mode, version, items };
}
function parseVersion(raw: unknown): ProposalVersion | null {
  if (
    !exact(raw, ['id', 'version', 'audience', 'levels', 'unsupported']) ||
    !isCanonicalUuid(raw.id) ||
    !nonnegative(raw.version) || raw.version < 1 || typeof raw.audience !== 'string' ||
    raw.audience.length > 2000 || !Array.isArray(raw.levels) ||
    raw.levels.length > 250 || !nonnegative(raw.unsupported)
  ) return null;
  const levels: ProposalLevel[] = [];
  for (const level of raw.levels) {
    if (
      !exact(level, ['id', 'label', 'available']) || typeof level.id !== 'string' ||
      !level.id.length || level.id.length > 64 || typeof level.label !== 'string' ||
      !level.label.length || level.label.length > 200 || !nonnegative(level.available)
    ) return null;
    levels.push({ id: level.id, label: level.label, available: level.available });
  }
  return new Set(levels.map((v) => v.id)).size === levels.length
    ? {
      id: raw.id,
      version: raw.version,
      audience: raw.audience,
      unsupported: raw.unsupported,
      levels,
    }
    : null;
}
function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}
