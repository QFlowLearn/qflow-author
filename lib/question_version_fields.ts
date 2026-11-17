/** Author-facing section that owns one changed revision field. */
export type QuestionVersionFieldCategory =
  | 'content'
  | 'answer_and_scoring'
  | 'standards_and_accessibility'
  | 'details';

/** Arrays are sequences unless this field explicitly declares a stable member key. */
export type RevisionFieldSchema = {
  readonly derivedFields?: readonly string[];
  readonly category?: QuestionVersionFieldCategory;
  readonly label?: string;
  readonly identity?: 'id' | 'identifier' | 'responseIdentifier';
  readonly fields?: Readonly<Record<string, RevisionFieldSchema>>;
};

const accessibility: RevisionFieldSchema = { category: 'standards_and_accessibility' };
const attributes: RevisionFieldSchema = {
  fields: { alt: accessibility, 'aria-label': accessibility, longdesc: accessibility },
};
const choice: RevisionFieldSchema = {
  identity: 'identifier',
  derivedFields: ['text'],
  label: 'choices',
  fields: { attributes, asset: { fields: { attributes, alt: accessibility } } },
};
const declarations: RevisionFieldSchema = {
  identity: 'identifier',
  category: 'answer_and_scoring',
  label: 'scoring',
  fields: { correctResponse: { label: 'correctAnswer' } },
};

/** One schema owns comparison categories, display labels and identified-array invariants. */
export const REVISION_DOCUMENT_SCHEMA: RevisionFieldSchema = {
  fields: {
    title: { category: 'details', label: 'title' },
    tags: { category: 'details' },
    note: { category: 'details' },
    standards: { ...accessibility, label: 'standards' },
    standardAlignments: { ...accessibility, label: 'standards' },
    importWarnings: { category: 'details' },
    qti: {
      derivedFields: ['bodyText'],
      fields: {
        language: { label: 'language' },
        attributes,
        body: { label: 'body' },
        responseDeclarations: declarations,
        outcomeDeclarations: declarations,
        templateDeclarations: declarations,
        responseProcessing: { category: 'answer_and_scoring', label: 'scoring' },
        modalFeedback: { category: 'answer_and_scoring' },
        catalogInfo: { ...accessibility, fields: { catalogs: { identity: 'id' } } },
        catalogReferences: accessibility,
        interactions: {
          identity: 'responseIdentifier',
          derivedFields: ['text', 'prompt'],
          label: 'interaction',
          fields: {
            prompt: { label: 'prompt' },
            promptContent: { label: 'prompt' },
            choices: choice,
            attributes,
            object: { fields: { attributes } },
          },
        },
      },
    },
  },
};
