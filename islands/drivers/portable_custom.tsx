import { useEffect } from 'preact/hooks';
import { setDraftFieldValue, setDraftListFieldValue } from './editor_shell.tsx';
import Button from '../../components/ui/Button.tsx';
import Input from '../../components/ui/Input.tsx';
import Textarea from '../../components/ui/Textarea.tsx';
import type { PortableDataAttribute } from '../../lib/types/portable_custom.ts';
import { defaultsPortableCustom } from '../../lib/types/portable_custom.ts';
import type { DriverUiContext } from './view_registry.ts';
import type { CommonContentProps } from './types.ts';
import { ResponseIdentifierDisclosure } from './response_identifier_disclosure.tsx';
import { attachStandardDriverViews } from './standard_driver_views.ts';
import { useI18n } from '../../lib/i18n/context.tsx';

export type PortableCustomContentProps = CommonContentProps & {
  responseIdentifier: string;
  portableCustomTypeIdentifier: string;
  portableDataAttributes: PortableDataAttribute[];
  portableInteractionMarkup: string;

  setResponseIdentifier: (id: string) => void;
  setPortableCustomTypeIdentifier: (value: string) => void;
  setPortableInteractionMarkup: (markup: string) => void;
  addPortableDataAttribute: () => void;
  updatePortableDataAttributeName: (index: number, name: string) => void;
  updatePortableDataAttributeValue: (index: number, value: string) => void;
  removePortableDataAttribute: (index: number) => void;
};

function PortableCustomEditor(ctx: DriverUiContext<'portable_custom'>) {
  const { editor, draft, update } = ctx;

  const setDraftField = <K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K] | ((prev: (typeof draft)[K]) => (typeof draft)[K]),
  ) => setDraftFieldValue(editor, draft, update, key, value);

  const dataAttrs = draft.portableDataAttributes ?? [];

  useEffect(() => {
    if (
      draft.portableCustomTypeIdentifier || draft.portableInteractionMarkup || dataAttrs.length > 0
    ) return;
    const defaults = defaultsPortableCustom();
    update({
      ...draft,
      responseIdentifier: draft.responseIdentifier ?? defaults.responseIdentifier ?? 'RESPONSE',
      portableCustomTypeIdentifier: draft.portableCustomTypeIdentifier ??
        defaults.portableCustomTypeIdentifier ??
        '',
      portableModule: draft.portableModule ?? defaults.portableModule ?? '',
      portableBaseType: draft.portableBaseType ?? defaults.portableBaseType ?? 'string',
      portableCardinality: draft.portableCardinality ?? defaults.portableCardinality ?? 'single',
      portableInteractionMarkup: draft.portableInteractionMarkup ??
        defaults.portableInteractionMarkup ?? '',
      portableDataAttributes: defaults.portableDataAttributes ?? [],
      portableInteractionModules: defaults.portableInteractionModules ?? [],
      portableModulesPrimaryConfiguration: defaults.portableModulesPrimaryConfiguration ?? '',
      portableModulesSecondaryConfiguration: defaults.portableModulesSecondaryConfiguration ?? '',
    });
  }, [draft.portableCustomTypeIdentifier, draft.portableInteractionMarkup, dataAttrs.length]);

  const setResponseIdentifier = (value: string) => setDraftField('responseIdentifier', value);
  const setPortableCustomTypeIdentifier = (value: string) =>
    setDraftField('portableCustomTypeIdentifier', value);
  const setPortableInteractionMarkup = (value: string) =>
    setDraftField('portableInteractionMarkup', value);

  const addPortableDataAttribute = () =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'portableDataAttributes',
      (prev) => [
        ...prev,
        { name: 'data-', value: '' },
      ],
    );
  const updatePortableDataAttributeName = (index: number, name: string) =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'portableDataAttributes',
      (prev) => prev.map((attr, idx) => (idx === index ? { ...attr, name } : attr)),
    );
  const updatePortableDataAttributeValue = (index: number, value: string) =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'portableDataAttributes',
      (prev) => prev.map((attr, idx) => (idx === index ? { ...attr, value } : attr)),
    );
  const removePortableDataAttribute = (index: number) =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'portableDataAttributes',
      (prev) => prev.filter((_, idx) => idx !== index),
    );

  return (
    <PortableCustomContent
      renderPromptField={editor.renderPromptField ?? (() => null)}
      fieldHasIssue={editor.fieldHasIssue ?? (() => false)}
      fieldIssueText={editor.fieldIssueText ?? (() => undefined)}
      responseIdentifier={draft.responseIdentifier ?? 'RESPONSE'}
      portableCustomTypeIdentifier={draft.portableCustomTypeIdentifier ?? ''}
      portableDataAttributes={dataAttrs}
      portableInteractionMarkup={draft.portableInteractionMarkup ?? ''}
      setResponseIdentifier={setResponseIdentifier}
      setPortableCustomTypeIdentifier={setPortableCustomTypeIdentifier}
      setPortableInteractionMarkup={setPortableInteractionMarkup}
      addPortableDataAttribute={addPortableDataAttribute}
      updatePortableDataAttributeName={updatePortableDataAttributeName}
      updatePortableDataAttributeValue={updatePortableDataAttributeValue}
      removePortableDataAttribute={removePortableDataAttribute}
    />
  );
}

