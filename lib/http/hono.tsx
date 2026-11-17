import { RootRendererContext } from '../rendering/root_renderer.ts';
import type { Context } from 'hono';
import type { RequestDiagnosticVariables } from './request_diagnostics.ts';
import { renderToString } from 'preact-render-to-string';
import type { ComponentChildren } from 'preact';
import { AppDocument } from '../../components/AppDocument.tsx';
import { HeaderLayout } from '../../components/Header.tsx';
import { HydrationRoot } from '../server/HydrationRoot.tsx';
import { createI18nPayload } from '../i18n/payload.ts';
import type { AppState } from './app_state.ts';
import type { QflowRuntimeBindings } from '../runtime.ts';
import { appAssets } from 'virtual:qflow-assets';
import type { InterfaceLocale } from '../i18n/locale.ts';
import { hasCapability } from '../roles.ts';
import ErrorPage from '../../components/ErrorPage.tsx';
import { createI18n } from '../i18n/messages.ts';
import { catalogForLocale } from '../i18n/catalogs.ts';

/** Hono receives only the runtime capabilities owned by its Worker composition. */
export type AppEnv = {
  Bindings: { readonly runtime: QflowRuntimeBindings; readonly clientAddress: string | null };
  Variables: RequestDiagnosticVariables & {
    readonly state: AppState;
    readonly locale: InterfaceLocale;
  };
};
/** Framework context confined to the HTTP adapter. */
export type HttpContext = Context<AppEnv>;

/** Read the locale already resolved by the shared request policy. */
export function localeFor(c: HttpContext) {
  return c.get('state').interfaceLocale;
}

/** Reuse this request's translator rather than resolving preferences again. */
export function i18nFor(c: HttpContext) {
  return c.get('state').i18n;
}

function AssetHead() {
  return (
    <>
      {appAssets.styles.map((href) => <link key={href} rel='stylesheet' href={href} />)}
      {appAssets.preloads.map((href) => <link key={href} rel='modulepreload' href={href} />)}
      <script type='module' src={appAssets.bootstrap} />
    </>
  );
}

/** Render an error even when request policy failed before authentication/state resolution. */
export function errorPage(c: HttpContext): Response {
  const interfaceLocale = c.get('locale');
  const i18n = createI18n(interfaceLocale, catalogForLocale(interfaceLocale));
  const html = renderToString(
    <AppDocument
      state={{ interfaceLocale }}
      notices={null}
      header={<HeaderLayout i18n={i18n} accountMenu={null} />}
      head={<AssetHead />}
    >
      <ErrorPage state={{ i18n }} />
    </AppDocument>,
  );
  return new Response('<!DOCTYPE html>' + html, {
    status: 500,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

/** Render one route inside the localized document and its declared client assets. */
export function page(c: HttpContext, children: ComponentChildren, status = 200): Response {
  const locale = localeFor(c);
  const state = c.get('state');
  const { catalog, i18n } = state;
  const currentPath = new URL(c.req.url).pathname;
  const html = renderToString(
    <RootRendererContext.Provider value={(payload) => <HydrationRoot payload={payload} />}>
      <AppDocument
        state={c.get('state')}
        notices={state.auth && hasCapability(state.auth.role, 'manage_content') &&
            ['/assessments', '/items', '/items/organize'].includes(currentPath)
          ? (
            <HydrationRoot
              payload={{
                id: 'qf-organization-notices',
                component: 'OrganizationNotices',
                props: { payload: createI18nPayload(locale, catalog, ['core']) },
              }}
            />
          )
          : null}
        header={
          <HeaderLayout
            showAccountMenu={Boolean(c.get('state').auth)}
            currentPath={currentPath}
            i18n={i18n}
            accountMenu={
              <HydrationRoot
                payload={{
                  id: 'qf-account-menu',
                  component: 'AccountMenu',
                  props: { payload: createI18nPayload(locale, catalog, ['core']) },
                }}
              />
            }
          />
        }
        head={<AssetHead />}
      >
        {children}
      </AppDocument>
    </RootRendererContext.Provider>,
  );
  return new Response('<!DOCTYPE html>' + html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
