import { useDomId } from '../../lib/rendering/island_context.tsx';
import { type ComponentChildren, Fragment } from 'preact';

import SettingsSection from '../../components/ui/SettingsSection.tsx';
import type { RightRailSection } from '../drivers/right_rail/types.ts';
import Button from '../../components/ui/Button.tsx';
import Input, { FieldIssueMessage } from '../../components/ui/Input.tsx';
import Select from '../../components/ui/Select.tsx';
import CatalogAuthoring from '../CatalogAuthoring.tsx';
import { useItemEditorState } from './context.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import StandaloneDropdownSettings from './StandaloneDropdownSettings.tsx';
import type {
  BlueprintCognitiveDemand,
  BlueprintDifficulty,
} from '../../lib/assessment_blueprint.ts';

export type ItemEditorInspectorProps = {
  readonly sections?: readonly RightRailSection[];
  readonly detailsContent?: ComponentChildren;
};

/** Contextual metadata, standards, and accessibility inspector. */
export default function ItemEditorInspector(
  { sections = [], detailsContent }: ItemEditorInspectorProps,
) {
  const state = useItemEditorState();
  const titleId = useDomId();
  const planTargetId = useDomId();
  const i18n = useI18n();
  const { showPreviewOnly } = state.navigation;
  const { fieldHasIssue, fieldIssueText } = state.persistence;
  const {
    title,
    setTitle,
    setTitleLocked,
    standards,
    addStandard,
    updateStandard,
    removeStandard,
    catalogs,
    setCatalogs,
    stylesheets,
    setStylesheets,
    a11yIssues,
    blueprint,
    blueprintTargetId,
    setBlueprintTargetId,
    reviewSuggestions,
  } = state.inspector;
  const qualitySuggestions = reviewSuggestions.filter((suggestion) =>
    suggestion.category !== 'accessibility'
  );

  if (showPreviewOnly) return null;

  return (
    <>
      <StandaloneDropdownSettings />
      <SettingsSection
        group='accessibility'
        label={i18n.t('inspector.accessibility')}
        notice={
          <div
            class={`rounded-md border p-3 space-y-2 ${
              a11yIssues.length === 0
                ? 'border-secondary/30 bg-secondary/10'
                : a11yIssues.some((issue) => issue.severity === 'error')
                ? 'border-error/40 bg-error/10'
                : 'border-warning/40 bg-warning/10'
            }`}
          >
            <h4 class='font-medium'>{i18n.t('inspector.accessibilityCheck')}</h4>
            {a11yIssues.length === 0 && (
              <p class='text-sm text-base-content/70'>
                {i18n.t('inspector.noAccessibilityIssues')}
              </p>
            )}
            {a11yIssues.length > 0 && (
              <ul class='list-disc pl-5 text-sm space-y-1'>
                {a11yIssues.map((issue) => (
                  <li
                    class={issue.severity === 'error' ? 'text-error' : 'text-warning'}
                    key={`${issue.severity}:${issue.code}:${issue.message}`}
                  >
                    [{issue.severity === 'error'
                      ? i18n.t('inspector.severityError')
                      : i18n.t('inspector.severityWarning')}] [{issue.code}] {issue.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        }
      >
        {sections.filter((section) => section.group === 'accessibility').map((section) => (
          <Fragment key={section.id}>{section.content}</Fragment>
        ))}
        <CatalogAuthoring
          catalogs={catalogs}
          stylesheets={stylesheets}
          onCatalogsChange={setCatalogs}
          onStylesheetsChange={setStylesheets}
        />
      </SettingsSection>
      <SettingsSection
        group='details'
        label={i18n.t('inspector.details')}
        needsAttention={fieldHasIssue('title')}
      >
        {sections.filter((section) => section.group === 'details').map((section) => (
          <Fragment key={section.id}>{section.content}</Fragment>
        ))}
        {blueprint?._tag === 'Defined' && (
          <label class='flex flex-col gap-1'>
            <span id={`${planTargetId}-label`}>{i18n.t('inspector.planTarget')}</span>
            <Select
              aria-labelledby={`${planTargetId}-label`}
              aria-describedby={`${planTargetId}-help`}
              value={blueprintTargetId ?? ''}
              required
              onChange={(event) => setBlueprintTargetId(event.currentTarget.value || undefined)}
            >
              <option value='' disabled>{i18n.t('inspector.chooseTarget')}</option>
              {blueprint.targets.filter((target) => target.questionType === state.content.qtype)
                .map(
                  (target) => {
                    const outcome = blueprint.outcomes.find((entry) =>
                      entry.id === target.outcomeId
                    );
                    return (
                      <option key={target.id} value={target.id}>
                        {outcome?.title ?? target.outcomeId} ·{' '}
                        {cognitiveDemandLabel(i18n, target.cognitiveDemand)} ·{' '}
                        {difficultyLabel(i18n, target.difficulty)}
                      </option>
                    );
                  },
                )}
            </Select>
            <span id={`${planTargetId}-help`} class='text-xs leading-5 text-base-content/65'>
              {i18n.t('inspector.planHelp')}
            </span>
          </label>
        )}
        <label class='flex flex-col'>
          <span id={`${titleId}-label`}>{i18n.t('inspector.title')}</span>
          <Input
            data-settings-field='title'
            aria-labelledby={`${titleId}-label`}
            aria-invalid={fieldHasIssue('title') || undefined}
            aria-describedby={`${titleId}-help${fieldHasIssue('title') ? ` ${titleId}-issue` : ''}`}
            class={!title.trim() || fieldHasIssue('title') ? 'ds-input-error' : 'ds-input-success'}
            value={title}
            placeholder={i18n.t('inspector.titlePlaceholder')}
            onInput={(event) => {
              const next = (event.target as HTMLInputElement).value;
              setTitle(next);
              setTitleLocked(next.trim().length > 0);
            }}
          />
          {fieldHasIssue('title') && (
            <FieldIssueMessage id={`${titleId}-issue`} message={fieldIssueText('title') ?? ''} />
          )}
          <span id={`${titleId}-help`} class='text-xs text-base-content/70'>
            {i18n.t('inspector.titleHelp')}
          </span>
        </label>
        <div class='space-y-3 rounded-md border border-base-300 p-3'>
          <div class='flex items-center justify-between gap-3'>
            <h4 class='font-medium'>{i18n.t('inspector.standards')}</h4>
            <Button type='button' size='sm' onClick={addStandard}>
              {i18n.t('inspector.addStandard')}
            </Button>
          </div>
          {standards.length === 0 && (
            <p class='text-sm text-base-content/70'>
              {i18n.t('inspector.noStandards')}
            </p>
          )}
          <div class='space-y-3'>
            {standards.map((standard, index) => (
              <div
                key={`${index}-${standard.standardId ?? ''}-${standard.code ?? ''}`}
                class='rounded-md border border-base-300 p-3 space-y-3'
              >
                <div class='grid gap-3 sm:grid-cols-2'>
                  <label class='flex flex-col'>
                    <span>{i18n.t('inspector.code')}</span>
                    <Input
                      value={standard.code ?? ''}
                      placeholder={i18n.t('inspector.codePlaceholder')}
                      onInput={(event) =>
                        updateStandard(index, { code: (event.target as HTMLInputElement).value })}
                    />
                  </label>
                  <label class='flex flex-col'>
                    <span>{i18n.t('inspector.provider')}</span>
                    <Input
                      value={standard.providerId ?? ''}
                      placeholder={i18n.t('inspector.providerPlaceholder')}
                      onInput={(event) =>
                        updateStandard(index, {
                          providerId: (event.target as HTMLInputElement).value,
                        })}
                    />
                  </label>
                  <label class='flex flex-col sm:col-span-2'>
                    <span>{i18n.t('inspector.standardLabel')}</span>
                    <Input
                      value={standard.label ?? ''}
                      placeholder={i18n.t('inspector.labelPlaceholder')}
                      onInput={(event) =>
                        updateStandard(index, { label: (event.target as HTMLInputElement).value })}
                    />
                  </label>
                  <label class='flex flex-col sm:col-span-2'>
                    <span>{i18n.t('inspector.guid')}</span>
                    <Input
                      value={standard.standardId ?? ''}
                      placeholder={i18n.t('inspector.guidPlaceholder')}
                      onInput={(event) =>
                        updateStandard(index, {
                          standardId: (event.target as HTMLInputElement).value,
                        })}
                    />
                  </label>
                  <label class='flex flex-col sm:col-span-2'>
                    <span>{i18n.t('inspector.uri')}</span>
                    <Input
                      value={standard.uri ?? ''}
                      placeholder={i18n.t('inspector.uriPlaceholder')}
                      onInput={(event) =>
                        updateStandard(index, { uri: (event.target as HTMLInputElement).value })}
                    />
                  </label>
                </div>
                <div class='flex justify-end'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    aria-label={i18n.t('inspector.removeStandardNamed', {
                      name: standard.code ?? standard.label ?? String(index + 1),
                    })}
                    onClick={() => removeStandard(index)}
                  >
                    {i18n.t('inspector.remove')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div>
            <h4 class='text-sm font-medium text-base-content'>
              {i18n.t('inspector.qualityReview')}
            </h4>
            <p class='mt-1 text-xs leading-5 text-base-content/65'>
              {i18n.t('inspector.qualityHelp')}
            </p>
          </div>
          {qualitySuggestions.length === 0
            ? (
              <p class='rounded-md border border-success/30 bg-success/10 p-3 text-sm'>
                {i18n.t('inspector.noQualityConcerns')}
              </p>
            )
            : (
              <ul class='space-y-2'>
                {qualitySuggestions.map((suggestion) => (
                  <li
                    key={`${suggestion.source}:${suggestion.code}:${suggestion.message}`}
                    class='rounded-md border border-warning/40 bg-warning/10 p-3 text-sm'
                  >
                    <div class='flex items-start gap-2'>
                      <span class='ds-badge ds-badge-outline ds-badge-sm shrink-0'>
                        {suggestion.source === 'ai'
                          ? i18n.t('inspector.aiSuggestion')
                          : i18n.t('inspector.check')}
                      </span>
                      <span>{suggestion.message}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </div>

        {detailsContent}
      </SettingsSection>
    </>
  );
}

function cognitiveDemandLabel(
  i18n: ReturnType<typeof useI18n>,
  value: BlueprintCognitiveDemand,
): string {
  const labels = {
    remember: 'inspector.cognitive.remember',
    understand: 'inspector.cognitive.understand',
    apply: 'inspector.cognitive.apply',
    analyze: 'inspector.cognitive.analyze',
    evaluate: 'inspector.cognitive.evaluate',
    create: 'inspector.cognitive.create',
  } satisfies Record<BlueprintCognitiveDemand, string>;
  return i18n.t(labels[value]);
}

function difficultyLabel(i18n: ReturnType<typeof useI18n>, value: BlueprintDifficulty): string {
  const labels = {
    easy: 'inspector.difficulty.easy',
    medium: 'inspector.difficulty.medium',
    hard: 'inspector.difficulty.hard',
  } satisfies Record<BlueprintDifficulty, string>;
  return i18n.t(labels[value]);
}
