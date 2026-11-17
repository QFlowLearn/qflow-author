import { type ComponentType, createElement, type FunctionComponent } from 'preact';
import { useContext, useId } from 'preact/hooks';
import type { RootPayload } from '../client/root_registry.ts';
import { IslandOwnershipContext } from './island_context.tsx';
import { RootRendererContext } from './root_renderer.ts';

type Props<K extends RootPayload['component']> = Extract<RootPayload, { component: K }>['props'];

/** Declare a server mount; a child already inside an island stays in its parent's tree. */
export function mountIsland<K extends RootPayload['component'], P extends Props<K> & object>(
  { component, View }: {
    readonly component: K;
    readonly View: ComponentType<P>;
  },
): FunctionComponent<P> {
  return function IslandMount(props) {
    const owned = useContext(IslandOwnershipContext);
    const root = useContext(RootRendererContext);
    const identity = useId();
    if (owned) return createElement(View, props);
    if (!root) throw new Error('Hydration root renderer is not configured.');
    // SAFETY: the generic component key fixes both the View and its data props at declaration.
    const payload = {
      id: `qf-${component.toLowerCase()}-${identity.toLowerCase()}`,
      component,
      props,
    } as RootPayload;
    return root(payload);
  };
}
