import { useDomId } from '../../lib/rendering/island_context.tsx';
import { h } from 'preact';
import { useEffect, useMemo } from 'preact/hooks';
import Button from '../../components/ui/Button.tsx';
import Checkbox from '../../components/ui/Checkbox.tsx';
import Input, { FieldIssueMessage } from '../../components/ui/Input.tsx';
import Select from '../../components/ui/Select.tsx';
import type { GapMatchChoice, GapMatchPair, GapTarget } from '../../lib/types/gap_match.ts';
import {
  createGapMarkerHtml,
  defaultsGapMatch,
  GAP_MARKER_ATTR,
  listGapIds,
} from '../../lib/types/gap_match.ts';
import type { DriverUiContext } from './view_registry.ts';
import { sanitizeIdentifier } from '../../lib/identifiers.ts';
import { replaceAllMarkers } from '../../lib/qti_markers.ts';
import { attachStandardDriverViews } from './standard_driver_views.ts';
import {
  commonContentProps,
  insertBodyHtml,
  setDraftFieldValue,
  setDraftListFieldValue,
} from './editor_shell.tsx';
import type { CommonContentProps } from './types.ts';
import { ResponseIdentifierDisclosure } from './response_identifier_disclosure.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';

export type GapMatchContentProps = CommonContentProps & {
  bodyHtml: string;
  shuffle: boolean;
  allowPins: boolean;

  gapResponseIdentifier: string;
  setGapResponseIdentifier: (next: string) => void;

  gapChoices: GapMatchChoice[];
  gaps: GapTarget[];
  correctGapPairs: GapMatchPair[];

  insertGap: () => void;
  insertGapMarker: (gapId: string) => void;
  removeGap: (gapId: string) => void;
  updateGapLabel: (gapId: string, label: string) => void;

  addGapChoice: () => void;
  removeGapChoice: (choiceId: string) => void;
  updateGapChoiceText: (choiceId: string, text: string) => void;
  updateGapChoiceId: (choiceId: string, nextId: string) => void;
  updateGapChoiceMatchMax: (choiceId: string, next?: number) => void;
  setGapChoiceFixed: (choiceId: string, fixed: boolean) => void;

  setCorrectChoiceForGap: (gapId: string, choiceId: string) => void;
};

