import type { FunctionalComponent } from 'preact';
import Checkbox from '../components/ui/Checkbox.tsx';
import { useI18n } from '../lib/i18n/context.tsx';

export type MatchMatrixProps = {
  sources: Array<{ id: string; text?: string; matchMax?: number }>;
  targets: Array<{ id: string; text?: string; matchMax?: number }>;
  pairs: Array<{ sourceId: string; targetId: string }>;
  onChange: (pairs: Array<{ sourceId: string; targetId: string }>) => void;
  maxAssociations?: number;
  issueId?: string;
};

const MatchMatrix: FunctionalComponent<MatchMatrixProps> = ({
  sources,
  targets,
  pairs,
  onChange,
  maxAssociations,
  issueId,
}) => {
  const i18n = useI18n();
  const canAddMoreGlobal = (maxAssociations == null || maxAssociations === 0)
    ? true
    : pairs.length < maxAssociations;
  const countForId = (id: string, isSource: boolean) =>
    pairs.filter((p) => isSource ? p.sourceId === id : p.targetId === id).length;
  const toggle = (sid: string, tid: string) => {
    const exists = pairs.some((p) => p.sourceId === sid && p.targetId === tid);
    if (exists) {
      onChange(pairs.filter((p) => !(p.sourceId === sid && p.targetId === tid)));
      return;
    }
    const src = sources.find((s) => s.id === sid);
    const tgt = targets.find((t) => t.id === tid);
    const srcOk = (src?.matchMax == null || src.matchMax === 0)
      ? true
      : countForId(sid, true) < (src.matchMax || 0);
    const tgtOk = (tgt?.matchMax == null || tgt.matchMax === 0)
      ? true
      : countForId(tid, false) < (tgt.matchMax || 0);
    if (canAddMoreGlobal && srcOk && tgtOk) onChange([...pairs, { sourceId: sid, targetId: tid }]);
  };

  const countLabel = (count: number, max?: number) =>
    max != null && max > 0
      ? i18n.t('driver.countOfMax', { count, max })
      : i18n.t('driver.countUnlimited', { count });
  const displayChoiceText = (
    choice: { id: string; text?: string },
    fallback: string,
  ) => (choice.text ?? '').trim() || fallback;

  return (
    <div
      class='space-y-2'
      data-editor-field='matchPairs'
      role='group'
      tabIndex={-1}
      aria-label={i18n.t('driver.correctPairs')}
      aria-invalid={issueId ? true : undefined}
      aria-describedby={issueId}
    >
      <p class='text-xs text-base-content/65'>{i18n.t('driver.matchMatrixHelp')}</p>
      <div class='overflow-auto rounded-lg border border-base-300 bg-base-100'>
        <table class='w-full border-separate border-spacing-0 text-sm'>
          <thead class='bg-base-200/80'>
            <tr>
              <th class='sticky left-0 z-20 min-w-36 border-b border-r border-base-300 bg-base-200 px-2 py-2 text-left text-xs font-medium uppercase tracking-wide text-base-content/70'>
                {i18n.t('driver.sources')}
              </th>
              {targets.map((t, index) => {
                const targetCount = countForId(t.id, false);
                const targetAtLimit = t.matchMax != null && t.matchMax > 0 &&
                  targetCount >= (t.matchMax || 0);
                const targetLabel = displayChoiceText(
                  t,
                  i18n.t('driver.targetIndexed', { number: index + 1 }),
                );
                return (
                  <th
                    key={t.id}
                    title={targetLabel}
                    class='min-w-28 border-b border-l border-base-300 px-2 py-2 text-center text-xs font-medium text-base-content/80'
                  >
                    <div class='space-y-1'>
                      <div class='line-clamp-2 break-words text-xs'>{targetLabel}</div>
                      <div
                        class={`text-[10px] ${
                          targetAtLimit ? 'text-warning' : 'text-base-content/60'
                        }`}
                      >
                        {countLabel(targetCount, t.matchMax)}
                      </div>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sources.map((s, rowIndex) => {
              const sourceCount = countForId(s.id, true);
              const sourceAtLimit = s.matchMax != null && s.matchMax > 0 &&
                sourceCount >= (s.matchMax || 0);
              const sourceLabel = displayChoiceText(
                s,
                i18n.t('driver.sourceIndexed', { number: rowIndex + 1 }),
              );
              return (
                <tr
                  key={s.id}
                  class={rowIndex % 2 === 0
                    ? 'bg-base-100 hover:bg-base-200/35'
                    : 'bg-base-100/70 hover:bg-base-200/35'}
                >
                  <th
                    title={sourceLabel}
                    class='sticky left-0 z-10 border-b border-r border-base-200 bg-inherit px-2 py-2 text-left text-xs font-medium text-base-content/80'
                  >
                    <div class='flex items-center justify-between gap-2'>
                      <div class='min-w-0'>
                        <div class='line-clamp-2 break-words'>{sourceLabel}</div>
                      </div>
                      <span
                        class={`text-[10px] ${
                          sourceAtLimit ? 'text-warning' : 'text-base-content/60'
                        }`}
                      >
                        {countLabel(sourceCount, s.matchMax)}
                      </span>
                    </div>
                  </th>
                  {targets.map((t, targetIndex) => {
                    const checked = pairs.some((p) => p.sourceId === s.id && p.targetId === t.id);
                    const disableByGlobal = !checked && !canAddMoreGlobal;
                    const disableBySrc = !checked && s.matchMax != null && s.matchMax !== 0 &&
                      countForId(s.id, true) >= (s.matchMax || 0);
                    const disableByTgt = !checked && t.matchMax != null && t.matchMax !== 0 &&
                      countForId(t.id, false) >= (t.matchMax || 0);
                    const disabled = disableByGlobal || disableBySrc || disableByTgt;
                    const targetLabel = displayChoiceText(
                      t,
                      i18n.t('driver.targetIndexed', { number: targetIndex + 1 }),
                    );
                    return (
                      <td
                        key={`${s.id}-${t.id}`}
                        class={`border-b border-l border-base-200 px-2 py-2 text-center ${
                          checked ? 'bg-success/15 ring-1 ring-inset ring-success/25' : ''
                        } ${!checked && disabled ? 'bg-base-200/40' : ''}`}
                      >
                        <Checkbox
                          aria-invalid={issueId ? true : undefined}
                          aria-describedby={issueId}
                          size='sm'
                          aria-label={i18n.t('driver.pairLabel', {
                            source: sourceLabel,
                            target: targetLabel,
                          })}
                          class={`${checked ? 'ds-checkbox-success' : ''}`}
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggle(s.id, t.id)}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(maxAssociations != null && maxAssociations > 0) && (
        <div class='text-xs text-base-content/70'>
          {i18n.t('driver.maxAssociationsSummary', { max: maxAssociations, count: pairs.length })}
        </div>
      )}
    </div>
  );
};

export default MatchMatrix;
