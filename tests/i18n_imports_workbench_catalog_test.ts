import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';

import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { QUESTION_TYPE_IDS } from '../lib/types/registry.ts';
import {
  BLUEPRINT_COGNITIVE_DEMANDS,
  BLUEPRINT_DIFFICULTIES,
} from '../lib/assessment_blueprint.ts';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];

testCase('conversion workbench catalog covers typed values and true percent ratios', () => {
  for (const locale of locales) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    for (const type of QUESTION_TYPE_IDS) {
      const label = i18n.t('imports.blueprint.typeLabel', { type });
      if (!(label.length > 0)) expect.unreachable('Expected label.length > 0');
    }
    for (const demand of BLUEPRINT_COGNITIVE_DEMANDS) {
      if (!(i18n.t('imports.blueprint.demandLabel', { value: demand }).length > 0)) {
        expect.unreachable(
          "Expected i18n.t('imports.blueprint.demandLabel', { value: demand }).length > 0",
        );
      }
    }
    for (const difficulty of BLUEPRINT_DIFFICULTIES) {
      if (!(i18n.t('imports.blueprint.difficultyLabel', { value: difficulty }).length > 0)) {
        expect.unreachable(
          "Expected i18n.t('imports.blueprint.difficultyLabel', { value: difficulty }).length > 0",
        );
      }
    }
    if (
      !(i18n.t('imports.blueprint.targetSummary', {
        type: 'Single select',
        demand: 'Understand',
        difficulty: 'Medium',
        count: 1,
      }).includes(locale.startsWith('es-') ? '1 pregunta' : '1 question'))
    ) {
      expect.unreachable(
        "Expected i18n.t('imports.blueprint.targetSummary', { type: 'Single select', demand: 'Understand', d",
      );
    }
    if (
      !(i18n.t('imports.blueprint.targetSummary', {
        type: 'Single select',
        demand: 'Understand',
        difficulty: 'Medium',
        count: 2,
      }).includes(locale.startsWith('es-') ? '2 preguntas' : '2 questions'))
    ) {
      expect.unreachable(
        "Expected i18n.t('imports.blueprint.targetSummary', { type: 'Single select', demand: 'Understand', d",
      );
    }
    const policy = i18n.t('imports.generation.policy');
    if (
      !(policy.includes(locale.startsWith('es-') ? 'proveedor de IA' : 'configured AI provider'))
    ) {
      expect.unreachable(
        "Expected policy.includes(locale.startsWith('es-') ? 'proveedor de IA' : 'configured AI provider')",
      );
    }
    if (!(policy.includes(locale.startsWith('es-') ? 'recuperación' : 'Recovery'))) {
      expect.unreachable(
        "Expected policy.includes(locale.startsWith('es-') ? 'recuperación' : 'Recovery')",
      );
    }
    if (!(policy.includes(locale.startsWith('es-') ? 'no envían' : 'do not send'))) {
      expect.unreachable(
        "Expected policy.includes(locale.startsWith('es-') ? 'no envían' : 'do not send')",
      );
    }
    expect(i18n.t('imports.blueprint.demandLabel', { value: 'analyze' })).toStrictEqual(
      locale === 'en-GB' ? 'Analyse' : locale === 'en-US' ? 'Analyze' : 'Analizar',
    );
    expect(i18n.t('imports.blueprint.typeLabel', { type: 'portable_custom' })).toStrictEqual(
      locale.startsWith('es-') ? 'Personalizada portátil' : 'Portable custom',
    );
    expect(i18n.t('imports.blueprint.removeTarget', { index: 12 })).toStrictEqual(
      locale.startsWith('es-') ? 'Eliminar objetivo de pregunta 12' : 'Remove question target 12',
    );
    const deterministicMessages: string[] = [];
    for (
      const id of [
        'imports.suggestion.ambiguous_stem.multiple_questions',
        'imports.suggestion.ambiguous_stem.short',
        'imports.suggestion.duplicate_options.normalized_text',
        'imports.suggestion.clueing.correct_option_length',
        'imports.suggestion.clueing.answer_repeated_in_stem',
        'imports.suggestion.answer_key.conflicting_choice_keys',
        'imports.suggestion.answer_key.single_select_reference',
        'imports.suggestion.answer_key.multi_select_reference',
        'imports.suggestion.answer_key.text_entry_empty',
        'imports.suggestion.alignment.blueprint_target_missing',
        'imports.suggestion.alignment.question_type_mismatch',
      ]
    ) {
      const message = id.endsWith('question_type_mismatch')
        ? i18n.t(id, { expectedType: 'Single select', actualType: 'Text entry' })
        : id.endsWith('.ai')
        ? i18n.t(id, { message: 'AUTHORED-AI-SUGGESTION' })
        : i18n.t(id);
      if (!(message.length > 0)) expect.unreachable('Expected message.length > 0');
      if (message.includes(id)) expect.unreachable('Expected !message.includes(id)');
      if (message.includes('Review this deterministic suggestion')) {
        expect.unreachable("Expected !message.includes('Review this deterministic suggestion')");
      }
      deterministicMessages.push(message);
    }
    for (
      const id of [
        'imports.suggestion.accessibility.missing_alt_text',
        'imports.suggestion.accessibility.invalid_data_ssml',
        'imports.suggestion.accessibility.unsupported_a11y_markup',
        'imports.suggestion.accessibility.color_only_instruction',
        'imports.suggestion.accessibility.missing_media_label',
        'imports.suggestion.accessibility.missing_captions',
        'imports.suggestion.accessibility.missing_transcript',
      ]
    ) {
      const message = i18n.t(id);
      if (!(message.length > 0)) expect.unreachable('Expected message.length > 0');
      if (message.includes(id)) expect.unreachable('Expected !message.includes(id)');
      if (message.includes('Review this deterministic suggestion')) {
        expect.unreachable("Expected !message.includes('Review this deterministic suggestion')");
      }
      deterministicMessages.push(message);
    }
    expect(new Set(deterministicMessages).size).toStrictEqual(deterministicMessages.length);
    const unknown = i18n.t('imports.suggestion.unknown');
    if (!(unknown.length > 0)) expect.unreachable('Expected unknown.length > 0');
    if (unknown.includes('unknown_deterministic_code')) {
      expect.unreachable("Expected !unknown.includes('unknown_deterministic_code')");
    }
    if (unknown.includes('imports.suggestion.unknown')) {
      expect.unreachable("Expected !unknown.includes('imports.suggestion.unknown')");
    }
    const ai = i18n.t('imports.suggestion.ai', { message: 'AUTHORED-AI-SUGGESTION' });
    if (!(ai.includes('AUTHORED-AI-SUGGESTION'))) {
      expect.unreachable("Expected ai.includes('AUTHORED-AI-SUGGESTION')");
    }
    if (ai.includes('imports.suggestion.ai')) {
      expect.unreachable("Expected !ai.includes('imports.suggestion.ai')");
    }
    expect(i18n.t('imports.report.reviewerPresent', { reviewer: 'none' })).toStrictEqual(
      locale.startsWith('es-') ? 'Revisor: none' : 'Reviewer: none',
    );
    expect(i18n.t('imports.report.reviewerAbsent')).toStrictEqual(
      locale.startsWith('es-') ? 'No hay revisor asignado.' : 'No reviewer assigned.',
    );
    for (
      const id of [
        'imports.feedback.notFound',
        'imports.feedback.invalidAction',
        'imports.feedback.retryFailed',
        'imports.feedback.alignmentFailed',
        'imports.feedback.preparationInvalidated',
        'imports.feedback.approvalUpdateFailed',
        'imports.feedback.bulkUpdateFailed',
        'imports.feedback.questionUpdateFailed',
        'imports.feedback.commitFailed',
        'imports.feedback.generateFailed',
      ]
    ) if (!(i18n.t(id).length > 0)) expect.unreachable('Expected i18n.t(id).length > 0');
    for (
      const id of [
        'imports.report.commitHelp',
        'imports.report.emptyGenerateHelp',
        'imports.report.emptyRecoverHelp',
        'imports.report.acceptBeforeCommit',
        'imports.report.reviewEvidenceConfirmation',
        'imports.report.approvalIncomplete',
        'imports.report.approvalWaiting',
        'imports.report.approvalConfirmEvidence',
        'imports.report.changesNeeded',
        'imports.report.approvalApprovedSuccess',
        'imports.report.approvalDraft',
        'imports.report.approvalSubmitted',
        'imports.report.approvalApproved',
        'imports.report.approvalChangesRequested',
        'imports.report.sourcePackageFallback',
        'imports.report.extractionUncertainty',
        'imports.report.defineBlueprintBeforeAlign',
        'imports.report.suggestionsHelp',
        'imports.report.previewIssues',
        'imports.report.previewRecovery',
      ]
    ) {
      if (!(i18n.t(id).length > 0)) expect.unreachable('Expected i18n.t(id).length > 0');
    }
  }
  expect(
    createI18n('en-US', catalogForLocale('en-US')).t('imports.generation.progress', { value: 0.5 }),
  ).toStrictEqual('Generating questions… 50%');
  expect(
    createI18n('es-ES', catalogForLocale('es-ES')).t('imports.generation.progress', { value: 0.5 }),
  ).toStrictEqual('Generando preguntas… 50 %');
});

