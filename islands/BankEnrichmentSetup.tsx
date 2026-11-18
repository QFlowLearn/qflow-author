import { uiEvent } from '../lib/client/ui_event.ts';
import LocalizedTimestamp from './LocalizedTimestamp.tsx';
import { useEffect, useRef, useState } from 'preact/hooks';
import Button from '../components/ui/Button.tsx';
import Input from '../components/ui/Input.tsx';
import Textarea from '../components/ui/Textarea.tsx';
import Checkbox from '../components/ui/Checkbox.tsx';
import Tabs from '../components/ui/Tabs.tsx';
import { BankAlert, BankField } from '../components/item_bank/ui.tsx';
import { BankEnrichmentVocabulary } from '../components/item_bank/BankEnrichmentVocabulary.tsx';
import { BankEnrichmentExamples } from '../components/item_bank/BankEnrichmentExamples.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import type { I18nPayload } from '../lib/i18n/payload.ts';
import {
  ENRICHMENT_DIMENSIONS,
  type EnrichmentDefinition,
  type EnrichmentDimension,
  parseEnrichmentDefinition,
} from '../lib/services/bank_enrichment_contract.ts';
import type { EnrichmentPreviewResult } from '../lib/services/bank_enrichment_preview_codec.ts';
import type { EnrichmentQuestion } from '../lib/services/bank_enrichment_input.ts';
import { enrichmentDraftForSave, incompleteEnrichmentTab } from '../lib/bank_enrichment_editor.ts';
import { submitEnrichmentAction } from '../lib/bank_enrichment_client.ts';
import { canonicalJsonStringify } from '../lib/canonical_json.ts';
import { enrichmentRemovedValues } from '../lib/services/bank_enrichment_affected_policy.ts';