export function GapMatchContent(props: GapMatchContentProps) {
  const i18n = useI18n();
  const choicesIssueId = useDomId();
  const pairsIssueId = useDomId();
  const pairsHaveIssue = props.fieldHasIssue('matchPairs') || props.fieldHasIssue('correct');
  const placedIds = useMemo(() => new Set(listGapIds(props.bodyHtml ?? '')), [props.bodyHtml]);
  const correctByGap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of props.correctGapPairs ?? []) {
      if (p.gapId && p.choiceId) m.set(p.gapId, p.choiceId);
    }
    return m;
  }, [props.correctGapPairs]);

  return (
    <div class='space-y-5'>
      {props.renderPromptField(i18n.t('driver.gapPrompt'))}
      <ResponseIdentifierDisclosure
        value={props.gapResponseIdentifier ?? ''}
        onChange={props.setGapResponseIdentifier}
      />

      <div class='space-y-3'>
        <div class='flex items-center justify-between'>
          <strong class='text-sm text-base-content/80'>{i18n.t('driver.gaps')}</strong>
          <Button
            size='sm'
            type='button'
            data-editor-field={props.gaps.length === 0 ? 'matchPairs' : undefined}
            aria-invalid={pairsHaveIssue || undefined}
            aria-describedby={pairsHaveIssue ? pairsIssueId : undefined}
            onClick={props.insertGap}
          >
            + {i18n.t('driver.insertGap')}
          </Button>
        </div>
        {pairsHaveIssue && (
          <FieldIssueMessage
            id={pairsIssueId}
            message={props.fieldIssueText('matchPairs') ?? props.fieldIssueText('correct') ?? ''}
          />
        )}
        {props.gaps.length === 0 && (
          <p class='text-sm text-base-content/60'>
            {i18n.t('driver.emptyGaps')}
          </p>
        )}
        {props.gaps.map((gap, idx) => {
          const placed = placedIds.has(gap.id);
          return (
            <div key={gap.id} class='space-y-3 rounded-lg border border-base-300 bg-base-100 p-3'>
              <div class='flex flex-wrap items-center justify-between gap-2'>
                <strong class='text-sm text-base-content/80'>
                  {i18n.t('driver.gap', { number: idx + 1 })}
                </strong>
                <div class='flex items-center gap-2'>
                  <span class={`ds-badge ${placed ? 'ds-badge-success' : 'ds-badge-warning'}`}>
                    {placed ? i18n.t('driver.placedInBody') : i18n.t('driver.notPlaced')}
                  </span>
                  {!placed && (
                    <Button
                      size='xs'
                      variant='ghost'
                      type='button'
                      onClick={() => props.insertGapMarker(gap.id)}
                    >
                      {i18n.t('driver.insertIntoBody')}
                    </Button>
                  )}
                  <Button
                    size='xs'
                    variant='danger-ghost'
                    type='button'
                    disabled={props.gaps.length <= 1}
                    onClick={() =>
                      props.removeGap(gap.id)}
                  >
                    {i18n.t('driver.remove')}
                  </Button>
                </div>
              </div>
              <div class='grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(16rem,28rem)] md:items-end'>
                <label class='ds-form-control'>
                  <span>{i18n.t('driver.blankLabel')}</span>
                  <Input
                    size='sm'
                    value={gap.label ?? ''}
                    onInput={(e) =>
                      props.updateGapLabel(gap.id, (e.target as HTMLInputElement).value)}
                    placeholder={i18n.t('driver.blank', { number: idx + 1 })}
                  />
                </label>
                <label class='ds-form-control' data-choice-selection>
                  <span>{i18n.t('driver.correctAnswer')}</span>
                  <Select
                    size='sm'
                    data-editor-field='matchPairs'
                    aria-invalid={pairsHaveIssue || undefined}
                    aria-describedby={pairsHaveIssue ? pairsIssueId : undefined}
                    value={correctByGap.get(gap.id) ?? ''}
                    onInput={(e) =>
                      props.setCorrectChoiceForGap(gap.id, (e.target as HTMLSelectElement).value)}
                  >
                    <option value=''>{i18n.t('driver.selectAnswer')}</option>
                    {props.gapChoices.map((choice) => {
                      const choiceText = (choice.text ?? '').trim();
                      return (
                        <option key={choice.id} value={choice.id}>
                          {choiceText ? `${choice.id} · ${choiceText}` : choice.id}
                        </option>
                      );
                    })}
                  </Select>
                </label>
              </div>
            </div>
          );
        })}
      </div>

      <div class='space-y-3'>
        <div class='flex items-center justify-between'>
          <strong class='text-sm text-base-content/80'>{i18n.t('driver.choiceBank')}</strong>
          <Button
            size='sm'
            type='button'
            data-editor-field={props.gapChoices.length === 0 ? 'choices' : undefined}
            aria-invalid={props.fieldHasIssue('choices') || undefined}
            aria-describedby={props.fieldHasIssue('choices') ? choicesIssueId : undefined}
            onClick={props.addGapChoice}
          >
            + {i18n.t('driver.addChoice')}
          </Button>
        </div>
        {props.fieldHasIssue('choices') && (
          <FieldIssueMessage id={choicesIssueId} message={props.fieldIssueText('choices') ?? ''} />
        )}
        {props.gapChoices.length === 0 && (
          <p class='text-sm text-base-content/60'>{i18n.t('driver.addDraggableChoice')}</p>
        )}
        <div class='space-y-2'>
          {props.gapChoices.map((choice) => {
            const showPinColumn = props.shuffle && props.allowPins;
            return (
              <div
                key={choice.id}
                class={`grid gap-3 rounded-lg border border-base-200 bg-base-100 p-3 ${
                  showPinColumn
                    ? 'md:grid-cols-[8rem_minmax(0,1fr)_9rem_11rem_auto]'
                    : 'md:grid-cols-[8rem_minmax(0,1fr)_9rem_auto]'
                }`}
              >
                <label class='ds-form-control'>
                  <span class='text-xs'>{i18n.t('driver.identifier')}</span>
                  <Input
                    value={choice.id}
                    onInput={(e) =>
                      props.updateGapChoiceId(choice.id, (e.target as HTMLInputElement).value)}
                    placeholder='A'
                  />
                </label>
                <label class='ds-form-control'>
                  <span class='text-xs'>{i18n.t('driver.text')}</span>
                  <Input
                    value={choice.text ?? ''}
                    data-editor-field='choices'
                    aria-invalid={props.fieldHasIssue('choices') || undefined}
                    aria-describedby={props.fieldHasIssue('choices') ? choicesIssueId : undefined}
                    onInput={(e) =>
                      props.updateGapChoiceText(choice.id, (e.target as HTMLInputElement).value)}
                    placeholder={i18n.t('driver.optionText')}
                  />
                </label>
                <label class='ds-form-control'>
                  <span class='text-xs'>{i18n.t('driver.maxAssociations')}</span>
                  <Input
                    type='number'
                    min={0}
                    value={typeof choice.matchMax === 'number' ? String(choice.matchMax) : ''}
                    onInput={(e) => {
                      const raw = (e.target as HTMLInputElement).value;
                      const next = raw === '' ? undefined : Math.max(0, Number(raw) || 0);
                      props.updateGapChoiceMatchMax(choice.id, next);
                    }}
                  />
                </label>
                {showPinColumn && (
                  <div class='space-y-1'>
                    <div class='text-xs font-medium text-base-content/70'>
                      {i18n.t('driver.pinned')}
                    </div>
                    <label class='flex min-h-10 items-center gap-2 rounded-md border border-base-300 bg-base-200/30 px-3 py-2 text-xs text-base-content/70'>
                      <Checkbox
                        checked={!!choice.fixed}
                        onChange={(e) =>
                          props.setGapChoiceFixed(
                            choice.id,
                            (e.target as HTMLInputElement).checked,
                          )}
                      />
                      <span>{i18n.t('driver.keepFixed')}</span>
                    </label>
                  </div>
                )}
                <div class='flex items-start justify-end md:pt-6'>
                  <Button
                    size='xs'
                    variant='danger-ghost'
                    type='button'
                    disabled={props.gapChoices.length <= 1}
                    onClick={() => props.removeGapChoice(choice.id)}
                  >
                    {i18n.t('driver.remove')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function GapMatchEditor(ctx: DriverUiContext<'gap_match'>) {
  return h(GapMatchEditorWithI18n, { ctx });
}

function GapMatchEditorWithI18n({ ctx }: { ctx: DriverUiContext<'gap_match'> }) {
  const i18n = useI18n();
  const { editor, draft, update } = ctx;
  const bodyHtml = draft.bodyHtml ?? '';
  const gapChoices = draft.gapChoices;
  const gaps = draft.gaps;
  const correctGapPairs = draft.correctGapPairs;
  const responseIdentifier = draft.responseIdentifier ?? 'RESPONSE';
  const shuffle = Boolean(draft.shuffle);
  const allowPinsSetting = editor.settings?.allowPins;
  const allowPins = typeof allowPinsSetting === 'boolean'
    ? allowPinsSetting
    : gapChoices.some((choice) => choice.fixed);

  const setBodyHtml = (value: string | ((prev: string) => string)) =>
    setDraftFieldValue(
      editor,
      draft,
      update,
      'bodyHtml',
      typeof value === 'function' ? (prev) => value(prev ?? '') : value,
    );
  const setResponseIdentifier = (value: string) =>
    setDraftFieldValue(editor, draft, update, 'responseIdentifier', value);
  const setGapChoices = (
    value: GapMatchChoice[] | ((prev: GapMatchChoice[]) => GapMatchChoice[]),
  ) => setDraftListFieldValue(editor, draft, update, 'gapChoices', value);
  const setGaps = (value: GapTarget[] | ((prev: GapTarget[]) => GapTarget[])) =>
    setDraftListFieldValue(editor, draft, update, 'gaps', value);
  const setCorrectGapPairs = (
    value: GapMatchPair[] | ((prev: GapMatchPair[]) => GapMatchPair[]),
  ) => setDraftListFieldValue(editor, draft, update, 'correctGapPairs', value);

  useEffect(() => {
    if (!gaps.length && !gapChoices.length) {
      const base = defaultsGapMatch();
      update({
        ...draft,
        responseIdentifier: base.responseIdentifier ?? 'RESPONSE',
        gapChoices: base.gapChoices ?? [],
        gaps: base.gaps ?? [],
        correctGapPairs: base.correctGapPairs ?? [],
        minAssociations: base.minAssociations,
        maxAssociations: base.maxAssociations,
        minAssociationsMessage: base.minAssociationsMessage ?? '',
        maxAssociationsMessage: base.maxAssociationsMessage ?? '',
        shuffle: Boolean(base.shuffle),
        bodyHtml: draft.bodyHtml?.trim() && draft.bodyHtml.trim() !== '<p></p>'
          ? `${draft.bodyHtml}${draft.bodyHtml.trim().endsWith('</p>') ? '' : ' '}<p>${
            (base.gaps ?? []).map((gap) => createGapMarkerHtml({ id: gap.id, label: gap.label }))
              .join(' ')
          }</p>`
          : base.bodyHtml ?? '<p></p>',
      });
      return;
    }
    if (!gaps.length || listGapIds(bodyHtml).length) return;
    const markers = gaps.map((gap) => createGapMarkerHtml({ id: gap.id, label: gap.label })).join(
      ' ',
    );
    setBodyHtml((prev) =>
      prev?.trim() && prev.trim() !== '<p></p>'
        ? `${prev}${prev.trim().endsWith('</p>') ? '' : ' '}<p>${markers}</p>`
        : `<p>${markers}</p>`
    );
  }, [bodyHtml, draft, gapChoices.length, gaps]);

  const nextGapId = () => {
    const existing = new Set(gaps.map((gap) => (gap.id ?? '').toUpperCase()));
    let idx = gaps.length + 1;
    let candidate = `GAP_${idx}`;
    while (existing.has(candidate.toUpperCase())) {
      idx += 1;
      candidate = `GAP_${idx}`;
    }
    return candidate;
  };

  const replaceGapMarkers = (oldId: string, replacementHtml: string) => {
    setBodyHtml((prev) => {
      const { html } = replaceAllMarkers(
        prev ?? '',
        GAP_MARKER_ATTR,
        (info) => info.id === oldId ? replacementHtml : info.match,
      );
      return html;
    });
  };

  const removeGapMarkers = (id: string) => {
    setBodyHtml((prev) => {
      const { html } = replaceAllMarkers(
        prev ?? '',
        GAP_MARKER_ATTR,
        (info) => info.id === id ? '' : info.match,
      );
      return html;
    });
  };

  const nextGapChoiceId = () => {
    const existing = new Set(gapChoices.map((choice) => (choice.id ?? '').toUpperCase()));
    for (let i = 0; i < 26; i++) {
      const candidate = String.fromCharCode('A'.charCodeAt(0) + i);
      if (!existing.has(candidate)) return candidate;
    }
    let idx = existing.size + 1;
    let candidate = `CHOICE_${idx}`;
    while (existing.has(candidate.toUpperCase())) {
      idx += 1;
      candidate = `CHOICE_${idx}`;
    }
    return candidate;
  };

  return (
    <GapMatchContent
      {...commonContentProps(editor)}
      bodyHtml={bodyHtml}
      shuffle={shuffle}
      allowPins={allowPins}
      gapResponseIdentifier={responseIdentifier}
      setGapResponseIdentifier={setResponseIdentifier}
      gapChoices={gapChoices}
      gaps={gaps}
      correctGapPairs={correctGapPairs}
      insertGap={() => {
        const id = nextGapId();
        const gap: GapTarget = { id, label: i18n.t('driver.gap', { number: gaps.length + 1 }) };
        setGaps((prev) => [...prev, gap]);
        insertBodyHtml(editor, setBodyHtml, createGapMarkerHtml({ id: gap.id, label: gap.label }));
      }}
      insertGapMarker={(gapId) => {
        const gap = gaps.find((entry) => entry.id === gapId);
        insertBodyHtml(
          editor,
          setBodyHtml,
          createGapMarkerHtml({ id: gapId, label: gap?.label ?? gapId }),
        );
      }}
      removeGap={(gapId) => {
        setGaps((prev) => prev.filter((gap) => gap.id !== gapId));
        setCorrectGapPairs((prev) => prev.filter((pair) => pair.gapId !== gapId));
        removeGapMarkers(gapId);
      }}
      updateGapLabel={(gapId, label) => {
        const gap = gaps.find((entry) => entry.id === gapId);
        if (!gap) return;
        const updated = { ...gap, label };
        setGaps((prev) => prev.map((entry) => (entry.id === gapId ? updated : entry)));
        replaceGapMarkers(gapId, createGapMarkerHtml({ id: gapId, label: updated.label }));
      }}
      addGapChoice={() => {
        const id = nextGapChoiceId();
        setGapChoices((prev) => [...prev, { id, kind: 'text', text: '', matchMax: 1 }]);
      }}
      removeGapChoice={(choiceId) => {
        setGapChoices((prev) => prev.filter((choice) => choice.id !== choiceId));
        setCorrectGapPairs((prev) => prev.filter((pair) => pair.choiceId !== choiceId));
      }}
      updateGapChoiceText={(choiceId, text) =>
        setGapChoices((prev) =>
          prev.map((choice) =>
            choice.id === choiceId ? { ...choice, text, html: undefined } : choice
          )
        )}
      updateGapChoiceId={(choiceId, nextIdInput) => {
        const sanitizedBase = sanitizeIdentifier(nextIdInput || choiceId, choiceId);
        let finalId = sanitizedBase;
        if (gapChoices.some((choice) => choice.id === finalId && choice.id !== choiceId)) {
          let suffix = 2;
          const base = sanitizedBase.replace(/_\d+$/, '');
          while (gapChoices.some((choice) => choice.id === `${base}_${suffix}`)) suffix += 1;
          finalId = `${base}_${suffix}`;
        }
        setGapChoices((prev) =>
          prev.map((choice) => (choice.id === choiceId ? { ...choice, id: finalId } : choice))
        );
        setCorrectGapPairs((prev) =>
          prev.map((pair) => (pair.choiceId === choiceId ? { ...pair, choiceId: finalId } : pair))
        );
      }}
      updateGapChoiceMatchMax={(choiceId, next) =>
        setGapChoices((prev) =>
          prev.map((choice) => (choice.id === choiceId ? { ...choice, matchMax: next } : choice))
        )}
      setGapChoiceFixed={(choiceId, fixed) =>
        setGapChoices((prev) =>
          prev.map((choice) => (choice.id === choiceId ? { ...choice, fixed } : choice))
        )}
      setCorrectChoiceForGap={(gapId, choiceId) =>
        setCorrectGapPairs((prev) => {
          const trimmedChoiceId = (choiceId ?? '').trim();
          const next = prev.filter((pair) => pair.gapId !== gapId);
          if (!trimmedChoiceId) return next;
          return [...next, { gapId, choiceId: trimmedChoiceId }];
        })}
    />
  );
}

attachStandardDriverViews('gap_match', GapMatchEditor);
