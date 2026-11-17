import { mountIsland } from '../../lib/rendering/mount_island.ts';
import Button from '../ui/Button.tsx';
import Input from '../ui/Input.tsx';
import QtiItemPreviewView from '../../islands/QtiItemPreview.tsx';
import { VersionChanges } from './VersionChanges.tsx';
import { itemDetailQueryParams } from '../../lib/item_detail_query.ts';
import type { ItemBankDetailViewData } from './ItemDetailView.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';

/** Owns comparison selection, evidence and previews; restoration belongs to revision history. */
export function RevisionComparison({ data, i18n }: {
  readonly data: Pick<
    ItemBankDetailViewData,
    'id' | 'query' | 'detail' | 'comparison' | 'previewPayload' | 'playerCatalog'
  >;
  readonly i18n: I18n;
}) {
  if (data.detail.revision < 2) return null;
  return (
    <section id='comparison' class='ds-card ds-card-border'>
      <div class='ds-card-body gap-4'>
        <div>
          <h2 class='text-lg font-medium'>{i18n.t('items.detail.comparison')}</h2>
          <p class='text-sm text-base-content/65'>{i18n.t('items.detail.compareHelp')}</p>
        </div>
        {data.detail.revision > 1
          ? (
            <form
              method='get'
              action={`/items/${data.id}#comparison`}
              class='flex flex-wrap items-end gap-3'
            >
              {[...itemDetailQueryParams({ ...data.query, comparison: null })].map((
                [name, value],
              ) => <Input key={name} type='hidden' name={name} value={value} />)}
              <label class='flex flex-col min-w-44 gap-1'>
                <span class='text-xs font-medium text-base-content/70'>
                  {i18n.t('items.detail.earlierRevision')}
                </span>
                <Input
                  name='compare'
                  type='number'
                  min={1}
                  max={data.detail.revision - 1}
                  value={String(data.comparison?.fromRevision ?? data.detail.revision - 1)}
                  required
                />
              </label>
              <label class='flex flex-col min-w-44 gap-1'>
                <span class='text-xs font-medium'>
                  {i18n.t('items.detail.laterRevision')}
                </span>
                <Input
                  name='compareTo'
                  type='number'
                  min={2}
                  max={data.detail.revision}
                  value={String(data.comparison?.toRevision ?? data.detail.revision)}
                  required
                />
              </label>
              <Button type='submit'>{i18n.t('items.detail.compareRevisions')}</Button>
            </form>
          )
          : (
            <p class='text-sm text-base-content/65'>
              {i18n.t('items.detail.compareUnavailable')}
            </p>
          )}
        {data.comparison && (
          <>
            <h3 class='text-base font-semibold'>
              {i18n.t('items.detail.comparisonPair', {
                before: data.comparison.fromRevision,
                after: data.comparison.toRevision,
              })}
            </h3>
            <div class='flex flex-wrap gap-3'>
              <Button
                href={`/items/${data.id}/r/${data.comparison.fromRevision}`}
                variant='ghost'
              >
                {i18n.t('items.detail.openRevision', {
                  revision: data.comparison.fromRevision,
                })}
              </Button>
              <Button
                href={`/items/${data.id}/r/${data.comparison.toRevision}`}
                variant='ghost'
              >
                {i18n.t('items.detail.openRevision', {
                  revision: data.comparison.toRevision,
                })}
              </Button>
              <Button href='#item-history-heading' variant='ghost'>
                {i18n.t('items.detail.history')}
              </Button>
            </div>
            <VersionChanges comparison={data.comparison} i18n={i18n} />
            <details>
              <summary class='cursor-pointer py-2 font-medium'>
                {i18n.t('items.detail.comparePreviews')}
              </summary>
              <div class='grid gap-4 lg:grid-cols-2'>
                <QtiItemPreview
                  xml={data.comparison.beforeXml}
                  title={i18n.t('items.detail.revisionColumn', {
                    revision: data.comparison.fromRevision,
                  })}
                  mode='snapshot'
                  payload={data.previewPayload}
                  playerCatalog={data.playerCatalog}
                />
                <QtiItemPreview
                  xml={data.comparison.afterXml}
                  title={i18n.t('items.detail.revisionColumn', {
                    revision: data.comparison.toRevision,
                  })}
                  mode='snapshot'
                  payload={data.previewPayload}
                  playerCatalog={data.playerCatalog}
                />
              </div>
            </details>
          </>
        )}
      </div>
    </section>
  );
}

const QtiItemPreview = mountIsland({ component: 'QtiItemPreview', View: QtiItemPreviewView });
