import type {
  CatalogCardDraft,
  CatalogCardEntryDraft,
  CatalogDraft,
  CatalogFileDraft,
  StylesheetDraft,
} from '../lib/types/draft.ts';
import {
  isValidLanguageTag,
  makeCatalogSupport,
  PREDEFINED_CATALOG_SUPPORTS,
} from '../lib/catalog_metadata.ts';
import Button from '../components/ui/Button.tsx';
import Checkbox from '../components/ui/Checkbox.tsx';
import Input from '../components/ui/Input.tsx';
import Select from '../components/ui/Select.tsx';
import RichTextEditor from './RichTextEditor.tsx';
import { useI18n } from '../lib/i18n/context.tsx';

type Props = {
  catalogs: CatalogDraft[];
  stylesheets: StylesheetDraft[];
  onCatalogsChange: (catalogs: CatalogDraft[]) => void;
  onStylesheetsChange: (stylesheets: StylesheetDraft[]) => void;
};

const CUSTOM_SUPPORT = '__custom__';

export default function CatalogAuthoring(
  { catalogs, stylesheets, onCatalogsChange, onStylesheetsChange }: Props,
) {
  const i18n = useI18n();
  const addGlossary = () => {
    const id = nextCatalogId(catalogs, 'glossary');
    onCatalogsChange([...catalogs, createGlossaryCatalog(id)]);
  };

  const addKeywordTranslations = () => {
    const id = nextCatalogId(catalogs, 'keyword');
    onCatalogsChange([
      ...catalogs,
      {
        id,
        cards: [{
          support: { kind: 'predefined', value: 'keyword-translation' },
          entries: [{ language: '', contentHtml: '<p></p>' }],
        }],
      },
    ]);
  };

  const addCustomCatalog = () => {
    const id = nextCatalogId(catalogs, 'catalog');
    onCatalogsChange([
      ...catalogs,
      {
        id,
        cards: [{
          support: { kind: 'custom', value: '' },
          entries: [{ contentHtml: '<p></p>' }],
        }],
      },
    ]);
  };

  const updateCatalog = (index: number, next: CatalogDraft) => {
    onCatalogsChange(catalogs.map((catalog, candidate) => candidate === index ? next : catalog));
  };

  return (
    <div class='space-y-6'>
      <section class='space-y-3' aria-labelledby='catalog-authoring-heading'>
        <div class='space-y-1'>
          <h3 id='catalog-authoring-heading' class='text-lg font-medium'>
            {i18n.t('catalog.accessibilityCatalogs')}
          </h3>
          <p class='max-w-3xl text-sm text-base-content/70'>
            {i18n.t('catalog.description')}
          </p>
        </div>
        <div class='flex flex-wrap gap-2'>
          <Button type='button' size='sm' variant='primary' onClick={addGlossary}>
            {i18n.t('catalog.addGlossary')}
          </Button>
          <Button type='button' size='sm' onClick={addKeywordTranslations}>
            {i18n.t('catalog.addTranslations')}
          </Button>
          <Button type='button' size='sm' variant='ghost' onClick={addCustomCatalog}>
            {i18n.t('catalog.addCustom')}
          </Button>
        </div>

        {catalogs.length === 0
          ? (
            <p class='rounded-md border border-base-300 p-4 text-sm text-base-content/70'>
              {i18n.t('catalog.empty')}
            </p>
          )
          : (
            <div class='space-y-4'>
              {catalogs.map((catalog, catalogIndex) => (
                <CatalogEditor
                  key={`${catalog.id}-${catalogIndex}`}
                  catalog={catalog}
                  index={catalogIndex}
                  onChange={(next) => updateCatalog(catalogIndex, next)}
                  onRemove={() =>
                    onCatalogsChange(catalogs.filter((_value, index) => index !== catalogIndex))}
                />
              ))}
            </div>
          )}
      </section>

      <StylesheetEditor stylesheets={stylesheets} onChange={onStylesheetsChange} />
    </div>
  );
}

