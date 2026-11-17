import type { QuestionPointEditingAuthority } from '../../lib/question_point_authority.ts';
import type { QuestionStructure } from '../../lib/authoring/question_text.ts';
import type {
  AuthoringPreference,
  AuthoringSettingsPatch,
} from '../../lib/authoring_preferences.ts';
import type { ComponentChildren } from 'preact';
import type { QuestionTypeId } from '../../lib/types/registry.ts';
import type { Draft } from '../../lib/types/draft.ts';
import type { AssessmentBlueprint } from '../../lib/assessment_blueprint.ts';
import type { QuestionReviewSuggestion } from '../../lib/question_review_types.ts';
import type { DraftSessionId } from '../../lib/draft_session_id.ts';
import type { DriverSettingsUpdate } from '../drivers/right_rail/settings_contract.ts';
import type { QflowPlayerMessageCatalog } from '../../lib/i18n/player_messages/types.ts';
import type { I18nPayload } from '../../lib/i18n/payload.ts';

/** Canonical question content plus assessment-local placement intent submitted on save. */
export type ItemEditorSaveCommand = {
  readonly draft: Draft;
  readonly rememberedSettings?: AuthoringSettingsPatch;
  readonly blueprintTargetId?: string;
};

export type ItemEditorPublishResult = {
  readonly itemId: string;
  readonly rev: number;
  readonly identifier: string;
};

/** The editor's one explicit persistence owner. Invalid mixed modes are not representable. */
export type ItemEditorPersistence =
  | { readonly _tag: 'Bank'; readonly draftSessionId: DraftSessionId }
  | {
    readonly _tag: 'Assessment';
    readonly save: (command: ItemEditorSaveCommand) => Promise<ItemEditorPublishResult>;
  }
  | {
    readonly _tag: 'Revision';
    readonly draftSessionId: DraftSessionId;
    readonly sourceRevisionId: string;
    readonly returnHref: string;
  };

export type ItemEditorProps = {
  pointEditingAuthority: QuestionPointEditingAuthority;
  persistence: ItemEditorPersistence;
  /** User preference loaded by the authenticated page route. */
  choiceRichText: boolean;
  playerCatalog: QflowPlayerMessageCatalog;
  payload: I18nPayload;
  initialType?: QuestionTypeId;
  textAssistance?: {
    readonly onPrepared: (draft: Draft) => void;
    readonly assessmentId: string;
    readonly recent: readonly QuestionStructure[];
    readonly preferences: readonly AuthoringPreference[];
  };
  onPublish?: (
    r: { itemId: string; rev: number; identifier: string },
  ) => void | Promise<void>;
  onDraftChange?: (draft: Draft) => void;
  presetSettings?: DriverSettingsUpdate;
  onSettingsChange?: (update: DriverSettingsUpdate) => void;
  showPreviewOnly?: boolean;
  focusQuestionText?: boolean;
  initialDraft?: Draft;
  itemId?: string;
  tagsCsv?: string;
  blueprint?: AssessmentBlueprint;
  initialBlueprintTargetId?: string;
  aiReviewSuggestions?: readonly QuestionReviewSuggestion[];
  /** Whether non-blocking question review runs. Defaults to true. */
  advisoryReviewEnabled?: boolean;
  /** Prevent saving while the assessment owner resets its authoring defaults. */
  authoringSettingsResetting?: boolean;
  onBlueprintTargetChange?: (targetId: string) => Promise<void>;
  children?: ComponentChildren;
};
