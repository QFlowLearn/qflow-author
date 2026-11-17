import { useEffect, useRef, useState } from 'preact/hooks';
import Button from '../components/ui/Button.tsx';
import { NoticeLabel, NoticePanel, NoticeRow } from '../components/ui/NoticePanel.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import type { I18nPayload } from '../lib/i18n/payload.ts';
import {
  type OrganizationNotice,
  type OrganizationNoticeSnapshot,
  parseOrganizationNoticeSnapshot,
} from '../lib/organization_notices.ts';

const endpoint = '/api/items/organization-notices';

/** Poll only visible home surfaces, without overlapping requests or stealing focus. */
export default function OrganizationNotices({ payload }: { readonly payload: I18nPayload }) {
  const { t } = createI18n(payload.locale, payload.namespaces);
  const [snapshot, setSnapshot] = useState<OrganizationNoticeSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const seen = useRef(false);
  const summary = useRef<HTMLElement>(null);
  const action = useRef<AbortController | null>(null);
  useEffect(() => () => action.current?.abort(), []);

  useEffect(() => {
    if (busy) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    async function read() {
      clearTimeout(timer);
      if (pending || document.hidden || controller.signal.aborted) return;
      pending = true;
      try {
        const response = await fetch(endpoint, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Notice request failed');
        const value = parseOrganizationNoticeSnapshot(await response.json());
        if (!value) throw new Error('Invalid notice response');
        if (controller.signal.aborted) return;
        if (value.total > 0) seen.current = true;
        setSnapshot(value);
        setError(false);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        pending = false;
        if (!controller.signal.aborted && !document.hidden) timer = setTimeout(read, 60_000);
      }
    }
    void read();
    document.addEventListener('visibilitychange', read);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', read);
    };
  }, [busy, refresh]);

  async function acknowledge(notice: OrganizationNotice, open: boolean) {
    if (action.current) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy(true);
    setActionError(false);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: notice.runId, executionId: notice.executionId }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      if (response.status !== 204) throw new Error('Notice acknowledgement failed');
      if (controller.signal.aborted) return;
      if (open) {
        globalThis.location.assign(`/items/organize/${notice.runId}?kind=organization`);
      } else {
        setSnapshot((current) =>
          current && ({
            total: Math.max(0, current.total - 1),
            notices: current.notices.filter((n) => n.executionId !== notice.executionId),
          })
        );
        summary.current?.focus();
      }
    } catch {
      if (!controller.signal.aborted) setActionError(true);
    } finally {
      action.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  if (!seen.current && !error) return null;
  return (
    <NoticePanel
      summary={snapshot
        ? t('core.organizationNotices.title', { count: snapshot.total })
        : t('core.organizationNotices.unavailable')}
      summaryRef={summary}
    >
      {(error || actionError) && (
        <p role='alert'>
          {t('core.organizationNotices.error')}{' '}
          <Button
            size='sm'
            disabled={busy}
            onClick={() => {
              setActionError(false);
              setRefresh((value) => value + 1);
            }}
          >
            {t('core.organizationNotices.retry')}
          </Button>
        </p>
      )}
      {snapshot?.total === 0 && !error && !actionError && (
        <p>{t('core.organizationNotices.empty')}</p>
      )}
      {snapshot && snapshot.total > snapshot.notices.length && (
        <p>{t('core.organizationNotices.more')}</p>
      )}
      <ul>
        {snapshot?.notices.map((notice) => (
          <NoticeRow key={notice.executionId}>
            <NoticeLabel>
              <strong>{notice.collection}</strong> — {t(`core.organizationNotices.${notice.state}`)}
            </NoticeLabel>
            <Button size='sm' disabled={busy} onClick={() => acknowledge(notice, true)}>
              {t('core.organizationNotices.open')}
            </Button>
            <Button
              size='sm'
              variant='ghost'
              disabled={busy}
              onClick={() => acknowledge(notice, false)}
            >
              {t('core.organizationNotices.dismiss')}
            </Button>
          </NoticeRow>
        ))}
      </ul>
    </NoticePanel>
  );
}
