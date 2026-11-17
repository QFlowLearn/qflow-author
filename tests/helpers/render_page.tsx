import { type ComponentChildren } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { RootRendererContext } from '../../lib/rendering/root_renderer.ts';
import { renderSsrRoot } from '../../lib/server/root_views.ts';

/** Render a page with the explicit SSR owner used by the Fresh adapter. */
export function renderPage(node: ComponentChildren): string {
  return renderToString(
    <RootRendererContext.Provider value={renderSsrRoot}>{node}</RootRendererContext.Provider>,
  );
}
