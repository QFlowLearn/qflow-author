import { useDomId } from '../../lib/rendering/island_context.tsx';
import { useEffect, useState } from 'preact/hooks';
import { setDraftFieldValue, setDraftListFieldValue } from './editor_shell.tsx';
import Button from '../../components/ui/Button.tsx';
import Input, { FieldIssueMessage } from '../../components/ui/Input.tsx';
import Select from '../../components/ui/Select.tsx';
import Checkbox from '../../components/ui/Checkbox.tsx';
import {
  createTextEntrySlot,
  type TextEntryAnswer,
  type TextEntrySlot,
} from '../../lib/types/text_entry.ts';
import {
  createPlaceholderHtml,
  listPlaceholderIds,
  removePlaceholderById,
  replacePlaceholderById,
} from '../../lib/text_entry_placeholders.ts';
import { generateIdentifierFromLabel, sanitizeIdentifier } from '../../lib/identifiers.ts';
import type { DriverUiContext } from './view_registry.ts';
import type { CommonContentProps } from './types.ts';
import { attachStandardDriverViews } from './standard_driver_views.ts';
import { useI18n } from '../../lib/i18n/context.tsx';

const TEXT_ENTRY_WIDTH_OPTIONS = [
  { value: '' },
  { value: 'qti-input-width-1' },
  { value: 'qti-input-width-2' },
  { value: 'qti-input-width-3' },
  { value: 'qti-input-width-4' },
  { value: 'qti-input-width-6' },
  { value: 'qti-input-width-10' },
  { value: 'qti-input-width-15' },
  { value: 'qti-input-width-20' },
  { value: 'qti-input-width-25' },
  { value: 'qti-input-width-30' },
  { value: 'qti-input-width-35' },
  { value: 'qti-input-width-40' },
  { value: 'qti-input-width-45' },
  { value: 'qti-input-width-50' },
  { value: 'qti-input-width-72' },
];

const TEXT_ENTRY_PATTERN_PRESETS = [
  { value: '^[0-9]+$' },
  { value: '^[A-Za-z]+$' },
  { value: '^[0-9]{4}$' },
  { value: '^[A-Za-z0-9]+$' },
];

const CUSTOM_PATTERN_VALUE = '__custom__';

export type TextEntryContentProps = CommonContentProps & {
  textEntries: TextEntrySlot[];
  showIdentifiers: boolean;
  setShowIdentifiers: (value: boolean) => void;
  allowIdentifierToggle?: boolean;
  requirePatterns?: boolean;
  setRequirePatterns?: (value: boolean) => void;
  allowPatternToggle?: boolean;
  patternSelections: Record<string, string>;
  setPatternSelection: (slotId: string, value: string) => void;
  insertBlank: () => void;
  removeSlot: (slotId: string) => void;
  updateSlotLabel: (slotId: string, label: string) => void;
  updateSlotIdentifier: (slotId: string, value: string, opts?: { manual?: boolean }) => void;
  updateSlotExpectedLength: (slotId: string, value: string) => void;
  updateSlotWidth: (slotId: string, widthClass: string) => void;
  updateSlotPattern: (slotId: string, value: string) => void;
  updateSlotPatternMessage: (slotId: string, value: string) => void;
  addAnswer: (slotId: string) => void;
  removeAnswer: (slotId: string, answerId: string) => void;
  upsertAnswer: (slotId: string, answerId: string, patch: Partial<TextEntryAnswer>) => void;
};

