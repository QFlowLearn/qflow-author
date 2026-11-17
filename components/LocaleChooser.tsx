import type { I18n } from '../lib/i18n/messages.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';
import Button from './ui/Button.tsx';
import Select from './ui/Select.tsx';

type Props = {
  readonly i18n: I18n;
  readonly value: InterfaceLocale;
  readonly next?: string | null;
};

/** Signed-out locale selection. The explicit submit keeps accidental changes from navigation. */
export default function LocaleChooser({ i18n, value, next }: Props) {
  return (
    <form method='post' action='/api/locale' class='space-y-2'>
      <label class='ds-form-control' for='interface-locale'>
        <span>{i18n.t('locale.label')}</span>
        <Select id='interface-locale' name='locale' value={value}>
          <option value='en-US' lang='en-US'>{i18n.t('locale.us')}</option>
          <option value='en-GB' lang='en-GB'>{i18n.t('locale.gb')}</option>
          <option value='es-ES' lang='es-ES'>
            {i18n.t('locale.es')} — {i18n.t('locale.beta')}
          </option>
          <option value='es-419' lang='es-419'>
            {i18n.t('locale.latam')} — {i18n.t('locale.beta')}
          </option>
          <option value='sv-SE' lang='sv-SE'>
            {i18n.t('locale.sv')} — {i18n.t('locale.beta')}
          </option>
        </Select>
      </label>
      <input type='hidden' name='next' value={next ?? ''} />
      <Button variant='ghost' type='submit'>{i18n.t('locale.apply')}</Button>
    </form>
  );
}
