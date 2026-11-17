import { useHydrated } from '../lib/client/use_hydrated.ts';
import { useState } from 'preact/hooks';
import Button from '../components/ui/Button.tsx';
import Input from '../components/ui/Input.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import type { I18nPayload } from '../lib/i18n/payload.ts';

/** Keyboard-operable, complete-collection arrangement with one explicit, retry-safe save. */
export default function BankCollectionOrder({ items, collectionId, operationId, payload }: {
  readonly items: readonly { readonly id: string; readonly title: string }[];
  readonly collectionId: string;
  readonly operationId: string;
  readonly payload: I18nPayload;
}) {
  const hydrated = useHydrated();
  const [ordered, setOrdered] = useState(items);
  const [announcement, setAnnouncement] = useState('');
  const i18n = createI18n(payload.locale, payload.namespaces);
  function move(index: number, delta: number) {
    const destination = index + delta;
    const item = ordered[index];
    if (!item || destination < 0 || destination >= ordered.length) return;
    const next = [...ordered];
    next.splice(index, 1);
    next.splice(destination, 0, item);
    setOrdered(next);
    setAnnouncement(
      i18n.t('items.collections.moved', { title: item.title, position: destination + 1 }),
    );
  }
  return (
    <form
      method='post'
      action={`/items/collections?collection=${collectionId}`}
      class='space-y-3'
      aria-label={i18n.t('items.collections.arrange')}
    >
      <p class='max-w-prose text-sm'>{i18n.t('items.collections.orderHint')}</p>
      <Input type='hidden' name='collectionAction' value='ReorderItems' />
      <Input type='hidden' name='collectionId' value={collectionId} />
      <Input type='hidden' name='operationId' value={operationId} />
      <p role='status' class='text-sm'>{announcement}</p>
      <ol class='divide-y divide-base-300'>
        {ordered.map((item, index) => (
          <li key={item.id} class='flex flex-wrap items-center gap-3 py-2'>
            <Input type='hidden' name='questionId' value={item.id} />
            <span class='min-w-0 flex-1 break-words'>
              {i18n.formatNumber(index + 1)}. {item.title}
            </span>
            <Button
              type='button'
              size='sm'
              disabled={!hydrated}
              // Keep focus on this control when its question reaches the first position.
              aria-disabled={index === 0}
              aria-label={i18n.t('items.collections.moveUp', { title: item.title })}
              onClick={() => move(index, -1)}
            >
              {i18n.t('items.collections.up')}
            </Button>
            <Button
              type='button'
              size='sm'
              disabled={!hydrated}
              aria-disabled={index === ordered.length - 1}
              aria-label={i18n.t('items.collections.moveDown', { title: item.title })}
              onClick={() => move(index, 1)}
            >
              {i18n.t('items.collections.down')}
            </Button>
          </li>
        ))}
      </ol>
      {ordered.length > 0 && (
        <Button type='submit' variant='primary' disabled={!hydrated}>
          {i18n.t('items.collections.saveOrder')}
        </Button>
      )}
      <Button href={`/items/collections?collection=${collectionId}`} variant='ghost'>
        {i18n.t('items.collections.cancelOrder')}
      </Button>
    </form>
  );
}
