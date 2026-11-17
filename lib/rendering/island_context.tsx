import { type ComponentChildren, createContext } from 'preact';
import { useContext, useId, useMemo, useState } from 'preact/hooks';

/** A root owns every interactive child and its DOM identities. */
export const IslandOwnershipContext = createContext(false);
const IdentityContext = createContext<{ readonly claim: () => string } | null>(null);

/** Start the same explicit identity namespace during SSR and independent browser hydration. */
export function OwnedIsland(
  { id, children }: { readonly id: string; readonly children?: ComponentChildren },
) {
  const identities = useMemo(() => {
    let next = 0;
    return { claim: () => `${id}-control-${next++}` };
  }, [id]);
  return (
    <IslandOwnershipContext.Provider value>
      <IdentityContext.Provider value={identities}>{children}</IdentityContext.Provider>
    </IslandOwnershipContext.Provider>
  );
}

/** Preserve native Preact IDs in ordinary trees and stable, unique IDs in standalone roots. */
export function useDomId(): string {
  const nativeId = useId();
  const identities = useContext(IdentityContext);
  const [id] = useState(() => identities ? identities.claim() : nativeId);
  return id;
}
