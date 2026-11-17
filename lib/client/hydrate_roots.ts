import { hydrate, render } from 'preact';
import { loadRootView, parseRootPayload } from './root_registry.ts';

const OWNERSHIP = Symbol.for('qflow.hydration.ownership');
type RootGlobal = typeof globalThis & { [OWNERSHIP]?: WeakMap<Element, Promise<void>> };
// SAFETY: this symbol slot is installed only by this browser module and shared across duplicate bootstrap URLs.
const rootGlobal = globalThis as RootGlobal;
const owned = rootGlobal[OWNERSHIP] ??= new WeakMap<Element, Promise<void>>();
/** Hydrate declared roots once; failed imports leave server HTML and native form controls intact. */
export async function hydrateRoots(document: Document): Promise<void> {
  const roots = [...document.querySelectorAll<HTMLElement>('[data-qflow-root]')];
  await Promise.all(roots.map((root) => {
    const current = owned.get(root);
    if (current) return current;
    const operation = hydrateOne(document, root);
    owned.set(root, operation);
    return operation;
  }));
}

async function hydrateOne(document: Document, root: HTMLElement): Promise<void> {
  try {
    if (
      root.parentElement?.closest('[data-qflow-root]') || root.querySelector('[data-qflow-root]')
    ) throw new Error('Overlapping hydration roots.');
    if (document.querySelectorAll(`[id="${CSS.escape(root.id)}"]`).length !== 1) {
      throw new Error('Duplicate hydration root identity.');
    }
    const scripts = [
      ...document.querySelectorAll<HTMLScriptElement>(
        'script[type="application/json"][data-qflow-payload-for]',
      ),
    ]
      .filter((script) => script.dataset.qflowPayloadFor === root.id);
    if (scripts.length !== 1 || !scripts[0]) throw new Error('Missing root payload.');
    const decoded: unknown = JSON.parse(scripts[0].textContent ?? '');
    const parsed = parseRootPayload(decoded);
    if (
      parsed._tag === 'Invalid' || parsed.value.id !== root.id ||
      parsed.value.component !== root.dataset.qflowRoot
    ) throw new Error('Invalid root payload.');
    const payload = parsed.value;
    const view = await loadRootView(payload);
    if (!root.isConnected) return;
    hydrate(view, root);
    root.dataset.qflowState = 'ready';
  } catch {
    root.dataset.qflowState = 'error';
    root.dispatchEvent(new CustomEvent('qflow:hydration-error', { bubbles: true }));
  }
}

/** Unmount only a declared owned root and release its hydration bookkeeping. */
export async function unmountRoot(root: HTMLElement): Promise<void> {
  const current = owned.get(root);
  if (!current) return;
  await current;
  render(null, root);
  owned.delete(root);
}
