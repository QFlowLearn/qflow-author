import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import Button from '../components/ui/Button.tsx';
import Input from '../components/ui/Input.tsx';
import Select from '../components/ui/Select.tsx';
import { BankField } from '../components/item_bank/ui.tsx';
import MemberPicker from './MemberPicker.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import type { I18nPayload } from '../lib/i18n/payload.ts';

/** Show only the additional inputs required by the chosen selected-question action. */
export default function BankBulkControls({ collections, payload }: {
  readonly collections: readonly { readonly id: string; readonly name: string }[];
  readonly payload: I18nPayload;
}) {
  const [action, setAction] = useState('');
  const controls = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const select = controls.current?.querySelector('select[name=bulkAction]');
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error('Bank bulk action control is not mounted.');
    }
    setAction(select.value);
  }, []);
  const i18n = createI18n(payload.locale, payload.namespaces);
  return (
    <div
      ref={controls}
      class='flex flex-wrap items-end gap-3 rounded-lg border border-base-300 bg-base-200/35 p-3'
    >
      <BankField label={i18n.t('items.bulk.label')} class='min-w-52 flex-1'>
        <Select
          name='bulkAction'
          required
          onChange={(event) => setAction(event.currentTarget.value)}
        >
          <option value=''>{i18n.t('items.bulk.choose')}</option>
          <option value='add_to_collection'>{i18n.t('items.collections.addSelected')}</option>
          <option value='remove_from_collection'>
            {i18n.t('items.collections.removeSelected')}
          </option>
          <option value='add_tags'>{i18n.t('items.bulk.addTags')}</option>
          <option value='remove_tags'>{i18n.t('items.bulk.removeTags')}</option>
          <option value='archive'>{i18n.t('items.bulk.archive')}</option>
          <option value='restore'>{i18n.t('items.bulk.restore')}</option>
          <option value='transfer'>{i18n.t('items.bulk.transfer')}</option>
        </Select>
      </BankField>
      {(action === 'add_to_collection' || action === 'remove_from_collection') && (
        <BankField label={i18n.t('items.collections.destination')} class='min-w-52 flex-1'>
          <Select name='collectionId' required>
            <option value=''>{i18n.t('items.collections.choose')}</option>
            {collections.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </Select>
        </BankField>
      )}
      {(action === 'add_tags' || action === 'remove_tags') && (
        <BankField label={i18n.t('items.filter.tags')} class='min-w-52 flex-1'>
          <Input name='bulkTags' placeholder={i18n.t('items.bulk.tagsHint')} required />
        </BankField>
      )}
      {action === 'transfer' && (
        <MemberPicker
          name='ownerUserId'
          label={i18n.t('items.bulk.ownerLabel')}
          hint={i18n.t('items.bulk.ownerHint')}
          required
          payload={payload}
        />
      )}
      <Button type='submit'>{i18n.t('items.bulk.apply')}</Button>
    </div>
  );
}
