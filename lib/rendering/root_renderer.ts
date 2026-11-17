import { type ComponentChildren, createContext } from 'preact';
import type { RootPayload } from '../client/root_registry.ts';

/** Rendering policy selected by the active SSR adapter. */
export type RootRenderer = (payload: RootPayload) => ComponentChildren;
/** Rendering context belongs to the view layer, independent of HTTP request types. */
export const RootRendererContext = createContext<RootRenderer | null>(null);
