import type { CatalogValidationIssueCode } from '../catalog_metadata.ts';
import { CATALOG_WARNING_POLICIES } from './catalog_migration_warning_policies.ts';
import { LMS_MIGRATION_WARNING_POLICIES } from './lms_migration_warning_policies.ts';
import { CANVAS_MIGRATION_WARNING_POLICIES } from './canvas_migration_warning_policies.ts';
import type {
  MigrationWarningPolicy,
  MigrationWarningSeverity,
} from './migration_warning_policy.ts';

export type { MigrationWarningSeverity } from './migration_warning_policy.ts';

export type MigrationWarningCode = keyof typeof WARNING_EXPLANATIONS;

export type MigrationWarningExplanation = MigrationWarningPolicy & {
  readonly code: MigrationWarningCode;
};

export function explainMigrationWarning(
  code: MigrationWarningCode,
): MigrationWarningExplanation {
  return { code, ...WARNING_EXPLANATIONS[code] };
}

/** Parse warning data written by QFlow. Unknown stored codes are invalid application state. */
export function parseMigrationWarningCode(value: string): MigrationWarningCode {
  const normalized = normalizeWarningCode(value);
  if (value !== normalized) {
    throw new Error(`Migration warning code is not canonical: ${value}`);
  }
  if (isMigrationWarningCode(normalized)) return normalized;
  throw new Error(`Unregistered migration warning code: ${normalized}`);
}

/** Exact migration policies for diagnostics owned by catalog validation. */
export const CATALOG_MIGRATION_WARNING_CODES = {
  CATALOG_CARD_CONTENT_CONFLICT: 'CATALOG_CARD_CONTENT_CONFLICT',
  CATALOG_CARD_REQUIRED: 'CATALOG_CARD_REQUIRED',
  CATALOG_CONTENT_CHOICE: 'CATALOG_CONTENT_CHOICE',
  CATALOG_CONTENT_REQUIRED: 'CATALOG_CONTENT_REQUIRED',
  CATALOG_DEFAULT_CONFLICT: 'CATALOG_DEFAULT_CONFLICT',
  CATALOG_FILE_REQUIRED: 'CATALOG_FILE_REQUIRED',
  CATALOG_FILE_UNSAFE: 'CATALOG_FILE_UNSAFE',
  CATALOG_ID_DUPLICATE: 'CATALOG_ID_DUPLICATE',
  CATALOG_ID_INVALID: 'CATALOG_ID_INVALID',
  CATALOG_REFERENCE_MISSING: 'CATALOG_REFERENCE_MISSING',
  CATALOG_SUPPORT_DUPLICATE: 'CATALOG_SUPPORT_DUPLICATE',
  CATALOG_SUPPORT_INVALID: 'CATALOG_SUPPORT_INVALID',
  CATALOG_SUPPORT_PATH_INVALID: 'CATALOG_SUPPORT_PATH_INVALID',
  CATALOG_SUPPORT_REQUIRED: 'CATALOG_SUPPORT_REQUIRED',
  CATALOG_UNUSED: 'CATALOG_UNUSED',
  KEYWORD_TRANSLATION_LANGUAGE_REQUIRED: 'KEYWORD_TRANSLATION_LANGUAGE_REQUIRED',
  LANGUAGE_TAG_INVALID: 'LANGUAGE_TAG_INVALID',
  STYLESHEET_HREF_REQUIRED: 'STYLESHEET_HREF_REQUIRED',
  STYLESHEET_REFERENCE_UNSAFE: 'STYLESHEET_REFERENCE_UNSAFE',
} as const satisfies Readonly<Record<CatalogValidationIssueCode, MigrationWarningCode>>;

/** Preserve the exact code owned by catalog validation. */
export function migrationWarningCodeFromCatalog(
  code: CatalogValidationIssueCode,
): MigrationWarningCode {
  return CATALOG_MIGRATION_WARNING_CODES[code];
}

function isMigrationWarningCode(value: string): value is MigrationWarningCode {
  return Object.hasOwn(WARNING_EXPLANATIONS, value);
}

export function labelWarningSeverity(severity: MigrationWarningSeverity): string {
  if (severity === 'correction') return 'Correction likely';
  if (severity === 'info') return 'Information';
  return 'Review recommended';
}

