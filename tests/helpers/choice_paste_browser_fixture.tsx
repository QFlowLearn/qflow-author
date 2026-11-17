import { render } from 'preact';
import { useState } from 'preact/hooks';
import { I18nProvider } from '../../lib/i18n/context.tsx';
import { catalogForLocale } from '../../lib/i18n/catalogs.ts';
import { parseInterfaceLocale } from '../../lib/i18n/locale.ts';
import { createI18nPayload } from '../../lib/i18n/payload.ts';
import { parsePersistedDraft } from '../../lib/persisted_draft.ts';
import type { Draft } from '../../lib/types/draft.ts';
import { driverViewsFor } from '../../islands/drivers/view_registry.ts';
import { applyDraftListField } from '../../islands/drivers/draft_list_field.ts';
import type { DriverEditorShell } from '../../islands/drivers/types.ts';
import { normalizeDraftForDriver, resolveDriver } from '../../lib/types/draft_utils.ts';
import '../../islands/drivers/single_select.tsx';
import '../../islands/drivers/multi_select.tsx';

const query = new URL(location.href).searchParams;
const locale = parseInterfaceLocale(query.get('locale'));
const mode = query.get('mode');
if (!locale || (mode !== 'single_select' && mode !== 'multi_select')) {
  throw new Error('Explicit supported fixture locale and mode required.');
}
const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
const views = driverViewsFor(mode);
if (!views) throw new Error('Choice driver is not registered.');
const registeredViews = views;
const fixtureMode = mode;
const initial = parsePersistedDraft({
  type: mode,
  title: 'Pasted answers',
  itemLanguage: 'en-US',
  bodyHtml: '<p>Choose a planet.</p>',
  choices: [
    { id: 'A', text: '', ...(query.get('rich') === '1' ? { html: '<p></p>' } : {}) },
    { id: 'B', text: '' },
    ...(query.get('existing') === '1'
      ? [{ id: 'Q', text: 'Existing answer', label: 'Original', fixed: true }]
      : []),
  ],
  ...(mode === 'single_select'
    ? { correctId: query.get('existing') === '1' ? 'Q' : '' }
    : { correctIds: query.get('existing') === '1' ? ['Q'] : [] }),
}, mode);

if (query.has('removal')) {
  initial.choices = [
    { id: 'A', text: 'Paris' },
    {
      id: 'B',
      text: 'Berlin',
      html: '<p><em>Berlin</em></p>',
      label: 'City',
      fixed: true,
      matchMax: 2,
    },
    { id: 'C', text: 'Oslo' },
  ];
  if (mode === 'single_select') initial.correctId = 'B';
  else initial.correctIds = ['A', 'B'];
}
function Fixture() {
  const [draft, setDraft] = useState<Draft>(() => normalizeDraftForDriver(fixtureMode, initial));
  const [key, setKey] = useState(0);
  const [saveVersion, setSaveVersion] = useState(0);
  const editor: DriverEditorShell = {
    choiceHistoryKey: String(saveVersion),
    useRteForChoices: query.get('rich') === '1',
    renderPromptField: () => <p>Choose a planet.</p>,
    fieldHasIssue: () => false,
    fieldIssueText: () => undefined,
    plainTextValue: (text) => text ?? '',
    settings: { allowPins: true },
    setDraftListField: (field, value) =>
      setDraft((previous) => applyDraftListField(previous, field, value)),
  };
  return (
    <main class='mx-auto max-w-3xl p-4'>
      <h1>Pasted answer choices</h1>
      <section key={key}>
        {registeredViews.ui({ draft, update: setDraft, editor })}
      </section>
      <button
        type='button'
        onClick={() => {
          setSaveVersion((version) => version + 1);
          localStorage.setItem('choice-draft', JSON.stringify(draft));
          const saved = localStorage.getItem('choice-draft');
          if (!saved) throw new Error('Saved draft is missing.');
          setDraft(parsePersistedDraft(JSON.parse(saved), fixtureMode));
          setKey((previous) => previous + 1);
        }}
      >
        Save and reopen
      </button>
      <button type='button' onClick={() => setSaveVersion((version) => version + 1)}>Save</button>
      <output data-state hidden>{JSON.stringify(draft)}</output>
      <output data-validation hidden>
        {JSON.stringify(
          resolveDriver(draft).driver.validate(normalizeDraftForDriver(fixtureMode, draft)),
        )}
      </output>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Fixture mount is missing.');
render(
  <I18nProvider payload={payload}>
    <Fixture />
  </I18nProvider>,
  root,
);
