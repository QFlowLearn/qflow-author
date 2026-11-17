import type { DriverUiContext } from './view_registry.ts';
import RichTextEditor from '../RichTextEditor.tsx';
import { commonContentProps, setDraftFieldValue } from './editor_shell.tsx';
import type { CommonContentProps } from './types.ts';
import { attachStandardDriverViews } from './standard_driver_views.ts';
import { ResponseIdentifierDisclosure } from './response_identifier_disclosure.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';

export type ExtendedTextContentProps = CommonContentProps & {
  extendedResponseId: string;
  setExtendedResponseId: (value: string) => void;
  extendedRubricHtml: string;
  setExtendedRubricHtml: (value: string) => void;
};

function ExtendedTextEditor(ctx: DriverUiContext<'extended_text'>) {
  const { editor, draft, update } = ctx;

  const setDraftField = <K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K] | ((prev: (typeof draft)[K]) => (typeof draft)[K]),
  ) => setDraftFieldValue(editor, draft, update, key, value);

  return (
    <ExtendedTextContent
      {...commonContentProps(editor)}
      extendedResponseId={draft.responseIdentifier ?? 'RESPONSE'}
      setExtendedResponseId={(value) => setDraftField('responseIdentifier', value)}
      extendedRubricHtml={draft.rubricHtml ?? ''}
      setExtendedRubricHtml={(value) => setDraftField('rubricHtml', value)}
    />
  );
}

export function ExtendedTextContent(props: ExtendedTextContentProps) {
  const i18n = useI18n();
  return (
    <div class='space-y-4'>
      {props.renderPromptField(i18n.t('driver.extendedPrompt'))}

      <ResponseIdentifierDisclosure
        value={props.extendedResponseId}
        onChange={(value) => props.setExtendedResponseId(value.toUpperCase())}
      />

      <div class='space-y-2'>
        <span class='text-sm font-medium text-base-content/80'>
          {i18n.t('driver.scorerRubric')}
        </span>
        <RichTextEditor
          valueHtml={props.extendedRubricHtml}
          onChangeHtml={props.setExtendedRubricHtml}
          placeholder={i18n.t('driver.rubricPlaceholder')}
          minHeight={120}
          contentScope='body'
        />
      </div>
    </div>
  );
}

attachStandardDriverViews('extended_text', ExtendedTextEditor);
