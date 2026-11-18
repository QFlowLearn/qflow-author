import { uiEvent } from '../../lib/client/ui_event.ts';
import Alert from '../ui/Alert.tsx';
import Button from '../ui/Button.tsx';
import type { CanvasMoveStatus } from './useAssessmentCanvasMove.ts';
import type { I18n } from '../../lib/i18n/messages.ts';
import type { ItemMeta, Part } from '../../islands/assessment_builder/types.ts';

/** Move confirmation is separate from the unsaved question draft and remains an accessible live region. */
export default function AssessmentCanvasMoveNotice(props: {
  readonly status: CanvasMoveStatus;
  readonly parts: readonly Part[];
  readonly items: Readonly<Record<string, ItemMeta>>;
  readonly i18n: I18n;
  readonly onRetry: () => Promise<void>;
  readonly onReload: () => Promise<unknown>;
}) {
  const { status, i18n } = props;
  let message = '';
  if (status.kind === 'saved') {
    const partIndex = props.parts.findIndex((part) => part.id === status.move.partId);
    const itemIndex =
      props.parts[partIndex]?.placements.findIndex((placement) =>
        placement.id === status.move.placementId
      ) ?? -1;
    if (itemIndex >= 0) {
      message = i18n.t('assessments.builder.moveSaved', {
        title: props.items[status.move.placementId]?.title ??
          i18n.t('assessments.builder.untitledQuestion'),
        number: `${partIndex + 1}.${itemIndex + 1}`,
      });
    }
  } else if (status.kind === 'saving') message = i18n.t('assessments.builder.moveSaving');
  const failed = status.kind === 'conflict' || status.kind === 'uncertain' ||
    status.kind === 'rejected';
  return (
    <>
      <p role='status' aria-atomic='true' class='min-h-6 text-sm text-base-content'>{message}</p>
      {failed && (
        <Alert tone='neutral'>
          <div>
            <p>
              {i18n.t(
                status.kind === 'conflict'
                  ? 'assessments.builder.moveConflict'
                  : status.kind === 'uncertain'
                  ? 'assessments.builder.moveUncertain'
                  : 'assessments.builder.moveRejected',
              )}
            </p>
            {status.kind === 'uncertain' && (
              <Button type='button' onClick={uiEvent(props.onRetry)}>
                {i18n.t('assessments.builder.tool.retry')}
              </Button>
            )}
            <Button type='button' onClick={uiEvent(props.onReload)}>
              {i18n.t('assessments.arrange.reloadSaved')}
            </Button>
          </div>
        </Alert>
      )}
    </>
  );
}
