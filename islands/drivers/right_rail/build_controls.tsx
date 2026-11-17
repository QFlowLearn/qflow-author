import type { QuestionTypeId, TypeDriver } from '../../../lib/types/registry.ts';
import type { RightRailControls, RightRailSection } from './types.ts';
import {
  ExtendedTextSection,
  GapMatchSection,
  GraphicGapMatchSection,
  ItemLanguageSection,
  MatchSection,
  MediaSection,
  MultiSelectSection,
  OrderSection,
  PortableCustomSection,
  ScoringSection,
  SharedVocabularySection,
  ShuffleSection,
  SingleSelectSection,
  SliderSection,
  TextEntrySection,
  UploadSection,
} from './sections.tsx';
import {
  buildSharedVocabularyControls,
  createSharedVocabularyUpdater,
  hasSharedVocabularyControls,
} from '../shared_vocabulary_controls.ts';
import { type RailDraft } from './rail_draft.ts';
import { associationControls } from './concerns/associations.ts';
import { coreControls, textEntryControls } from './concerns/core.ts';
import type { RailBuildContext } from './concerns/context.ts';
import type { ItemLanguageMessages } from './types.ts';
import { extendedTextControls } from './concerns/extended_text.ts';
import { selectionControls } from './concerns/selection_limits.ts';
import { shuffleControls } from './concerns/shuffle.ts';
import {
  mediaControls,
  portableControls,
  sliderControls,
  uploadControls,
} from './concerns/type_specific.ts';

export { createRailDraft, type RailDraft } from './rail_draft.ts';
export {
  applyPersistedSettingsChange,
  applySettingsChange,
  settingsFromRailDraft,
} from './settings_rail.ts';

export function buildRightRailControls(
  typeId: QuestionTypeId,
  caps: TypeDriver['capabilities'] | undefined,
  draft: RailDraft,
  update: (draft: RailDraft) => void,
  opts: {
    scoringTemplates?: TypeDriver['scoringTemplates'];
    itemLanguageMessages: ItemLanguageMessages;
    t: RailBuildContext['t'];
    fieldIssueText?: RailBuildContext['fieldIssueText'];
  },
): RightRailControls {
  let currentDraft = draft;
  const setDraft = (patch: Partial<RailDraft>) => {
    currentDraft = { ...currentDraft, ...patch };
    update(currentDraft);
  };
  const ctx: RailBuildContext = {
    typeId,
    draft,
    getDraft: () => currentDraft,
    setDraft,
    caps,
    scoringTemplates: opts?.scoringTemplates,
    itemLanguageMessages: opts.itemLanguageMessages,
    t: opts.t,
    fieldIssueText: opts.fieldIssueText,
  };
  const setSharedVocabulary = createSharedVocabularyUpdater(
    () => currentDraft.sharedVocabulary,
    (next) => setDraft({ sharedVocabulary: next }),
  );
  const sharedVocabularyControls = buildSharedVocabularyControls(
    typeId,
    draft.sharedVocabulary,
    setSharedVocabulary,
    opts.t,
  );

  const isMatch = typeId === 'match' || typeId === 'associate' || typeId === 'graphic_associate';
  const isOrder = typeId === 'order';
  const isGapMatch = typeId === 'gap_match';
  const isGraphicGapMatch = typeId === 'graphic_gap_match';
  const isTextEntry = typeId === 'text_entry';
  const isExtendedText = typeId === 'extended_text';
  const isUpload = typeId === 'upload';
  const isMedia = typeId === 'media';
  const isPortableCustom = typeId === 'portable_custom';
  const isSlider = typeId === 'slider';
  const supportsMinMax = Boolean(caps?.minMaxChoices);

  const controls: RightRailControls = {
    sections: [],
    ...coreControls(ctx),
    ...selectionControls(ctx),
    ...associationControls(ctx),
    ...shuffleControls(ctx),
    ...textEntryControls(ctx),
    ...extendedTextControls(ctx),
    ...uploadControls(ctx),
    ...mediaControls(ctx),
    ...portableControls(ctx),
    ...sliderControls(ctx),
    ...sharedVocabularyControls,
  };

  const sections: RightRailSection[] = [];
  sections.push({
    id: 'item_language',
    group: 'accessibility',
    content: <ItemLanguageSection controls={controls} />,
  });
  if (controls.shuffle) {
    sections.push({
      id: 'shuffle',
      group: 'answer',
      content: <ShuffleSection controls={controls} />,
    });
  }
  if (controls.required || controls.answerMasking) {
    sections.push({
      id: 'single_select',
      group: 'answer',
      content: <SingleSelectSection controls={controls} />,
    });
  }
  if (supportsMinMax && !isOrder) {
    sections.push({
      id: 'selection',
      group: 'answer',
      content: <MultiSelectSection controls={controls} />,
    });
  }
  if (isOrder) {
    sections.push({ id: 'order', group: 'answer', content: <OrderSection controls={controls} /> });
  }
  if (isSlider) {
    sections.push({
      id: 'slider',
      group: 'answer',
      content: <SliderSection controls={controls} />,
    });
  }
  if (isMatch) {
    sections.push({ id: 'match', group: 'answer', content: <MatchSection controls={controls} /> });
  }
  if (isGapMatch) {
    sections.push({
      id: 'gap_match',
      group: 'answer',
      content: <GapMatchSection controls={controls} />,
    });
  }
  if (isGraphicGapMatch) {
    sections.push({
      id: 'graphic_gap_match',
      group: 'answer',
      content: <GraphicGapMatchSection controls={controls} />,
    });
  }
  if (hasSharedVocabularyControls(controls)) {
    sections.push({
      id: 'shared_vocabulary',
      group: 'details',
      content: <SharedVocabularySection controls={controls} />,
    });
  }
  if (isTextEntry) {
    sections.push({
      id: 'text_entry',
      group: 'answer',
      content: <TextEntrySection controls={controls} />,
    });
  }
  if (isExtendedText) {
    sections.push({
      id: 'extended_text',
      group: 'answer',
      content: <ExtendedTextSection controls={controls} />,
    });
  }
  if (isUpload) {
    sections.push({
      id: 'upload',
      group: 'answer',
      content: <UploadSection controls={controls} />,
    });
  }
  if (isMedia) {
    sections.push({ id: 'media', group: 'answer', content: <MediaSection controls={controls} /> });
  }
  if (isPortableCustom) {
    sections.push({
      id: 'portable_custom',
      group: 'answer',
      content: <PortableCustomSection controls={controls} />,
    });
  }
  if (controls.responseMode) {
    sections.push({
      id: 'scoring',
      group: 'scoring',
      content: <ScoringSection controls={controls} />,
    });
  }

  return { ...controls, sections };
}
