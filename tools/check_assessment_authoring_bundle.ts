import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _url from 'node:url';
import { join } from 'node:path';
import { fileURLToPath as fromFileUrl } from 'node:url';

const ASSESSMENT_BUILDER_ENTRY = 'islands/AssessmentBuilder.tsx';

/** Fixed limits for the AssessmentBuilder initial static client graph. */
export const ASSESSMENT_AUTHORING_BUNDLE_LIMITS = {
  chunks: 100,
  rawBytes: 1_000_000,
  gzipBytes: 315_000,
} as const;

/** Limits enforced for one client entry's static graph. */
export type AssessmentAuthoringBundleLimits = {
  readonly chunks: number;
  readonly rawBytes: number;
  readonly gzipBytes: number;
};

/** Measured size of one client entry's unique static import graph. */
export type AssessmentAuthoringBundleMeasurement = {
  readonly entry: string;
  readonly chunks: number;
  readonly rawBytes: number;
  readonly gzipBytes: number;
  readonly assets: readonly string[];
};

/** Outcome of comparing an assessment authoring graph with its limits. */
export type AssessmentAuthoringBundleValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly string[] };

/** Filesystem inputs used to measure an assessment authoring client graph. */
export type AssessmentAuthoringBundleInput = {
  readonly manifestPath: string;
  readonly clientRoot: string;
  readonly entryKey?: string;
};

type ManifestChunk = {
  readonly file: string;
  readonly imports: readonly string[];
};

type ClientManifest = Readonly<Record<string, ManifestChunk>>;

/** An invalid manifest or missing asset that prevents a deterministic bundle measurement. */
export class AssessmentAuthoringBundleError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AssessmentAuthoringBundleError';
  }
}

/** Measures the unique static graph rooted at the AssessmentBuilder manifest entry. */
export async function measureAssessmentAuthoringBundle(
  input: AssessmentAuthoringBundleInput,
): Promise<AssessmentAuthoringBundleMeasurement> {
  const manifest = await readClientManifest(input.manifestPath);
  const entryKey = input.entryKey ?? ASSESSMENT_BUILDER_ENTRY;
  if (!manifest[entryKey]) {
    throw new AssessmentAuthoringBundleError(
      `Client manifest is missing the assessment authoring entry "${entryKey}". Run pnpm run build before checking the bundle.`,
    );
  }

  const pending = [entryKey];
  const visitedKeys = new Set<string>();
  const measuredFiles = new Set<string>();
  const assets: string[] = [];
  let rawBytes = 0;
  let gzipBytes = 0;

  while (pending.length > 0) {
    const key = pending.pop();
    if (key === undefined || visitedKeys.has(key)) continue;
    const chunk = manifest[key];
    if (!chunk) {
      throw new AssessmentAuthoringBundleError(
        `Static import "${key}" referenced by the assessment authoring graph is missing from the client manifest.`,
      );
    }
    visitedKeys.add(key);
    pending.push(...chunk.imports);
    if (measuredFiles.has(chunk.file)) continue;

    measuredFiles.add(chunk.file);
    assets.push(chunk.file);

    const assetPath = join(input.clientRoot, chunk.file);
    let bytes: Uint8Array;
    try {
      bytes = await _fs.readFile(assetPath);
    } catch (cause: unknown) {
      throw new AssessmentAuthoringBundleError(
        `Client asset "${chunk.file}" is missing or unreadable. Run pnpm run build before checking the bundle.`,
        { cause },
      );
    }
    rawBytes += bytes.byteLength;
    gzipBytes += await gzipByteLength(bytes);
  }

  return {
    entry: manifest[entryKey].file,
    chunks: measuredFiles.size,
    rawBytes,
    gzipBytes,
    assets: assets.sort(),
  };
}

/** Compares a measured graph with fixed or test-provided limits. */
export function validateAssessmentAuthoringBundle(
  measurement: AssessmentAuthoringBundleMeasurement,
  limits: AssessmentAuthoringBundleLimits = ASSESSMENT_AUTHORING_BUNDLE_LIMITS,
): AssessmentAuthoringBundleValidation {
  const violations: string[] = [];
  if (measurement.chunks > limits.chunks) {
    violations.push(
      `${measurement.chunks} static chunks exceeds the limit of ${limits.chunks}`,
    );
  }
  if (measurement.rawBytes > limits.rawBytes) {
    violations.push(
      `${measurement.rawBytes} raw bytes exceeds the limit of ${limits.rawBytes}`,
    );
  }
  if (measurement.gzipBytes > limits.gzipBytes) {
    violations.push(
      `${measurement.gzipBytes} gzip bytes exceeds the limit of ${limits.gzipBytes}`,
    );
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

async function readClientManifest(path: string): Promise<ClientManifest> {
  let text: string;
  try {
    text = await _fs.readFile(path, 'utf8');
  } catch (cause: unknown) {
    throw new AssessmentAuthoringBundleError(
      `Client manifest "${path}" is missing or unreadable. Run pnpm run build before checking the bundle.`,
      { cause },
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause: unknown) {
    throw new AssessmentAuthoringBundleError('Client manifest is not valid JSON.', { cause });
  }
  if (!isRecord(value)) {
    throw new AssessmentAuthoringBundleError('Client manifest must be a JSON object.');
  }

  const manifest: Record<string, ManifestChunk> = {};
  for (const [key, chunk] of Object.entries(value)) {
    if (!isRecord(chunk)) {
      throw new AssessmentAuthoringBundleError(`Client manifest entry "${key}" must be an object.`);
    }
    const file = chunk.file;
    if (typeof file !== 'string' || !isSafeAssetPath(file)) {
      throw new AssessmentAuthoringBundleError(
        `Client manifest entry "${key}" must contain a safe relative asset file path.`,
      );
    }
    const imports = chunk.imports ?? [];
    if (!Array.isArray(imports) || !imports.every((entry) => typeof entry === 'string')) {
      throw new AssessmentAuthoringBundleError(
        `Client manifest entry "${key}" has an invalid static imports list.`,
      );
    }
    manifest[key] = { file, imports };
  }
  return manifest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeAssetPath(path: string): boolean {
  return path.length > 0 && !path.startsWith('/') && !path.split('/').includes('..');
}

async function gzipByteLength(bytes: Uint8Array): Promise<number> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const stream = new Blob([copy.buffer]).stream().pipeThrough(new CompressionStream('gzip'));
  return (await new Response(stream).arrayBuffer()).byteLength;
}

if ((process.argv[1] && _path.resolve(process.argv[1]) === _url.fileURLToPath(import.meta.url))) {
  try {
    const clientRoot = fromFileUrl(new URL('../build/client/', import.meta.url));
    const measurement = await measureAssessmentAuthoringBundle({
      manifestPath: join(clientRoot, '.vite/manifest.json'),
      clientRoot,
    });
    const validation = validateAssessmentAuthoringBundle(measurement);
    const report =
      `${measurement.chunks} chunks, ${measurement.rawBytes} raw bytes, ${measurement.gzipBytes} gzip bytes`;
    if (!validation.ok) {
      console.error(`FAIL assessment authoring bundle: ${report}.`);
      for (const violation of validation.violations) console.error(`- ${violation}`);
      console.error('Remove unintended static imports from islands/AssessmentBuilder.tsx.');
      process.exit(1);
    }
    console.log(`PASS assessment authoring bundle: ${report}.`);
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`FAIL assessment authoring bundle: ${message}`);
    process.exit(1);
  }
}
