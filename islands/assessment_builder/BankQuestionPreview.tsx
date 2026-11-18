import { reportUiError } from '../../lib/client/ui_event.ts';
import type { QtiAttemptStateV1 } from '@longsightgroup/qti3-core';
import { useEffect, useState } from 'preact/hooks';
import Button from '../../components/ui/Button.tsx';
import QtiItemPreview from '../QtiItemPreview.tsx';
import {
  type BankQuestionPreview as Preview,
  parseBankQuestionPreview,
} from '../../lib/bank_question_preview.ts';
import type { I18nPayload } from '../../lib/i18n/payload.ts';
import type { QflowPlayerMessageCatalog } from '../../lib/i18n/player_messages/types.ts';
import { useI18n } from '../../lib/i18n/context.tsx';

/** Localization already owned by the assessment, shared with on-demand previews. */
export type BankPreviewContext = {
  readonly payload: I18nPayload;
  readonly playerCatalog: QflowPlayerMessageCatalog;
};

/** Loads only the expanded revision and cancels abandoned preview requests. */
export default function BankQuestionPreview(
  props: BankPreviewContext & {
    readonly itemId: string;
    readonly revision: number;
    readonly scoreLabel?: string;
    readonly onScored?: (state: QtiAttemptStateV1) => void;
  },
) {
  const i18n = useI18n();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; preview: Preview }
  >({ kind: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    async function load() {
      try {
        const response = await fetch(
          `/api/items/${props.itemId}/preview?revision=${props.revision}`,
          { signal: controller.signal },
        );
        const raw: unknown = response.ok ? await response.json() : null;
        const preview = parseBankQuestionPreview(raw, props.itemId, props.revision);
        if (!controller.signal.aborted) {
          setState(preview ? { kind: 'ready', preview } : { kind: 'failed' });
        }
      } catch {
        if (!controller.signal.aborted) setState({ kind: 'failed' });
      }
    }
    // The effect owns cancellation; load handles every rejected request.
    load().catch(reportUiError);
    return () => controller.abort();
  }, [props.itemId, props.revision, attempt]);
  if (state.kind === 'loading') {
    return <p role='status'>{i18n.t('assessments.builder.library.previewLoading')}</p>;
  }
  if (state.kind === 'failed') {
    return (
      <div role='alert'>
        <p>{i18n.t('assessments.builder.library.previewFailed')}</p>
        <Button variant='text' onClick={() => setAttempt((value) => value + 1)}>
          {i18n.t('assessments.builder.library.retry')}
        </Button>
      </div>
    );
  }
  return (
    <div class='space-y-3'>
      <QtiItemPreview
        xml={state.preview.xml}
        title={state.preview.title}
        mode='bank'
        onScored={props.onScored}
        scoreLabel={props.scoreLabel}
        showDiagnostics={false}
        payload={props.payload}
        playerCatalog={props.playerCatalog}
      />
      {!props.onScored && (
        <div class='text-sm'>
          <p class='font-medium'>{i18n.t('assessments.builder.library.answer')}</p>
          {state.preview.answers.length
            ? (
              <ul class='mt-1 space-y-1'>
                {state.preview.answers.map((answer, index) => <li key={index}>{answer}</li>)}
              </ul>
            )
            : <p>{i18n.t('assessments.builder.library.noAnswer')}</p>}
        </div>
      )}
    </div>
  );
}
