import { isValidQtiIdentifier } from '../qti_identifiers.ts';
import type { ItemLanguage } from './item_language.ts';
import {
  type Qti3PortableCustomAuthoringItem,
  sanitizedQti3BodyFragment,
  sanitizedQti3InlineFragment,
  trustedQti3Fragment,
} from './qti3_writer_adapter.ts';

export type PortableInteractionModule = {
  id: string;
  primaryPath?: string;
  fallbackPath?: string;
};

export type PortableDataAttribute = { name: string; value: string };

export type PortableCustomDraft = {
  title: string;
  promptHtml?: string;
  bodyHtml?: string;
  responseIdentifier: string;
  portableCustomTypeIdentifier?: string;
  portableModule?: string;
  portableClassName?: string;
  portableLabel?: string;
  portableBaseType?: string;
  portableCardinality?: 'single' | 'multiple' | 'ordered' | 'record';
  portableInteractionMarkup?: string;
  portableDataAttributes?: PortableDataAttribute[];
  portableInteractionModules?: PortableInteractionModule[];
  portableModulesPrimaryConfiguration?: string;
  portableModulesSecondaryConfiguration?: string;
  portableResponseProcessingXml?: string;
};

export type BuildOptions = { identifier?: string; lang: ItemLanguage };

const CARDINALITIES = ['single', 'multiple', 'ordered', 'record'] as const;
const ATTR_NAME_RE = /^[A-Za-z_][A-Za-z0-9:._-]*$/;

export function defaultsPortableCustom(): PortableCustomDraft {
  return {
    title: 'Portable Custom Interaction',
    promptHtml: 'Provide instructions for the custom interaction.',
    bodyHtml: '<p>Describe the portable custom interaction.</p>',
    responseIdentifier: 'RESPONSE',
    portableCustomTypeIdentifier: 'urn:example:portable:interaction',
    portableModule: 'pciModule',
    portableBaseType: 'string',
    portableCardinality: 'single',
    portableInteractionMarkup: '<div class="pci-root">Portable custom markup</div>',
    portableDataAttributes: [{ name: 'data-mode', value: 'demo' }],
    portableInteractionModules: [],
    portableModulesPrimaryConfiguration: '',
    portableModulesSecondaryConfiguration: '',
  };
}

export function validatePortableCustom(draft: PortableCustomDraft): string[] {
  const errs: string[] = [];
  if (!draft.title?.trim()) errs.push('Title is required.');

  const responseId = (draft.responseIdentifier ?? '').trim();
  if (!responseId) errs.push('Response identifier is required.');
  else if (!isValidQtiIdentifier(responseId)) {
    errs.push('Response identifier must be a valid QTI identifier.');
  }

  const baseType = (draft.portableBaseType ?? '').trim();
  if (!baseType) errs.push('Response base type is required.');

  const cardinality = (draft.portableCardinality ?? 'single') as string;
  if (!CARDINALITIES.includes(cardinality as any)) {
    errs.push('Response cardinality must be single, multiple, ordered, or record.');
  }

  const typeId = (draft.portableCustomTypeIdentifier ?? '').trim();
  if (!typeId) errs.push('Custom interaction type identifier is required.');

  const moduleAttr = (draft.portableModule ?? '').trim();
  if (moduleAttr && !isValidQtiIdentifier(moduleAttr)) {
    errs.push('Module name must be a valid QTI identifier.');
  }

  const modules = Array.isArray(draft.portableInteractionModules)
    ? draft.portableInteractionModules
    : [];
  if (!moduleAttr && modules.length === 0) {
    errs.push('Provide a module name or at least one interaction module.');
  }
  const primaryConfig = (draft.portableModulesPrimaryConfiguration ?? '').trim();
  const secondaryConfig = (draft.portableModulesSecondaryConfiguration ?? '').trim();
  if ((primaryConfig || secondaryConfig) && modules.length === 0) {
    errs.push('Interaction modules are required when module configuration is provided.');
  }

  for (const mod of modules) {
    const id = (mod?.id ?? '').trim();
    if (!id) {
      errs.push('Interaction modules must include an id.');
      continue;
    }
    if (!isValidQtiIdentifier(id)) {
      errs.push(`Interaction module id "${id}" must be a valid QTI identifier.`);
    }
  }

  const markup = draft.portableInteractionMarkup;
  if (typeof markup !== 'string') errs.push('Interaction markup is required.');

  const attrs = Array.isArray(draft.portableDataAttributes) ? draft.portableDataAttributes : [];
  for (const attr of attrs) {
    const name = (attr?.name ?? '').trim();
    if (!name) {
      errs.push('Data attribute names cannot be empty.');
      continue;
    }
    if (!ATTR_NAME_RE.test(name)) {
      errs.push(`Data attribute "${name}" is not a valid XML attribute name.`);
      continue;
    }
    if (!name.startsWith('data-')) {
      errs.push(`Data attribute "${name}" must start with "data-".`);
    }
  }

  return errs;
}

