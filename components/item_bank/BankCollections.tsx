import Button from '../ui/Button.tsx';
import Input from '../ui/Input.tsx';
import Textarea from '../ui/Textarea.tsx';
import { BankField } from './ui.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';

/** Serializable collection navigation data owned by the bank page's server loader. */
export type BankCollectionNavigation = {
  readonly collections: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly position: number;
    readonly archivedAt: Date | null;
  }[];
  readonly operationId: string;
  readonly createId: string;
};

/** Collection management forms for the selected collection. */
export function BankCollections({ workspace, selectedId, canManage, i18n, action }: {
  readonly workspace: BankCollectionNavigation;
  readonly selectedId: string | null;
  readonly canManage: boolean;
  readonly i18n: I18n;
  readonly action: string;
}) {
  const selected = workspace.collections.find((row) => row.id === selectedId);
  const identity = (collectionId: string) => (
    <>
      <Input type='hidden' name='collectionId' value={collectionId} />
      <Input type='hidden' name='operationId' value={workspace.operationId} />
    </>
  );
  const fields = (name: string, description: string, position: number) => (
    <>
      <BankField label={i18n.t('items.collections.name')}>
        <Input name='name' value={name} required maxLength={160} />
      </BankField>
      <BankField label={i18n.t('items.collections.description')}>
        <Textarea name='description' value={description} maxLength={4000} rows={2} />
      </BankField>
      <BankField label={i18n.t('items.collections.position')}>
        <Input
          name='position'
          type='number'
          min={1}
          max={2147483648}
          value={position + 1}
          required
        />
      </BankField>
    </>
  );
  return (
    <section
      class='space-y-4 py-3'
      aria-label={i18n.t('items.collections.title')}
    >
      {selected && (
        <div class='flex flex-wrap items-start justify-between gap-4 pt-2'>
          <div class='min-w-0 flex-1 basis-80 space-y-2'>
            <h2 class='text-xl font-semibold break-words'>{selected.name}</h2>
            {selected.description && (
              <p class='max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed text-base-content/80'>
                {selected.description}
              </p>
            )}
            {selected.archivedAt && (
              <p class='text-sm'>{i18n.t('items.collections.archiveHint')}</p>
            )}
          </div>
          <div class='flex flex-wrap gap-2'>
            <Button href={`/items?collection=${selected.id}`} variant='ghost'>
              {i18n.t('items.collections.viewQuestions')}
            </Button>
            {canManage && !selected.archivedAt && (
              <Button
                href={`/items/collections/${selected.id}/arrange`}
                variant='default'
              >
                {i18n.t('items.collections.arrange')}
              </Button>
            )}
          </div>
        </div>
      )}
      <p class='max-w-prose text-sm text-base-content/80'>
        {i18n.t('items.collections.visibility')}
      </p>
      {canManage && (
        <div>
          <p class='max-w-prose py-2 text-sm'>{i18n.t('items.collections.flatHint')}</p>
          <div class='flex flex-wrap gap-6'>
            <form action={action} method='post' class='w-full max-w-sm space-y-3'>
              <h3 class='font-medium'>{i18n.t('items.collections.create')}</h3>
              {identity(workspace.createId)}
              <Input type='hidden' name='collectionAction' value='Create' />
              {fields(
                '',
                '',
                workspace.collections.reduce((max, row) => Math.max(max, row.position + 1), 0),
              )}
              <Button type='submit'>{i18n.t('items.collections.create')}</Button>
            </form>
            {selected && (
              <div class='w-full max-w-sm space-y-3'>
                {!selected.archivedAt && (
                  <form action={action} method='post' class='space-y-3'>
                    <h3 class='font-medium'>{i18n.t('items.collections.edit')}</h3>
                    {identity(selected.id)}
                    <Input type='hidden' name='collectionAction' value='Update' />
                    {fields(selected.name, selected.description, selected.position)}
                    <Button type='submit'>{i18n.t('items.collections.save')}</Button>
                  </form>
                )}
                <form action={action} method='post' class='space-y-2'>
                  {identity(selected.id)}
                  <Input
                    type='hidden'
                    name='collectionAction'
                    value={selected.archivedAt ? 'Restore' : 'Archive'}
                  />
                  <p class='max-w-prose text-sm'>{i18n.t('items.collections.archiveHint')}</p>
                  <Button type='submit' variant='ghost'>
                    {i18n.t(
                      selected.archivedAt
                        ? 'items.collections.restore'
                        : 'items.collections.archive',
                    )}
                  </Button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