function TextEntryEditor(ctx: DriverUiContext<'text_entry'>) {
  const { editor, draft, update } = ctx;
  const textEntries = draft.textEntries;
  const bodyHtml = draft.bodyHtml ?? '';
  const requirePatterns = Boolean(draft.requirePattern);
  const settings = editor.settings;
  const [patternSelections, setPatternSelections] = useState<Record<string, string>>({});
  const [identifierLocks, setIdentifierLocks] = useState<Record<string, boolean>>({});
  const [localShowIdentifiers, setLocalShowIdentifiers] = useState(false);

  useEffect(() => {
    setPatternSelections({});
    setIdentifierLocks({});
    setLocalShowIdentifiers(false);
  }, [editor.draftKey]);

  const showIdentifiers = typeof settings?.textEntryShowIdentifiers === 'boolean'
    ? settings.textEntryShowIdentifiers
    : localShowIdentifiers;

  const setShowIdentifiers = (value: boolean) => {
    if (editor.onSettingsChange) editor.onSettingsChange({ textEntryShowIdentifiers: value });
    else setLocalShowIdentifiers(value);
  };

  const setDraftField = <K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K] | ((prev: (typeof draft)[K]) => (typeof draft)[K]),
  ) => setDraftFieldValue(editor, draft, update, key, value);

  const setTextEntries = (value: TextEntrySlot[] | ((prev: TextEntrySlot[]) => TextEntrySlot[])) =>
    setDraftListFieldValue(editor, draft, update, 'textEntries', value);

  const setBodyHtml = (value: string | ((prev: string) => string)) =>
    setDraftField(
      'bodyHtml',
      typeof value === 'function' ? (prev) => value(prev ?? '') : value,
    );

  const syncRequirePatterns = (value: boolean) => {
    setDraftField('requirePattern', value);
  };

  useEffect(() => {
    if (typeof settings?.requirePattern !== 'boolean') return;
    if (settings.requirePattern === requirePatterns) return;
    syncRequirePatterns(settings.requirePattern);
  }, [settings?.requirePattern, requirePatterns, draft]);

  const setRequirePatterns = (value: boolean) => {
    syncRequirePatterns(value);
    editor.onSettingsChange?.({ requirePattern: value });
  };

  const createPlaceholderForSlot = (slot: TextEntrySlot) =>
    createPlaceholderHtml({
      id: slot.id,
      label: slot.label,
      widthClass: slot.widthClass,
    });

  const ensureTextEntryDefaults = () => {
    if (textEntries.length === 0) {
      const slot = createTextEntrySlot('RESPONSE', 'Blank 1');
      setTextEntries([slot]);
      setPatternSelections({});
      setIdentifierLocks({ [slot.id]: false });
      const placeholder = createPlaceholderForSlot(slot);
      setBodyHtml((prev) => {
        if (!prev || !prev.trim()) return `<p>${placeholder}</p>`;
        if (prev.includes(`data-qti-entry=\"${slot.id}\"`)) return prev;
        return `${prev}${prev.trim().endsWith('</p>') ? '' : ' '}${placeholder}`;
      });
      return;
    }
    if (Object.keys(identifierLocks).length === 0) {
      setIdentifierLocks(Object.fromEntries(textEntries.map((slot) => [slot.id, false])));
    }
    const placeholders = listPlaceholderIds(bodyHtml ?? '');
    if (placeholders.length) return;
    const firstSlot = textEntries[0];
    if (!firstSlot) return;
    const placeholder = createPlaceholderForSlot(firstSlot);
    setBodyHtml((prev) => {
      if (!prev || !prev.trim()) return `<p>${placeholder}</p>`;
      return `${prev}${prev.trim().endsWith('</p>') ? '' : ' '}${placeholder}`;
    });
  };

  useEffect(() => {
    ensureTextEntryDefaults();
  }, [textEntries.length, bodyHtml]);

  const setPatternSelection = (slotId: string, value: string) => {
    setPatternSelections((prev) => {
      if (!value) {
        if (!(slotId in prev)) return prev;
        const next = { ...prev };
        delete next[slotId];
        return next;
      }
      return { ...prev, [slotId]: value };
    });
  };

  const updatePlaceholderMarkup = (slot: TextEntrySlot, previousId?: string) => {
    const placeholder = createPlaceholderForSlot(slot);
    setBodyHtml((prev) => {
      const { html, replaced } = replacePlaceholderById(
        prev ?? '',
        previousId ?? slot.id,
        placeholder,
      );
      return replaced ? html : prev;
    });
  };

  const updateSlotIdentifier = (
    slotId: string,
    nextIdInput: string,
    opts?: { manual?: boolean; nextLabel?: string; preserveLock?: boolean },
  ) => {
    const slot = textEntries.find((s) => s.id === slotId);
    if (!slot) return;
    const sanitizedBase = sanitizeIdentifier(nextIdInput || slotId, slot.id);
    let finalId = sanitizedBase;
    if (textEntries.some((s) => s.id === finalId && s.id !== slotId)) {
      let suffix = 2;
      const base = sanitizedBase.replace(/_\\d+$/, '');
      while (textEntries.some((s) => s.id === `${base}_${suffix}`)) suffix += 1;
      finalId = `${base}_${suffix}`;
    }
    const updated: TextEntrySlot = {
      ...slot,
      id: finalId,
      label: opts?.nextLabel ?? slot.label,
    };
    setTextEntries((prev) => prev.map((s) => (s.id === slotId ? updated : s)));
    updatePlaceholderMarkup(updated, slotId);
    setIdentifierLocks((prev) => {
      const next = { ...prev };
      const autoId = generateIdentifierFromLabel(updated.label, finalId);
      const lockValue = opts?.preserveLock
        ? prev[slotId] ?? false
        : (opts?.manual ? finalId !== autoId : false);
      delete next[slotId];
      next[finalId] = lockValue;
      return next;
    });
    setPatternSelections((prev) => {
      if (!(slotId in prev)) return prev;
      const next = { ...prev, [finalId]: prev[slotId] };
      delete next[slotId];
      return next;
    });
  };

  const updateSlotLabel = (slotId: string, label: string) => {
    const trimmed = label;
    const slot = textEntries.find((s) => s.id === slotId);
    if (!slot) return;
    if (identifierLocks[slotId]) {
      updateSlotIdentifier(slotId, slot.id, {
        manual: true,
        nextLabel: trimmed,
        preserveLock: true,
      });
      return;
    }
    const autoId = generateIdentifierFromLabel(trimmed || slot.label || slot.id, slot.id);
    updateSlotIdentifier(slotId, autoId, { manual: false, nextLabel: trimmed });
  };

  const updateSlotWidth = (slotId: string, widthClass: string) => {
    const slot = textEntries.find((s) => s.id === slotId);
    const nextWidth = widthClass || undefined;
    const updatedEntries = textEntries.map((entry) =>
      entry.id === slotId ? { ...entry, widthClass: nextWidth } : entry
    );
    if (!slot) {
      setTextEntries(updatedEntries);
      return;
    }
    const updatedSlot = { ...slot, widthClass: nextWidth };
    // The fallback path must commit the slot and its marker in one update. Two
    // updates based on this render's draft can otherwise let the marker write
    // restore a stale textEntries array.
    if (!editor.setDraftListField || !editor.setDraftField) {
      const placeholder = createPlaceholderForSlot(updatedSlot);
      const { html, replaced } = replacePlaceholderById(
        draft.bodyHtml ?? '',
        slot.id,
        placeholder,
      );
      update({
        ...draft,
        textEntries: updatedEntries,
        bodyHtml: replaced ? html : draft.bodyHtml,
      });
      return;
    }
    setTextEntries(updatedEntries);
    updatePlaceholderMarkup(updatedSlot);
  };

  const updateSlotExpectedLength = (slotId: string, value: string) => {
    const num = value === '' ? undefined : Math.max(0, Number(value) || 0);
    setTextEntries((prev) =>
      prev.map((slot) => slot.id === slotId ? { ...slot, expectedLength: num } : slot)
    );
  };

  const updateSlotPattern = (slotId: string, value: string) => {
    setTextEntries((prev) =>
      prev.map((slot) =>
        slot.id === slotId ? { ...slot, patternMask: value.trim() || undefined } : slot
      )
    );
  };

  const updateSlotPatternMessage = (slotId: string, value: string) => {
    setTextEntries((prev) =>
      prev.map((slot) =>
        slot.id === slotId ? { ...slot, patternMessage: value.trim() || undefined } : slot
      )
    );
  };

  const removeTextEntrySlot = (slotId: string) => {
    setTextEntries((prev) => prev.filter((slot) => slot.id !== slotId));
    setBodyHtml((prev) => removePlaceholderById(prev ?? '', slotId));
    setIdentifierLocks((prev) => {
      const next = { ...prev };
      delete next[slotId];
      return next;
    });
    setPatternSelections((prev) => {
      if (!(slotId in prev)) return prev;
      const next = { ...prev };
      delete next[slotId];
      return next;
    });
  };

  const upsertAnswer = (slotId: string, answerId: string, patch: Partial<TextEntryAnswer>) => {
    setTextEntries((prev) =>
      prev.map((slot) =>
        slot.id === slotId
          ? {
            ...slot,
            answers: slot.answers.map((ans) => ans.id === answerId ? { ...ans, ...patch } : ans),
          }
          : slot
      )
    );
  };

  const addAnswer = (slotId: string) => {
    setTextEntries((prev) =>
      prev.map((slot) =>
        slot.id === slotId
          ? {
            ...slot,
            answers: [
              ...slot.answers,
              { id: crypto.randomUUID(), value: '', score: 1, caseSensitive: true },
            ],
          }
          : slot
      )
    );
  };

  const removeAnswer = (slotId: string, answerId: string) => {
    setTextEntries((prev) =>
      prev.map((slot) =>
        slot.id === slotId
          ? {
            ...slot,
            answers: slot.answers.length > 1
              ? slot.answers.filter((ans) => ans.id !== answerId)
              : slot.answers,
          }
          : slot
      )
    );
  };

  const nextTextEntryId = () => {
    if (!textEntries.some((slot) => slot.id === 'RESPONSE')) return 'RESPONSE';
    let idx = textEntries.length + 1;
    let candidate = `RESPONSE_${idx}`;
    const existing = new Set(textEntries.map((slot) => slot.id.toUpperCase()));
    while (existing.has(candidate.toUpperCase())) {
      idx += 1;
      candidate = `RESPONSE_${idx}`;
    }
    return candidate;
  };

  const insertTextEntryBlank = () => {
    const id = nextTextEntryId();
    const slot = createTextEntrySlot(id, `Blank ${textEntries.length + 1}`);
    setTextEntries((prev) => [...prev, slot]);
    setIdentifierLocks((prev) => ({ ...prev, [slot.id]: false }));
    const placeholder = createPlaceholderForSlot(slot);
    const api = editor.bodyEditorApi?.current;
    if (api?.insertTextEntryBlank) {
      api.insertTextEntryBlank({
        id: slot.id,
        label: slot.label,
        widthClass: slot.widthClass,
      });
    } else {
      setBodyHtml((prev) => `${prev ?? ''}${(prev ?? '').trim() ? ' ' : ''}${placeholder}`);
    }
  };

  return (
    <TextEntryContent
      renderPromptField={editor.renderPromptField ?? (() => null)}
      fieldHasIssue={editor.fieldHasIssue ?? (() => false)}
      fieldIssueText={editor.fieldIssueText ?? (() => undefined)}
      textEntries={textEntries}
      showIdentifiers={showIdentifiers}
      setShowIdentifiers={setShowIdentifiers}
      allowIdentifierToggle={!editor.onSettingsChange}
      requirePatterns={requirePatterns}
      setRequirePatterns={setRequirePatterns}
      allowPatternToggle={!editor.onSettingsChange}
      patternSelections={patternSelections}
      setPatternSelection={setPatternSelection}
      insertBlank={insertTextEntryBlank}
      removeSlot={removeTextEntrySlot}
      updateSlotLabel={updateSlotLabel}
      updateSlotIdentifier={updateSlotIdentifier}
      updateSlotExpectedLength={updateSlotExpectedLength}
      updateSlotWidth={updateSlotWidth}
      updateSlotPattern={updateSlotPattern}
      updateSlotPatternMessage={updateSlotPatternMessage}
      addAnswer={addAnswer}
      removeAnswer={removeAnswer}
      upsertAnswer={upsertAnswer}
    />
  );
}

