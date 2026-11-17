import type { DriverUiContext } from './view_registry.ts';
import { setDraftFieldValue } from './editor_shell.tsx';
import { defaultsUpload } from '../../lib/types/upload.ts';
import type { CommonContentProps } from './types.ts';
import { ResponseIdentifierDisclosure } from './response_identifier_disclosure.tsx';
import { attachStandardDriverViews } from './standard_driver_views.ts';
import { useEffect } from 'preact/hooks';
import { useI18n } from '../../lib/i18n/context.tsx';

export type UploadContentProps = CommonContentProps & {
  responseIdentifier: string;
  maxFileSize?: number;
  fileTypes?: string;
  multiple?: boolean;
  setResponseIdentifier: (id: string) => void;
  setMaxFileSize: (value?: number) => void;
  setFileTypes: (value: string) => void;
  setMultiple: (value: boolean) => void;
};

function UploadEditor(ctx: DriverUiContext<'upload'>) {
  const { editor, draft, update } = ctx;

  const setDraftField = <K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K] | ((prev: (typeof draft)[K]) => (typeof draft)[K]),
  ) => setDraftFieldValue(editor, draft, update, key, value);

  useEffect(() => {
    if (draft.responseIdentifier) return;
    const defaults = defaultsUpload();
    update({
      ...draft,
      responseIdentifier: draft.responseIdentifier ?? defaults.responseIdentifier ?? 'RESPONSE',
    });
  }, [draft.responseIdentifier]);

  return (
    <UploadContent
      renderPromptField={editor.renderPromptField ?? (() => null)}
      fieldHasIssue={editor.fieldHasIssue ?? (() => false)}
      fieldIssueText={editor.fieldIssueText ?? (() => undefined)}
      responseIdentifier={draft.responseIdentifier ?? 'RESPONSE'}
      maxFileSize={draft.uploadMaxFileSize ?? undefined}
      fileTypes={draft.uploadFileTypes ?? ''}
      multiple={draft.uploadMultiple ?? false}
      setResponseIdentifier={(value) => setDraftField('responseIdentifier', value)}
      setMaxFileSize={(value) => setDraftField('uploadMaxFileSize', value)}
      setFileTypes={(value) => setDraftField('uploadFileTypes', value)}
      setMultiple={(value) => setDraftField('uploadMultiple', value)}
    />
  );
}

export function UploadContent(props: UploadContentProps) {
  const i18n = useI18n();
  return (
    <div class='space-y-5'>
      {props.renderPromptField(i18n.t('driver.uploadPrompt'))}
      <ResponseIdentifierDisclosure
        value={props.responseIdentifier}
        onChange={props.setResponseIdentifier}
      />
    </div>
  );
}

attachStandardDriverViews('upload', UploadEditor);
