import Button from '../ui/Button.tsx';
import Input from '../ui/Input.tsx';
import Radio from '../ui/Radio.tsx';
import type { UserSettings } from '../../lib/settings.ts';
import type { I18n } from '../../lib/i18n/messages.ts';

type Data = {
  user: { email: string; displayName?: string | null };
  settings: UserSettings;
  success?: boolean;
};

export default function AccountSettingsPage({ data, i18n }: { data: Data; i18n: I18n }) {
  return (
    <section class='space-y-6'>
      <div class='space-y-2'>
        <h1 class='text-3xl font-medium'>{i18n.t('settings.title')}</h1>
        <p class='text-sm text-base-content/70'>{i18n.t('settings.subtitle')}</p>
      </div>
      <form class='ds-card ds-card-border max-w-xl' method='post'>
        <div class='ds-card-body space-y-4'>
          {data.success && <div class='ds-alert text-sm'>{i18n.t('settings.saved')}</div>}
          <label class='flex flex-col'>
            <span>{i18n.t('settings.displayName')}</span>
            <Input
              name='displayName'
              defaultValue={data.user.displayName ?? ''}
              placeholder={i18n.t('settings.displayNamePlaceholder')}
            />
          </label>
          <label class='flex flex-col'>
            <span>{i18n.t('settings.email')}</span>
            <Input name='email' value={data.user.email} disabled />
          </label>
          <fieldset class='space-y-2'>
            <legend class='text-sm font-medium text-base-content/80'>
              {i18n.t('settings.theme')}
            </legend>
            <label class='flex items-center gap-3'>
              <Radio
                name='theme'
                value='system'
                defaultChecked={data.settings.theme === 'system'}
              />
              <span>{i18n.t('settings.themeSystem')}</span>
            </label>
            <label class='flex items-center gap-3'>
              <Radio
                name='theme'
                value='wireframe'
                defaultChecked={data.settings.theme === 'wireframe'}
              />
              <span>{i18n.t('settings.themeLight')}</span>
            </label>
            <label class='flex items-center gap-3'>
              <Radio name='theme' value='dark' defaultChecked={data.settings.theme === 'dark'} />
              <span>{i18n.t('settings.themeDark')}</span>
            </label>
          </fieldset>
          <fieldset class='space-y-2'>
            <legend class='text-sm font-medium'>{i18n.t('settings.language')}</legend>
            <p class='text-sm text-base-content/70'>{i18n.t('settings.languageHelp')}</p>
            <label class='flex items-center gap-3'>
              <Radio
                name='interfaceLocale'
                value='en-US'
                defaultChecked={data.settings.interfaceLocale === 'en-US'}
              />
              <span lang='en-US'>{i18n.t('settings.languageUs')}</span>
            </label>
            <label class='flex items-center gap-3'>
              <Radio
                name='interfaceLocale'
                value='en-GB'
                defaultChecked={data.settings.interfaceLocale === 'en-GB'}
              />
              <span lang='en-GB'>{i18n.t('settings.languageGb')}</span>
            </label>
            <label class='flex items-center gap-3'>
              <Radio
                name='interfaceLocale'
                value='es-ES'
                defaultChecked={data.settings.interfaceLocale === 'es-ES'}
              />
              <span lang='es-ES'>{i18n.t('settings.languageEs')}</span>
            </label>
            <label class='flex items-center gap-3'>
              <Radio
                name='interfaceLocale'
                value='es-419'
                defaultChecked={data.settings.interfaceLocale === 'es-419'}
              />
              <span lang='es-419'>{i18n.t('settings.languageLatam')}</span>
            </label>
            <label class='flex items-center gap-3'>
              <Radio
                name='interfaceLocale'
                value='sv-SE'
                defaultChecked={data.settings.interfaceLocale === 'sv-SE'}
              />
              <span lang='sv-SE'>{i18n.t('settings.languageSv')}</span>
            </label>
          </fieldset>
        </div>
        <div class='ds-card-actions justify-between border-t border-base-200 px-6 py-4'>
          <Button variant='primary' type='submit'>{i18n.t('settings.save')}</Button>
          <div class='flex items-center gap-2'>
            <Button variant='ghost' href='/settings/editor'>
              {i18n.t('settings.editorPreferences')}
            </Button>
            <Button variant='ghost' href='/settings/password'>
              {i18n.t('settings.changePassword')}
            </Button>
          </div>
        </div>
      </form>
      <script>
        {`(()=>{try{const k='qflow-theme';const t='${data.settings.theme}';if(t==='system'){localStorage.setItem(k,'system');const prefersDark=window.matchMedia?window.matchMedia('(prefers-color-scheme: dark)').matches:false;document.documentElement.dataset.theme=prefersDark?'dark':'wireframe';}else{localStorage.setItem(k,t);document.documentElement.dataset.theme=t;}}catch(e){}})();`}
      </script>
    </section>
  );
}