export function TextEntryContent(props: TextEntryContentProps) {
  const i18n = useI18n();
  const issueId = useDomId();
  return (
    <div class='space-y-4'>
      <div class='flex items-center justify-between'>
        <strong class='text-sm text-base-content/80'>{i18n.t('driver.blanks')}</strong>
        <Button
          size='sm'
          type='button'
          data-editor-field={props.textEntries.length === 0 ? 'textEntry' : undefined}
          aria-invalid={props.fieldHasIssue('textEntry') || undefined}
          aria-describedby={props.fieldHasIssue('textEntry') ? issueId : undefined}
          onClick={props.insertBlank}
        >
          {i18n.t('driver.insertBlank')}
        </Button>
      </div>
      {props.renderPromptField(i18n.t('driver.textPrompt'))}
      <div class='flex items-center justify-between text-xs text-base-content/60'>
        <span>{i18n.t('driver.identifiersHelp')}</span>
        {props.allowIdentifierToggle !== false && (
          <Button
            size='xs'
            variant='ghost'
            type='button'
            onClick={() => props.setShowIdentifiers(!props.showIdentifiers)}
          >
            {props.showIdentifiers
              ? i18n.t('driver.hideIdentifiers')
              : i18n.t('driver.showIdentifiers')}
          </Button>
        )}
      </div>
      {props.allowPatternToggle !== false && props.setRequirePatterns && (
        <label class='flex items-center gap-2 text-xs text-base-content/70'>
          <Checkbox
            checked={!!props.requirePatterns}
            onChange={(e) => props.setRequirePatterns?.((e.target as HTMLInputElement).checked)}
          />
          <span>{i18n.t('driver.requirePattern')}</span>
        </label>
      )}
      {props.requirePatterns && (
        <p class='text-xs text-base-content/60'>{i18n.t('driver.patternRequiredHelp')}</p>
      )}
      {props.fieldHasIssue('textEntry') && (
        <FieldIssueMessage id={issueId} message={props.fieldIssueText('textEntry') ?? ''} />
      )}
      {props.textEntries.map((slot, index) => {
        const patternMask = slot.patternMask ?? '';
        const preset = TEXT_ENTRY_PATTERN_PRESETS.find((p) => p.value === patternMask);
        const patternSelection = props.patternSelections[slot.id] ??
          (preset ? preset.value : (patternMask ? CUSTOM_PATTERN_VALUE : ''));
        const showCustomPattern = patternSelection === CUSTOM_PATTERN_VALUE;

        return (
          <div key={slot.id} class='space-y-3 rounded-lg border border-base-300 bg-base-100 p-3'>
            <div class='flex items-center justify-between'>
              <strong class='text-sm text-base-content/80'>
                {i18n.t('driver.blank', { number: index + 1 })}
              </strong>
              {props.textEntries.length > 1 && (
                <Button
                  size='xs'
                  variant='danger-ghost'
                  type='button'
                  onClick={() => props.removeSlot(slot.id)}
                >
                  {i18n.t('driver.remove')}
                </Button>
              )}
            </div>
            <div class='grid gap-3 sm:grid-cols-2'>
              <label class='ds-form-control'>
                <span>{i18n.t('driver.label')}</span>
                <Input
                  value={slot.label}
                  onInput={(e) =>
                    props.updateSlotLabel(slot.id, (e.target as HTMLInputElement).value)}
                />
              </label>
              {props.showIdentifiers && (
                <label class='ds-form-control'>
                  <span>{i18n.t('driver.identifier')}</span>
                  <Input
                    value={slot.id}
                    onInput={(e) =>
                      props.updateSlotIdentifier(slot.id, (e.target as HTMLInputElement).value, {
                        manual: true,
                      })}
                    placeholder={i18n.t('driver.responsePlaceholder')}
                  />
                </label>
              )}
            </div>
            <div class='grid gap-3 md:grid-cols-[minmax(0,0.95fr)_minmax(0,0.95fr)_minmax(0,1.15fr)] md:items-start'>
              <label class='ds-form-control'>
                <span>{i18n.t('driver.expectedLength')}</span>
                <Input
                  type='number'
                  min={0}
                  value={slot.expectedLength ?? ''}
                  onInput={(e) =>
                    props.updateSlotExpectedLength(slot.id, (e.target as HTMLInputElement).value)}
                  placeholder={i18n.t('driver.lengthPlaceholder')}
                />
              </label>
              <label class='ds-form-control'>
                <span>{i18n.t('driver.width')}</span>
                <Select
                  value={slot.widthClass ?? ''}
                  onInput={(e) =>
                    props.updateSlotWidth(slot.id, (e.target as HTMLSelectElement).value)}
                >
                  {TEXT_ENTRY_WIDTH_OPTIONS.map((opt) => (
                    <option key={opt.value || 'auto'} value={opt.value}>
                      {opt.value
                        ? i18n.t('driver.widthValue', {
                          number: Number(opt.value.replace('qti-input-width-', '')),
                        })
                        : i18n.t('driver.autoWidth')}
                    </option>
                  ))}
                </Select>
              </label>
              <label class='ds-form-control'>
                <span>{i18n.t('driver.patternMask')}</span>
                <Select
                  value={patternSelection}
                  onInput={(e) => {
                    const value = (e.target as HTMLSelectElement).value;
                    props.setPatternSelection(slot.id, value);
                    if (value === CUSTOM_PATTERN_VALUE) {
                      if (!patternMask) {
                        props.updateSlotPattern(slot.id, '');
                      }
                      return;
                    }
                    props.updateSlotPattern(slot.id, value);
                  }}
                >
                  <option value=''>{i18n.t('driver.noPattern')}</option>
                  {TEXT_ENTRY_PATTERN_PRESETS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.value === '^[0-9]+$'
                        ? i18n.t('driver.patternNumbers')
                        : opt.value === '^[A-Za-z]+$'
                        ? i18n.t('driver.patternLetters')
                        : opt.value === '^[0-9]{4}$'
                        ? i18n.t('driver.patternPin')
                        : i18n.t('driver.patternAlphanumeric')}
                    </option>
                  ))}
                  <option value={CUSTOM_PATTERN_VALUE}>{i18n.t('driver.customRegex')}</option>
                </Select>
                <span class='mt-1 text-xs leading-tight text-base-content/60'>
                  {i18n.t('driver.regexHelp')}
                </span>
                {showCustomPattern && (
                  <div class='mt-2 space-y-1'>
                    <Input
                      value={patternMask}
                      onInput={(e) =>
                        props.updateSlotPattern(slot.id, (e.target as HTMLInputElement).value)}
                      placeholder={i18n.t('driver.regexPlaceholder')}
                    />
                    <p class='text-xs text-base-content/60'>{i18n.t('driver.regexSyntax')}</p>
                  </div>
                )}
              </label>
            </div>
            {patternSelection !== '' && (
              <label class='ds-form-control'>
                <span>{i18n.t('driver.patternMessage')}</span>
                <Input
                  value={slot.patternMessage ?? ''}
                  onInput={(e) =>
                    props.updateSlotPatternMessage(slot.id, (e.target as HTMLInputElement).value)}
                  placeholder={i18n.t('driver.patternMessagePlaceholder')}
                />
              </label>
            )}
            <div class='space-y-2'>
              <div class='flex items-center justify-between'>
                <strong class='text-sm text-base-content/70'>
                  {i18n.t('driver.acceptedAnswers')}
                </strong>
                <Button
                  size='xs'
                  type='button'
                  onClick={() =>
                    props.addAnswer(slot.id)}
                >
                  {i18n.t('driver.addAnswer')}
                </Button>
              </div>
              <p class='text-xs text-base-content/60'>{i18n.t('driver.answerScoreHelp')}</p>
              {slot.answers.map((answer) => (
                <div key={answer.id} class='grid gap-2 md:grid-cols-[2fr,1fr,1fr]'>
                  <Input
                    class='w-full'
                    data-editor-field='textEntry'
                    aria-invalid={props.fieldHasIssue('textEntry') || undefined}
                    aria-describedby={props.fieldHasIssue('textEntry') ? issueId : undefined}
                    value={answer.value}
                    onInput={(e) =>
                      props.upsertAnswer(slot.id, answer.id, {
                        value: (e.target as HTMLInputElement).value,
                      })}
                    placeholder={i18n.t('driver.answerPlaceholder')}
                  />
                  <Input
                    type='number'
                    min={0}
                    step='0.1'
                    value={answer.score ?? 1}
                    onInput={(e) =>
                      props.upsertAnswer(slot.id, answer.id, {
                        score: Number((e.target as HTMLInputElement).value),
                      })}
                    placeholder={i18n.t('driver.scorePlaceholder')}
                  />
                  <div class='flex items-center justify-between gap-3'>
                    <label class='flex items-center gap-2 text-xs sm:text-sm text-base-content/70'>
                      <Checkbox
                        checked={!!answer.caseSensitive}
                        onChange={(e) =>
                          props.upsertAnswer(slot.id, answer.id, {
                            caseSensitive: (e.target as HTMLInputElement).checked,
                          })}
                        aria-label={i18n.t('driver.caseSensitive')}
                      />
                      <span>{i18n.t('driver.caseSensitive')}</span>
                    </label>
                    <Button
                      size='xs'
                      variant='danger-ghost'
                      type='button'
                      disabled={slot.answers.length <= 1}
                      onClick={() =>
                        props.removeAnswer(slot.id, answer.id)}
                    >
                      {i18n.t('driver.remove')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {props.textEntries.length === 0 && (
        <p class='text-sm text-base-content/60'>{i18n.t('driver.noBlanks')}</p>
      )}
    </div>
  );
}

attachStandardDriverViews('text_entry', TextEntryEditor);
