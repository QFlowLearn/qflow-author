import { inferImageMimeFromSource } from './image_source.ts';

/** Authoring state for one image and its accessibility metadata. */
export type ImageAsset = {
  readonly source: string;
  readonly alt: string;
  readonly longDescription?: string;
  readonly mimeType?: string;
  readonly width?: number;
  readonly height?: number;
};

/** Editable fields exposed by an image asset editor instance. */
export type ImageAssetField =
  | 'longDescription'
  | 'mimeType'
  | 'width'
  | 'height';

/** Resolve an authored MIME type without inventing a fallback. */
export function resolveImageMimeType(asset: Pick<ImageAsset, 'source' | 'mimeType'>):
  | string
  | undefined {
  return asset.mimeType?.trim() || inferImageMimeFromSource(asset.source);
}

/** Return true when an image source has explicit or inferable MIME metadata. */
export function hasImageMimeType(asset: Pick<ImageAsset, 'source' | 'mimeType'>): boolean {
  return asset.source.trim() === '' || resolveImageMimeType(asset) !== undefined;
}
