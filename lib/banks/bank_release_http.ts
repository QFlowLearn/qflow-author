import { parseReleaseCommand } from './bank_release_command.ts';
import { parseCreateRelease, type ReleaseManifest } from './bank_release.ts';

/** Form parser rejects duplicate scalars and unknown fields before creating an edition. */
export function parseReleaseCreateForm(form: FormData) {
  if (!validFields(form, ['id', 'operationId', 'label', 'notes'], ['questionId', 'collectionId'])) {
    return null;
  }
  return parseCreateRelease({
    id: form.get('id'),
    operationId: form.get('operationId'),
    label: form.get('label'),
    notes: form.get('notes'),
    questionIds: form.getAll('questionId'),
    collectionIds: form.getAll('collectionId'),
  });
}
/** Translate native form intent against the server-owned complete manifest, never visible row IDs. */
export function parseReleaseMutationForm(
  form: FormData,
  releaseId: string,
  manifest: ReleaseManifest,
) {
  const base = ['action', 'operationId', 'version', 'digest'];
  const command = {
    releaseId,
    operationId: form.get('operationId'),
    version: Number(form.get('version')),
    digest: form.get('digest'),
  };
  switch (form.get('action')) {
    case 'refresh':
      return validFields(form, [...base, 'label', 'notes'], [])
        ? parseReleaseCommand({
          ...command,
          action: 'refresh',
          label: form.get('label'),
          notes: form.get('notes'),
        })
        : null;
    case 'keep':
      return validFields(form, base, ['questionId'])
        ? parseReleaseCommand({
          ...command,
          action: form.get('action'),
          questionIds: form.getAll('questionId'),
        })
        : null;
    case 'exclude':
      return validFields(form, [...base, 'reason'], ['questionId'])
        ? parseReleaseCommand({
          ...command,
          action: 'exclude',
          questionIds: form.getAll('questionId'),
          reason: form.get('reason'),
        })
        : null;
    case 'withdraw':
    case 'restore':
      return validFields(form, [...base, 'reason', 'replacementId'], [])
        ? parseReleaseCommand({
          ...command,
          action: form.get('action'),
          reason: form.get('reason'),
          replacementId: form.get('replacementId') || null,
        })
        : null;
    case 'freeze': {
      const overrideFields = [...form.keys()].filter((key) => key.startsWith('override:'));
      if (!validFields(form, [...base, 'attest', 'reason', ...overrideFields], [])) return null;
      const required = manifest.items.some((item) =>
        item.eligibility.kind === 'attestation_required'
      );
      if (required && form.get('attest') !== 'yes') return null;
      if (
        !required && (form.get('attest') !== 'no' || overrideFields.length || form.get('reason'))
      ) return null;
      return parseReleaseCommand({
        ...command,
        action: 'freeze',
        attestation: required
          ? {
            reason: form.get('reason'),
            overrides: overrideFields.map((key) => ({
              revisionId: key.slice('override:'.length),
              reason: form.get(key),
            })),
          }
          : null,
      });
    }
    default:
      return null;
  }
}
function validFields(
  form: FormData,
  scalars: readonly string[],
  repeated: readonly string[],
): boolean {
  return [...form.keys()].every((key) =>
    (scalars.includes(key) && form.getAll(key).length === 1 && typeof form.get(key) === 'string') ||
    (repeated.includes(key) && form.getAll(key).every((value) => typeof value === 'string'))
  );
}
