import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import Button from '../../components/ui/Button.tsx';
import Input from '../../components/ui/Input.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';
import type { QuestionTypeId } from '../../lib/types/registry.ts';
import {
  AUTHORABLE_QUESTION_TYPE_IDS,
  AUTHORABLE_QUESTION_TYPES,
} from '../../lib/authoring/question_type_catalog.ts';

const TYPE_CATEGORIES: Array<{ id: string; types: QuestionTypeId[] }> = [
  { id: 'choice', types: ['single_select', 'multi_select', 'inline_choice'] },
  { id: 'text', types: ['text_entry', 'extended_text'] },
  {
    id: 'matching',
    types: ['match', 'associate', 'gap_match', 'graphic_gap_match', 'graphic_associate'],
  },
  {
    id: 'interactive',
    types: [
      'hotspot',
      'hottext',
      'drawing',
      'order',
      'graphic_order',
      'position_object',
      'select_point',
      'slider',
    ],
  },
  { id: 'media', types: ['media', 'upload'] },
  { id: 'advanced', types: ['portable_custom'] },
];

export default function QuestionTypePicker({
  search,
  onSearchChange,
  onStartAuthoring,
  onStartText,
  lastType,
  compact = false,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  onStartAuthoring: (type: QuestionTypeId) => void;
  lastType: QuestionTypeId | null;
  onStartText?: () => void;
  compact?: boolean;
}) {
  const i18n = useI18n();
  const [activeIdx, setActiveIdx] = useState(0);
  const typePickerRef = useRef<HTMLDivElement | null>(null);
  const visibleCategories = buildVisibleCategories(search, i18n);
  const visibleTypeIds = visibleCategories.flatMap((cat) => cat.types);

  useEffect(() => {
    setActiveIdx(0);
  }, [search]);

  function focusOption(index: number) {
    const root = typePickerRef.current;
    const nodes = root ? Array.from(root.querySelectorAll<HTMLElement>('[data-type-option]')) : [];
    nodes[index]?.focus();
  }

  function handleKeyDown(e: JSX.TargetedKeyboardEvent<HTMLDivElement>) {
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
    if (
      tag === 'input' || tag === 'textarea' ||
      (e.target as HTMLElement)?.closest('[data-text-authoring]')
    ) return;
    if ((e.target as HTMLElement)?.hasAttribute('data-type-option') && e.key === 'Enter') return;
    if (visibleTypeIds.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const nextIdx = (activeIdx + dir + visibleTypeIds.length) % visibleTypeIds.length;
      setActiveIdx(nextIdx);
      focusOption(nextIdx);
      return;
    }
    if (e.key === 'Enter') {
      const next = visibleTypeIds[activeIdx];
      if (next) onStartAuthoring(next);
    }
  }

  return (
    <div
      class='space-y-4'
      ref={typePickerRef}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {onStartText && (
        <Button data-text-authoring type='button' variant='primary' onClick={onStartText}>
          {i18n.t('editor.assistance.title')}
        </Button>
      )}
      <div class='flex flex-wrap items-center gap-2'>
        <div class='min-w-[240px] flex-1'>
          <label
            class='block text-sm font-medium text-base-content'
            for='assessment-question-type-search'
          >
            {i18n.t('assessments.builder.questionTypeSearchLabel')}
          </label>
          <Input
            id='assessment-question-type-search'
            value={search}
            onInput={(e) => onSearchChange((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowDown') return;
              focusOption(0);
              e.preventDefault();
            }}
            placeholder={i18n.t('assessments.builder.questionTypeSearch')}
            data-focus-type-search='true'
          />
        </div>
        {search.trim() && (
          <Button
            type='button'
            size='sm'
            variant='ghost'
            onClick={() => onSearchChange('')}
          >
            {i18n.t('assessments.builder.clearSearch')}
          </Button>
        )}
      </div>
      <div class='text-xs text-base-content/60'>
        {i18n.t('assessments.builder.questionTypeAvailable', { count: visibleTypeIds.length })}
      </div>
      {visibleTypeIds.length === 0 && (
        <div class='rounded-lg border border-dashed border-base-300 px-4 py-6 text-sm text-base-content/60'>
          {i18n.t('assessments.builder.questionTypeNoMatches')}
        </div>
      )}
      {visibleTypeIds.length > 0 && (
        <div class={compact ? 'space-y-3' : 'grid gap-4 lg:grid-cols-2'}>
          {visibleCategories.map((category) => (
            <div key={category.id} class='space-y-2'>
              <div class='text-xs font-medium uppercase tracking-wide text-base-content/60'>
                {i18n.t(`assessments.builder.category.${category.id}`)}
              </div>
              <div class='space-y-1'>
                {category.types.map((typeId) => {
                  const isActive = visibleTypeIds[activeIdx] === typeId;
                  const description = i18n.t(
                    `assessments.builder.questionTypeDescription.${typeId}`,
                  );
                  return (
                    <Button
                      key={typeId}
                      type='button'
                      variant='ghost'
                      size='sm'
                      class={`h-auto min-h-0 w-full items-start justify-start gap-3 py-2 text-left normal-case ${
                        isActive ? 'bg-primary/10' : ''
                      }`}
                      data-type-option='true'
                      title={compact ? description : undefined}
                      onClick={() => onStartAuthoring(typeId)}
                    >
                      <span class='flex min-w-0 flex-col items-start gap-0.5'>
                        <span class='text-sm font-medium whitespace-normal leading-snug'>
                          {i18n.t('assessments.builder.questionTypeLabel', { type: typeId })}
                        </span>
                        {!compact && description && (
                          <span class='text-xs text-base-content/60 whitespace-normal leading-snug'>
                            {description}
                          </span>
                        )}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {lastType && (
        <div class='text-xs text-base-content/70'>
          {i18n.t('assessments.builder.lastUsed', {
            type: i18n.t('assessments.builder.questionTypeLabel', { type: lastType }),
          })}
        </div>
      )}
    </div>
  );
}

function buildVisibleCategories(search: string, i18n: ReturnType<typeof useI18n>) {
  const normalizedSearch = search.trim().toLowerCase();
  const filteredTypeIds = AUTHORABLE_QUESTION_TYPES
    .filter((t) => {
      if (!normalizedSearch) return true;
      const label = i18n.t('assessments.builder.questionTypeLabel', { type: t.id }).toLowerCase();
      const description = i18n.t(
        `assessments.builder.questionTypeDescription.${t.id}`,
      ).toLowerCase();
      const slug = t.id.replace(/_/g, ' ');
      return label.includes(normalizedSearch) || description.includes(normalizedSearch) ||
        slug.includes(normalizedSearch);
    })
    .map((t) => t.id);
  const filteredTypeSet = new Set(filteredTypeIds);
  return TYPE_CATEGORIES
    .map((cat) => ({
      ...cat,
      types: cat.types.filter((id) =>
        AUTHORABLE_QUESTION_TYPE_IDS.has(id) && filteredTypeSet.has(id)
      ),
    }))
    .filter((cat) => cat.types.length > 0);
}