/** Creates an empty glossary card; visible starter copy comes from the localized editor placeholder. */
export function createGlossaryCatalog(id: string): CatalogDraft {
  return {
    id,
    cards: [{
      support: { kind: 'predefined', value: 'glossary-on-screen' },
      entries: [{ contentHtml: '<p></p>' }],
    }],
  };
}

function CatalogEditor(
  { catalog, index, onChange, onRemove }: {
    catalog: CatalogDraft;
    index: number;
    onChange: (catalog: CatalogDraft) => void;
    onRemove: () => void;
  },
) {
  const i18n = useI18n();
  const updateCard = (cardIndex: number, next: CatalogCardDraft) => {
    onChange({
      ...catalog,
      cards: catalog.cards.map((card, candidate) => candidate === cardIndex ? next : card),
    });
  };

  return (
    <fieldset class='rounded-md border border-base-300 p-4 space-y-4'>
      <legend class='px-2 text-sm font-medium'>
        {i18n.t('catalog.catalogNumber', { number: index + 1 })}
      </legend>
      <div class='flex items-end gap-3'>
        <label class='ds-form-control flex-1' htmlFor={`catalog-${index}-id`}>
          <span>{i18n.t('catalog.id')}</span>
          <Input
            id={`catalog-${index}-id`}
            value={catalog.id}
            aria-describedby={`catalog-${index}-id-help`}
            onInput={(event) =>
              onChange({ ...catalog, id: (event.target as HTMLInputElement).value })}
          />
          <span id={`catalog-${index}-id-help`} class='text-xs text-base-content/60'>
            {i18n.t('catalog.idHelp')}
          </span>
        </label>
        <Button
          type='button'
          size='sm'
          variant='ghost'
          aria-label={i18n.t('catalog.removeCatalogNamed', {
            name: catalog.id || String(index + 1),
          })}
          onClick={onRemove}
        >
          {i18n.t('catalog.remove')}
        </Button>
      </div>

      <div class='space-y-4'>
        {catalog.cards.map((card, cardIndex) => (
          <CardEditor
            key={`${card.support.value}-${cardIndex}`}
            card={card}
            catalogIndex={index}
            cardIndex={cardIndex}
            onChange={(next) => updateCard(cardIndex, next)}
            onRemove={() =>
              onChange({
                ...catalog,
                cards: catalog.cards.filter((_value, candidate) => candidate !== cardIndex),
              })}
          />
        ))}
      </div>
      <Button
        type='button'
        size='sm'
        onClick={() =>
          onChange({
            ...catalog,
            cards: [
              ...catalog.cards,
              {
                support: { kind: 'predefined', value: 'glossary-on-screen' },
                entries: [{ contentHtml: '<p></p>' }],
              },
            ],
          })}
      >
        {i18n.t('catalog.addCard')}
      </Button>
    </fieldset>
  );
}

