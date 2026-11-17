import { useState } from 'preact/hooks';
import Button from '../ui/Button.tsx';
import Input from '../ui/Input.tsx';
import Select from '../ui/Select.tsx';
import Textarea from '../ui/Textarea.tsx';
import { BankField } from './ui.tsx';
import { EnrichmentSection } from './BankEnrichmentLayout.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';
import {
  type EnrichmentCategory,
  type EnrichmentDimension,
  enrichmentVocabulary,
} from '../../lib/services/bank_enrichment_contract.ts';
import {
  type EnrichmentEditorDraft,
  regroupEnrichmentTopic,
  removeEnrichmentCategory,
  updateEnrichmentCategory,
} from '../../lib/bank_enrichment_editor.ts';

/** Vocabulary rows expose names directly and definitions/merge controls on demand. */
export function BankEnrichmentVocabulary(
  props: {
    readonly draft: EnrichmentEditorDraft;
    readonly onChange: (draft: EnrichmentEditorDraft) => void;
    readonly difficultyOnly?: boolean;
    readonly i18n: I18n;
  },
) {
  const { draft, i18n, onChange } = props;
  function add(dimension: EnrichmentDimension, subjectId?: string) {
    const id = `value-${crypto.randomUUID()}`;
    const category = { id, label: '', definition: '' };
    onChange(
      dimension === 'subject'
        ? { ...draft, subjects: [...draft.subjects, category] }
        : dimension === 'difficulty'
        ? { ...draft, difficulty: [...draft.difficulty, category] }
        : { ...draft, topics: [...draft.topics, { ...category, subjectId: subjectId ?? '' }] },
    );
    requestAnimationFrame(() => document.getElementById(`category-${id}`)?.focus());
  }
  function row(category: EnrichmentCategory, dimension: EnrichmentDimension) {
    const topic = draft.topics.find((t) => t.id === category.id);
    if (dimension === 'topic' && !topic) throw new Error('Topic row is missing its subject.');
    const options = enrichmentVocabulary(draft, dimension).filter((c) =>
      c.id !== category.id &&
      (dimension !== 'topic' ||
        draft.topics.find((t) => t.id === c.id)?.subjectId ===
          draft.topics.find((t) => t.id === category.id)?.subjectId)
    );
    return (
      <CategoryRow
        key={category.id}
        category={category}
        dimension={dimension}
        options={options}
        i18n={i18n}
        group={dimension === 'topic' && topic
          ? {
            subjects: draft.subjects,
            value: topic.subjectId,
            onChange: (id) => onChange(regroupEnrichmentTopic(draft, category.id, id)),
          }
          : undefined}
        canRemove={enrichmentVocabulary(draft, dimension).length >
          (dimension === 'difficulty' ? 2 : 1)}
        onEdit={(change) =>
          onChange(updateEnrichmentCategory(draft, dimension, category.id, change))}
        onRemove={(target) => {
          onChange(removeEnrichmentCategory(draft, dimension, category.id, target));
          const next = target ?? options[0]?.id;
          if (next) {
            requestAnimationFrame(() => {
              // Restore a removed control's focus without overriding the user's next focus target.
              if (document.activeElement === document.body) {
                document.getElementById(`category-${next}`)?.focus();
              }
            });
          }
        }}
        onMove={dimension === 'difficulty'
          ? (direction) => {
            const values = [...draft.difficulty],
              index = values.findIndex((v) => v.id === category.id),
              target = index + direction;
            if (target < 0 || target >= values.length) return;
            [values[index], values[target]] = [values[target], values[index]];
            onChange({ ...draft, difficulty: values });
          }
          : undefined}
      />
    );
  }
  if (props.difficultyOnly) {
    return (
      <EnrichmentSection
        title={i18n.t('items.organize.difficulty')}
        description={i18n.t('items.organize.difficultyHelp')}
      >
        <div class='divide-y divide-base-300'>
          {draft.difficulty.map((category) => row(category, 'difficulty'))}
        </div>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          disabled={draft.difficulty.length >= 10}
          onClick={() => add('difficulty')}
        >
          {i18n.t('items.organize.addLevel')}
        </Button>
      </EnrichmentSection>
    );
  }
  return (
    <div class='space-y-6'>
      <EnrichmentSection title={i18n.t('items.organize.subjects')}>
        <div class='divide-y divide-base-300'>
          {draft.subjects.map((category) => row(category, 'subject'))}
        </div>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          disabled={draft.subjects.length >= 50}
          onClick={() => add('subject')}
        >
          {i18n.t('items.organize.addSubject')}
        </Button>
      </EnrichmentSection>
      <EnrichmentSection
        title={i18n.t('items.organize.topics')}
        description={i18n.t('items.organize.topicsHelp')}
      >
        {draft.subjects.map((subject) => (
          <details key={subject.id} open class='border-b border-base-300 pb-3'>
            <summary class='cursor-pointer py-2 font-medium break-words'>
              {subject.label || i18n.t('items.organize.untitledSubject')}{' '}
              <span class='text-sm font-normal text-base-content/75'>
                ({draft.topics.filter((t) => t.subjectId === subject.id).length})
              </span>
            </summary>
            <div class='divide-y divide-base-300'>
              {draft.topics.filter((t) => t.subjectId === subject.id).map((topic) =>
                row(topic, 'topic')
              )}
            </div>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              disabled={draft.topics.length >= 250}
              onClick={() => add('topic', subject.id)}
            >
              {i18n.t('items.organize.addTopic')}
            </Button>
          </details>
        ))}
      </EnrichmentSection>
    </div>
  );
}

