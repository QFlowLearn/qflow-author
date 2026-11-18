import { uiEvent } from '../lib/client/ui_event.ts';
import { useEffect, useState } from 'preact/hooks';
import Button from '../components/ui/Button.tsx';
import ImportStatusPanel from '../components/ui/ImportStatusPanel.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import type { I18nPayload } from '../lib/i18n/payload.ts';

/** Poll active imports without exposing editing controls that a refresh could discard. */
export default function ImportProgress(props: {
  readonly runId: string;
  readonly state: 'Queued' | 'Analyzing';
  readonly payload: I18nPayload;
}) {
  const i18n = createI18n(props.payload.locale, props.payload.namespaces);
  const [state, setState] = useState(props.state);
  const [interrupted, setInterrupted] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const request = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const slowTimer = setTimeout(() => setSlow(true), 60000);
    async function refresh() {
      try {
        const response = await fetch(`/imports/${props.runId}`, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: request.signal,
        });
        if (!response.ok) {
          setInterrupted(true);
          return;
        }
        const value: unknown = await response.json();
        if (request.signal.aborted) return;
        if (typeof value !== 'object' || value === null || !('state' in value)) {
          setInterrupted(true);
          return;
        }
        switch (value.state) {
          case 'Analyzed':
          case 'Failed':
          case 'Committed':
            location.reload();
            return;
          case 'Queued':
          case 'Analyzing':
            setState(value.state);
            timer = setTimeout(uiEvent(refresh), 3000);
            return;
          default:
            setInterrupted(true);
        }
      } catch {
        if (!request.signal.aborted) setInterrupted(true);
      }
    }
    timer = setTimeout(uiEvent(refresh), 3000);
    return () => {
      request.abort();
      clearTimeout(timer);
      clearTimeout(slowTimer);
    };
  }, [props.runId]);
  return (
    <ImportStatusPanel
      tone={interrupted ? 'warning' : 'info'}
      title={i18n.t(state === 'Queued' ? 'imports.report.queued' : 'imports.report.analyzing')}
    >
      <p>
        {i18n.t(interrupted ? 'imports.report.updatesInterrupted' : 'imports.report.autoUpdates')}
      </p>
      {!interrupted && slow && <p>{i18n.t('imports.report.takingLonger')}</p>}
      <noscript>{i18n.t('imports.report.manualUpdates')}</noscript>
      <Button href={`/imports/${props.runId}`} variant='default'>
        {i18n.t('imports.report.checkStatus')}
      </Button>
    </ImportStatusPanel>
  );
}
