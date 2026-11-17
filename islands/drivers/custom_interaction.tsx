import type { DriverUiContext } from './view_registry.ts';
import Button from '../../components/ui/Button.tsx';
import Input from '../../components/ui/Input.tsx';
import Select from '../../components/ui/Select.tsx';
import Textarea from '../../components/ui/Textarea.tsx';
import type { CustomInteractionAttribute } from '../../lib/types/custom_interaction.ts';
import { commonContentProps } from './editor_shell.tsx';
import type { CommonContentProps } from './types.ts';
import { ResponseIdentifierDisclosure } from './response_identifier_disclosure.tsx';
import { attachStandardDriverViews } from './standard_driver_views.ts';
import { useI18n } from '../../lib/i18n/context.tsx';

type CustomCardinality = 'single' | 'multiple' | 'ordered' | 'record';

export type CustomInteractionContentProps = CommonContentProps & {
  responseIdentifier: string;
  customBaseType?: string;
  customCardinality?: CustomCardinality;
  customClassName?: string;
  customDefinition?: string;
  customAttributes: CustomInteractionAttribute[];
  customInteractionMarkup: string;

  setResponseIdentifier: (id: string) => void;
  setCustomBaseType: (baseType: string) => void;
  setCustomCardinality: (cardinality: CustomCardinality) => void;
  setCustomClassName: (name: string) => void;
  setCustomDefinition: (definition: string) => void;
  setCustomInteractionMarkup: (markup: string) => void;
  addCustomAttribute: () => void;
  updateCustomAttributeName: (index: number, name: string) => void;
  updateCustomAttributeValue: (index: number, value: string) => void;
  removeCustomAttribute: (index: number) => void;
};

function CustomInteractionEditor(ctx: DriverUiContext<'custom_interaction'>) {
  const { editor, draft, update } = ctx;
  const attrs = draft.customAttributes ?? [];

  return (
    <CustomInteractionContent
      {...commonContentProps(editor)}
      responseIdentifier={draft.responseIdentifier ?? 'RESPONSE'}
      customBaseType={draft.customBaseType ?? 'string'}
      customCardinality={draft.customCardinality ?? 'single'}
      customClassName={draft.customClassName ?? ''}
      customDefinition={draft.customDefinition ?? ''}
      customAttributes={attrs}
      customInteractionMarkup={draft.customInteractionMarkup ?? ''}
      setResponseIdentifier={(value) => update({ ...draft, responseIdentifier: value })}
      setCustomBaseType={(value) => update({ ...draft, customBaseType: value })}
      setCustomCardinality={(value) => update({ ...draft, customCardinality: value })}
      setCustomClassName={(value) => update({ ...draft, customClassName: value })}
      setCustomDefinition={(value) => update({ ...draft, customDefinition: value })}
      setCustomInteractionMarkup={(value) => update({ ...draft, customInteractionMarkup: value })}
      addCustomAttribute={() =>
        update({
          ...draft,
          customAttributes: [...attrs, { name: '', value: '' }],
        })}
      updateCustomAttributeName={(index, name) =>
        update({
          ...draft,
          customAttributes: attrs.map((attr, idx) => (idx === index ? { ...attr, name } : attr)),
        })}
      updateCustomAttributeValue={(index, value) =>
        update({
          ...draft,
          customAttributes: attrs.map((attr, idx) => (idx === index ? { ...attr, value } : attr)),
        })}
      removeCustomAttribute={(index) =>
        update({
          ...draft,
          customAttributes: attrs.filter((_attr, idx) => idx !== index),
        })}
    />
  );
}

