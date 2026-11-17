import type { AppState } from '../lib/http/app_state.ts';
import { localeMetadata } from '../lib/i18n/locale.ts';
import type { ComponentChildren } from 'preact';

/** Preload the primary latin sans face used across the app shell. */
export function PrimaryFontPreload() {
  return (
    <link
      rel='preload'
      href='/fonts/inter-latin.woff2'
      as='font'
      type='font/woff2'
      crossOrigin='anonymous'
    />
  );
}

/** Render the localized document shell from already-resolved request state. */
export function AppDocument(
  props: {
    readonly state: Pick<AppState, 'interfaceLocale'>;
    readonly notices: ComponentChildren;
    readonly children: ComponentChildren;
    readonly head?: ComponentChildren;
    readonly header: ComponentChildren;
  },
) {
  const { state, notices, children, head, header } = props;
  return (
    <html
      lang={state.interfaceLocale}
      dir={localeMetadata(state.interfaceLocale).dir}
      data-theme='wireframe'
    >
      <head>
        <meta charSet='utf-8' />
        <meta name='viewport' content='width=device-width, initial-scale=1' />
        <PrimaryFontPreload />
        <link rel='icon' href='/favicon.svg' type='image/svg+xml' />
        <title>QFlowLearn</title>
        {
          // Apply theme early based on localStorage or system preference.
        }
        <script>
          {`(()=>{try{const k='qflow-theme';const lightTheme='wireframe';const stored=localStorage.getItem(k);const selected=(stored==='dark'||stored==='wireframe'||stored==='system')?stored:'system';const mql=window.matchMedia?window.matchMedia('(prefers-color-scheme: dark)'):null;const prefersDark=mql?mql.matches:false;const resolved=selected==='system'?(prefersDark?'dark':lightTheme):selected;document.documentElement.dataset.theme=resolved;if(mql){mql.addEventListener('change',(e)=>{const cur=localStorage.getItem(k);if(cur!=='system')return;document.documentElement.dataset.theme=e.matches?'dark':lightTheme;});}}catch(e){document.documentElement.dataset.theme='wireframe';}})();`}
        </script>
        {head}
      </head>
      <body class='qf-body'>
        {header}
        <main class='qf-shell qf-main'>
          {notices}
          {children}
        </main>
      </body>
    </html>
  );
}
