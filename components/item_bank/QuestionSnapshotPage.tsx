import QtiItemPreviewView from '../../islands/QtiItemPreview.tsx';
import { mountIsland } from '../../lib/rendering/mount_island.ts';
import Button from '../ui/Button.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';
import type { I18nPayload } from '../../lib/i18n/payload.ts';
import type { QflowPlayerMessageCatalog } from '../../lib/i18n/player_messages/types.ts';
export type SnapshotData = {
  itemId: string;
  rev: number;
  xml: string | null;
  title?: string | null;
  payload: I18nPayload;
  playerCatalog: QflowPlayerMessageCatalog;
  i18n: I18n;
};

export default function SnapshotView(
  { itemId, rev, xml, title, payload, playerCatalog, i18n }: SnapshotData,
) {
  return (
    <section class='space-y-6'>
      <div>
        <h1 class='mb-2 text-3xl font-medium leading-tight'>
          {title || i18n.t('items.snapshot.untitled')} —{' '}
          {i18n.t('items.results.revision', { revision: rev })}
        </h1>
        <p class='text-sm text-base-content/70'>{i18n.t('items.detail.identifier')}: {itemId}</p>
      </div>
      {xml
        ? (
          <div class='space-y-4'>
            <QtiItemPreviewRoot
              xml={xml}
              title={title}
              mode='snapshot'
              payload={payload}
              playerCatalog={playerCatalog}
            />
            <div class='ds-card ds-card-border'>
              <div class='ds-card-body space-y-4'>
                {title ? <p class='text-base font-medium'>{title}</p> : null}
                <div class='flex flex-wrap gap-2'>
                  <Button href={`/api/items/${itemId}`} target='_blank' rel='noreferrer'>
                    {i18n.t('items.detail.open')}
                  </Button>
                  <Button
                    href={`data:application/xml;charset=utf-8,${encodeURIComponent(xml)}`}
                    download={`item-${itemId}-r${rev}.xml`}
                  >
                    {i18n.t('items.snapshot.downloadXml')}
                  </Button>
                </div>
                <details>
                  <summary class='cursor-pointer text-sm font-medium'>
                    {i18n.t('items.snapshot.sourceXml')}
                  </summary>
                  <pre class='mt-3 overflow-auto rounded-lg border border-base-300 bg-base-200/40 p-4 text-sm'>{xml}</pre>
                </details>
              </div>
            </div>
          </div>
        )
        : (
          <div class='rounded-lg border border-dashed border-base-300 px-4 py-6 text-sm text-base-content/70'>
            {i18n.t('items.snapshot.revisionUnavailable')}
          </div>
        )}
    </section>
  );
}

const QtiItemPreviewRoot = mountIsland({ component: 'QtiItemPreview', View: QtiItemPreviewView });
