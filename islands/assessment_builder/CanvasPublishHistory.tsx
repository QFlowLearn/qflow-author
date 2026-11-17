import type { CanvasPublishView } from '../../lib/client/canvas_publish.ts';
import Button from '../../components/ui/Button.tsx';
import CanvasPublishStatus from './CanvasPublishStatus.tsx';
import type { CanvasPublishesState, CanvasPublishUiState } from './useCanvasPublish.ts';
import { useI18n } from '../../lib/i18n/context.tsx';

type Props = {
  readonly state: CanvasPublishesState;
  readonly publishState: CanvasPublishUiState;
  readonly busy: boolean;
  readonly onResume: (publish: CanvasPublishView) => void;
  readonly onResolveUnknown: (
    publish: CanvasPublishView,
    outcome: 'import-found' | 'import-not-found',
  ) => void;
  readonly onReload: () => void;
  readonly onLoadMore: () => void;
};

/** Shows durable Canvas publishes that an author can recover after a reload. */
export default function CanvasPublishHistory(
  { state, publishState, busy, onResume, onResolveUnknown, onReload, onLoadMore }: Props,
) {
  const i18n = useI18n();
  const hasPublishes = state.actionRequired.length > 0 || state.terminal.length > 0;
  return (
    <section class='mt-6 max-w-2xl' aria-live='polite'>
      <h3 class='text-sm font-semibold text-base-content'>
        {i18n.t('delivery.canvas.historyTitle')}
      </h3>
      <p class='mt-1 text-sm leading-6 text-base-content/70'>
        {i18n.t('delivery.canvas.historyDescription')}
      </p>
      {state.load._tag === 'Loading' && !hasPublishes && (
        <div
          class='mt-3 space-y-2'
          role='status'
          aria-label={i18n.t('delivery.canvas.loadingHistory')}
        >
          <div class='ds-skeleton h-16 w-full' />
        </div>
      )}
      {state.load._tag === 'Failed' && (
        <div class='mt-3 ds-alert ds-alert-error' role='alert'>
          <div>
            <p>{i18n.t('delivery.canvas.historyLoadFailed', { code: state.load.code })}</p>
            <Button type='button' size='sm' class='mt-3' disabled={busy} onClick={onReload}>
              {i18n.t('delivery.canvas.reloadHistory')}
            </Button>
          </div>
        </div>
      )}
      {state.load._tag === 'Loaded' && !hasPublishes && (
        <p class='mt-3 text-sm text-base-content/65'>
          {i18n.t('delivery.canvas.emptyHistory')}
        </p>
      )}
      {state.actionRequired.length > 0 && (
        <PublishGroup
          heading={i18n.t('delivery.canvas.unfinished')}
          publishes={state.actionRequired}
          publishState={publishState}
          busy={busy}
          onResume={onResume}
          onResolveUnknown={onResolveUnknown}
        />
      )}
      {state.terminal.length > 0 && (
        <PublishGroup
          heading={i18n.t('delivery.canvas.recentResults')}
          publishes={state.terminal}
          publishState={publishState}
          busy={busy}
          onResume={onResume}
          onResolveUnknown={onResolveUnknown}
        />
      )}
      {state.pagination._tag === 'Failed' && (
        <div class='mt-3 ds-alert ds-alert-error' role='alert'>
          <span>{i18n.t('delivery.canvas.paginationFailed', { code: state.pagination.code })}</span>
        </div>
      )}
      {(state.pagination._tag === 'Available' || state.pagination._tag === 'Failed' ||
        state.pagination._tag === 'Loading') && (
        <Button
          type='button'
          size='sm'
          class='mt-3'
          disabled={busy || state.pagination._tag === 'Loading'}
          onClick={onLoadMore}
        >
          {state.pagination._tag === 'Loading'
            ? i18n.t('delivery.canvas.loadingEarlier')
            : i18n.t('delivery.canvas.loadEarlier')}
        </Button>
      )}
    </section>
  );
}

function PublishGroup(
  { heading, publishes, publishState, busy, onResume, onResolveUnknown }: {
    readonly heading: string;
    readonly publishes: readonly CanvasPublishView[];
    readonly publishState: CanvasPublishUiState;
    readonly busy: boolean;
    readonly onResume: (publish: CanvasPublishView) => void;
    readonly onResolveUnknown: (
      publish: CanvasPublishView,
      outcome: 'import-found' | 'import-not-found',
    ) => void;
  },
) {
  return (
    <div class='mt-4'>
      <h4 class='text-xs font-semibold text-base-content/75'>{heading}</h4>
      <div class='mt-2 space-y-3'>
        {publishes.map((publish) => (
          <CanvasPublishStatus
            key={publish.id}
            publish={publish}
            busy={busy}
            requestFailure={publishState._tag === 'ResumeFailed' &&
                publishState.publish.id === publish.id
              ? { code: publishState.code }
              : publishState._tag === 'ResolutionFailed' &&
                  publishState.publish.id === publish.id
              ? {
                code: publishState.code,
              }
              : null}
            onResume={() => onResume(publish)}
            onResolveUnknown={(outcome) => onResolveUnknown(publish, outcome)}
          />
        ))}
      </div>
    </div>
  );
}
