import { uiEvent } from '../lib/client/ui_event.ts';
import { useEffect, useRef, useState } from 'preact/hooks';
import Button from '../components/ui/Button.tsx';
import { BankAlert } from '../components/item_bank/ui.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import type { I18nPayload } from '../lib/i18n/payload.ts';
import { submitEnrichmentAction } from '../lib/bank_enrichment_client.ts';

/** Poll only the small status receipt while work is running; the durable job owns processing. */
export default function BankEnrichmentJobControls(
  props: {
    readonly id: string;
    readonly operationId: string;
    readonly updatedAt: string;
    readonly running: boolean;
    readonly resumable: boolean;
    readonly undoable: boolean;
    readonly payload: I18nPayload;
  },
) {
  const i18n = createI18n(props.payload.locale, props.payload.namespaces);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const pending = useRef(false),
    controller = useRef<AbortController | null>(null),
    errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (!props.running) return;
    const request = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      if (!pending.current && document.visibilityState === 'visible') {
        try {
          const response = await fetch(`/items/organize/${props.id}/status`, {
            signal: request.signal,
            cache: 'no-store',
          });
          const raw: unknown = await response.json();
          if (
            !response.ok || typeof raw !== 'object' || raw === null || !('updatedAt' in raw) ||
            typeof raw.updatedAt !== 'string'
          ) throw new Error('Invalid progress receipt.');
          if (raw.updatedAt !== props.updatedAt && !pending.current && !request.signal.aborted) {
            location.reload();
            return;
          }
        } catch {
          if (!request.signal.aborted) setError(i18n.t('items.organize.errorRefresh'));
        }
      }
      if (!request.signal.aborted) timer = setTimeout(uiEvent(refresh), 5000);
    }
    timer = setTimeout(uiEvent(refresh), 5000);
    return () => {
      request.abort();
      clearTimeout(timer);
    };
  }, [props.id, props.updatedAt, props.running]);
  async function act(action: 'cancel' | 'resume' | 'undo') {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    controller.current = new AbortController();
    const result = await submitEnrichmentAction(
      `/items/organize/${props.id}`,
      action === 'cancel' ? { action } : { action, operationId: props.operationId },
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
  return (
    <div class='space-y-3'>
      {error && (
        <div ref={errorRef} tabIndex={-1}>
          <BankAlert tone='error'>{error}</BankAlert>
        </div>
      )}
      {props.running && (
        <Button type='button' disabled={busy} onClick={uiEvent(() => act('cancel'))}>
          {i18n.t('items.organize.cancel')}
        </Button>
      )}
      {props.undoable && (
        <details>
          <summary class='cursor-pointer py-2 text-sm'>{i18n.t('items.organize.undo')}</summary>
          <p class='max-w-prose py-2 text-sm text-base-content/80'>
            {i18n.t('items.organize.undoHint')}
          </p>
          <Button type='button' disabled={busy} onClick={uiEvent(() => act('undo'))}>
            {i18n.t('items.organize.confirmUndo')}
          </Button>
        </details>
      )}
      {props.resumable && (
        <Button type='button' disabled={busy} onClick={uiEvent(() => act('resume'))}>
          {i18n.t('items.organize.resume')}
        </Button>
      )}
    </div>
  );
}
