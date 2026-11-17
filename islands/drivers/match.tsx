import { useDomId } from '../../lib/rendering/island_context.tsx';

import Button from '../../components/ui/Button.tsx';
import { AuthoringSectionHeader } from '../../components/ui/AuthoringLayout.tsx';
import { RemoveAnswerButton } from '../../components/ui/AnswerOptionRow.tsx';
import { setDraftListFieldValue } from './editor_shell.tsx';
import Input, { AuthoringInputRow, FieldIssueMessage } from '../../components/ui/Input.tsx';
import type { DriverUiContext } from './view_registry.ts';
import type { Choice, CommonContentProps } from './types.ts';
import MatchMatrix from '../MatchMatrix.tsx';
import { attachStandardDriverViews } from './standard_driver_views.ts';
import { AssociationLimitField } from './association_limit_field.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';

export type MatchContentProps = CommonContentProps & {
  sources: Choice[];
  targets: Choice[];
  addSource: () => void;
  addTarget: () => void;
  updateSourceText: (index: number, text: string) => void;
  updateTargetText: (index: number, text: string) => void;
  updateSourceMax: (index: number, max?: number) => void;
  updateTargetMax: (index: number, max?: number) => void;
  removeSource: (index: number) => void;
  removeTarget: (index: number) => void;
  pairs: Array<{ sourceId: string; targetId: string }>;
  setPairs: (pairs: Array<{ sourceId: string; targetId: string }>) => void;
  maxAssociations?: number;
  setMaxAssociations: (value: number | undefined) => void;
  plainTextValue: (text?: string, html?: string) => string;
};

function MatchEditor(ctx: DriverUiContext<'match'>) {
  const { editor, draft, update } = ctx;
  const sources = draft.sources;
  const targets = draft.targets;
  const pairs = draft.correctPairs;
  const maxAssociations = draft.maxAssociations;

  const setSources = (
    value: Choice[] | ((prev: Choice[]) => Choice[]),
  ) => setDraftListFieldValue(editor, draft, update, 'sources', value);
  const setTargets = (
    value: Choice[] | ((prev: Choice[]) => Choice[]),
  ) => setDraftListFieldValue(editor, draft, update, 'targets', value);
  const setPairs = (
    value: Array<{ sourceId: string; targetId: string }>,
  ) => update({ ...draft, correctPairs: value });

  const addSource = () => {
    setSources((
      prev,
    ) => [...prev, { id: String.fromCharCode(65 + prev.length), text: '', matchMax: 1 }]);
  };
  const addTarget = () => {
    setTargets((prev) => [...prev, { id: String(prev.length + 1), text: '', matchMax: 1 }]);
  };
  const updateSourceText = (index: number, text: string) => {
    setSources((prev) =>
      prev.map((entry, i) => i === index ? { ...entry, text, html: undefined } : entry)
    );
  };
  const updateTargetText = (index: number, text: string) => {
    setTargets((prev) =>
      prev.map((entry, i) => i === index ? { ...entry, text, html: undefined } : entry)
    );
  };
  const updateSourceMax = (index: number, max?: number) => {
    setSources((prev) => prev.map((entry, i) => i === index ? { ...entry, matchMax: max } : entry));
  };
  const updateTargetMax = (index: number, max?: number) => {
    setTargets((prev) => prev.map((entry, i) => i === index ? { ...entry, matchMax: max } : entry));
  };
  const removeSource = (index: number) => {
    const id = sources[index]?.id;
    const nextSources = sources.filter((_, i) => i !== index);
    const nextPairs = id ? pairs.filter((pair) => pair.sourceId !== id) : pairs;
    update({ ...draft, sources: nextSources, correctPairs: nextPairs });
  };
  const removeTarget = (index: number) => {
    const id = targets[index]?.id;
    const nextTargets = targets.filter((_, i) => i !== index);
    const nextPairs = id ? pairs.filter((pair) => pair.targetId !== id) : pairs;
    update({ ...draft, targets: nextTargets, correctPairs: nextPairs });
  };
  const setMaxAssociations = (value: number | undefined) => {
    update({ ...draft, maxAssociations: value });
  };

  return (
    <MatchContent
      renderPromptField={editor.renderPromptField ?? (() => null)}
      fieldHasIssue={editor.fieldHasIssue ?? (() => false)}
      fieldIssueText={editor.fieldIssueText ?? (() => undefined)}
      plainTextValue={editor.plainTextValue ?? ((text) => text ?? '')}
      sources={sources}
      targets={targets}
      addSource={addSource}
      addTarget={addTarget}
      updateSourceText={updateSourceText}
      updateTargetText={updateTargetText}
      updateSourceMax={updateSourceMax}
      updateTargetMax={updateTargetMax}
      removeSource={removeSource}
      removeTarget={removeTarget}
      pairs={pairs}
      setPairs={setPairs}
      maxAssociations={maxAssociations}
      setMaxAssociations={setMaxAssociations}
    />
  );
}

