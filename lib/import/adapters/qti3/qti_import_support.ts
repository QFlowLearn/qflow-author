import {
  type QtiAssessmentItem,
  type QtiInteraction,
  qtiValueToIdentifierList,
} from '@longsightgroup/qti3-core';

type QtiResponseDeclaration = QtiAssessmentItem['responseDeclarations'][number];
type QtiResponseProcessing = NonNullable<QtiAssessmentItem['responseProcessing']>;
type QtiResponseCondition = QtiResponseProcessing['conditions'][number];
import type { Draft } from '../../../types/draft.ts';

/** Structured failure for missing or invalid required assessmentItem language metadata. */
export class QtiItemLanguageImportError extends Error {
  readonly code = 'QTI_ITEM_LANGUAGE_INVALID';
  readonly path = 'assessmentItem/@xml:lang';
  constructor(message: string) {
    super(message);
    this.name = 'QtiItemLanguageImportError';
  }
}
import { xmlEscape } from '../../../xml.ts';
import {
  normalizeInputWidthClass,
  parseImportedInteractionVocabulary,
  type QtiInteractionVocabulary,
} from '../../../shared_vocabulary.ts';

export function itemTitle(item: QtiAssessmentItem): string {
  return item.title?.trim() || 'Imported Item';
}

export function importedBase(title: string): { title: string; tags: string[] } {
  return { title, tags: ['imported'] };
}

export function responseDeclarationFor(
  item: QtiAssessmentItem,
  responseIdentifier?: string,
): QtiResponseDeclaration | undefined {
  const id = responseIdentifier ?? 'RESPONSE';
  return item.responseDeclarations.find((decl) => decl.identifier === id) ??
    item.responseDeclarations.find((decl) => decl.identifier.toUpperCase() === 'RESPONSE') ??
    item.responseDeclarations[0];
}

export function correctIdentifiers(
  declaration: QtiResponseDeclaration | undefined,
): string[] {
  if (!declaration) return [];
  return qtiValueToIdentifierList(declaration.correctResponse);
}

export function responseProcessingTemplateXml(
  item: QtiAssessmentItem,
): string | undefined {
  const template = item.responseProcessing?.template?.trim();
  if (!template) return undefined;
  return `<qti-response-processing template="${xmlEscape(template)}"/>`;
}

export function deriveResponseMode(
  processing: QtiResponseProcessing | undefined,
): Draft['responseMode'] {
  const template = (processing?.template ?? '').toLowerCase();
  if (template.includes('map_response')) return 'partial';
  if (template.includes('match_correct')) return 'all_or_nothing';
  if (!processing) return 'custom';
  if (responseProcessingUsesMapResponse(processing)) return 'partial';
  if (responseProcessingUsesMatchCorrect(processing)) return 'all_or_nothing';
  return 'custom';
}

export function attrBool(value: string | undefined): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

export function attrNumber(value: string | undefined): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function attrPositiveInt(value: string | undefined): number | undefined {
  const parsed = attrNumber(value);
  return parsed != null && parsed > 0 ? parsed : undefined;
}

export function sharedVocabularyFromInteraction(
  interaction: QtiInteraction,
): QtiInteractionVocabulary {
  return parseImportedInteractionVocabulary(
    interaction.attributes.class ?? '',
    interaction.attributes as Record<string, string | undefined>,
    interaction.type,
    interaction.attributes.orientation,
  );
}

export function deriveChoiceLabel(identifier: string, index: number): string | undefined {
  const trimmed = identifier.trim();
  if (/^[A-Z]$/.test(trimmed)) return trimmed;
  if (/^\d+$/.test(trimmed)) return trimmed;
  if (trimmed) return trimmed;
  return toLetters(index);
}

function responseProcessingUsesMapResponse(processing: QtiResponseProcessing): boolean {
  return walkResponseRules(processing.rules, (expr) => expr.type === 'mapResponse') ||
    processing.conditions.some((condition: QtiResponseCondition) =>
      conditionBranchUses(condition.thenRules, (expr) => expr.type === 'mapResponse') ||
      condition.elseIfs.some((branch) =>
        conditionBranchUses(branch.rules, (expr) => expr.type === 'mapResponse')
      ) ||
      conditionBranchUses(condition.elseRules, (expr) => expr.type === 'mapResponse')
    );
}

function responseProcessingUsesMatchCorrect(processing: QtiResponseProcessing): boolean {
  return walkResponseRules(processing.rules, (expr) => expr.type === 'matchCorrect') ||
    processing.conditions.some((condition: QtiResponseCondition) =>
      conditionBranchUses(condition.thenRules, (expr) => expr.type === 'matchCorrect') ||
      condition.elseIfs.some((branch) =>
        conditionBranchUses(branch.rules, (expr) => expr.type === 'matchCorrect')
      ) ||
      conditionBranchUses(condition.elseRules, (expr) => expr.type === 'matchCorrect')
    );
}

function conditionBranchUses(
  rules: QtiResponseProcessing['rules'],
  predicate: (expr: { type: string }) => boolean,
): boolean {
  return walkResponseRules(rules, predicate);
}

function walkResponseRules(
  rules: QtiResponseProcessing['rules'],
  predicate: (expr: { type: string }) => boolean,
): boolean {
  for (const rule of rules) {
    if (rule.type === 'setOutcomeValue' || rule.type === 'lookupOutcomeValue') {
      if (expressionUses(rule.expression, predicate)) return true;
      continue;
    }
    if (rule.type === 'responseCondition') {
      if (walkResponseCondition(rule.condition, predicate)) return true;
      continue;
    }
    if (rule.type === 'responseProcessingFragment') {
      if (walkResponseRules(rule.rules, predicate)) return true;
    }
  }
  return false;
}

function walkResponseCondition(
  condition: QtiResponseProcessing['conditions'][number],
  predicate: (expr: { type: string }) => boolean,
): boolean {
  if (condition.ifExpression && expressionUses(condition.ifExpression, predicate)) return true;
  if (conditionBranchUses(condition.thenRules, predicate)) return true;
  for (const branch of condition.elseIfs) {
    if (branch.expression && expressionUses(branch.expression, predicate)) return true;
    if (conditionBranchUses(branch.rules, predicate)) return true;
  }
  if (conditionBranchUses(condition.elseRules, predicate)) return true;
  return false;
}

function expressionUses(
  expression: { type: string; [key: string]: unknown },
  predicate: (expr: { type: string }) => boolean,
): boolean {
  if (predicate(expression)) return true;
  for (const value of Object.values(expression)) {
    if (!value) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry && typeof entry === 'object' && 'type' in entry) {
          if (expressionUses(entry as { type: string }, predicate)) return true;
        }
      }
      continue;
    }
    if (typeof value === 'object' && 'type' in value) {
      if (expressionUses(value as { type: string }, predicate)) return true;
    }
  }
  return false;
}

function toLetters(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export function inputWidthClassFromClassAttr(className?: string): string | undefined {
  const token = (className ?? '')
    .split(/\s+/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('qti-input-width-'));
  return normalizeInputWidthClass(token);
}
/** Draft shape produced by interaction mappers before item-level metadata enrichment. */
export type MappedQtiDraft = Omit<Draft, 'itemLanguage' | 'catalogs' | 'stylesheets'> & {
  readonly type: NonNullable<Draft['type']>;
};
