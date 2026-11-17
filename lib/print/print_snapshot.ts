import {
  type AssessmentStandaloneContent,
  parseAssessmentStandaloneContent,
} from '../assessment_standalone_content.ts';
import { parseAssessmentPartOptions } from '../assessment_arrangement.ts';
import type { PartOptions } from '../test_export.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { parsePrintConfiguration, type PrintConfiguration } from './print_contract.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import { sha256Hex } from '../sha256.ts';

export const PRINT_RENDERER_ID =
  'typst-ts-404730f-artifact-eb6ab96d614433c89839169a0268f4dbc89f46fbce11af11a9f7159c499c3db2';
export const PRINT_TEMPLATE_VERSION =
  'qflow-paper-v1-sha256-043fa7ba05a85baacf6eeff814825b4e078b8828464f599785b24917f37dfca2';

/** Full ordered source identity, including exact immutable revisions and unscored anchors. */
export type PrintSource = {
  readonly assessmentId: string;
  readonly assessmentTitle: string;
  readonly assessmentMetadata: Readonly<Record<string, unknown>>;
  readonly adaptive: boolean;
  readonly parts: readonly {
    readonly id: string;
    readonly title: string;
    readonly options: PartOptions;
    readonly placements: readonly (
      | {
        readonly kind: 'question';
        readonly id: string;
        readonly questionId: string;
        readonly revisionId: string;
        readonly revision: number;
        readonly xml: string;
        readonly staffTitle: string;
      }
      | {
        readonly kind: 'content';
        readonly id: string;
        readonly content: AssessmentStandaloneContent;
      }
      | {
        readonly kind: 'unavailable';
        readonly reason?: 'source_limit';
        readonly id: string;
        readonly questionId: string;
        readonly requestedRevision: number | null;
      }
    )[];
  }[];
};

/** Retained source and metadata-free derivative. Only derivative bytes enter renderer input. */
export type PrintAsset = {
  readonly reference: string;
  readonly sourceSha256: string;
  readonly sourceKey: string;
  readonly sha256: string;
  readonly key: string;
  readonly mediaType: 'image/png' | 'image/jpeg';
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
};

/** One immutable form reservation. Confirmation promotes its exact retained PDF pair. */
export type PrintSnapshot = {
  readonly schema: 'qflow.print-snapshot.v1';
  readonly id: string;
  readonly tenantId: string;
  readonly form: string;
  readonly createdAt: string;
  readonly sourceDigest: string;
  readonly rendererId: string;
  readonly templateVersion: string;
  readonly source: PrintSource;
  readonly configuration: PrintConfiguration;
  readonly assets: readonly PrintAsset[];
};

/** Hash current source/settings and actual source bytes, independent of the reservation clock. */
export async function printSourceDigest(
  source: PrintSource,
  configuration: PrintConfiguration,
  assets: readonly Pick<PrintAsset, 'reference' | 'sourceSha256' | 'sha256'>[],
  identity: { readonly rendererId: string; readonly templateVersion: string } = {
    rendererId: PRINT_RENDERER_ID,
    templateVersion: PRINT_TEMPLATE_VERSION,
  },
): Promise<string> {
  return await sha256Hex(
    new TextEncoder().encode(
      canonicalJsonStringify({
        source,
        configuration,
        assets: assets.map((asset) => ({
          reference: asset.reference,
          sourceSha256: asset.sourceSha256,
          derivativeSha256: asset.sha256,
        })).sort((a, b) => a.reference.localeCompare(b.reference)),
        rendererId: identity.rendererId,
        templateVersion: identity.templateVersion,
        imagePolicy: 'metadata-free-v1',
      }),
    ),
  );
}