function CardEditor(
  { card, catalogIndex, cardIndex, onChange, onRemove }: {
    card: CatalogCardDraft;
    catalogIndex: number;
    cardIndex: number;
    onChange: (card: CatalogCardDraft) => void;
    onRemove: () => void;
  },
) {
  const i18n = useI18n();
  const path = `catalog-${catalogIndex}-card-${cardIndex}`;
  const supportValue = card.support.kind === 'custom' ? CUSTOM_SUPPORT : card.support.value;
  const entries = card.entries ?? [];
  const updateEntry = (index: number, next: CatalogCardEntryDraft) => {
    onChange({
      ...card,
      entries: entries.map((entry, candidate) => candidate === index ? next : entry),
    });
  };

  return (
    <fieldset class='border-t border-base-300 pt-4 space-y-3'>
      <legend class='sr-only'>{i18n.t('catalog.cardNumber', { number: cardIndex + 1 })}</legend>
      <div class='grid gap-3 sm:grid-cols-2'>
        <label class='ds-form-control' htmlFor={`${path}-support`}>
          <span>{i18n.t('catalog.support')}</span>
          <Select
            id={`${path}-support`}
            value={supportValue}
            onInput={(event) => {
              const value = (event.target as HTMLSelectElement).value;
              onChange({
                ...card,
                support: value === CUSTOM_SUPPORT
                  ? { kind: 'custom', value: '' }
                  : makeCatalogSupport(value),
              });
            }}
          >
            {PREDEFINED_CATALOG_SUPPORTS.map((support) => (
              <option key={support} value={support}>{i18n.t(`catalog.support.${support}`)}</option>
            ))}
            <option value={CUSTOM_SUPPORT}>{i18n.t('catalog.customSupport')}</option>
          </Select>
        </label>
        {card.support.kind === 'custom' && (
          <label class='ds-form-control' htmlFor={`${path}-custom-support`}>
            <span>{i18n.t('catalog.customSupportName')}</span>
            <Input
              id={`${path}-custom-support`}
              value={card.support.value}
              onInput={(event) =>
                onChange({
                  ...card,
                  support: makeCatalogSupport((event.target as HTMLInputElement).value),
                })}
            />
          </label>
        )}
        <LanguageField
          id={`${path}-language`}
          label={i18n.t('catalog.cardLanguage')}
          value={card.language ?? ''}
          onChange={(language) => onChange({ ...card, language })}
        />
      </div>

      {entries.map((entry, entryIndex) => (
        <EntryEditor
          key={`${entry.language ?? 'entry'}-${entryIndex}`}
          entry={entry}
          support={card.support.value}
          id={`${path}-entry-${entryIndex}`}
          onChange={(next) => updateEntry(entryIndex, next)}
          onRemove={() =>
            onChange({
              ...card,
              entries: entries.filter((_value, candidate) => candidate !== entryIndex),
            })}
        />
      ))}

      {entries.length === 0 && (
        <div class='rounded-md bg-base-200 p-3 space-y-3'>
          <div class='ds-form-control'>
            <span id={`${path}-direct-content-label`}>
              {card.support.value === 'glossary-on-screen'
                ? i18n.t('catalog.definition')
                : i18n.t('catalog.directContent')}
            </span>
            <RichTextEditor
              valueHtml={card.contentHtml ?? ''}
              onChangeHtml={(contentHtml) => onChange({ ...card, contentHtml })}
              placeholder={i18n.t('catalog.contentPlaceholder')}
              minHeight={96}
              contentScope='body'
              ariaLabelledBy={`${path}-direct-content-label`}
            />
          </div>
          {!card.contentHtml?.trim() && (
            <FileEditors
              id={`${path}-direct`}
              files={card.files ?? []}
              label={i18n.t('catalog.referencedFiles')}
              onChange={(files) => onChange({ ...card, files, contentHtml: undefined })}
            />
          )}
        </div>
      )}

      <div class='flex flex-wrap justify-between gap-2'>
        <Button
          type='button'
          size='sm'
          onClick={() => {
            const nextEntry = entries.length === 0
              ? {
                language: card.language,
                contentHtml: card.contentHtml,
                files: card.files,
              }
              : { language: '', contentHtml: '<p></p>' };
            onChange({
              ...card,
              language: entries.length === 0 ? undefined : card.language,
              contentHtml: undefined,
              files: undefined,
              entries: [...entries, nextEntry],
            });
          }}
        >
          {entries.length === 0 && (card.contentHtml?.trim() || card.files?.length)
            ? i18n.t('catalog.convertToEntry')
            : card.support.value === 'keyword-translation'
            ? i18n.t('catalog.addTranslation')
            : i18n.t('catalog.addEntry')}
        </Button>
        <Button
          type='button'
          size='sm'
          variant='ghost'
          aria-label={i18n.t('catalog.removeCardNamed', {
            name: card.support.value || String(cardIndex + 1),
          })}
          onClick={onRemove}
        >
          {i18n.t('catalog.removeCard')}
        </Button>
      </div>
    </fieldset>
  );
}

