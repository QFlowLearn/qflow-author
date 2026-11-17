import { useDomId } from '../../lib/rendering/island_context.tsx';
// Inline choice uses a slot-based model (body markers + per-slot options), not a flat choice list.
// It does not use ChoiceListEditor because slots are placed in rich text and scored independently.
import { h } from 'preact';
import StandaloneDropdown from './standalone_dropdown.tsx';
import { standaloneInlineChoice } from '../../lib/types/inline_choice.ts';
import { useEffect, useMemo } from 'preact/hooks';
import Button from '../../components/ui/Button.tsx';
import Checkbox from '../../components/ui/Checkbox.tsx';
import Input, { FieldIssueMessage } from '../../components/ui/Input.tsx';
import Radio from '../../components/ui/Radio.tsx';
import type { InlineChoiceSlot } from '../../lib/types/inline_choice.ts';
import {
  createInlineChoiceMarkerHtml,
  INLINE_CHOICE_MARKER_ATTR,
  listInlineChoiceSlotIds,
} from '../../lib/types/inline_choice.ts';
import type { DriverUiContext } from './view_registry.ts';
import { sanitizeIdentifier } from '../../lib/identifiers.ts';
import {
  commonContentProps,
  insertBodyHtml,
  setDraftFieldValue,
  setDraftListFieldValue,
} from './editor_shell.tsx';
import { attachStandardDriverViews } from './standard_driver_views.ts';
import { replaceAllMarkers } from '../../lib/qti_markers.ts';
import { ResponseIdentifierDisclosure } from './response_identifier_disclosure.tsx';
import type { CommonContentProps } from './types.ts';
import { useI18n } from '../../lib/i18n/context.tsx';

export type InlineChoiceContentProps = CommonContentProps & {
  bodyHtml: string;
  inlineChoices: InlineChoiceSlot[];
  responseMode: 'all_or_nothing' | 'partial' | 'custom';
  insertInlineChoiceSlot: () => void;
  insertInlineChoiceSlotMarker: (slotId: string) => void;
  removeInlineChoiceSlot: (slotId: string) => void;
  updateInlineChoiceSlotLabel: (slotId: string, label: string) => void;
  updateInlineChoiceSlotId: (slotId: string, nextId: string) => void;
  setInlineChoiceSlotRequired: (slotId: string, required: boolean) => void;
  setInlineChoiceSlotShuffle: (slotId: string, shuffle: boolean) => void;
  addInlineChoiceOption: (slotId: string) => void;
  removeInlineChoiceOption: (slotId: string, optionId: string) => void;
  updateInlineChoiceOptionText: (slotId: string, optionId: string, text: string) => void;
  updateInlineChoiceOptionId: (slotId: string, optionId: string, nextId: string) => void;
  setInlineChoiceCorrectId: (slotId: string, optionId: string) => void;
  setInlineChoiceOptionFixed: (slotId: string, optionId: string, fixed: boolean) => void;
  setInlineChoiceOptionScore: (slotId: string, optionId: string, score?: number) => void;
};

