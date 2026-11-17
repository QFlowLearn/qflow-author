import { useEffect, useRef, useState } from 'preact/hooks';
import Button from '../components/ui/Button.tsx';
import Input from '../components/ui/Input.tsx';
import Select from '../components/ui/Select.tsx';
import { BankAlert, BankField } from '../components/item_bank/ui.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import type { I18nPayload } from '../lib/i18n/payload.ts';
import { submitEnrichmentAction } from '../lib/bank_enrichment_client.ts';

/** The instructor supplies the audience before the first bounded sample. */
export default function BankEnrichmentBegin(
  props: {
    readonly operationId: string;
    readonly queryString: string;
    readonly schemes: readonly {
      readonly id: string;
      readonly name: string;
      readonly audience: string;
    }[];
    readonly payload: I18nPayload;
  },
) {
  const i18n = createI18n(props.payload.locale, props.payload.namespaces);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [audience, setAudience] = useState(''), [baseVersionId, setBase] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const pending = useRef(false),
    errorRef = useRef<HTMLDivElement>(null),
    controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  return (
    <form
      method='post'
      action='/items/organize'
      class='max-w-2xl space-y-5'
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setError(null);
        controller.current = new AbortController();
        const result = await submitEnrichmentAction('/items/organize', {
          action: 'begin',
          operationId: props.operationId,
          scope: { _tag: 'Filtered', queryString: props.queryString },
          audience,
          baseVersionId: baseVersionId || null,
        }, { signal: controller.current.signal });
        if (result && 'url' in result) {
          location.assign(result.url);
          return;
        }
        setError(
          result && 'error' in result ? result.error : i18n.t('items.organize.errorNetwork'),
        );
        pending.current = false;
        setBusy(false);
      }}
    >
      {error && (
        <div ref={errorRef} tabIndex={-1}>
          <BankAlert tone='error'>{error}</BankAlert>
        </div>
      )}
      <fieldset disabled={!ready || busy} class='space-y-5'>
        <legend class='sr-only'>{i18n.t('items.organize.title')}</legend>
        {props.schemes.length > 0 && (
          <BankField label={i18n.t('items.organize.scheme')}>
            <Select
              name='scheme'
              value={baseVersionId}
              onChange={(event) => {
                const id = event.currentTarget.value;
                setBase(id);
                const saved = props.schemes.find((s) => s.id === id);
                if (saved) setAudience(saved.audience);
              }}
            >
              <option value=''>{i18n.t('items.organize.newScheme')}</option>
              {props.schemes.map((scheme) => (
                <option key={scheme.id} value={scheme.id}>{scheme.name}</option>
              ))}
            </Select>
          </BankField>
        )}
        <BankField label={i18n.t('items.organize.audience')}>
          <Input
            name='audience'
            required
            maxLength={1000}
            value={audience}
            placeholder={i18n.t('items.organize.audiencePlaceholder')}
            aria-describedby='audience-help'
            onInput={(event) => setAudience(event.currentTarget.value)}
          />
        </BankField>
        <p id='audience-help' class='text-sm text-base-content/80'>
          {i18n.t('items.organize.audienceHelp')}
        </p>
        <Button type='submit' variant='primary' disabled={busy} aria-busy={busy}>
          {i18n.t(busy ? 'items.organize.starting' : 'items.organize.sample')}
        </Button>
      </fieldset>
    </form>
  );
}