function normalizeWarningCode(code: string): string {
  const normalized = String(code || 'UNKNOWN').trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_');
  return normalized || 'UNKNOWN';
}

const WARNING_EXPLANATIONS = {
  ...CANVAS_MIGRATION_WARNING_POLICIES,
  ...LMS_MIGRATION_WARNING_POLICIES,
  BANK_PART_CONTEXT_UNSUPPORTED: {
    title: 'Question depends on assessment-level context',
    severity: 'correction',
    blocksAcceptance: true,
    meaning:
      'The source includes part instructions or feedback that cannot be attached to a standalone bank question.',
    reviewAction:
      'Move the required context into each source question and import again, or use assessment intake to preserve the part structure.',
  },
  UNREGISTERED_IMPORT_DIAGNOSTIC: {
    title: 'Import diagnostic needs registration',
    severity: 'correction',
    blocksAcceptance: true,
    meaning:
      'An import dependency reported a diagnostic that QFlowLearn does not yet classify, so QFlowLearn cannot safely determine item readiness.',
    reviewAction:
      'Keep the item blocked and register the diagnostic with an explicit migration policy before accepting it.',
  },
  IMPORT_FAILED: {
    title: 'Package could not be analyzed',
    severity: 'correction',
    blocksAcceptance: false,
    meaning: 'QFlowLearn could not read the package enough to produce item-level results.',
    reviewAction:
      'Confirm that the original export is complete and uses a supported source format, then try again.',
  },
  EXTRACTION_UNCERTAINTY: {
    title: 'Source extraction needs review',
    severity: 'review',
    blocksAcceptance: false,
    meaning:
      'Source extraction recorded content or structure that could not be established exactly.',
    reviewAction:
      'Compare the normalized evidence with the original source before accepting items.',
  },
  QTI_ASSESSMENT_STRUCTURE_FLATTENED: {
    title: 'Assessment structure flattened',
    severity: 'review',
    blocksAcceptance: false,
    meaning:
      'Questions were recovered into one review section; the original assessment structure and sequencing were not migrated.',
    reviewAction:
      'Review the recovered questions and restore the required sections and delivery settings before publishing.',
  },
  UNSUPPORTED_ITEM_STUBBED: {
    title: 'Unsupported item preserved as source',
    severity: 'correction',
    blocksAcceptance: true,
    meaning:
      'The source item used behavior that cannot be mapped directly, so QFlowLearn preserved the XML and created an editable placeholder.',
    reviewAction:
      'Compare the source XML with the placeholder and rebuild the item before accepting it.',
  },
  QTI3_CHOICE_POINTS_NOT_PRESERVED: {
    title: 'Question points require source scoring review',
    severity: 'correction',
    blocksAcceptance: true,
    meaning:
      'The source maximum, declarations or scoring program cannot be reproduced by the choice authoring model. The original XML is retained.',
    reviewAction:
      'Compare the original scoring rules and rebuild the question explicitly, or retain the source in a player that supports its program.',
  },
  UNSUPPORTED_ITEM: {
    title: 'Unsupported item behavior',
    severity: 'correction',
    blocksAcceptance: false,
    meaning: 'The item contains source behavior that does not have a direct QFlowLearn mapping.',
    reviewAction:
      'Review the source XML and rebuild the interaction in QFlowLearn before accepting the item.',
  },
  QFLOW_DRAFT_VALIDATION: {
    title: 'Imported draft needs validation',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'The imported QFlowLearn draft did not fully pass item validation.',
    reviewAction:
      'Open the item preview and draft JSON, fix the listed field, then mark the item accepted or needs correction.',
  },
  IMAGE_ALT_MISSING: {
    title: 'Image alternative text missing',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'An image imported without accessible alternative text.',
    reviewAction: 'Add or verify the image description before accepting the item for delivery.',
  },
  MISSING_ALT_TEXT: {
    title: 'Image alternative text missing',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'An image or media object is missing accessible alternative text.',
    reviewAction: 'Add or verify the description before accepting the item for delivery.',
  },
  MISSING_CAPTIONS: {
    title: 'Media captions missing',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'A media item does not include captions.',
    reviewAction:
      'Add captions or document why captions are not required before accepting the item.',
  },
  MISSING_TRANSCRIPT: {
    title: 'Media transcript missing',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'A media item does not include a transcript.',
    reviewAction:
      'Add a transcript or document why a transcript is not required before accepting the item.',
  },
  MISSING_CORRECT: {
    title: 'Correct answer missing',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'The source item did not provide a clear correct response.',
    reviewAction: 'Set the correct answer or scoring rule before accepting the item.',
  },
  MISSING_ORDER: {
    title: 'Correct order missing',
    severity: 'correction',
    blocksAcceptance: false,
    meaning: 'The source order interaction did not provide a clear correct sequence.',
    reviewAction: 'Set the intended order before accepting the item.',
  },
  INCOMPLETE_MATCH: {
    title: 'Match scoring incomplete',
    severity: 'correction',
    blocksAcceptance: true,
    meaning:
      'The source matching item did not provide enough information to map every expected pair.',
    reviewAction:
      'Review the matching choices and set the expected pairs before accepting the item.',
  },
  RESPONDUS_INLINE_APPENDIX_ANSWER_CONFLICT: {
    title: 'Respondus answer sources conflict',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'Inline answer markers conflict with the terminal answer list.',
    reviewAction:
      'Correct the source answer key or set the intended correct response in the item editor before acceptance.',
  },
  RESPONDUS_SINGLE_ANSWER_MULTIPLE_KEYS: {
    title: 'Single-answer question has multiple keys',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'A Respondus single-answer question identifies more than one correct choice.',
    reviewAction:
      'Choose one intended correct response or change the question to multiple-answer before acceptance.',
  },
  INVALID_ANSWER_REFERENCE: {
    title: 'Answer key references a missing choice',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'The source answer key names a choice that the question does not contain.',
    reviewAction: 'Correct the answer key before accepting the item.',
  },
  RESPONDUS_CHOICES_INCOMPLETE: {
    title: 'Respondus answer choices incomplete',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'A Respondus choice question contains fewer than two answer choices.',
    reviewAction: 'Add the missing answer choices before accepting the item.',
  },
  RESPONDUS_DUPLICATE_CHOICE: {
    title: 'Respondus choice label repeated',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'A Respondus question repeats a choice label, so the answer key is ambiguous.',
    reviewAction: 'Give every answer choice a unique label before accepting the item.',
  },
  RESPONDUS_FEEDBACK_POSITION_INVALID: {
    title: 'Respondus feedback is out of position',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'General correct feedback appears after the answer choices.',
    reviewAction:
      'Compare the feedback with the source and place it correctly if it is required for delivery.',
  },
  RESPONDUS_MULTIPLE_ANSWER_SINGLE_KEY: {
    title: 'Multiple-answer question has one key',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'A Respondus multiple-answer question identifies only one correct choice.',
    reviewAction:
      'Confirm that one correct choice is intentional or change the question to single-answer.',
  },
  RESPONDUS_ESSAY_ANSWER_MULTIPLE: {
    title: 'Essay contains multiple model answers',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'A Respondus essay supplies more than one model answer.',
    reviewAction:
      'Choose or combine the intended model answer before using it as grading guidance.',
  },
  RESPONDUS_MATCH_ANSWER_LIST_IGNORED: {
    title: 'Matching answer list not applied',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'The matching pairs were read inline, so the terminal answer entry was not applied.',
    reviewAction:
      'Compare the recovered pairs with the terminal answer entry and confirm the pairing is correct.',
  },
  RESPONDUS_POINTS_NOT_MAPPED: {
    title: 'Respondus points need review',
    severity: 'review',
    blocksAcceptance: false,
    meaning:
      'The source declares a per-question point value that QFlowLearn does not currently map.',
    reviewAction: 'Record the intended point value in the destination LMS before delivery.',
  },
  RESPONDUS_FEEDBACK_NOT_MAPPED: {
    title: 'Respondus feedback needs review',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'The source contains feedback that is preserved as evidence but not mapped into QTI.',
    reviewAction: 'Recreate required feedback before accepting the item.',
  },
  RESPONDUS_HTML_PRESERVED_AS_TEXT: {
    title: 'Respondus HTML preserved as text',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'Respondus HTML markers remain literal text instead of rendered HTML.',
    reviewAction: 'Review the question formatting and recreate required HTML before acceptance.',
  },
  RESPONDUS_IMAGE_REQUIRES_ASSET: {
    title: 'Respondus image asset missing',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'The source references an image without an importable sidecar asset.',
    reviewAction: 'Attach the intended image and verify its alternative text before acceptance.',
  },
  RESPONDUS_ANSWERS_DUPLICATE: {
    title: 'Respondus answer list repeated',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'The Respondus source contains more than one terminal answer list.',
    reviewAction: 'Compare the answer lists and keep the intended key before accepting the item.',
  },
  RESPONDUS_ANSWER_WITHOUT_QUESTION: {
    title: 'Respondus answer has no question',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'The source contains an answer entry that cannot be attached to a question.',
    reviewAction: 'Restore the missing question or remove the orphaned answer entry.',
  },
  RESPONDUS_DIRECTIVE_INCOMPLETE: {
    title: 'Respondus directive is incomplete',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'A Respondus Type, Title, Points, or Answers directive is incomplete.',
    reviewAction: 'Complete the directive before accepting the affected item.',
  },
  RESPONDUS_DUPLICATE_QUESTION_NUMBER: {
    title: 'Respondus question number repeated',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'Two Respondus questions use the same number, so answer-key ownership is ambiguous.',
    reviewAction: 'Give every question a unique number and verify the answer list.',
  },
  RESPONDUS_INVALID_ANSWER_ENTRY: {
    title: 'Respondus answer entry is invalid',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'An entry in the Respondus answer list does not follow the supported grammar.',
    reviewAction: 'Correct the answer entry before accepting the affected item.',
  },
  RESPONDUS_INVALID_POINTS: {
    title: 'Respondus point value is invalid',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'A Respondus Points directive does not contain a usable numeric value.',
    reviewAction: 'Set the intended point value in the destination LMS.',
  },
  RESPONDUS_NO_QUESTIONS: {
    title: 'Respondus source has no questions',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'The Respondus parser did not find any complete question entries.',
    reviewAction: 'Restore the question markers and try the import again.',
  },
  RESPONDUS_TEXT_OUTSIDE_QUESTION: {
    title: 'Respondus text is outside a question',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'The source contains text that is not owned by a numbered question or directive.',
    reviewAction: 'Confirm that the unassigned text is not required by an item.',
  },
  EXAMVIEW_QUESTION_TEXT_MISSING: {
    title: 'ExamView question text missing',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'The ExamView XML question does not contain a usable question prompt.',
    reviewAction: 'Restore the question text from the source before accepting the item.',
  },
  EXAMVIEW_CHOICES_INCOMPLETE: {
    title: 'ExamView answer choices incomplete',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'The ExamView multiple-choice question contains fewer than two answer choices.',
    reviewAction: 'Restore the missing answer choices before accepting the item.',
  },
  EXAMVIEW_SINGLE_ANSWER_MULTIPLE_KEYS: {
    title: 'ExamView single-answer question has multiple keys',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'The ExamView question identifies more than one key for a single-answer interaction.',
    reviewAction: 'Choose one correct answer or rebuild the item as multiple-answer.',
  },
  EXAMVIEW_NUMERIC_ANSWER_UNSUPPORTED: {
    title: 'ExamView numeric answer needs repair',
    severity: 'correction',
    blocksAcceptance: true,
    meaning:
      'The ExamView numeric answer is not an integer or decimal that can be mapped without changing its scoring rule.',
    reviewAction: 'Rebuild the numeric scoring rule before accepting the item.',
  },
  EXAMVIEW_MEDIA_REQUIRES_REBUILD: {
    title: 'ExamView media needs an asset',
    severity: 'correction',
    blocksAcceptance: true,
    meaning:
      'The ExamView XML references media without a verified asset binding, so QFlowLearn did not guess the missing resource.',
    reviewAction:
      'Attach the source media, add accessibility text, and verify the item before acceptance.',
  },
  EXAMVIEW_DYNAMIC_CONTENT_UNSUPPORTED: {
    title: 'ExamView dynamic content needs rebuilding',
    severity: 'correction',
    blocksAcceptance: true,
    meaning:
      'The ExamView item uses dynamic content that the published XML 4 interchange grammar cannot preserve.',
    reviewAction: 'Rebuild the intended item and scoring behavior before acceptance.',
  },
  EXAMVIEW_FORMATTING_FLATTENED: {
    title: 'ExamView text formatting flattened',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'The visible text was preserved, but ExamView-specific text formatting was flattened.',
    reviewAction:
      'Compare the imported item with the source and restore formatting that carries meaning.',
  },
  EXAMVIEW_RATIONALE_NOT_MAPPED: {
    title: 'ExamView rationale preserved as evidence',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'The source rationale remains in review evidence but is not mapped into the QTI item.',
    reviewAction:
      'Add the rationale as feedback or grading guidance if learners or reviewers need it.',
  },
  EXAMVIEW_METADATA_NOT_MAPPED: {
    title: 'ExamView metadata needs review',
    severity: 'review',
    blocksAcceptance: false,
    meaning:
      'ExamView-specific metadata or response-layout guidance remains in source evidence but is not mapped into the QFlowLearn item.',
    reviewAction:
      'Restore any topic, standard, difficulty, reference, or response-space setting you need.',
  },
  EXAMVIEW_DOCUMENT_PRESENTATION_NOT_MAPPED: {
    title: 'ExamView document settings need review',
    severity: 'review',
    blocksAcceptance: false,
    meaning:
      'ExamView instructions or document presentation settings remain in source evidence but are not mapped into QTI items.',
    reviewAction:
      'Review the source evidence and restore any instructions or presentation settings required for delivery.',
  },
  EXAMVIEW_UNRECOGNIZED_CONTENT: {
    title: 'ExamView content is not recognized',
    severity: 'correction',
    blocksAcceptance: true,
    meaning:
      'An ExamView item contains an XML element whose assessment meaning is not classified by this importer.',
    reviewAction:
      'Compare the item with the source XML, rebuild the missing behavior, and register the element before accepting it.',
  },
  BLACKBOARD_EMPTY_ANSWERS: {
    title: 'Blackboard answers are empty',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'The Blackboard source contains an answer section without usable answers.',
    reviewAction: 'Restore the answers and scoring rule before accepting the item.',
  },
  BLACKBOARD_MATCH_INCOMPLETE: {
    title: 'Blackboard matching item is incomplete',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'The Blackboard source does not define every required matching pair.',
    reviewAction: 'Restore the missing choices or pairs before accepting the item.',
  },
  BLACKBOARD_MISSING_QUESTION: {
    title: 'Blackboard question text is missing',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'The Blackboard source does not contain usable question text.',
    reviewAction: 'Restore the question text before accepting the item.',
  },
  BLACKBOARD_NO_CHOICES: {
    title: 'Blackboard choices are missing',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'The Blackboard choice question does not contain usable answer choices.',
    reviewAction: 'Restore the answer choices before accepting the item.',
  },
  BLACKBOARD_NO_TEXT_ENTRY_ANSWERS: {
    title: 'Blackboard text answers are missing',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'The Blackboard text-entry question does not provide an accepted answer.',
    reviewAction: 'Set at least one accepted answer before accepting the item.',
  },
  BLACKBOARD_UNSUPPORTED_TYPE: {
    title: 'Blackboard question type is unsupported',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'The Blackboard source uses a question type that QFlowLearn cannot map safely.',
    reviewAction: 'Rebuild the question in a supported interaction before accepting it.',
  },
  GIFT_CLOZE_MIXED: {
    title: 'GIFT cloze interactions are mixed',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'The GIFT item combines cloze interaction types in one question.',
    reviewAction: 'Confirm that the imported learner task still matches the source.',
  },
  GIFT_FEEDBACK_IGNORED: {
    title: 'GIFT feedback is not mapped',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'GIFT answer feedback remains in the source but is not mapped into the item.',
    reviewAction: 'Recreate any feedback learners need before delivery.',
  },
  GIFT_NO_ANSWER: {
    title: 'GIFT answer is missing',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'The GIFT question does not contain a usable answer definition.',
    reviewAction: 'Add the intended answer or scoring rule before accepting the item.',
  },
  GIFT_PARTIAL_IGNORED: {
    title: 'GIFT partial credit is not mapped',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'The GIFT source defines partial credit that is not mapped into QFlowLearn.',
    reviewAction: 'Recreate the partial-credit rule if it is required for scoring.',
  },
  CLOZE_EMPTY: {
    title: 'Moodle cloze answer is empty',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'A Moodle cloze interaction does not contain a usable answer.',
    reviewAction: 'Restore the cloze answer before accepting the item.',
  },
  CLOZE_MIXED: {
    title: 'Moodle cloze interactions are mixed',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'A Moodle question combines cloze interaction types.',
    reviewAction: 'Confirm that the imported learner task still matches the source.',
  },
  CLOZE_MULTI_RESPONSE: {
    title: 'Moodle cloze response is ambiguous',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'A Moodle cloze segment defines multiple response rules that cannot be mapped safely.',
    reviewAction: 'Split or rebuild the response rule before accepting the item.',
  },
  CLOZE_TYPE_UNKNOWN: {
    title: 'Moodle cloze type is unknown',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'A Moodle cloze segment uses an interaction type that QFlowLearn does not recognize.',
    reviewAction: 'Rebuild the cloze segment with a supported interaction.',
  },
  DDWTOS_NO_CORRECT: {
    title: 'Moodle drag-word answer is missing',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'The Moodle drag-words question does not define every correct placement.',
    reviewAction: 'Set the correct placements before accepting the item.',
  },
  UNSUPPORTED_MOODLE_TYPE: {
    title: 'Moodle question type is unsupported',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'The Moodle source uses a question type that QFlowLearn cannot map safely.',
    reviewAction: 'Rebuild the question in a supported interaction before accepting it.',
  },
  MIXED_INTERACTIONS: {
    title: 'Multiple interaction patterns detected',
    severity: 'review',
    blocksAcceptance: false,
    meaning:
      'The source item combined interaction patterns that may need author review after import.',
    reviewAction:
      'Compare the source item with the imported preview and confirm the learner task still matches the original.',
  },
  IMSCC_RESOURCE_MISSING: {
    title: 'Referenced resource missing',
    severity: 'correction',
    blocksAcceptance: false,
    meaning: 'The package referenced a file that was not found in the upload.',
    reviewAction:
      'Re-export the source package with all referenced files or replace the missing resource after import.',
  },
  IMSCC_RESOURCE_UNSUPPORTED: {
    title: 'Unsupported package resource',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'The package included a resource type that QFlowLearn does not import directly.',
    reviewAction:
      'Check whether the unsupported resource affects item delivery, then rebuild or document it.',
  },
  IMSCC_ASSET_COLLISION: {
    title: 'Package asset paths collide',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'Two package assets resolve to the same destination path.',
    reviewAction:
      'Rename the conflicting assets and update their references before accepting items.',
  },
  IMSCC_PARSE_FAILED: {
    title: 'Package resource could not be parsed',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'A package assessment resource could not be read safely.',
    reviewAction: 'Repair or re-export the resource before accepting affected items.',
  },
  IMSCC_UNRECOGNIZED_ASSESSMENT: {
    title: 'Package assessment is unrecognized',
    severity: 'correction',
    blocksAcceptance: true,
    meaning:
      'A package resource appears to be an assessment but does not match a supported grammar.',
    reviewAction: 'Re-export the assessment in a supported package format.',
  },
  MISSING_MAX_CHOICES_REPAIRED: {
    title: 'Maximum choices repaired',
    severity: 'info',
    blocksAcceptance: false,
    meaning: 'QFlowLearn restored a missing maximum-choice constraint from the item structure.',
    reviewAction: 'Confirm the repaired selection limit in the preview.',
  },
  MISSING_ALT_REPAIRED: {
    title: 'Image alternative text repaired',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'QFlowLearn inserted replacement alternative text for an image that lacked it.',
    reviewAction: 'Replace the generated description with accurate author-provided text.',
  },
  MISSING_CORRECT_REPAIRED: {
    title: 'Correct response repaired',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'QFlowLearn repaired a missing correct-response declaration from other item evidence.',
    reviewAction: 'Confirm the repaired answer before accepting the item.',
  },
  QTI_MIGRATION_WRITER_REJECTED: {
    title: 'Migrated question could not be written',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'The converted question does not meet the QTI 3 authoring requirements.',
    reviewAction:
      'Review the original question and rebuild the unsupported content before accepting it.',
  },
  QTI12_COMPOSITE_RESPONSES_UNSUPPORTED: {
    title: 'QTI 1.2 question has unsupported response interactions',
    severity: 'correction',
    blocksAcceptance: true,
    meaning:
      'The original question combines response interactions whose scoring cannot be preserved.',
    reviewAction:
      'Rebuild and verify each response interaction against the original question before accepting it.',
  },
  QTI12_MATERIAL_NOT_PRESERVED: {
    title: 'QTI 1.2 question content cannot be preserved',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'The source includes question content that the converter cannot preserve.',
    reviewAction: 'Rebuild the missing content from the original question before accepting it.',
  },
  QTI12_RESPONSE_PROCESSING_UNSUPPORTED: {
    title: 'QTI 1.2 scoring needs manual migration',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'The original scoring rules cannot be preserved in the authoring model.',
    reviewAction:
      'Rebuild and verify the scoring against the original question before accepting it.',
  },
  QTI2_RESPONSE_PROCESSING_NOT_PRESERVED: {
    title: 'QTI 2 scoring cannot be preserved',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'Migration would change the original response-processing rules.',
    reviewAction:
      'Rebuild and verify the scoring against the original question before accepting it.',
  },
  QTI2_OUTCOMES_NOT_PRESERVED: {
    title: 'QTI 2 outcomes cannot be preserved',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'Migration would change the original outcome declarations or their defaults.',
    reviewAction: 'Review the original outcomes and rebuild the question before accepting it.',
  },
  QTI12_ASSOCIATE_CORRECT_RESPONSE_MISSING_REPAIRED: {
    title: 'QTI 1.2 association answer repaired',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'QFlowLearn recovered missing QTI 1.2 association scoring from response conditions.',
    reviewAction: 'Confirm every recovered association in the item preview.',
  },
  QTI12_CHOICE_CORRECT_RESPONSE_MISSING_REPAIRED: {
    title: 'QTI 1.2 choice answer repaired',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'QFlowLearn recovered a missing QTI 1.2 choice answer from response conditions.',
    reviewAction: 'Confirm the recovered correct choice in the item preview.',
  },
  QTI2_CHOICE_CORRECT_RESPONSE_MISSING_REPAIRED: {
    title: 'QTI 2 choice answer repaired',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'QFlowLearn recovered a missing QTI 2 choice answer from response processing.',
    reviewAction: 'Confirm the recovered correct choice in the item preview.',
  },
  QTI_PACKAGE_ITEM_REFERENCE_DUPLICATE: {
    title: 'QTI package item reference repeated',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'The package references the same assessment item more than once.',
    reviewAction:
      'Confirm whether the repeated placement is intentional before accepting the assessment.',
  },
  QTI_METADATA_EXTERNAL_REFERENCE: {
    title: 'QTI metadata uses an external file',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'Imported QTI metadata references a file outside the package.',
    reviewAction: 'Confirm that the external file will remain available in the destination.',
  },
  QTI_METADATA_FILE_MISSING: {
    title: 'QTI metadata file is missing',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'Imported QTI metadata references a file that is not present in the package.',
    reviewAction: 'Restore the file or remove its reference before accepting the item.',
  },
  ...CATALOG_WARNING_POLICIES,
  INVALID_DATA_SSML: {
    title: 'Invalid SSML markup',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'An accessibility speech annotation could not be read as valid SSML.',
    reviewAction:
      'Review the affected text and correct the speech annotation if it is needed for delivery.',
  },
  UNSUPPORTED_A11Y_MARKUP: {
    title: 'Unsupported accessibility markup',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'Some accessibility markup was not supported during import.',
    reviewAction:
      'Verify the accessible presentation in the preview and restore any required support metadata.',
  },
} as const satisfies Readonly<Record<string, MigrationWarningPolicy>>;