export function PortableCustomContent(props: PortableCustomContentProps) {
  const i18n = useI18n();
  const attrs = props.portableDataAttributes ?? [];
  return (
    <div class='space-y-5'>
      {props.renderPromptField(i18n.t('driver.portableCustomPrompt'))}
      <ResponseIdentifierDisclosure
        value={props.responseIdentifier}
        onChange={props.setResponseIdentifier}
      />

      <div class='grid gap-3 sm:grid-cols-2'>
        <label class='ds-form-control'>
          <span>{i18n.t('driver.portableCustomType')}</span>
          <Input
            value={props.portableCustomTypeIdentifier}
            onInput={(e) =>
              props.setPortableCustomTypeIdentifier((e.target as HTMLInputElement).value)}
            placeholder='urn:example:pci:type'
          />
        </label>
      </div>

      <div class='space-y-2'>
        <div class='flex items-center justify-between'>
          <strong class='text-sm text-base-content/80'>
            {i18n.t('driver.portableCustomAttributes')}
          </strong>
          <Button size='sm' type='button' onClick={props.addPortableDataAttribute}>
            + {i18n.t('driver.attributeAdd')}
          </Button>
        </div>
        {attrs.length === 0 && (
          <p class='text-sm text-base-content/60'>
            {i18n.t('driver.portableCustomAttributesEmpty')}
          </p>
        )}
        <div class='space-y-2'>
          {attrs.map((attr, index) => (
            <div
              key={`pci-data-${index}`}
              class='grid gap-2 rounded-lg border border-base-300 bg-base-100 px-3 py-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center'
            >
              <label class='ds-form-control'>
                <span class='text-xs'>{i18n.t('driver.attributeName', { number: index + 1 })}</span>
                <Input
                  size='sm'
                  value={attr.name}
                  placeholder='data-mode'
                  onInput={(e) =>
                    props.updatePortableDataAttributeName(
                      index,
                      (e.target as HTMLInputElement).value,
                    )}
                />
              </label>
              <label class='ds-form-control'>
                <span class='text-xs'>
                  {i18n.t('driver.attributeValue', { number: index + 1 })}
                </span>
                <Input
                  size='sm'
                  value={attr.value}
                  placeholder={i18n.t('driver.attributeValuePlaceholder')}
                  onInput={(e) =>
                    props.updatePortableDataAttributeValue(
                      index,
                      (e.target as HTMLInputElement).value,
                    )}
                />
              </label>
              <Button
                size='xs'
                variant='danger-ghost'
                type='button'
                onClick={() => props.removePortableDataAttribute(index)}
                aria-label={i18n.t('driver.attributeRemove', { number: index + 1 })}
              >
                {i18n.t('driver.remove')}
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div class='space-y-2'>
        <label class='ds-form-control'>
          <span>{i18n.t('driver.portableCustomMarkup')}</span>
          <Textarea
            class='min-h-[180px] font-mono text-xs'
            value={props.portableInteractionMarkup}
            onInput={(e) =>
              props.setPortableInteractionMarkup((e.target as HTMLTextAreaElement).value)}
            placeholder={`<div class="pci-root">${
              i18n.t('driver.portableCustomMarkupExample')
            }</div>`}
          />
        </label>
        {props.fieldHasIssue('body') && (
          <p class='text-xs text-error'>{props.fieldIssueText('body')}</p>
        )}
        <p class='text-xs text-base-content/60'>
          {i18n.t('driver.portableCustomMarkupHelp')}
        </p>
      </div>
    </div>
  );
}

attachStandardDriverViews('portable_custom', PortableCustomEditor);
