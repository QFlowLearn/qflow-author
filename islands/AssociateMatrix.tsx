import type { FunctionalComponent } from 'preact';
import Checkbox from '../components/ui/Checkbox.tsx';
import { useI18n } from '../lib/i18n/context.tsx';

export type AssociateMatrixProps = {
  choices: Array<{ id: string; text?: string; matchMax?: number }>;
  pairs: Array<{ sourceId: string; targetId: string }>;
  onChange: (pairs: Array<{ sourceId: string; targetId: string }>) => void;
  maxAssociations?: number;
  issueId?: string;
  rowLabel: string;
};

type Pair = { sourceId: string; targetId: string };

function normalizePair(sourceId: string, targetId: string): Pair | null {
  const left = (sourceId ?? '').trim();
  const right = (targetId ?? '').trim();
  if (!left || !right) return null;
  if (left === right) return null;
  return left < right ? { sourceId: left, targetId: right } : { sourceId: right, targetId: left };
}

function normalizePairs(pairs: Pair[]): Pair[] {
  const out: Pair[] = [];
  const seen = new Set<string>();
  for (const pair of pairs) {
    const normalized = normalizePair(pair.sourceId, pair.targetId);
    if (!normalized) continue;
    const key = `${normalized.sourceId} ${normalized.targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

const AssociateMatrix: FunctionalComponent<AssociateMatrixProps> = ({
  choices,
  pairs,
  onChange,
  maxAssociations,
  issueId,
  rowLabel,
}) => {
  const i18n = useI18n();
  const normalizedPairs = normalizePairs(pairs);
  const canAddMoreGlobal = (maxAssociations == null || maxAssociations === 0)
    ? true
    : normalizedPairs.length < maxAssociations;

  const countForId = (id: string) =>
    normalizedPairs.filter((p) => p.sourceId === id || p.targetId === id).length;

  const toggle = (sid: string, tid: string) => {
    const normalized = normalizePair(sid, tid);
    if (!normalized) return;
    const key = `${normalized.sourceId} ${normalized.targetId}`;
    const exists = normalizedPairs.some((p) => `${p.sourceId} ${p.targetId}` === key);
    if (exists) {
      onChange(normalizedPairs.filter((p) => `${p.sourceId} ${p.targetId}` !== key));
      return;
    }
    const src = choices.find((c) => c.id === normalized.sourceId);
    const tgt = choices.find((c) => c.id === normalized.targetId);
    const srcOk = (src?.matchMax == null || src.matchMax === 0)
      ? true
      : countForId(normalized.sourceId) < (src.matchMax || 0);
    const tgtOk = (tgt?.matchMax == null || tgt.matchMax === 0)
      ? true
      : countForId(normalized.targetId) < (tgt.matchMax || 0);
    if (canAddMoreGlobal && srcOk && tgtOk) {
      onChange([...normalizedPairs, normalized]);
    }
  };

  const countLabel = (count: number, max?: number) =>
    max != null && max > 0
      ? i18n.t('driver.countOfMax', { count, max })
      : i18n.t('driver.countUnlimited', { count });

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
      <p class='text-xs text-base-content/65'>{i18n.t('driver.associationHelp')}</p>
      <div class='overflow-auto rounded-lg border border-base-300 bg-base-100'>
        <table class='w-full border-separate border-spacing-0 text-sm'>
          <thead class='bg-base-200/80'>
            <tr>
              <th class='sticky left-0 z-20 min-w-36 border-b border-r border-base-300 bg-base-200 px-2 py-2 text-left text-xs font-medium uppercase tracking-wide text-base-content/70'>
                {rowLabel}
              </th>
              {choices.map((choice) => {
                const choiceCount = countForId(choice.id);
                const choiceAtLimit = choice.matchMax != null && choice.matchMax > 0 &&
                  choiceCount >= (choice.matchMax || 0);
                return (
                  <th
                    key={choice.id}
                    title={choice.text ?? choice.id}
                    class='min-w-24 border-b border-l border-base-300 px-2 py-2 text-center text-xs font-medium text-base-content/80'
                  >
                    <div class='space-y-1'>
                      <div class='text-[10px] uppercase tracking-wide text-base-content/60'>
                        {choice.id}
                      </div>
                      <div class='line-clamp-2 break-words text-xs'>{choice.text ?? choice.id}</div>
                      <div
                        class={`text-[10px] ${
                          choiceAtLimit ? 'text-warning' : 'text-base-content/60'
                        }`}
                      >
                        {countLabel(choiceCount, choice.matchMax)}
                      </div>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {choices.map((s, rowIdx) => {
              const sourceCount = countForId(s.id);
              const sourceAtLimit = s.matchMax != null && s.matchMax > 0 &&
                sourceCount >= (s.matchMax || 0);
              return (
                <tr
                  key={s.id}
                  class={rowIdx % 2 === 0
                    ? 'bg-base-100 hover:bg-base-200/35'
                    : 'bg-base-100/70 hover:bg-base-200/35'}
                >
                  <th
                    title={s.text ?? s.id}
                    class='sticky left-0 z-10 border-b border-r border-base-200 bg-inherit px-2 py-2 text-left text-xs font-medium text-base-content/80'
                  >
                    <div class='flex items-center justify-between gap-2'>
                      <div class='min-w-0'>
                        <div class='text-[10px] uppercase tracking-wide text-base-content/60'>
                          {s.id}
                        </div>
                        <div class='line-clamp-2 break-words'>{s.text ?? s.id}</div>
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
                  {choices.map((t, colIdx) => {
                    if (colIdx <= rowIdx) {
                      return (
                        <td
                          key={`${s.id}-${t.id}`}
                          class='border-b border-l border-base-200 bg-base-200/40 px-2 py-2 text-center text-[10px] text-base-content/40'
                        >
                          -
                        </td>
                      );
                    }
                    const normalized = normalizePair(s.id, t.id);
                    const key = normalized ? `${normalized.sourceId} ${normalized.targetId}` : '';
                    const checked = normalizedPairs.some((p) =>
                      `${p.sourceId} ${p.targetId}` === key
                    );
                    const disableByGlobal = !checked && !canAddMoreGlobal;
                    const disableBySrc = !checked && s.matchMax != null && s.matchMax !== 0 &&
                      countForId(s.id) >= (s.matchMax || 0);
                    const disableByTgt = !checked && t.matchMax != null && t.matchMax !== 0 &&
                      countForId(t.id) >= (t.matchMax || 0);
                    const disabled = disableByGlobal || disableBySrc || disableByTgt;
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
                            source: s.text ?? s.id,
                            target: t.text ?? t.id,
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
          {i18n.t('driver.maxAssociationsSummary', {
            max: maxAssociations,
            count: normalizedPairs.length,
          })}
        </div>
      )}
    </div>
  );
};

export default AssociateMatrix;
