import type { QflowRuntime, QflowRuntimeState } from '../runtime.ts';
import type { RequestContext } from '../tenants.ts';
import type { I18n, MessageCatalog } from '../i18n/messages.ts';
import type { InterfaceLocale } from '../i18n/locale.ts';

/** Request-scoped state shared by HTTP adapters, middleware, and routes. */
export type AppState = QflowRuntimeState & {
  readonly runtime: QflowRuntime;
  auth?: RequestContext;
  readonly interfaceLocale: InterfaceLocale;
  readonly catalog: MessageCatalog;
  readonly i18n: I18n;
};
