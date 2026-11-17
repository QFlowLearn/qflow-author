import { OwnedIsland } from '../rendering/island_context.tsx';
import {
  type ComponentChildren,
  type ComponentProps,
  type ComponentType,
  createElement,
} from 'preact';

/** Only names, wrapper tags and dynamic imports belong in the bootstrap's static graph. */
export const ROOTS = {
  BankEnrichmentJobControls: {
    tag: 'div',
    load: () => import('../../islands/BankEnrichmentJobControls.tsx'),
  },
  MemberPicker: { tag: 'div', load: () => import('../../islands/MemberPicker.tsx') },
  QuestionOrganizationProgress: {
    tag: 'div',
    load: () => import('../../islands/QuestionOrganizationProgress.tsx'),
  },
  SsoSettingsForm: { tag: 'div', load: () => import('../../islands/SsoSettingsForm.tsx') },
  QuestionOrganizationSetup: {
    tag: 'div',
    load: () => import('../../islands/QuestionOrganizationSetup.tsx'),
  },
  BankEnrichmentCorrection: {
    tag: 'div',
    load: () => import('../../islands/BankEnrichmentCorrection.tsx'),
  },
  BankEnrichmentSetup: { tag: 'div', load: () => import('../../islands/BankEnrichmentSetup.tsx') },
  BankCollectionOrder: { tag: 'div', load: () => import('../../islands/BankCollectionOrder.tsx') },
  ItemEditor: { tag: 'div', load: () => import('../../islands/ItemEditor.tsx') },
  BringFilesIntake: { tag: 'div', load: () => import('../../islands/BringFilesIntake.tsx') },
  AssessmentActionsMenu: {
    tag: 'div',
    load: () => import('../../islands/AssessmentActionsMenu.tsx'),
  },
  ArrangeBoard: { tag: 'div', load: () => import('../../islands/ArrangeBoard.tsx') },
  ImportProgress: { tag: 'div', load: () => import('../../islands/ImportProgress.tsx') },
  ConversionGeneration: {
    tag: 'div',
    load: () => import('../../islands/ConversionGeneration.tsx'),
  },
  BlueprintPanel: { tag: 'div', load: () => import('../../islands/BlueprintPanel.tsx') },
  AssessmentBuilder: { tag: 'div', load: () => import('../../islands/AssessmentBuilder.tsx') },
  QtiItemPreview: { tag: 'div', load: () => import('../../islands/QtiItemPreview.tsx') },
  BankCategoryFilters: { tag: 'div', load: () => import('../../islands/BankCategoryFilters.tsx') },
  BankQuestionTable: { tag: 'div', load: () => import('../../islands/BankQuestionTable.tsx') },
  BankBulkControls: { tag: 'div', load: () => import('../../islands/BankBulkControls.tsx') },
  BankOverview: { tag: 'div', load: () => import('../../islands/BankOverview.tsx') },
  AccountMenu: { tag: 'div', load: () => import('../../islands/AccountMenu.tsx') },
  LocalizedTimestamp: { tag: 'span', load: () => import('../../islands/LocalizedTimestamp.tsx') },
  OrganizationNotices: { tag: 'div', load: () => import('../../islands/OrganizationNotices.tsx') },
} as const;

type RootName = keyof typeof ROOTS;
// Standalone roots transport data; callbacks remain inside the owning component tree.
type DataProps<P> = {
  [K in keyof P as P[K] extends ((...args: never[]) => unknown) | undefined ? never : K]: P[K];
};
/** Server-issued props follow each component's public data contract. */
export type RootPayload = {
  [K in RootName]: {
    readonly id: string;
    readonly component: K;
    readonly props: DataProps<
      ComponentProps<Awaited<ReturnType<(typeof ROOTS)[K]['load']>>['default']>
    >;
  };
}[RootName];

/** Load only the component named by this document's validated envelope. */
export async function loadRootView(payload: RootPayload): Promise<ComponentChildren> {
  const module = await ROOTS[payload.component].load();
  // SAFETY: RootPayload maps the same discriminant to its component's typed, server-issued props.
  const View = module.default as ComponentType<RootPayload['props']>;
  return createElement(OwnedIsland, { id: payload.id }, createElement(View, payload.props));
}

/** Result of checking the document-owned envelope; domain/HTTP parsers belong at their input seams. */
export type RootPayloadResult = { readonly _tag: 'Parsed'; readonly value: RootPayload } | {
  readonly _tag: 'Invalid';
};

/** Check identity and envelope shape for JSON emitted by this application's typed server renderer. */
export function parseRootPayload(value: unknown): RootPayloadResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { _tag: 'Invalid' };
  const keys = Object.keys(value),
    id = Reflect.get(value, 'id'),
    component = Reflect.get(value, 'component'),
    props: unknown = Reflect.get(value, 'props');
  if (
    keys.length !== 3 || !keys.every((key) => ['id', 'component', 'props'].includes(key)) ||
    typeof id !== 'string' || !/^qf-[a-z0-9-]+$/.test(id) || typeof component !== 'string' ||
    !Object.hasOwn(ROOTS, component) ||
    !props || typeof props !== 'object' || Array.isArray(props)
  ) return { _tag: 'Invalid' };
  // SAFETY: this is the same-document server-issued data channel, not an external JSON API.
  // The server checks its component contract and plain JSON representation; the browser checks the envelope.
  return { _tag: 'Parsed', value: value as RootPayload };
}
