import { ROOTS } from '../client/root_registry.ts';
import { encodeRootPayload, type RootPayload } from '../client/root_payload.ts';

import { renderSsrRoot } from './root_views.ts';
export { renderSsrRoot } from './root_views.ts';

/** Render one nonoverlapping root and its inert JSON payload. Never use this wrapper inside tables. */
export function HydrationRoot({ payload }: { readonly payload: RootPayload }) {
  const encoded = encodeRootPayload(payload);
  const Root = ROOTS[payload.component].tag;
  return (
    <>
      <Root id={payload.id} data-qflow-root={payload.component} data-qflow-state='pending'>
        {renderSsrRoot(payload)}
      </Root>
      <script
        type='application/json'
        data-qflow-payload-for={payload.id}
        // oxlint-disable-next-line react/no-danger -- SAFETY: encodeRootPayload escapes HTML delimiters and Unicode separators in inert JSON script data.
        dangerouslySetInnerHTML={{ __html: encoded }}
      />
    </>
  );
}
