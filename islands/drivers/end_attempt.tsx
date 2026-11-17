import type { DriverUiContext } from './view_registry.ts';
import Input from '../../components/ui/Input.tsx';
import Checkbox from '../../components/ui/Checkbox.tsx';
import { commonContentProps } from './editor_shell.tsx';
import type { CommonContentProps } from './types.ts';
import { ResponseIdentifierDisclosure } from './response_identifier_disclosure.tsx';
import { attachStandardDriverViews } from './standard_driver_views.ts';
import { useI18n } from '../../lib/i18n/context.tsx';

export type EndAttemptContentProps = CommonContentProps & {
  endAttemptResponseIdentifier: string;
  endAttemptTitle: string;
  endAttemptCountAttempt?: boolean;

  setEndAttemptResponseIdentifier: (id: string) => void;
  setEndAttemptTitle: (title: string) => void;
  setEndAttemptCountAttempt: (value: boolean) => void;
};

function EndAttemptEditor(ctx: DriverUiContext<'end_attempt'>) {
  const { editor, draft, update } = ctx;

  return (
    <EndAttemptContent
      {...commonContentProps(editor)}
      endAttemptResponseIdentifier={draft.responseIdentifier ?? 'RESPONSE'}
      endAttemptTitle={draft.endAttemptTitle ?? 'End Attempt'}
      endAttemptCountAttempt={Boolean(draft.endAttemptCountAttempt)}
      setEndAttemptResponseIdentifier={(value) => update({ ...draft, responseIdentifier: value })}
      setEndAttemptTitle={(value) => update({ ...draft, endAttemptTitle: value })}
      setEndAttemptCountAttempt={(value) => update({ ...draft, endAttemptCountAttempt: value })}
    />
  );
}

export function EndAttemptContent(props: EndAttemptContentProps) {
  const i18n = useI18n();
  return (
    <div class='space-y-5'>
      {props.renderPromptField(i18n.t('driver.endAttemptPrompt'))}
      <ResponseIdentifierDisclosure
        value={props.endAttemptResponseIdentifier}
        onChange={props.setEndAttemptResponseIdentifier}
        placeholder='END_ATTEMPT'
      />

      <div class='grid gap-3 sm:grid-cols-2'>
        <label class='flex flex-col'>
          <span>{i18n.t('driver.buttonLabel')}</span>
          <Input
            value={props.endAttemptTitle}
            onInput={(e) => props.setEndAttemptTitle((e.target as HTMLInputElement).value)}
            placeholder={i18n.t('driver.buttonPlaceholder')}
          />
        </label>
      </div>

      <label class='flex items-center gap-2 text-xs text-base-content/70'>
        <Checkbox
          checked={!!props.endAttemptCountAttempt}
          onChange={(e) => props.setEndAttemptCountAttempt((e.target as HTMLInputElement).checked)}
        />
        <span>{i18n.t('driver.countAttempt')}</span>
      </label>
    </div>
  );
}

attachStandardDriverViews('end_attempt', EndAttemptEditor);
