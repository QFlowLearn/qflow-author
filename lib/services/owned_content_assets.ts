import { and, eq, inArray } from 'drizzle-orm';
import type { QflowDatabaseTransaction } from '../db.ts';
import { uploadsTable } from '../db/schema.ts';
import type { RequestContext } from '../tenants.ts';
import type { AssessmentStandaloneContent } from '../assessment_standalone_content.ts';
import { uploadIdFromUrl } from '../uploads.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { classifyUploadHint } from '../upload_policy.ts';

/** A content reference must belong to this tenant and match the uploaded file's type. */
export class ContentAssetUnavailableError extends Error {
  readonly code = 'content_asset_unavailable' as const;
  readonly status = 422;
  constructor() {
    super(
      'A content file is unavailable or has the wrong media type. Upload the file again before saving.',
    );
  }
}
export async function requireOwnedContentAssets(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  content: readonly AssessmentStandaloneContent[],
  unavailable: () => Error = () => new ContentAssetUnavailableError(),
  options: { readonly allowIncompleteDraftReferences?: boolean } = {},
): Promise<void> {
  const references: Array<
    {
      readonly src: string;
      readonly kind: 'image' | 'video' | 'captions';
      readonly mimeType: string | null;
    }
  > = [];
  for (const block of content) {
    if (block.kind === 'image') references.push({ src: block.src, kind: 'image', mimeType: null });
    if (block.kind === 'video') {
      references.push(
        {
          src: block.src,
          kind: 'video',
          mimeType: options.allowIncompleteDraftReferences && !block.mimeType
            ? null
            : block.mimeType,
        },
        { src: block.captionSrc, kind: 'captions', mimeType: 'text/vtt' },
      );
    }
  }
  // Only unfinished bank drafts may omit files while the author is still filling the form.
  // Every supplied file reference is still checked against this tenant's upload inventory.
  if (options.allowIncompleteDraftReferences) {
    for (let index = references.length - 1; index >= 0; index--) {
      if (!references[index].src) references.splice(index, 1);
    }
  }
  if (!references.length) return;
  const ids = new Set<string>();
  for (const reference of references) {
    const id = uploadIdFromUrl(reference.src);
    if (!id || !isCanonicalUuid(id)) throw unavailable();
    ids.add(id);
  }
  const records = await tx.select({
    id: uploadsTable.id,
    url: uploadsTable.url,
    mimeType: uploadsTable.mimeType,
    name: uploadsTable.name,
  })
    .from(uploadsTable).where(
      and(eq(uploadsTable.tenantId, ctx.tenantId), inArray(uploadsTable.id, [...ids])),
    );
  const byId = new Map(records.map((record) => [record.id, record]));
  for (const reference of references) {
    const id = uploadIdFromUrl(reference.src);
    const stored = id === null ? undefined : byId.get(id);
    if (
      !stored || stored.url !== reference.src ||
      classifyUploadHint(stored.name ?? '', stored.mimeType) !== reference.kind ||
      (reference.mimeType !== null && stored.mimeType !== reference.mimeType)
    ) {
      throw unavailable();
    }
  }
}