/** Parse the immutable persistence boundary before a Workflow sees source/configuration. */
export function parsePrintSnapshot(input: unknown): PrintSnapshot | null {
  const value = object(input);
  if (
    !value || value.schema !== 'qflow.print-snapshot.v1' || !uuid(value.id) ||
    !uuid(value.tenantId) ||
    typeof value.form !== 'string' || !/^QF-[A-F0-9-]+$/.test(value.form) ||
    typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) ||
    !digest(value.sourceDigest) || typeof value.rendererId !== 'string' ||
    typeof value.templateVersion !== 'string'
  ) return null;
  const source = parsePrintSource(value.source),
    configuration = parsePrintConfiguration(value.configuration);
  if (!source || !configuration || !Array.isArray(value.assets) || value.assets.length > 8) {
    return null;
  }
  let assetBytes = 0, assetPixels = 0;
  const assets: PrintAsset[] = [];
  for (const raw of value.assets) {
    const asset = object(raw);
    if (
      !asset || typeof asset.reference !== 'string' || !digest(asset.sourceSha256) ||
      !digest(asset.sha256) ||
      typeof asset.key !== 'string' ||
      asset.key !== `print/${value.tenantId}/${value.id}/assets/image-${asset.sha256}` ||
      typeof asset.sourceKey !== 'string' ||
      asset.sourceKey !==
        `print/${value.tenantId}/${value.id}/assets/source-${asset.sourceSha256}` ||
      (asset.mediaType !== 'image/png' && asset.mediaType !== 'image/jpeg') ||
      !positive(asset.byteLength) || !positive(asset.width) || !positive(asset.height)
    ) return null;
    assetBytes += asset.byteLength;
    assetPixels += asset.width * asset.height;
    if (assetBytes > 500000 || assetPixels > 1500000) return null;
    assets.push({
      reference: asset.reference,
      sourceSha256: asset.sourceSha256,
      sourceKey: asset.sourceKey,
      sha256: asset.sha256,
      key: asset.key,
      mediaType: asset.mediaType,
      byteLength: asset.byteLength,
      width: asset.width,
      height: asset.height,
    });
  }
  return {
    schema: 'qflow.print-snapshot.v1',
    id: value.id,
    tenantId: value.tenantId,
    form: value.form,
    createdAt: value.createdAt,
    sourceDigest: value.sourceDigest,
    rendererId: value.rendererId,
    templateVersion: value.templateVersion,
    source,
    configuration,
    assets,
  };
}

/** Reconstruct ordered membership and exact source XML without trusting serialized draft objects. */
export function parsePrintSource(input: unknown): PrintSource | null {
  const root = object(input);
  if (
    !root || !uuid(root.assessmentId) || typeof root.assessmentTitle !== 'string' ||
    typeof root.adaptive !== 'boolean' || !Array.isArray(root.parts) || root.parts.length > 100
  ) return null;
  const metadata = object(root.assessmentMetadata);
  if (!metadata) return null;
  const parts: PrintSource['parts'][number][] = [];
  for (const rawPart of root.parts) {
    const part = object(rawPart);
    if (
      !part || !uuid(part.id) || typeof part.title !== 'string' || !Array.isArray(part.placements)
    ) return null;
    const options = parseAssessmentPartOptions(part.options);
    if (!options.ok) return null;
    const placements: PrintSource['parts'][number]['placements'][number][] = [];
    for (const rawPlacement of part.placements) {
      const placement = object(rawPlacement);
      if (!placement || !uuid(placement.id)) return null;
      if (placement.kind === 'content') {
        const content = parseAssessmentStandaloneContent(placement.content);
        if (!content.ok) return null;
        placements.push({ kind: 'content', id: placement.id, content: content.content });
      } else if (
        placement.kind === 'unavailable' && uuid(placement.questionId) &&
        (placement.requestedRevision === null || positive(placement.requestedRevision))
      ) {
        placements.push({
          kind: 'unavailable',
          id: placement.id,
          questionId: placement.questionId,
          requestedRevision: placement.requestedRevision,
          ...(placement.reason === 'source_limit' ? { reason: 'source_limit' as const } : {}),
        });
      } else if (
        placement.kind === 'question' && uuid(placement.questionId) && uuid(placement.revisionId) &&
        positive(placement.revision) && typeof placement.xml === 'string' &&
        typeof placement.staffTitle === 'string'
      ) {
        placements.push({
          kind: 'question',
          id: placement.id,
          questionId: placement.questionId,
          revisionId: placement.revisionId,
          revision: placement.revision,
          xml: placement.xml,
          staffTitle: placement.staffTitle,
        });
      } else return null;
    }
    parts.push({ id: part.id, title: part.title, options: options.options, placements });
  }
  return {
    assessmentId: root.assessmentId,
    assessmentTitle: root.assessmentTitle,
    assessmentMetadata: metadata,
    adaptive: root.adaptive,
    parts,
  };
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}
function uuid(value: unknown): value is string {
  return typeof value === 'string' && isCanonicalUuid(value);
}
function digest(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
