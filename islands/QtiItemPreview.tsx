import { useEffect, useRef, useState } from 'preact/hooks';
import Button from '../components/ui/Button.tsx';
import type { QtiAttemptStateV1, QtiDiagnostic } from '@longsightgroup/qti3-core';
import type { QtiPlayerLoadOptions } from '@longsightgroup/qti3-player';
import type { I18nPayload } from '../lib/i18n/payload.ts';
import { I18nProvider, useI18n } from '../lib/i18n/context.tsx';
import type { QflowPlayerMessageCatalog } from '../lib/i18n/player_messages/types.ts';

type QtiPlayerElement = HTMLElement & {
  languageOfInterface: string;
  messageCatalog: import('@longsightgroup/qti3-player').PlayerMessageCatalog | undefined;
  loadXml: (xml: string, options?: QtiPlayerLoadOptions) => Promise<void>;
  reset: () => void;
  scoreAttempt: (options?: { validateResponses?: boolean }) => unknown;
  serialize: () => QtiAttemptStateV1 | undefined;
};

type Props = {
  xml: string;
  title?: string | null;
  mode?: 'author' | 'migration' | 'snapshot' | 'bank';
  showDiagnostics?: boolean;
  scoreLabel?: string;
  onScored?: (state: QtiAttemptStateV1) => void;
  payload: I18nPayload;
  playerCatalog: QflowPlayerMessageCatalog;
};

type LoadStatus = 'loading' | 'ready' | 'error';

export default function QtiItemPreview(
  { payload, playerCatalog, ...props }: Props,
) {
  if (playerCatalog.locale !== payload.locale) {
    throw new Error('Preview locale and player catalog locale must match.');
  }
  return (
    <I18nProvider payload={payload}>
      <LocalizedPreview {...props} payload={payload} playerCatalog={playerCatalog} />
    </I18nProvider>
  );
}