export function toQti3PortableCustomAuthoringItem(
  draft: PortableCustomDraft,
  opts: BuildOptions,
): Qti3PortableCustomAuthoringItem {
  const className = (draft.portableClassName ?? '').trim();
  const label = (draft.portableLabel ?? '').trim();
  const responseProcessing = (draft.portableResponseProcessingXml ?? '').trim();
  const markup = draft.portableInteractionMarkup;
  return {
    interactionType: 'portableCustom',
    identifier: opts.identifier ?? `item-${crypto.randomUUID()}`,
    title: draft.title || 'Untitled',
    lang: opts.lang,
    bodyHtml: sanitizedQti3BodyFragment(draft.bodyHtml),
    promptHtml: sanitizedQti3InlineFragment(draft.promptHtml),
    responseIdentifier: draft.responseIdentifier ?? 'RESPONSE',
    responseBaseType:
      ((draft.portableBaseType ?? 'string').trim() || 'string') as Qti3PortableCustomAuthoringItem[
        'responseBaseType'
      ],
    responseCardinality: (draft.portableCardinality ?? 'single') as Qti3PortableCustomAuthoringItem[
      'responseCardinality'
    ],
    customInteractionTypeIdentifier: (draft.portableCustomTypeIdentifier ?? '').trim(),
    module: (draft.portableModule ?? '').trim() || undefined,
    label: label || undefined,
    classNames: className ? [className] : [],
    dataAttributes: (draft.portableDataAttributes ?? []).map((attr) => ({
      name: attr.name,
      value: attr.value,
    })),
    interactionModules: toQti3PortableInteractionModules(draft),
    interactionMarkupHtml: typeof markup === 'string'
      ? trustedQti3Fragment(markup.trim())
      : undefined,
    responseProcessingXml: responseProcessing ? trustedQti3Fragment(responseProcessing) : undefined,
  };
}

function toQti3PortableInteractionModules(
  draft: PortableCustomDraft,
): Qti3PortableCustomAuthoringItem['interactionModules'] {
  const modules = Array.isArray(draft.portableInteractionModules)
    ? draft.portableInteractionModules
    : [];
  const primaryConfiguration = (draft.portableModulesPrimaryConfiguration ?? '').trim();
  const secondaryConfiguration = (draft.portableModulesSecondaryConfiguration ?? '').trim();
  if (!modules.length && !primaryConfiguration && !secondaryConfiguration) return undefined;
  return {
    primaryConfiguration: primaryConfiguration || undefined,
    secondaryConfiguration: secondaryConfiguration || undefined,
    modules: modules.map((mod) => ({
      id: mod.id,
      primaryPath: (mod.primaryPath ?? '').trim() || undefined,
      fallbackPath: (mod.fallbackPath ?? '').trim() || undefined,
    })),
  };
}