function CategoryRow(
  props: {
    readonly category: EnrichmentCategory;
    readonly dimension: EnrichmentDimension;
    readonly options: readonly EnrichmentCategory[];
    readonly i18n: I18n;
    readonly canRemove: boolean;
    readonly onEdit: (change: { label?: string; definition?: string }) => void;
    readonly onRemove: (target: string | null) => void;
    readonly onMove?: (direction: -1 | 1) => void;
    readonly group?: {
      readonly subjects: readonly EnrichmentCategory[];
      readonly value: string;
      readonly onChange: (id: string) => void;
    };
  },
) {
  const [target, setTarget] = useState('');
  const { category, i18n } = props;
  const definitionField = (
    <BankField label={i18n.t('items.organize.definition')}>
      <Textarea
        name={`definition-${category.id}`}
        rows={2}
        maxLength={1000}
        value={category.definition}
        onInput={(event) => props.onEdit({ definition: event.currentTarget.value })}
      />
    </BankField>
  );
  return (
    <div data-category={category.id} class='py-3 space-y-2'>
      <div
        class={props.dimension === 'difficulty'
          ? 'grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-start'
          : 'flex flex-wrap items-end gap-2'}
      >
        <BankField label={i18n.t('items.organize.label')} class='min-w-40 flex-1'>
          <Input
            id={`category-${category.id}`}
            name={`label-${category.id}`}
            maxLength={80}
            value={category.label}
            onInput={(event) => props.onEdit({ label: event.currentTarget.value })}
          />
        </BankField>
        {props.dimension === 'difficulty' && definitionField}
        {props.onMove && (
          <div class='flex gap-1'>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              aria-label={i18n.t('items.organize.moveEarlier', { label: category.label })}
              onClick={() => props.onMove?.(-1)}
            >
              ↑
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              aria-label={i18n.t('items.organize.moveLater', { label: category.label })}
              onClick={() => props.onMove?.(1)}
            >
              ↓
            </Button>
          </div>
        )}
      </div>
      <details open={category.definition.length === 0 && props.dimension !== 'difficulty'}>
        <summary class='cursor-pointer py-1 text-sm text-base-content/80'>
          {i18n.t(
            props.dimension === 'difficulty'
              ? 'items.organize.levelOptions'
              : 'items.organize.definitionOptions',
          )}
        </summary>
        <div class='mt-2 space-y-3'>
          {props.group && (
            <BankField label={i18n.t('items.organize.subject')}>
              <Select
                name={`parent-${category.id}`}
                value={props.group.value}
                onChange={(event) => props.group?.onChange(event.currentTarget.value)}
              >
                {props.group.subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>{subject.label}</option>
                ))}
              </Select>
            </BankField>
          )}
          {props.dimension !== 'difficulty' && definitionField}
          <div class='flex flex-wrap items-end gap-2'>
            {props.options.length > 0 && (
              <>
                <BankField label={i18n.t('items.organize.mergeInto')} class='min-w-40 flex-1'>
                  <Select
                    name={`merge-${category.id}`}
                    value={target}
                    onChange={(event) => setTarget(event.currentTarget.value)}
                  >
                    <option value=''>{i18n.t('items.organize.choose')}</option>
                    {props.options.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </Select>
                </BankField>
                <Button
                  type='button'
                  size='sm'
                  disabled={!target || !props.canRemove}
                  onClick={() => props.onRemove(target)}
                >
                  {i18n.t('items.organize.merge')}
                </Button>
              </>
            )}
            <Button
              type='button'
              variant='danger-ghost'
              size='sm'
              disabled={!props.canRemove}
              onClick={() => props.onRemove(null)}
            >
              {i18n.t('items.organize.remove')}
            </Button>
          </div>
        </div>
      </details>
    </div>
  );
}