export function InlineChoiceContent(props: InlineChoiceContentProps) {
  const i18n = useI18n();
  const answersIssueId = useDomId();
  const placedIds = useMemo(() => new Set(listInlineChoiceSlotIds(props.bodyHtml ?? '')), [
    props.bodyHtml,
  ]);
  return (
    <div class='space-y-4'>
      {props.renderPromptField(i18n.t('driver.inlinePrompt'))}
      <div class='flex items-center justify-between'>
        <strong class='text-sm text-base-content/80'>{i18n.t('driver.inlineChoices')}</strong>
        <Button
          size='sm'
          type='button'
          data-editor-field={props.inlineChoices.length === 0 ? 'choices' : undefined}
          aria-invalid={props.fieldHasIssue('choices') || undefined}
          aria-describedby={props.fieldHasIssue('choices') ? answersIssueId : undefined}
          onClick={props.insertInlineChoiceSlot}
        >
          + {i18n.t('driver.insertInlineChoice')}
        </Button>
      </div>
      {(props.fieldHasIssue('choices') || props.fieldHasIssue('correct')) && (
        <FieldIssueMessage
          id={answersIssueId}
          message={props.fieldIssueText('choices') ?? props.fieldIssueText('correct') ?? ''}
        />
      )}
      {props.inlineChoices.length === 0 && (
        <p class='text-sm text-base-content/60'>{i18n.t('driver.insertInlineChoice')}</p>
      )}
      {props.inlineChoices.map((slot, slotIndex) => {
        const placed = placedIds.has(slot.id);
        const options = slot.options ?? [];
        const correctId = slot.correctId ?? '';
        const displayLabel = (slot.label ?? '').trim() || i18n.t('driver.blank', {
          number: slotIndex + 1,
        });
        return (
          <div key={slot.id} class='space-y-3 rounded-lg border border-base-300 bg-base-100 p-3'>
            <div class='flex flex-wrap items-center justify-between gap-2'>
              <div class='min-w-0'>
                <strong class='block truncate text-base text-base-content'>{displayLabel}</strong>
                <div class='text-xs text-base-content/60'>
                  {i18n.t('driver.gap', { number: slotIndex + 1 })}
                </div>
              </div>
              <div class='flex items-center gap-2'>
                <span class={`ds-badge ${placed ? 'ds-badge-success' : 'ds-badge-warning'}`}>
                  {placed ? i18n.t('driver.placedInBody') : i18n.t('driver.notPlaced')}
                </span>
                {!placed && (
                  <Button
                    size='xs'
                    variant='ghost'
                    type='button'
                    onClick={() => props.insertInlineChoiceSlotMarker(slot.id)}
                  >
                    {i18n.t('driver.insertIntoBody')}
                  </Button>
                )}
                {props.inlineChoices.length > 1 && (
                  <Button
                    size='xs'
                    variant='danger-ghost'
                    type='button'
                    onClick={() => props.removeInlineChoiceSlot(slot.id)}
                  >
                    {i18n.t('driver.remove')}
                  </Button>
                )}
              </div>
            </div>
            <div class='space-y-2'>
              <label class='flex flex-col'>
                <span>{i18n.t('driver.slotLabel')}</span>
                <Input
                  value={slot.label ?? ''}
                  onInput={(e) =>
                    props.updateInlineChoiceSlotLabel(
                      slot.id,
                      (e.target as HTMLInputElement).value,
                    )}
                />
              </label>
              <ResponseIdentifierDisclosure
                value={slot.id ?? ''}
                onChange={(value) => props.updateInlineChoiceSlotId(slot.id, value)}
                placeholder='RESPONSE_1'
              />
            </div>
            <div class='flex flex-wrap gap-4'>
              <label class='flex items-center gap-2 text-sm text-base-content/70'>
                <Checkbox
                  checked={!!slot.required}
                  onChange={(e) =>
                    props.setInlineChoiceSlotRequired(
                      slot.id,
                      (e.target as HTMLInputElement).checked,
                    )}
                />
                <span>{i18n.t('driver.required')}</span>
              </label>
              <label class='flex items-center gap-2 text-sm text-base-content/70'>
                <Checkbox
                  checked={!!slot.shuffle}
                  onChange={(e) =>
                    props.setInlineChoiceSlotShuffle(
                      slot.id,
                      (e.target as HTMLInputElement).checked,
                    )}
                />
                <span>{i18n.t('driver.shuffleOptions')}</span>
              </label>
              {props.responseMode === 'partial' && (
                <span class='text-xs text-base-content/60'>
                  {i18n.t('driver.partialCredit')}
                </span>
              )}
            </div>

            <div class='space-y-2'>
              <div class='flex items-center justify-between'>
                <strong class='text-sm text-base-content/70'>{i18n.t('driver.options')}</strong>
                <Button
                  size='xs'
                  type='button'
                  data-editor-field={options.length === 0 ? 'choices' : undefined}
                  aria-invalid={props.fieldHasIssue('choices') || undefined}
                  aria-describedby={props.fieldHasIssue('choices') ? answersIssueId : undefined}
                  onClick={() => props.addInlineChoiceOption(slot.id)}
                >
                  + {i18n.t('driver.addOption')}
                </Button>
              </div>
              <div class='space-y-2'>
                {options.map((opt) => {
                  const showScore = props.responseMode === 'partial';
                  const showShufflePin = !!slot.shuffle;
                  const hasMetaColumn = showScore || showShufflePin;
                  return (
                    <div
                      key={opt.id}
                      class={`grid gap-3 rounded-lg border p-3 ${
                        hasMetaColumn
                          ? 'md:grid-cols-[2.5rem_8rem_minmax(0,1fr)_11rem_auto]'
                          : 'md:grid-cols-[2.5rem_8rem_minmax(0,1fr)_auto]'
                      } ${
                        correctId === opt.id
                          ? 'border-success/40 bg-success/5'
                          : 'border-base-200 bg-base-100'
                      }`}
                    >
                      <div class='flex items-center justify-center md:pt-6'>
                        <Radio
                          name={`correct-${slot.id}`}
                          class='ds-radio-success'
                          checked={correctId === opt.id}
                          data-editor-field='correct'
                          aria-label={i18n.t('driver.markCorrect') + ': ' + displayLabel + ' · ' +
                            opt.id}
                          aria-invalid={props.fieldHasIssue('correct') || undefined}
                          aria-describedby={props.fieldHasIssue('correct')
                            ? answersIssueId
                            : undefined}
                          title={i18n.t('driver.markCorrect')}
                          onChange={() => props.setInlineChoiceCorrectId(slot.id, opt.id)}
                        />
                      </div>
                      <label class='flex flex-col'>
                        <span class='text-xs'>{i18n.t('driver.identifier')}</span>
                        <Input
                          value={opt.id}
                          onInput={(e) =>
                            props.updateInlineChoiceOptionId(
                              slot.id,
                              opt.id,
                              (e.target as HTMLInputElement).value,
                            )}
                          placeholder='A'
                        />
                      </label>
                      <label class='flex flex-col'>
                        <span class='text-xs'>{i18n.t('driver.text')}</span>
                        <Input
                          value={opt.text ?? ''}
                          data-editor-field='choices'
                          aria-invalid={props.fieldHasIssue('choices') || undefined}
                          aria-describedby={props.fieldHasIssue('choices')
                            ? answersIssueId
                            : undefined}
                          onInput={(e) =>
                            props.updateInlineChoiceOptionText(
                              slot.id,
                              opt.id,
                              (e.target as HTMLInputElement).value,
                            )}
                          placeholder={i18n.t('driver.optionText')}
                        />
                      </label>
                      {hasMetaColumn && (
                        <div class='space-y-2'>
                          {showScore && (
                            <label class='flex flex-col'>
                              <span class='text-xs'>{i18n.t('driver.score')}</span>
                              <Input
                                type='number'
                                value={Number.isFinite(opt.score) ? String(opt.score) : ''}
                                onInput={(e) => {
                                  const raw = (e.target as HTMLInputElement).value;
                                  const next = raw === '' ? undefined : Number(raw);
                                  props.setInlineChoiceOptionScore(
                                    slot.id,
                                    opt.id,
                                    Number.isFinite(next) ? next : undefined,
                                  );
                                }}
                              />
                            </label>
                          )}
                          {showShufflePin && (
                            <div class='space-y-1'>
                              <div class='text-xs font-medium text-base-content/70'>
                                {i18n.t('driver.shufflePin')}
                              </div>
                              <label class='flex min-h-10 items-center gap-2 rounded-md border border-base-300 bg-base-200/30 px-3 py-2 text-xs text-base-content/70'>
                                <Checkbox
                                  checked={!!opt.fixed}
                                  onChange={(e) =>
                                    props.setInlineChoiceOptionFixed(
                                      slot.id,
                                      opt.id,
                                      (e.target as HTMLInputElement).checked,
                                    )}
                                />
                                <span>{i18n.t('driver.keepFixed')}</span>
                              </label>
                            </div>
                          )}
                        </div>
                      )}
                      <div class='flex items-start justify-end md:pt-6'>
                        <Button
                          size='xs'
                          variant='danger-ghost'
                          type='button'
                          disabled={options.length <= 2}
                          onClick={() => props.removeInlineChoiceOption(slot.id, opt.id)}
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
      })}
    </div>
  );
}

function InlineChoiceEditor(ctx: DriverUiContext<'inline_choice'>) {
  const standalone = standaloneInlineChoice(ctx.draft);
  if (
    standalone &&
    standalone.slot.options.every((option) => !option.html?.trim() && option.score === undefined)
  ) {
    return h(StandaloneDropdown, { ctx, slot: standalone.slot });
  }
  return h(InlineChoiceEditorWithI18n, { ctx });
}

function InlineChoiceEditorWithI18n({ ctx }: { ctx: DriverUiContext<'inline_choice'> }) {
  const i18n = useI18n();
  const { editor, draft, update } = ctx;
  const bodyHtml = draft.bodyHtml ?? '';
  const inlineChoices = draft.inlineChoices;
  const responseMode = draft.responseMode ?? 'all_or_nothing';

  const setBodyHtml = (value: string | ((prev: string) => string)) =>
    setDraftFieldValue(
      editor,
      draft,
      update,
      'bodyHtml',
      typeof value === 'function' ? (prev) => value(prev ?? '') : value,
    );

  const setInlineChoices = (
    value: InlineChoiceSlot[] | ((prev: InlineChoiceSlot[]) => InlineChoiceSlot[]),
  ) => setDraftListFieldValue(editor, draft, update, 'inlineChoices', value);

  useEffect(() => {
    if (!inlineChoices.length) {
      const slot: InlineChoiceSlot = {
        id: 'RESPONSE_1',
        label: i18n.t('driver.blank', { number: 1 }),
        required: true,
        shuffle: false,
        options: [
          { id: 'A', text: 'Option A', score: 0 },
          { id: 'B', text: 'Option B', score: 1 },
        ],
        correctId: 'B',
      };
      const marker = createInlineChoiceMarkerHtml({ id: slot.id, label: slot.label });
      update({
        ...draft,
        inlineChoices: [slot],
        bodyHtml: draft.bodyHtml?.trim() && draft.bodyHtml.trim() !== '<p></p>'
          ? `${draft.bodyHtml}${draft.bodyHtml.trim().endsWith('</p>') ? '' : ' '}<p>${marker}</p>`
          : `<p>${marker}</p>`,
      });
      return;
    }
    if (listInlineChoiceSlotIds(bodyHtml).length) return;
    const markers = inlineChoices.map((slot) =>
      createInlineChoiceMarkerHtml({ id: slot.id, label: slot.label })
    ).join(' ');
    setBodyHtml((prev) =>
      prev?.trim() && prev.trim() !== '<p></p>'
        ? `${prev}${prev.trim().endsWith('</p>') ? '' : ' '}<p>${markers}</p>`
        : `<p>${markers}</p>`
    );
  }, [bodyHtml, draft, inlineChoices]);

  const nextInlineChoiceSlotId = () => {
    const existing = new Set(inlineChoices.map((slot) => (slot.id ?? '').toUpperCase()));
    let idx = inlineChoices.length + 1;
    let candidate = `RESPONSE_${idx}`;
    while (existing.has(candidate.toUpperCase())) {
      idx += 1;
      candidate = `RESPONSE_${idx}`;
    }
    return candidate;
  };

  const nextInlineChoiceOptionId = (slot: InlineChoiceSlot): string => {
    const existing = new Set((slot.options ?? []).map((option) => (option.id ?? '').toUpperCase()));
    for (let i = 0; i < 26; i++) {
      const candidate = String.fromCharCode('A'.charCodeAt(0) + i);
      if (!existing.has(candidate)) return candidate;
    }
    let idx = existing.size + 1;
    let candidate = `OPT_${idx}`;
    while (existing.has(candidate.toUpperCase())) {
      idx += 1;
      candidate = `OPT_${idx}`;
    }
    return candidate;
  };

  return (
    <InlineChoiceContent
      {...commonContentProps(editor)}
      bodyHtml={bodyHtml}
      inlineChoices={inlineChoices}
      responseMode={responseMode}
      insertInlineChoiceSlot={() => {
        const id = nextInlineChoiceSlotId();
        const slot: InlineChoiceSlot = {
          id,
          label: i18n.t('driver.blank', { number: inlineChoices.length + 1 }),
          required: true,
          shuffle: false,
          options: [
            { id: 'A', text: 'Option A', score: 0 },
            { id: 'B', text: 'Option B', score: 1 },
          ],
          correctId: 'B',
        };
        const marker = createInlineChoiceMarkerHtml({ id: slot.id, label: slot.label });
        setInlineChoices((prev) => [...prev, slot]);
        insertBodyHtml(editor, setBodyHtml, marker);
      }}
      insertInlineChoiceSlotMarker={(slotId) => {
        const slot = inlineChoices.find((entry) => entry.id === slotId);
        insertBodyHtml(
          editor,
          setBodyHtml,
          createInlineChoiceMarkerHtml({ id: slotId, label: slot?.label ?? slotId }),
        );
      }}
      removeInlineChoiceSlot={(slotId) => {
        setInlineChoices((prev) => prev.filter((slot) => slot.id !== slotId));
        setBodyHtml((prev) => {
          const { html } = replaceAllMarkers(
            prev ?? '',
            INLINE_CHOICE_MARKER_ATTR,
            (info) => info.id === slotId ? '' : info.match,
          );
          return html;
        });
      }}
      updateInlineChoiceSlotLabel={(slotId, label) => {
        const slot = inlineChoices.find((entry) => entry.id === slotId);
        if (!slot) return;
        const updated = { ...slot, label };
        setInlineChoices((prev) => prev.map((entry) => entry.id === slotId ? updated : entry));
        setBodyHtml((prev) => {
          const { html } = replaceAllMarkers(
            prev ?? '',
            INLINE_CHOICE_MARKER_ATTR,
            (info) =>
              info.id === slotId
                ? createInlineChoiceMarkerHtml({ id: slotId, label: updated.label })
                : info.match,
          );
          return html;
        });
      }}
      updateInlineChoiceSlotId={(slotId, nextIdInput) => {
        const slot = inlineChoices.find((entry) => entry.id === slotId);
        if (!slot) return;
        const sanitizedBase = sanitizeIdentifier(nextIdInput || slotId, slot.id);
        let finalId = sanitizedBase;
        if (inlineChoices.some((entry) => entry.id === finalId && entry.id !== slotId)) {
          let suffix = 2;
          const base = sanitizedBase.replace(/_\d+$/, '');
          while (inlineChoices.some((entry) => entry.id === `${base}_${suffix}`)) suffix += 1;
          finalId = `${base}_${suffix}`;
        }
        const updated: InlineChoiceSlot = { ...slot, id: finalId };
        setInlineChoices((prev) => prev.map((entry) => entry.id === slotId ? updated : entry));
        setBodyHtml((prev) => {
          const { html } = replaceAllMarkers(
            prev ?? '',
            INLINE_CHOICE_MARKER_ATTR,
            (info) =>
              info.id === slotId
                ? createInlineChoiceMarkerHtml({ id: updated.id, label: updated.label })
                : info.match,
          );
          return html;
        });
      }}
      setInlineChoiceSlotRequired={(slotId, required) =>
        setInlineChoices((prev) =>
          prev.map((slot) => (slot.id === slotId ? { ...slot, required } : slot))
        )}
      setInlineChoiceSlotShuffle={(slotId, shuffle) =>
        setInlineChoices((prev) =>
          prev.map((slot) => (slot.id === slotId ? { ...slot, shuffle } : slot))
        )}
      addInlineChoiceOption={(slotId) =>
        setInlineChoices((prev) =>
          prev.map((slot) => {
            if (slot.id !== slotId) return slot;
            const id = nextInlineChoiceOptionId(slot);
            return {
              ...slot,
              options: [...(slot.options ?? []), { id, text: '' }],
            };
          })
        )}
      removeInlineChoiceOption={(slotId, optionId) =>
        setInlineChoices((prev) =>
          prev.map((slot) => {
            if (slot.id !== slotId) return slot;
            const options = slot.options ?? [];
            if (options.length <= 2) return slot;
            const nextOptions = options.filter((option) => option.id !== optionId);
            const nextCorrect = slot.correctId === optionId ? undefined : slot.correctId;
            return { ...slot, options: nextOptions, correctId: nextCorrect };
          })
        )}
      updateInlineChoiceOptionText={(slotId, optionId, text) =>
        setInlineChoices((prev) =>
          prev.map((slot) =>
            slot.id === slotId
              ? {
                ...slot,
                options: (slot.options ?? []).map((option) =>
                  option.id === optionId ? { ...option, text } : option
                ),
              }
              : slot
          )
        )}
      updateInlineChoiceOptionId={(slotId, optionId, nextIdInput) =>
        setInlineChoices((prev) =>
          prev.map((slot) => {
            if (slot.id !== slotId) return slot;
            const sanitizedBase = sanitizeIdentifier(nextIdInput || optionId, optionId);
            let finalId = sanitizedBase;
            if (slot.options.some((option) => option.id === finalId && option.id !== optionId)) {
              let suffix = 2;
              const base = sanitizedBase.replace(/_\d+$/, '');
              while (slot.options.some((option) => option.id === `${base}_${suffix}`)) {
                suffix += 1;
              }
              finalId = `${base}_${suffix}`;
            }
            const options = (slot.options ?? []).map((option) =>
              option.id === optionId ? { ...option, id: finalId } : option
            );
            const correctId = slot.correctId === optionId ? finalId : slot.correctId;
            return { ...slot, options, correctId };
          })
        )}
      setInlineChoiceCorrectId={(slotId, optionId) =>
        setInlineChoices((prev) =>
          prev.map((slot) => (slot.id === slotId ? { ...slot, correctId: optionId } : slot))
        )}
      setInlineChoiceOptionFixed={(slotId, optionId, fixed) =>
        setInlineChoices((prev) =>
          prev.map((slot) =>
            slot.id === slotId
              ? {
                ...slot,
                options: (slot.options ?? []).map((option) =>
                  option.id === optionId ? { ...option, fixed } : option
                ),
              }
              : slot
          )
        )}
      setInlineChoiceOptionScore={(slotId, optionId, score) =>
        setInlineChoices((prev) =>
          prev.map((slot) =>
            slot.id === slotId
              ? {
                ...slot,
                options: (slot.options ?? []).map((option) =>
                  option.id === optionId ? { ...option, score } : option
                ),
              }
              : slot
          )
        )}
    />
  );
}

attachStandardDriverViews('inline_choice', InlineChoiceEditor);