/** Customize one scheme and optionally preview it again before starting the complete frozen bank. */
export default function BankEnrichmentSetup(
  props: {
    readonly id: string;
    readonly initialDimensions: readonly EnrichmentDimension[];
    readonly affectedSelection: boolean;
    readonly previewOperationId: string;
    readonly result: EnrichmentPreviewResult;
    readonly questions: readonly EnrichmentQuestion[];
    readonly base: EnrichmentDefinition | null;
    readonly count: number;
    readonly capturedAt: string;
    readonly budgetMicros: number;
    readonly payload: I18nPayload;
  },
) {
  const i18n = createI18n(props.payload.locale, props.payload.namespaces);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [draft, setDraft] = useState(props.result.definition),
    [tab, setTab] = useState<'vocabulary' | 'difficulty' | 'examples'>('vocabulary');
  const [dimensions, setDimensions] = useState<readonly EnrichmentDimension[]>(
    props.initialDimensions,
  );
  const [replace, setReplace] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const pending = useRef(false),
    errorRef = useRef<HTMLDivElement>(null),
    controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  const cost = (micros: number) =>
    i18n.formatNumber(micros / 1_000_000, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    });
  const editedDefinition = enrichmentDraftForSave(draft, props.base);
  const affectedChanged = props.affectedSelection &&
    canonicalJsonStringify(editedDefinition) !== canonicalJsonStringify(props.result.definition);
  const canSelectAffected = props.base && !props.affectedSelection &&
    enrichmentRemovedValues(props.base, editedDefinition) !== null;
  async function submit(
    action: 'preview' | 'start',
    selection: 'current' | 'affected' = 'current',
  ) {
    if (pending.current) return;
    const missing = incompleteEnrichmentTab(draft);
    const definition = parseEnrichmentDefinition(enrichmentDraftForSave(draft, props.base));
    if (!definition) {
      if (missing) setTab(missing);
      setError(i18n.t('items.organize.errorInput'));
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    controller.current = new AbortController();
    const command = action === 'preview'
      ? { action, operationId: props.previewOperationId, definition, dimensions, selection }
      : {
        action,
        definition,
        dimensions,
        replacement: replace ? 'replace_captured' : 'preserve_manual',
      };
    const result = await submitEnrichmentAction(`/items/organize/${props.id}`, command, {
      signal: controller.current.signal,
    });
    if (result && 'url' in result) {
      location.assign(result.url);
      return;
    }
    setError(result && 'error' in result ? result.error : i18n.t('items.organize.errorNetwork'));
    pending.current = false;
    setBusy(false);
  }
  return (
    <form
      method='post'
      action={`/items/organize/${props.id}`}
      class='space-y-6'
      onSubmit={uiEvent((event) => {
        event.preventDefault();
        return submit('start');
      })}
    >
      {error && (
        <div ref={errorRef} tabIndex={-1}>
          <BankAlert tone='error'>{error}</BankAlert>
        </div>
      )}
      <fieldset disabled={!ready || busy} class='space-y-6'>
        <legend class='sr-only'>{i18n.t('items.organize.customize')}</legend>
        <div class='grid gap-4 sm:grid-cols-2'>
          <BankField label={i18n.t('items.organize.schemeName')}>
            <Input
              name='name'
              required
              maxLength={160}
              value={draft.name}
              onInput={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
            />
          </BankField>
          <BankField label={i18n.t('items.organize.audience')}>
            <Input
              name='audience'
              required
              maxLength={1000}
              value={draft.audience}
              onInput={(event) => setDraft({ ...draft, audience: event.currentTarget.value })}
            />
          </BankField>
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          ariaLabel={i18n.t('items.organize.customize')}
          items={[
            { value: 'vocabulary', label: i18n.t('items.organize.vocabulary') },
            { value: 'difficulty', label: i18n.t('items.organize.difficulty') },
            { value: 'examples', label: i18n.t('items.organize.examples') },
          ]}
          renderPanel={(value) =>
            value === 'examples'
              ? (
                <BankEnrichmentExamples
                  result={props.result}
                  draft={draft}
                  onChange={setDraft}
                  questions={props.questions}
                  i18n={i18n}
                />
              )
              : (
                <BankEnrichmentVocabulary
                  draft={draft}
                  onChange={setDraft}
                  difficultyOnly={value === 'difficulty'}
                  i18n={i18n}
                />
              )}
        />
        <details>
          <summary class='cursor-pointer py-2 text-sm font-medium'>
            {i18n.t('items.organize.instructions')}
          </summary>
          <BankField label={i18n.t('items.organize.instructionsLabel')}>
            <Textarea
              name='instructions'
              rows={3}
              maxLength={4000}
              value={draft.instructions}
              onInput={(event) => setDraft({ ...draft, instructions: event.currentTarget.value })}
            />
          </BankField>
        </details>
        <div class='space-y-4 border-t border-base-300 pt-5'>
          <p class='font-medium'>{i18n.t('items.organize.ready', { count: props.count })}</p>
          <p class='text-xs text-base-content/75'>
            {i18n.rich('items.organize.captured', {
              when: <LocalizedTimestamp value={props.capturedAt} locale={i18n.locale} />,
            })}
          </p>
          <p class='text-sm text-base-content/80'>
            {i18n.t('items.organize.estimate', {
              estimate: cost(props.result.estimatedRunMicros),
              budget: cost(props.budgetMicros),
            })}
          </p>
          <fieldset class='space-y-2'>
            <legend class='text-sm font-medium'>{i18n.t('items.organize.updateFields')}</legend>
            <div class='flex flex-wrap gap-x-5'>
              {ENRICHMENT_DIMENSIONS.map((dimension) => (
                <label key={dimension} class='flex min-h-11 items-center gap-2 text-sm'>
                  <Checkbox
                    name={`update-${dimension}`}
                    checked={dimensions.includes(dimension)}
                    onChange={(event) => {
                      const next = new Set(dimensions);
                      if (event.currentTarget.checked) {
                        next.add(dimension);
                        if (dimension === 'subject') {
                          next.add('topic');
                        }
                      } else {
                        next.delete(dimension);
                        if (dimension === 'topic') {
                          next.delete('subject');
                        }
                      }
                      setDimensions(ENRICHMENT_DIMENSIONS.filter((d) => next.has(d)));
                    }}
                  />
                  {i18n.t(`items.browse.${dimension}`)}
                </label>
              ))}
            </div>
            {props.base && props.base.audience !== draft.audience && (
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => setDimensions(['difficulty'])}
              >
                {i18n.t('items.organize.audienceRerate')}
              </Button>
            )}
          </fieldset>
          <label class='flex min-h-11 items-center gap-3 text-sm'>
            <Checkbox
              name='replace'
              checked={replace}
              onChange={(event) => setReplace(event.currentTarget.checked)}
            />
            {i18n.t('items.organize.replace')}
          </label>
          {affectedChanged && (
            <p role='status' class='text-sm font-medium'>
              {i18n.t('items.organize.refreshAffected')}
            </p>
          )}
          {canSelectAffected && (
            <p class='text-sm text-base-content/80'>{i18n.t('items.organize.affectedHint')}</p>
          )}
          <div class='flex flex-wrap gap-3'>
            <Button
              type='submit'
              variant='primary'
              disabled={busy || dimensions.length === 0 || affectedChanged}
              aria-busy={busy}
            >
              {i18n.t(busy ? 'items.organize.starting' : 'items.organize.tag')}
            </Button>
            <Button
              type='button'
              disabled={busy || dimensions.length === 0}
              onClick={uiEvent(() => submit('preview'))}
            >
              {i18n.t('items.organize.preview')}
            </Button>
            {canSelectAffected && (
              <Button
                type='button'
                disabled={busy || dimensions.length === 0}
                onClick={uiEvent(() => submit('preview', 'affected'))}
              >
                {i18n.t('items.organize.previewAffected')}
              </Button>
            )}
          </div>
        </div>
      </fieldset>
    </form>
  );
}
