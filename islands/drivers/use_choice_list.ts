import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
  choiceLabelOptionsFromVocabulary,
  defaultChoiceLabel,
  nextChoiceId,
} from '../../lib/choice_labels.ts';
import type { QtiInteractionVocabulary } from '../../lib/shared_vocabulary.ts';
import type { Choice, LabelEditingState } from './types.ts';
import { type ChoicePaste, insertPastedChoices } from './choice_paste.ts';

export type ChoiceListMode = 'single' | 'multi';

type ChoiceListDraft = {
  readonly choices: Choice[];
  readonly correctId?: string;
  readonly correctIds?: string[];
  readonly shuffle?: boolean;
  readonly sharedVocabulary?: QtiInteractionVocabulary;
};

type ChoiceListPatch = Partial<
  Pick<ChoiceListDraft, 'choices' | 'correctId' | 'correctIds'>
>;

type ChoiceListUpdater = Choice[] | ((previous: Choice[]) => Choice[]);

export function useChoiceList(options: {
  draft: ChoiceListDraft;
  updateFields: (patch: ChoiceListPatch) => void;
  setChoices: (value: ChoiceListUpdater) => void;
  mode: ChoiceListMode;
  historyKey?: string | null;
  settings?: { allowPins?: boolean };
}) {
  const { draft, mode, settings } = options;
  const choices = draft.choices;
  const correctId = draft.correctId ?? '';
  const correctIds = draft.correctIds ?? [];
  const shuffle = Boolean(draft.shuffle);
  const choiceLabelOptions = choiceLabelOptionsFromVocabulary(draft.sharedVocabulary);
  const allowPinsSetting = settings?.allowPins;
  const allowPins = typeof allowPinsSetting === 'boolean'
    ? allowPinsSetting
    : choices.some((c) => c.fixed);
  const answerKeyVersion = useRef(0);
  const [labelEditing, setLabelEditing] = useState<LabelEditingState>(null);
  const [pasteTransaction, setPasteTransaction] = useState<
    {
      before: Choice[];
      index: number;
      paste: ChoicePaste;
      richText: boolean;
    } | null
  >(null);
  const [removals, setRemovals] = useState<ChoiceRemoval[]>([]);
  const [redos, setRedos] = useState<ChoiceRemoval[]>([]);
  const [keyboardHistory, setKeyboardHistory] = useState(false);
  const [historyFocus, setHistoryFocus] = useState({ sequence: 0, choiceId: '' });
  useLayoutEffect(() => {
    setRemovals([]);
    setRedos([]);
    setKeyboardHistory(false);
    setPasteTransaction(null);
  }, [options.historyKey]);
  const focusHistory = (choiceId: string) => {
    setHistoryFocus((previous) => ({ sequence: previous.sequence + 1, choiceId }));
    setKeyboardHistory(true);
  };
  const settleRemovals = () => {
    setRemovals([]);
    setRedos([]);
    setKeyboardHistory(false);
  };
  const setChoices = (value: ChoiceListUpdater) => {
    setPasteTransaction(null);
    setKeyboardHistory(false);
    options.setChoices(value);
  };
  const updateFields = (patch: ChoiceListPatch) => {
    setPasteTransaction(null);
    setKeyboardHistory(false);
    options.updateFields(patch);
  };

  const pasteChoices = (index: number, paste: ChoicePaste, richText: boolean) => {
    settleRemovals();
    setPasteTransaction({ before: choices, index, paste, richText });
    options.setChoices(insertPastedChoices(choices, index, paste, richText));
  };

  const undoPaste = () => {
    if (!pasteTransaction) return;
    const { before } = pasteTransaction;
    setChoices(before);
  };

  const keepPasteAsOne = () => {
    if (!pasteTransaction) return;
    const { before, index, paste, richText } = pasteTransaction;
    setChoices(
      before.map((choice, i) =>
        i === index
          ? { ...choice, text: paste.singleText, html: richText ? paste.singleHtml : undefined }
          : choice
      ),
    );
  };

  const addChoice = () => {
    settleRemovals();
    setChoices((prev) => [...prev, { id: nextChoiceId(new Set(prev.map((c) => c.id))), text: '' }]);
  };

  const updateChoiceText = (index: number, text: string) => {
    setChoices((prev) => prev.map((c, i) => (i === index ? { ...c, text, html: undefined } : c)));
  };

  const updateChoiceHtml = (index: number, html: string) => {
    setChoices((prev) => prev.map((c, i) => (i === index ? { ...c, html } : c)));
  };

  const updateChoiceLabel = (index: number, label: string) => {
    const value = label.trim();
    setChoices((prev) =>
      prev.map((c, i) => (i === index ? { ...c, label: value || undefined } : c))
    );
  };

  const captureRemoval = (index: number): ChoiceRemoval | null => {
    const choice = choices[index];
    if (!choice) return null;
    const beforeCorrect = mode === 'single' ? [correctId] : correctIds;
    return {
      choice,
      index,
      answerKeyVersion: answerKeyVersion.current,
      nextId: choices[index + 1]?.id,
      beforeCorrect,
      afterCorrect: mode === 'single'
        ? [choice.id === correctId ? '' : correctId]
        : correctIds.filter((id) => id !== choice.id),
    };
  };
  const applyRemoval = (removal: ChoiceRemoval) => {
    const nextChoices = choices.filter((choice) => choice.id !== removal.choice.id);
    updateFields(
      mode === 'single'
        ? { choices: nextChoices, correctId: removal.afterCorrect[0] }
        : { choices: nextChoices, correctIds: removal.afterCorrect },
    );
    if (labelEditing?.id === removal.choice.id) setLabelEditing(null);
    focusHistory('');
  };
  const removeChoice = (index: number) => {
    const removal = captureRemoval(index);
    if (!removal) return;
    setRemovals((previous) => [...previous, removal]);
    setRedos([]);
    applyRemoval(removal);
  };
  const undoRemoval = () => {
    const removal = removals.at(-1);
    if (!removal) return;
    const nextIndex = choices.findIndex((choice) => choice.id === removal.nextId);
    const index = nextIndex === -1 ? Math.min(removal.index, choices.length) : nextIndex;
    const nextChoices = [...choices.slice(0, index), removal.choice, ...choices.slice(index)];
    const currentCorrect = mode === 'single' ? [correctId] : correctIds;
    // A later explicit answer-key edit takes precedence over the removed option's old key.
    const restoredCorrect = answerKeyVersion.current === removal.answerKeyVersion &&
        sameIds(currentCorrect, removal.afterCorrect)
      ? removal.beforeCorrect
      : currentCorrect;
    updateFields(
      mode === 'single'
        ? { choices: nextChoices, correctId: restoredCorrect[0] }
        : { choices: nextChoices, correctIds: restoredCorrect },
    );
    setRemovals(removals.slice(0, -1));
    setRedos((previous) => [...previous, removal]);
    focusHistory(removal.choice.id);
  };
  const redoRemoval = () => {
    const previousRemoval = redos.at(-1);
    if (!previousRemoval) return;
    const removal = captureRemoval(
      choices.findIndex((choice) => choice.id === previousRemoval.choice.id),
    );
    if (!removal) return;
    setRedos(redos.slice(0, -1));
    setRemovals((previous) => [...previous, removal]);
    applyRemoval(removal);
  };

  const toggleChoicePin = (index: number, fixed: boolean) => {
    setChoices((prev) => prev.map((c, i) => (i === index ? { ...c, fixed } : c)));
  };

  const setCorrectId = (value: string) => {
    answerKeyVersion.current += 1;
    updateFields({ correctId: value });
  };

  const setCorrectIds = (updater: (prev: string[]) => string[]) => {
    answerKeyVersion.current += 1;
    updateFields({ correctIds: updater(correctIds) });
  };

  const beginLabelEdit = (choice: Choice, index: number) => {
    if (labelEditing?.id === choice.id) return;
    const initial = choice.label?.trim() ??
      defaultChoiceLabel(choice, index, choiceLabelOptions);
    setLabelEditing({ id: choice.id, value: initial });
  };

  const commitLabelEdit = () => {
    if (!labelEditing) return;
    const idx = choices.findIndex((c) => c.id === labelEditing.id);
    if (idx === -1) {
      setLabelEditing(null);
      return;
    }
    const fallback = defaultChoiceLabel(choices[idx], idx, choiceLabelOptions);
    const value = labelEditing.value.trim();
    if (value && value !== fallback) updateChoiceLabel(idx, value);
    else updateChoiceLabel(idx, '');
    setLabelEditing(null);
  };

  const onLabelEditInput = (id: string, value: string) => {
    setLabelEditing({ id, value });
  };

  return {
    choices,
    canUndoRemoval: removals.length > 0,
    canRedoRemoval: redos.length > 0,
    keyboardHistory,
    historyFocus,
    undoRemoval,
    redoRemoval,
    correctId,
    correctIds,
    shuffle,
    allowPins,
    choiceLabelOptions,
    labelEditing,
    pastedChoiceCount: pasteTransaction?.paste.entries.length ?? 0,
    pasteChoices,
    undoPaste,
    keepPasteAsOne,
    addChoice,
    updateChoiceText,
    updateChoiceHtml,
    removeChoice,
    toggleChoicePin,
    setCorrectId,
    setCorrectIds,
    beginLabelEdit,
    commitLabelEdit,
    onLabelEditInput,
  };
}

export type ChoiceListState = ReturnType<typeof useChoiceList>;

/** A removal retains only the removed option and its answer-key effect, never other options' text. */
type ChoiceRemoval = {
  readonly choice: Choice;
  readonly index: number;
  readonly answerKeyVersion: number;
  readonly nextId?: string;
  readonly beforeCorrect: string[];
  readonly afterCorrect: string[];
};
function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}