function LocalizedPreview(
  {
    xml,
    title,
    mode = 'author',
    showDiagnostics = true,
    payload,
    playerCatalog,
    onScored,
    scoreLabel,
  }:
    & Omit<Props, 'payload' | 'playerCatalog'>
    & {
      payload: I18nPayload;
      playerCatalog: QflowPlayerMessageCatalog;
    },
) {
  const i18n = useI18n();
  const scoredCallback = useRef(onScored);
  scoredCallback.current = onScored;
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<QtiPlayerElement | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [statusText, setStatusText] = useState(() => i18n.t('preview.loading'));
  const [diagnostics, setDiagnostics] = useState<QtiDiagnostic[]>([]);
  const [responseCount, setResponseCount] = useState(0);
  const [hasResponse, setHasResponse] = useState(false);

  useEffect(() => {
    let active = true;
    const events = new AbortController();
    const mount = mountRef.current;
    if (!mount) return;

    setStatus('loading');
    setStatusText(i18n.t('preview.loading'));
    setDiagnostics([]);
    setResponseCount(0);
    setHasResponse(false);
    playerRef.current = null;
    mount.replaceChildren();

    const load = async () => {
      try {
        const { defineQtiAssessmentItemPlayer } = await import('@longsightgroup/qti3-player');
        if (!active) return;
        defineQtiAssessmentItemPlayer();

        const player = document.createElement('qti-assessment-item-player') as QtiPlayerElement;
        player.languageOfInterface = payload.locale;
        player.messageCatalog = playerCatalog;
        player.className = 'qti-preview-player';
        playerRef.current = player;
        const isCurrentPlayer = () => active && playerRef.current === player;

        player.addEventListener('qti-diagnostics', (event) => {
          if (!isCurrentPlayer()) return;
          const detail = (event as CustomEvent<{ diagnostics?: QtiDiagnostic[] }>).detail;
          setDiagnostics(detail?.diagnostics ?? []);
        }, { signal: events.signal });
        player.addEventListener('qti-ready', () => {
          if (!isCurrentPlayer()) return;
          setStatus('ready');
          setStatusText(i18n.t('preview.ready'));
        }, { signal: events.signal });
        player.addEventListener('qti-statechange', (event) => {
          if (!isCurrentPlayer()) return;
          const detail = (event as CustomEvent<{ state?: QtiAttemptStateV1 }>).detail;
          const responses = detail?.state?.responses;
          setResponseCount(responses ? Object.keys(responses).length : 0);
          setHasResponse(
            Object.values(responses ?? {}).some((value) =>
              value !== null && value !== '' && (!Array.isArray(value) || value.length > 0)
            ),
          );
        }, { signal: events.signal });
        player.addEventListener('qti-score', () => {
          if (!isCurrentPlayer()) return;
          setStatusText(i18n.t('preview.score'));
          const state = player.serialize();
          if (state) scoredCallback.current?.(state);
        }, { signal: events.signal });
        player.addEventListener('qti-validation', () => {
          if (!isCurrentPlayer()) return;
          setStatusText(i18n.t('preview.validation'));
        }, { signal: events.signal });

        mount.replaceChildren(player);
        await player.loadXml(xml, {
          status: 'interacting',
          sessionControl: {
            validateResponses: true,
            showFeedback: true,
          },
        });
      } catch (_err) {
        if (!active) return;
        setStatus('error');
        setStatusText(i18n.t('preview.error'));
      }
    };

    void load();
    return () => {
      active = false;
      events.abort();
      playerRef.current = null;
      mount.replaceChildren();
    };
  }, [xml, payload.locale, i18n]);

  const visibleDiagnostics = diagnostics.filter((diagnostic) =>
    diagnostic.severity === 'error' || diagnostic.severity === 'warning'
  );
  const statusClass = status === 'error'
    ? 'text-error'
    : status === 'ready'
    ? 'text-success'
    : 'text-base-content/60';

  function resetPreview() {
    playerRef.current?.reset();
    setStatusText(i18n.t('preview.reset'));
  }

  function scorePreview() {
    playerRef.current?.scoreAttempt({ validateResponses: true });
  }

  return (
    <div
      class={`qti-preview qti-preview--${mode} ${
        mode === 'bank' ? '' : 'ds-card ds-card-border border-base-200/70 bg-base-100'
      }`}
      data-qti-preview-host='true'
    >
      <div class={mode === 'bank' ? 'space-y-3' : 'ds-card-body gap-4'}>
        <div class='flex flex-wrap items-start justify-between gap-3'>
          <div class='min-w-0'>
            {mode !== 'bank' && (
              <div class='text-xs uppercase text-base-content/60'>{i18n.t('preview.label')}</div>
            )}
            {mode !== 'bank' && (
              <h3 class='truncate text-lg font-medium text-base-content'>
                {title || i18n.t('preview.untitled')}
              </h3>
            )}
            <p role='status' aria-live='polite' class={`mt-1 text-xs ${statusClass}`}>
              {statusText}
            </p>
          </div>
          <div class='flex flex-wrap items-center gap-2'>
            {!onScored && (
              <span class='text-xs text-base-content/60'>
                {i18n.t('preview.responseChanges', { count: responseCount })}
              </span>
            )}
            <Button
              type='button'
              size={onScored ? 'sm' : 'xs'}
              variant={onScored ? 'primary' : 'ghost'}
              disabled={status !== 'ready' || Boolean(onScored && !hasResponse)}
              onClick={scorePreview}
            >
              {scoreLabel ?? i18n.t('preview.check')}
            </Button>
            {!onScored && (
              <Button
                type='button'
                size='xs'
                variant='ghost'
                disabled={status !== 'ready'}
                onClick={resetPreview}
              >
                {i18n.t('preview.resetButton')}
              </Button>
            )}
          </div>
        </div>

        {showDiagnostics && visibleDiagnostics.length > 0 && (
          <div class='rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-base-content'>
            <div class='mb-1 font-medium'>{i18n.t('preview.diagnostics')}</div>
            <ul class='list-disc space-y-1 pl-5'>
              {visibleDiagnostics.map((diagnostic, index) => (
                <li key={`${diagnostic.code}-${index}`}>
                  <span class='font-medium'>
                    {i18n.t(
                      `preview.severity.${diagnostic.severity === 'error' ? 'error' : 'warning'}`,
                    )}
                  </span>
                  {diagnostic.code ? ` ${diagnostic.code}: ` : ': '}
                  {diagnostic.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div ref={mountRef} class='qti-preview__canvas min-h-24' />
      </div>
    </div>
  );
}