export function CustomInteractionContent(props: CustomInteractionContentProps) {
  const i18n = useI18n();
  const attrs = props.customAttributes ?? [];
  return (
    <div class='space-y-5'>
      {props.renderPromptField(i18n.t('driver.customInteractionPrompt'))}
      <ResponseIdentifierDisclosure
        value={props.responseIdentifier}
        onChange={props.setResponseIdentifier}
      />

      <div class='grid gap-3 sm:grid-cols-2'>
        <label class='ds-form-control'>
          <span>{i18n.t('driver.customInteractionBaseType')}</span>
          <Input
            value={props.customBaseType ?? ''}
            onInput={(e) => props.setCustomBaseType((e.target as HTMLInputElement).value)}
            placeholder='string'
          />
        </label>
        <label class='ds-form-control'>
          <span>{i18n.t('driver.customInteractionCardinality')}</span>
          <Select
            value={props.customCardinality ?? 'single'}
            onInput={(e) => {
              const next = (e.target as HTMLSelectElement).value as CustomCardinality;
              props.setCustomCardinality(next);
            }}
          >
            <option value='single'>{i18n.t('driver.customInteractionSingle')}</option>
            <option value='multiple'>{i18n.t('driver.customInteractionMultiple')}</option>
            <option value='ordered'>{i18n.t('driver.customInteractionOrdered')}</option>
            <option value='record'>{i18n.t('driver.customInteractionRecord')}</option>
          </Select>
        </label>
        <label class='ds-form-control'>
          <span>{i18n.t('driver.customInteractionClass')}</span>
          <Input
            value={props.customClassName ?? ''}
            onInput={(e) => props.setCustomClassName((e.target as HTMLInputElement).value)}
            placeholder='qti-custom-interaction'
          />
        </label>
        <label class='ds-form-control sm:col-span-2'>
          <span>{i18n.t('driver.customInteractionDefinition')}</span>
          <Input
            value={props.customDefinition ?? ''}
            onInput={(e) => props.setCustomDefinition((e.target as HTMLInputElement).value)}
            placeholder='https://example.com/spec/custom-interaction'
          />
        </label>
      </div>

      <div class='space-y-2'>
        <div class='flex items-center justify-between'>
          <strong class='text-sm text-base-content/80'>
            {i18n.t('driver.customInteractionAttributes')}
          </strong>
          <Button size='sm' type='button' onClick={props.addCustomAttribute}>
            + {i18n.t('driver.attributeAdd')}
          </Button>
        </div>
        {attrs.length === 0 && (
          <p class='text-sm text-base-content/60'>
            {i18n.t('driver.customInteractionAttributesEmpty')}
          </p>
        )}
        <div class='space-y-2'>
          {attrs.map((attr, index) => (
            <div
              key={`custom-attr-${index}`}
              class='grid gap-2 rounded-lg border border-base-300 bg-base-100 px-3 py-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center'
            >
              <label class='ds-form-control'>
                <span class='text-xs'>{i18n.t('driver.attributeName', { number: index + 1 })}</span>
                <Input
                  size='sm'
                  value={attr.name}
                  placeholder='data-foo'
                  onInput={(e) =>
                    props.updateCustomAttributeName(index, (e.target as HTMLInputElement).value)}
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
                    props.updateCustomAttributeValue(index, (e.target as HTMLInputElement).value)}
                />
              </label>
              <Button
                size='xs'
                variant='danger-ghost'
                type='button'
                onClick={() => props.removeCustomAttribute(index)}
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
          <span>{i18n.t('driver.customInteractionMarkup')}</span>
          <Textarea
            class='min-h-[180px] font-mono text-xs'
            value={props.customInteractionMarkup}
            onInput={(e) =>
              props.setCustomInteractionMarkup((e.target as HTMLTextAreaElement).value)}
            placeholder={`<div class="custom-interaction">${
              i18n.t('driver.customInteractionMarkupExample')
            }</div>`}
          />
        </label>
        {props.fieldHasIssue('body') && (
          <p class='text-xs text-error'>{props.fieldIssueText('body')}</p>
        )}
        <p class='text-xs text-base-content/60'>
          {i18n.t('driver.customInteractionMarkupHelp')}
        </p>
      </div>
    </div>
  );
}

attachStandardDriverViews('custom_interaction', CustomInteractionEditor);
