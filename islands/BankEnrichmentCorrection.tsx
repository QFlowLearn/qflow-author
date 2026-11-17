import { useEffect, useRef, useState } from 'preact/hooks';
import Button from '../components/ui/Button.tsx';
import Select from '../components/ui/Select.tsx';
import { BankAlert, BankField } from '../components/item_bank/ui.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import type { I18nPayload } from '../lib/i18n/payload.ts';
import type {
  EnrichmentDefinition,
  EnrichmentDimension,
  EnrichmentValue,
} from '../lib/services/bank_enrichment_contract.ts';
import { parseEnrichmentCorrectionValues } from '../lib/services/bank_enrichment_change_contract.ts';
import type { EnrichmentScope } from '../lib/services/bank_enrichment_scope.ts';
import { submitEnrichmentAction } from '../lib/bank_enrichment_client.ts';

/** Set chosen dimensions for a server-counted scope; unchanged fields retain each question's current value. */
export default function BankEnrichmentCorrection(props: {
  readonly operationId: string;
  readonly versionId: string;
  readonly definition: EnrichmentDefinition;
  readonly scope: EnrichmentScope;
  readonly count: number;
  readonly backHref: string;
  readonly payload: I18nPayload;
}) {
  const i18n = createI18n(props.payload.locale, props.payload.namespaces);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [selected, setSelected] = useState({ subject: '', topic: '', difficulty: '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const pending = useRef(false),
    controller = useRef<AbortController | null>(null),
    errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  const value = (id: string): EnrichmentValue | null =>
    id === ''
      ? null
      : id === '__none'
      ? { state: 'unassigned', reason: 'outside_scheme' }
      : { state: 'assigned', valueIds: [id] };
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending.current) return;
    const values = parseEnrichmentCorrectionValues({
      subject: value(selected.subject),
      topic: value(selected.topic),
      difficulty: value(selected.difficulty),
    }, props.definition);
    if (!values) {
      setError(i18n.t('items.organize.errorInput'));
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    controller.current = new AbortController();
    const scope = props.scope._tag === 'Filtered'
      ? { _tag: 'Filtered', queryString: props.scope.queryString }
      : props.scope;
    const result = await submitEnrichmentAction(
      '/items/organize',
      {
        action: 'correct',
        operationId: props.operationId,
        versionId: props.versionId,
        expectedCount: props.count,
        scope,
        values,
      },
      { signal: controller.current.signal },
    );
    if (result && 'url' in result) {
      location.assign(result.url);
      return;
    }
    setError(result && 'error' in result ? result.error : i18n.t('items.organize.errorNetwork'));
    pending.current = false;
    setBusy(false);
  }
  const categories = (dimension: EnrichmentDimension) =>
    dimension === 'subject'
      ? props.definition.subjects
      : dimension === 'difficulty'
      ? props.definition.difficulty
      : props.definition.topics.filter((t) =>
        !selected.subject || selected.subject === t.subjectId
      );
  return (
    <form method='post' action='/items/organize' onSubmit={submit} class='max-w-2xl space-y-5'>
      {error && (
        <div ref={errorRef} tabIndex={-1}>
          <BankAlert tone='error'>{error}</BankAlert>
        </div>
      )}
      <fieldset disabled={!ready || busy} class='space-y-4'>
        <legend class='sr-only'>{i18n.t('items.organize.editClassifications')}</legend>
        {(['subject', 'topic', 'difficulty'] as const).map((dimension) => (
          <BankField key={dimension} label={i18n.t(`items.browse.${dimension}`)}>
            <Select
              name={dimension}
              value={selected[dimension]}
              onChange={(event) => {
                const next = event.currentTarget.value;
                const topic = dimension === 'topic'
                  ? props.definition.topics.find((t) => t.id === next)
                  : undefined;
                setSelected({
                  ...selected,
                  [dimension]: next,
                  ...(dimension === 'subject' ? { topic: next ? '__none' : '' } : {}),
                  ...(topic ? { subject: topic.subjectId } : {}),
                });
              }}
            >
              {(dimension !== 'topic' || selected.subject === '') && (
                <option value=''>{i18n.t('items.organize.leaveUnchanged')}</option>
              )}
              <option value='__none'>{i18n.t('items.organize.clearClassification')}</option>
              {categories(dimension).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          </BankField>
        ))}
        {selected.topic && !selected.subject && (
          <p class='text-sm text-base-content/80'>{i18n.t('items.organize.topicCorrectionHint')}</p>
        )}
        <div class='flex flex-wrap gap-3 pt-2'>
          <Button
            type='submit'
            variant='primary'
            disabled={busy || !Object.values(selected).some(Boolean)}
            aria-busy={busy}
          >
            {i18n.t('items.organize.applyCorrection', { count: props.count })}
          </Button>
          <Button href={props.backHref} variant='ghost'>{i18n.t('items.organize.back')}</Button>
        </div>
      </fieldset>
    </form>
  );
}