function EntryEditor(
  { entry, support, id, onChange, onRemove }: {
    entry: CatalogCardEntryDraft;
    support: string;
    id: string;
    onChange: (entry: CatalogCardEntryDraft) => void;
    onRemove: () => void;
  },
) {
  const i18n = useI18n();
  const isGlossary = support === 'glossary-on-screen';
  const isTranslation = support === 'keyword-translation';
  const files = entry.files ?? [];
  return (
    <div class='rounded-md bg-base-200 p-3 space-y-3'>
      <div class='grid gap-3 sm:grid-cols-2'>
        <LanguageField
          id={`${id}-language`}
          label={isTranslation
            ? i18n.t('catalog.translationLanguage')
            : i18n.t('catalog.languageOptional')}
          value={entry.language ?? ''}
          required={isTranslation}
          onChange={(language) => onChange({ ...entry, language })}
        />
        <label class='flex items-center gap-2 self-end min-h-12'>
          <Checkbox
            checked={entry.default ?? false}
            onChange={(event) =>
              onChange({ ...entry, default: (event.target as HTMLInputElement).checked })}
          />
          <span>{i18n.t('catalog.defaultEntry')}</span>
        </label>
      </div>
      <div class='ds-form-control'>
        <span id={`${id}-content-label`}>
          {isGlossary
            ? i18n.t('catalog.definition')
            : isTranslation
            ? i18n.t('catalog.translatedText')
            : i18n.t('catalog.content')}
        </span>
        <RichTextEditor
          valueHtml={entry.contentHtml ?? ''}
          onChangeHtml={(contentHtml) => onChange({ ...entry, contentHtml })}
          placeholder={isGlossary
            ? i18n.t('catalog.termPlaceholder')
            : i18n.t('catalog.contentPlaceholder')}
          minHeight={96}
          contentScope='body'
          ariaLabelledBy={`${id}-content-label`}
        />
      </div>
      <FileEditors
        id={id}
        files={files}
        label={isTranslation ? i18n.t('catalog.audioResources') : i18n.t('catalog.referencedFiles')}
        onChange={(next) => onChange({ ...entry, files: next })}
      />
      <div class='flex justify-end'>
        <Button
          type='button'
          size='sm'
          variant='ghost'
          aria-label={i18n.t('catalog.removeEntryNamed', { name: entry.language || id })}
          onClick={onRemove}
        >
          {i18n.t('catalog.removeEntry')}
        </Button>
      </div>
    </div>
  );
}

function FileEditors(
  { files, id, label, onChange }: {
    files: CatalogFileDraft[];
    id: string;
    label: string;
    onChange: (files: CatalogFileDraft[]) => void;
  },
) {
  const i18n = useI18n();
  return (
    <fieldset class='space-y-2'>
      <legend class='text-sm font-medium'>{label}</legend>
      {files.map((file, index) => (
        <div key={index} class='grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.45fr)_auto]'>
          <label class='ds-form-control' htmlFor={`${id}-file-${index}-href`}>
            <span>{i18n.t('catalog.fileReference')}</span>
            <Input
              id={`${id}-file-${index}-href`}
              value={file.href}
              placeholder='/uploads/… · package/path'
              onInput={(event) =>
                onChange(files.map((value, candidate) =>
                  candidate === index
                    ? { ...value, href: (event.target as HTMLInputElement).value }
                    : value
                ))}
            />
          </label>
          <label class='ds-form-control' htmlFor={`${id}-file-${index}-mime`}>
            <span>{i18n.t('catalog.mimeType')}</span>
            <Input
              id={`${id}-file-${index}-mime`}
              value={file.mimeType ?? ''}
              placeholder='audio/mpeg'
              onInput={(event) =>
                onChange(files.map((value, candidate) =>
                  candidate === index
                    ? { ...value, mimeType: (event.target as HTMLInputElement).value }
                    : value
                ))}
            />
          </label>
          <Button
            class='self-end'
            type='button'
            size='sm'
            variant='ghost'
            aria-label={i18n.t('catalog.removeFileNamed', { name: file.href || String(index + 1) })}
            onClick={() =>
              onChange(files.filter((_value, candidate) =>
                candidate !== index
              ))}
          >
            {i18n.t('catalog.removeFile')}
          </Button>
        </div>
      ))}
      <Button
        type='button'
        size='sm'
        variant='ghost'
        onClick={() => onChange([...files, { href: '', mimeType: '' }])}
      >
        {i18n.t('catalog.addFile')}
      </Button>
    </fieldset>
  );
}