testCase('conversion workbench catalog has no duplicate raw JSON properties', async () => {
  const paths = [
    ...locales.map((locale) =>
      new URL(
        '../lib/i18n/messages/' + locale + '/imports.json',
        import.meta.url,
      )
    ),
    new URL('../lib/i18n/message_context.json', import.meta.url),
  ];
  for (const path of paths) {
    const source = await _fs.readFile(path, 'utf8');
    expect(duplicatePropertyNames(source), path.pathname).toStrictEqual([]);
  }
});

testCase('duplicate detector rejects nested object properties', () => {
  expect(duplicatePropertyNames('{"outer":{"duplicate":1,"duplicate":2}}')).toStrictEqual([
    'duplicate',
  ]);
});

function duplicatePropertyNames(source: string): string[] {
  const scopes: Array<Set<string> | null> = [];
  const duplicates: string[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '{') {
      scopes.push(new Set());
      index++;
      continue;
    }
    if (character === '[') {
      scopes.push(null);
      index++;
      continue;
    }
    if (character === '}' || character === ']') {
      scopes.pop();
      index++;
      continue;
    }
    if (character !== '"') {
      index++;
      continue;
    }
    index++;
    let value = '';
    while (index < source.length) {
      const current = source[index++];
      if (current === '\\') {
        value += current + (source[index++] ?? '');
      } else if (current === '"') {
        break;
      } else {
        value += current;
      }
    }
    while (/\s/.test(source[index] ?? '')) index++;
    if (source[index] === ':' && scopes.at(-1)) {
      const scope = scopes.at(-1);
      if (scope?.has(value)) duplicates.push(value);
      scope?.add(value);
    }
  }
  return duplicates;
}
