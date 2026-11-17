import type { ImportAdapter, ImportSource, SniffResult } from './types.ts';
import { assertImportArchivePolicy } from './archive_policy.ts';
import {
  DEFAULT_IMPORT_ADAPTER_KEYS,
  type ImportAdapterDescriptorKey,
} from './adapter_descriptors.ts';
import { examViewXmlAdapter } from './adapters/examview_xml.ts';
import { moodleXmlAdapter } from './adapters/moodle_xml.ts';
import { giftAdapter } from './adapters/gift.ts';
import { aikenAdapter } from './adapters/aiken.ts';
import { qti12Adapter } from './adapters/qti12.ts';
import { blackboardAdapter } from './adapters/blackboard.ts';
import { qti21Adapter } from './adapters/qti21.ts';
import { qti3Adapter } from './adapters/qti3.ts';
import { imsccAdapter } from './adapters/imscc.ts';
import { respondusStandardAdapter } from './adapters/respondus_standard.ts';

export type ImportDetection = {
  adapter: ImportAdapter;
  sniff: SniffResult;
};

export type InspectedImportAdapter = ImportDetection & {
  readonly index: number;
};

export type ImportAdapterRef = {
  readonly id: string;
  readonly version: string;
};

const ADAPTERS_BY_DESCRIPTOR: Readonly<Record<ImportAdapterDescriptorKey, ImportAdapter>> = {
  qti3: qti3Adapter,
  imscc: imsccAdapter,
  qti21: qti21Adapter,
  qti12: qti12Adapter,
  blackboard: blackboardAdapter,
  examViewXml: examViewXmlAdapter,
  moodleXml: moodleXmlAdapter,
  respondusStandard: respondusStandardAdapter,
  gift: giftAdapter,
  aiken: aikenAdapter,
};

const DEFAULT_ADAPTERS: readonly ImportAdapter[] = DEFAULT_IMPORT_ADAPTER_KEYS.map((key) =>
  ADAPTERS_BY_DESCRIPTOR[key]
);

export async function detectImportAdapter(
  source: ImportSource,
  adapters: readonly ImportAdapter[] = DEFAULT_ADAPTERS,
): Promise<ImportDetection> {
  if (!adapters.length) throw new Error('No import adapters configured');

  const results = await inspectImportAdapters(source, adapters);

  const supported = results.filter((entry) => entry.sniff.supported);
  if (supported.length === 0) {
    throw new Error(`Unsupported import format: ${formatUnsupportedReasons(results)}`);
  }

  supported.sort((a, b) => {
    if (b.sniff.confidence !== a.sniff.confidence) return b.sniff.confidence - a.sniff.confidence;
    if (b.adapter.priority !== a.adapter.priority) return b.adapter.priority - a.adapter.priority;
    return a.index - b.index;
  });

  const match = supported[0];
  return { adapter: match.adapter, sniff: match.sniff };
}

/** Inspect every configured import adapter without selecting a winner. */
export async function inspectImportAdapters(
  source: ImportSource,
  adapters: readonly ImportAdapter[] = DEFAULT_ADAPTERS,
): Promise<InspectedImportAdapter[]> {
  // A native QTI 3 manifest selects its own bounded parser. Other formats keep
  // their existing extraction budgets; do not run ten ZIP readers concurrently.
  const native = adapters.find((adapter) => adapter === qti3Adapter);
  const nativeSniff = native ? await native.sniff(source) : null;
  if (nativeSniff?.supported && nativeSniff.reason === 'manifest-qti3') {
    return adapters.map((adapter, index) => ({
      adapter,
      index,
      sniff: adapter === native ? nativeSniff : {
        supported: false,
        confidence: 0,
        reason: 'native-qti3-package',
      },
    }));
  }
  await assertImportArchivePolicy(source);
  const results: InspectedImportAdapter[] = [];
  for (const [index, adapter] of adapters.entries()) {
    try {
      results.push({ adapter, index, sniff: await adapter.sniff(source) });
    } catch {
      results.push({
        adapter,
        index,
        sniff: { supported: false, confidence: 0, reason: 'sniff-error' },
      });
    }
  }
  return results;
}

/** Resolve one pinned adapter. Adapter execution must not fall through to another adapter. */
export function resolveImportAdapter(
  ref: ImportAdapterRef,
  adapters: readonly ImportAdapter[] = DEFAULT_ADAPTERS,
): ImportAdapter {
  const adapter = adapters.find((candidate) =>
    candidate.id === ref.id && candidate.version === ref.version
  );
  if (!adapter) throw new Error(`Import adapter ${ref.id}@${ref.version} is not configured.`);
  return adapter;
}

/** Resolve a fully pinned adapter reference. */
export function resolvePinnedImportAdapterRef(
  id: string,
  version?: string | null,
  adapters: readonly ImportAdapter[] = DEFAULT_ADAPTERS,
): ImportAdapterRef {
  if (!version) throw new Error(`Import adapter ${id} requires an explicit version.`);
  resolveImportAdapter({ id, version }, adapters);
  return { id, version };
}

/** Inspect one pinned adapter and fail when it does not recognize the source. */
export async function inspectSelectedImportAdapter(
  source: ImportSource,
  ref: ImportAdapterRef,
  adapters: readonly ImportAdapter[] = DEFAULT_ADAPTERS,
): Promise<ImportDetection> {
  const adapter = resolveImportAdapter(ref, adapters);
  if (adapter !== qti3Adapter) await assertImportArchivePolicy(source);
  const sniff = await adapter.sniff(source);
  if (!sniff.supported) {
    throw new Error(
      `${adapter.label} did not recognize this source${sniff.reason ? ` (${sniff.reason})` : ''}.`,
    );
  }
  return { adapter, sniff };
}

function formatUnsupportedReasons(
  results: ReadonlyArray<{ readonly adapter: ImportAdapter; readonly sniff: SniffResult }>,
): string {
  const reasons = results.flatMap(({ adapter, sniff }) =>
    sniff.reason === undefined ? [] : [`${adapter.id}: ${sniff.reason}`]
  );
  return reasons.join('; ') || 'no adapter recognized the source';
}
