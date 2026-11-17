import { useEffect, useState } from 'preact/hooks';
import Button from '../components/ui/Button.tsx';
import Checkbox from '../components/ui/Checkbox.tsx';
import { hasCapability, roleAtLeast } from '../lib/roles.ts';
import { I18nProvider, useI18n } from '../lib/i18n/context.tsx';
import type { I18nPayload } from '../lib/i18n/payload.ts';

import { type AccountPayload, parseAccountPayload } from '../lib/client/account_payload.ts';
import { parseUserSettings, type UserSettings } from '../lib/settings.ts';

type State = { loading: boolean; me: AccountPayload | null };

type Theme = 'wireframe' | 'dark';

function initialsFromLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return '?';
  const base = trimmed.includes('@') ? trimmed.split('@')[0] : trimmed;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export default function AccountMenu({ payload }: { readonly payload: I18nPayload }) {
  return (
    <I18nProvider payload={payload}>
      <AccountMenuContent />
    </I18nProvider>
  );
}

function AccountMenuContent() {
  const i18n = useI18n();
  const [state, setState] = useState<State>({ loading: true, me: null });
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [activeTheme, setActiveTheme] = useState<Theme>('wireframe');

  useEffect(() => {
    let active = true;
    fetch('/api/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return;
        setState({ loading: false, me: parseAccountPayload(data) });
      })
      .catch(() => {
        if (!active) return;
        setState({ loading: false, me: null });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!state.me) {
      setSettings(null);
      setSettingsLoading(false);
      return;
    }

    let active = true;
    setSettingsLoading(true);
    (async () => {
      try {
        const rs = await fetch('/api/settings');
        if (active && rs.ok) setSettings(parseUserSettings(await rs.json(), 'complete'));
      } catch (_err) {
        /* ignore settings fetch failures */
      }
      if (active) setSettingsLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [state.me]);

  useEffect(() => {
    if (settings?.theme === 'dark' || settings?.theme === 'wireframe') {
      setActiveTheme(settings.theme);
      return;
    }
    const cur = document.documentElement.dataset.theme;
    if (cur === 'wireframe' || cur === 'dark') setActiveTheme(cur);
  }, [settings?.theme]);

  async function updateSettings(patch: Partial<Pick<UserSettings, 'theme' | 'choiceRichText'>>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
    } catch (_err) {
      /* ignore background sync errors */
    }
  }

  async function applyTheme(next: Theme) {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('qflow-theme', next);
    } catch (_err) {
      /* ignore persistence errors */
    }
    await updateSettings({ theme: next });
  }

  const signOut = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
    } finally {
      globalThis.location.href = '/login';
    }
  };

  if (state.loading) {
    return <span class='inline-flex h-10 min-w-[7rem]' aria-hidden='true' />;
  }

  if (!state.me) {
    return <Button variant='ghost' href='/login'>{i18n.t('nav.signIn')}</Button>;
  }

  const label = state.me.user.displayName || state.me.user.email;
  const initials = initialsFromLabel(label);
  const role = state.me.role;
  const isAdmin = roleAtLeast(role, 'admin');

  return (
    <div class='ds-dropdown ds-dropdown-end'>
      <Button type='button' variant='ghost' size='sm' class='gap-2' tabIndex={0}>
        <div class='ds-avatar ds-placeholder'>
          <div class='bg-neutral text-neutral-content w-8 rounded-[10px]'>
            <span class='text-xs'>{initials}</span>
          </div>
        </div>
        <span class='hidden sm:inline text-sm'>{label}</span>
        <svg
          class='h-4 w-4'
          fill='none'
          viewBox='0 0 24 24'
          stroke='currentColor'
          aria-hidden='true'
        >
          <path
            stroke-linecap='round'
            stroke-linejoin='round'
            stroke-width='1.2'
            d='M19 9l-7 7-7-7'
          />
        </svg>
      </Button>
      <ul
        tabIndex={0}
        class='ds-dropdown-content ds-menu bg-base-100 rounded-box z-50 w-56 p-2 shadow-lg border border-base-200'
      >
        <li>
          <label class='flex items-center justify-between gap-3'>
            <span>{i18n.t('nav.darkMode')}</span>
            <Checkbox
              variant='toggle'
              size='sm'
              class='theme-controller'
              value='dark'
              disabled={settingsLoading}
              checked={activeTheme === 'dark'}
              onChange={() => {
                const next = activeTheme === 'dark' ? 'wireframe' : 'dark';
                setActiveTheme(next);
                applyTheme(next);
              }}
            />
          </label>
        </li>
        <li class='ds-divider' />
        <li>
          <a href='/settings'>{i18n.t('nav.accountSettings')}</a>
        </li>
        <li>
          <a href='/settings/editor'>{i18n.t('nav.editorPreferences')}</a>
        </li>
        <li>
          <a href='/settings/password'>{i18n.t('nav.changePassword')}</a>
        </li>
        <li>
          <a href='/settings/canvas'>{i18n.t('nav.canvasConnections')}</a>
        </li>
        {isAdmin && (
          <>
            <li class='ds-divider' />
            <li class='ds-menu-title text-base-content/80'>{i18n.t('nav.admin')}</li>
            <li>
              <a href='/settings/sso'>{i18n.t('nav.ssoSettings')}</a>
            </li>
            <li>
              <a href='/settings/tenant'>{i18n.t('nav.workspaceSettings')}</a>
            </li>
            <li>
              <a href='/settings/sessions'>{i18n.t('nav.sessions')}</a>
            </li>
            <li>
              <a href='/settings/migrations'>{i18n.t('nav.importAnalytics')}</a>
            </li>
            <li>
              <a href='/settings/audit'>{i18n.t('nav.auditLog')}</a>
            </li>
            {role && hasCapability(role, 'manage_members') && (
              <li>
                <a href='/settings/members'>{i18n.t('nav.members')}</a>
              </li>
            )}
          </>
        )}
        <li class='ds-divider' />
        <li>
          <button type='button' class='text-error' onClick={signOut}>
            {i18n.t('nav.signOut')}
          </button>
        </li>
      </ul>
    </div>
  );
}