export function MatchContent(props: MatchContentProps) {
  const i18n = useI18n();
  const issueId = useDomId();
  return (
    <div class='space-y-3'>
      {props.renderPromptField(i18n.t('driver.matchPrompt'))}
      <section class='space-y-2'>
        <AuthoringSectionHeader
          heading={
            <div class='flex items-center gap-2'>
              <strong>{i18n.t('driver.sources')}</strong>
              <span class='rounded-sm border border-base-300 bg-base-200 px-1.5 py-0.5 text-[10px] font-medium text-base-content/80'>
                {i18n.t('driver.itemCount', { count: props.sources.length })}
              </span>
            </div>
          }
        >
          <Button
            size='sm'
            type='button'
            data-editor-field={props.sources.length === 0 ? 'matchSources' : undefined}
            aria-invalid={props.fieldHasIssue('matchSources') || undefined}
            aria-describedby={props.fieldHasIssue('matchSources')
              ? `${issueId}-matchSources`
              : undefined}
            onClick={props.addSource}
          >
            + {i18n.t('driver.addSource')}
          </Button>
        </AuthoringSectionHeader>
        <p class='text-sm text-base-content/65'>
          {i18n.t('driver.matchSourcesHelp')}
        </p>
        {props.fieldHasIssue('matchSources') && (
          <FieldIssueMessage
            id={`${issueId}-matchSources`}
            message={props.fieldIssueText('matchSources') ?? ''}
          />
        )}
        {props.sources.map((source, index) => (
          (() => {
            const sourceText = props.plainTextValue(source.text, source.html).trim();
            const sourceName = sourceText || i18n.t('driver.sourceIndexed', { number: index + 1 });
            return (
              <AuthoringInputRow
                key={`S-${source.id}`}
                label={i18n.t('driver.ordinal', { number: index + 1 })}
                content={
                  <Input
                    size='sm'
                    data-editor-field='matchSources'
                    aria-invalid={props.fieldHasIssue('matchSources') || undefined}
                    aria-describedby={props.fieldHasIssue('matchSources')
                      ? `${issueId}-matchSources`
                      : undefined}
                    value={sourceText}
                    onInput={(e) =>
                      props.updateSourceText(index, (e.target as HTMLInputElement).value)}
                    placeholder={i18n.t('driver.sourceText')}
                    aria-label={i18n.t('driver.sourceIndexed', { number: index + 1 })}
                  />
                }
                details={
                  <AssociationLimitField
                    value={source.matchMax}
                    onChange={(value) => props.updateSourceMax(index, value)}
                    ariaLabel={i18n.t('driver.maximumMatches', { name: sourceName })}
                    label={i18n.t('driver.maxAssociations')}
                    hint={null}
                    layout='inline'
                    widthClass='w-full'
                  />
                }
                action={
                  <RemoveAnswerButton
                    label={i18n.t('driver.removeChoiceLabel', { label: sourceName })}
                    onRemove={() => props.removeSource(index)}
                  />
                }
              />
            );
          })()
        ))}
      </section>

      <section class='space-y-2 border-t border-base-300 pt-3'>
        <AuthoringSectionHeader
          heading={
            <div class='flex items-center gap-2'>
              <strong>{i18n.t('driver.targets')}</strong>
              <span class='rounded-sm border border-base-300 bg-base-100 px-1.5 py-0.5 text-[10px] font-medium text-base-content/80'>
                {i18n.t('driver.itemCount', { count: props.targets.length })}
              </span>
            </div>
          }
        >
          <Button
            size='sm'
            type='button'
            data-editor-field={props.targets.length === 0 ? 'matchTargets' : undefined}
            aria-invalid={props.fieldHasIssue('matchTargets') || undefined}
            aria-describedby={props.fieldHasIssue('matchTargets')
              ? `${issueId}-matchTargets`
              : undefined}
            onClick={props.addTarget}
          >
            + {i18n.t('driver.addTarget')}
          </Button>
        </AuthoringSectionHeader>
        <p class='text-sm text-base-content/65'>
          {i18n.t('driver.matchTargetsHelp')}
        </p>
        {props.fieldHasIssue('matchTargets') && (
          <FieldIssueMessage
            id={`${issueId}-matchTargets`}
            message={props.fieldIssueText('matchTargets') ?? ''}
          />
        )}
        {props.targets.map((target, index) => (
          (() => {
            const targetText = props.plainTextValue(target.text, target.html).trim();
            const targetName = targetText || i18n.t('driver.targetIndexed', { number: index + 1 });
            return (
              <AuthoringInputRow
                key={`T-${target.id}`}
                label={i18n.t('driver.ordinal', { number: index + 1 })}
                content={
                  <Input
                    size='sm'
                    data-editor-field='matchTargets'
                    aria-invalid={props.fieldHasIssue('matchTargets') || undefined}
                    aria-describedby={props.fieldHasIssue('matchTargets')
                      ? `${issueId}-matchTargets`
                      : undefined}
                    value={targetText}
                    onInput={(e) =>
                      props.updateTargetText(index, (e.target as HTMLInputElement).value)}
                    placeholder={i18n.t('driver.targetText')}
                    aria-label={i18n.t('driver.targetIndexed', { number: index + 1 })}
                  />
                }
                details={
                  <AssociationLimitField
                    value={target.matchMax}
                    onChange={(value) => props.updateTargetMax(index, value)}
                    ariaLabel={i18n.t('driver.maximumMatches', { name: targetName })}
                    label={i18n.t('driver.maxAssociations')}
                    hint={null}
                    layout='inline'
                    widthClass='w-full'
                  />
                }
                action={
                  <RemoveAnswerButton
                    label={i18n.t('driver.removeChoiceLabel', { label: targetName })}
                    onRemove={() => props.removeTarget(index)}
                  />
                }
              />
            );
          })()
        ))}
      </section>

      <section class='space-y-2 border-t border-base-300 pt-3'>
        <div class='flex items-center justify-between gap-2'>
          <strong>{i18n.t('driver.correctPairs')}</strong>
          <span class='rounded-sm border border-base-300 bg-base-200 px-1.5 py-0.5 text-[10px] font-medium text-base-content/80'>
            {i18n.t('driver.matchCount', { count: props.pairs.length })}
          </span>
        </div>
        {props.fieldHasIssue('matchPairs') && (
          <FieldIssueMessage
            id={`${issueId}-matchPairs`}
            message={props.fieldIssueText('matchPairs') ?? ''}
          />
        )}
        <MatchMatrix
          issueId={props.fieldHasIssue('matchPairs') ? `${issueId}-matchPairs` : undefined}
          sources={props.sources}
          targets={props.targets}
          pairs={props.pairs}
          onChange={props.setPairs}
          maxAssociations={props.maxAssociations}
        />
      </section>
    </div>
  );
}

attachStandardDriverViews('match', MatchEditor);
