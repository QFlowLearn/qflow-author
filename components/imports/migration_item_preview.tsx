import QtiItemPreviewView from '../../islands/QtiItemPreview.tsx';
import { mountIsland } from '../../lib/rendering/mount_island.ts';
import type { MigrationItemRecord } from '../../lib/import/migration_types.ts';
import type { Draft } from '../../lib/types/draft.ts';
import { buildQtiPreviewXml } from '../../lib/qti_preview.ts';
import type { I18nPayload } from '../../lib/i18n/payload.ts';
import type { I18n } from '../../lib/i18n/messages.ts';
import type { QflowPlayerMessageCatalog } from '../../lib/i18n/player_messages/types.ts';

export function MigrationItemPreview(
  { item, payload, i18n, playerCatalog }: {
    item: MigrationItemRecord;
    payload: I18nPayload;
    i18n: I18n;
    playerCatalog: QflowPlayerMessageCatalog;
  },
) {
  const preview = buildQtiPreviewXml({
    ...item.importedDraft,
    type: item.itemType,
  } as Draft, { identifier: `preview-${item.id}` });
  if (!preview.ok) return <PreviewIssues item={item} issues={preview.issues} i18n={i18n} />;
  return (
    <div class='max-w-3xl'>
      <QtiItemPreviewRoot
        xml={preview.xml}
        title={preview.title || item.title}
        mode='migration'
        payload={payload}
        playerCatalog={playerCatalog}
      />
    </div>
  );
}

function PreviewIssues(
  { item, issues, i18n }: {
    item: MigrationItemRecord;
    issues: Array<{ message: string }>;
    i18n: I18n;
  },
) {
  return (
    <div class='rounded-lg border border-dashed border-base-300 p-4 text-sm text-base-content/70'>
      <div class='font-medium text-base-content'>
        {i18n.t('imports.preview.unavailable', { type: item.itemTypeLabel })}
      </div>
      <p class='mt-1'>{i18n.t('imports.report.previewRecovery')}</p>
      <ul class='mt-2 list-disc space-y-1 pl-5'>
        {issues.map((issue, index) => <li key={`${issue.message}-${index}`}>{issue.message}</li>)}
      </ul>
    </div>
  );
}

const QtiItemPreviewRoot = mountIsland({ component: 'QtiItemPreview', View: QtiItemPreviewView });