export function LanguageField(
  { id, label, value, required = false, onChange }: {
    id: string;
    label: string;
    value: string;
    required?: boolean;
    onChange: (value: string) => void;
  },
) {
  const i18n = useI18n();
  const invalid = value.trim().length > 0 && !isValidLanguageTag(value);
  const errorId = `${id}-error`;
  return (
    <label class='ds-form-control' htmlFor={id}>
      <span>{label}{required ? ` (${i18n.t('catalog.required')})` : ''}</span>
      <Input
        id={id}
        value={value}
        required={required}
        aria-invalid={invalid ? 'true' : undefined}
        aria-describedby={invalid ? errorId : undefined}
        placeholder={i18n.t('catalog.languagePlaceholder')}
        onInput={(event) => onChange((event.target as HTMLInputElement).value)}
      />
      {invalid && (
        <span id={errorId} role='alert' aria-live='polite' class='text-xs text-error'>
          {i18n.t('catalog.invalidLanguage')}
        </span>
      )}
    </label>
  );
}

function StylesheetEditor(
  { stylesheets, onChange }: {
    stylesheets: StylesheetDraft[];
    onChange: (stylesheets: StylesheetDraft[]) => void;
  },
) {
  const i18n = useI18n();
  return (
    <section class='space-y-3' aria-labelledby='stylesheet-heading'>
      <div class='space-y-1'>
        <h3 id='stylesheet-heading' class='text-lg font-medium'>{i18n.t('stylesheet.heading')}</h3>
        <p class='max-w-3xl text-sm text-base-content/70'>
          {i18n.t('stylesheet.description')}
        </p>
      </div>
      {stylesheets.map((stylesheet, index) => (
        <fieldset
          key={`stylesheet-${index}`}
          class='rounded-md border border-base-300 p-3 space-y-3'
        >
          <legend class='px-2 text-sm font-medium'>
            {i18n.t('stylesheet.number', { number: index + 1 })}
          </legend>
          <div class='grid gap-3 sm:grid-cols-2'>
            {(['href', 'type', 'media', 'title'] as const).map((field) => (
              <label key={field} class='ds-form-control' htmlFor={`stylesheet-${index}-${field}`}>
                <span>
                  {field === 'href'
                    ? i18n.t('catalog.fileReference')
                    : i18n.t(`stylesheet.${field}`)}
                </span>
                <Input
                  id={`stylesheet-${index}-${field}`}
                  value={stylesheet[field] ?? ''}
                  placeholder={field === 'href' ? '/uploads/… · styles/item.css' : undefined}
                  onInput={(event) =>
                    onChange(stylesheets.map((value, candidate) =>
                      candidate === index
                        ? { ...value, [field]: (event.target as HTMLInputElement).value }
                        : value
                    ))}
                />
              </label>
            ))}
          </div>
          <div class='flex justify-end'>
            <Button
              type='button'
              size='sm'
              variant='ghost'
              aria-label={i18n.t('stylesheet.removeNamed', {
                name: stylesheet.href || String(index + 1),
              })}
              onClick={() =>
                onChange(stylesheets.filter((_value, candidate) => candidate !== index))}
            >
              {i18n.t('stylesheet.remove')}
            </Button>
          </div>
        </fieldset>
      ))}
      <Button
        type='button'
        size='sm'
        onClick={() => onChange([...stylesheets, { href: '', type: 'text/css' }])}
      >
        {i18n.t('stylesheet.add')}
      </Button>
    </section>
  );
}

function nextCatalogId(catalogs: readonly CatalogDraft[], prefix: string): string {
  const ids = new Set(catalogs.map((catalog) => catalog.id));
  let index = 1;
  while (ids.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}
