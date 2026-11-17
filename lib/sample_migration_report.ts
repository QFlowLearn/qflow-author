import type { MigrationRunRecord } from './import/migration_types.ts';
import { UNSPECIFIED_ASSESSMENT_BLUEPRINT } from './assessment_blueprint.ts';

const CREATED_AT = '2026-04-23T15:00:00.000Z';
const REVIEWED_AT = '2026-04-23T15:38:00.000Z';

export const SAMPLE_QTI_MIGRATION_RUN: MigrationRunRecord = {
  organizationGroups: [],
  id: 'sample-qti-migration',
  batchId: 'sample-qti-migration-batch',
  batchPosition: 1,
  purpose: 'recover_existing',
  createdBy: 'sample-user',
  creatorEmail: 'reviewer@example.edu',
  creatorName: 'Sample Reviewer',
  sourceFilename: 'district-algebra-qti12-export.zip',
  sourceMime: 'application/zip',
  sourceSize: 4_872_192,
  adapter: {
    id: 'qti12',
    label: 'QTI 1.2/1.2.1',
    version: '1',
  },
  execution: {
    _tag: 'Analyzed',
    attempts: 1,
    maxAttempts: 3,
    completedAt: '2026-04-23T15:42:00.000Z',
  },
  approval: { _tag: 'Draft' },
  destination: { _tag: 'Assessment', blueprint: UNSPECIFIED_ASSESSMENT_BLUEPRINT },
  summary: {
    title: 'District Algebra Benchmark',
    counts: {
      parts: 2,
      items: 5,
      assets: 3,
      warnings: 4,
      ready: 1,
      reviewNeeded: 3,
      blocked: 1,
    },
    warningCounts: {
      IMAGE_ALT_MISSING: 1,
      MISSING_TRANSCRIPT: 1,
      INCOMPLETE_MATCH: 1,
      UNSUPPORTED_ITEM_STUBBED: 1,
    },
    itemTypeCounts: {
      single_select: 2,
      multi_select: 1,
      match: 1,
      unsupported: 1,
    },
    sniff: {
      confidence: 0.96,
      reason: 'imsmanifest.xml declared QTI 1.2 assessment resources',
    },
  },
  createdAt: CREATED_AT,
  updatedAt: '2026-04-23T15:42:00.000Z',
  parts: [
    { id: 'part-algebra-foundations', title: 'Algebra Foundations', itemCount: 3 },
    { id: 'part-modeling', title: 'Modeling And Reasoning', itemCount: 2 },
  ],
  reviewProgress: {
    total: 5,
    accepted: 1,
    pending: 2,
    rejected: 2,
  },
  items: [
    {
      id: 'linear-equations-clean',
      runId: 'sample-qti-migration',
      sourceHref: 'items/ALG-001.xml',
      sourceIdentifier: 'ALG_001',
      title: 'Solve A Linear Equation',
      itemType: 'single_select',
      itemTypeLabel: 'Single Select',
      position: 1,
      readiness: 'ready',
      warnings: [],
      sourceXml: `<?xml version="1.0" encoding="UTF-8"?>
<item ident="ALG_001" title="Solve A Linear Equation">
  <presentation>
    <material>
      <mattext texttype="text/html"><![CDATA[<p>Solve: 3x + 7 = 22</p>]]></mattext>
    </material>
    <response_lid ident="RESPONSE" rcardinality="Single">
      <render_choice>
        <response_label ident="A"><material><mattext>3</mattext></material></response_label>
        <response_label ident="B"><material><mattext>5</mattext></material></response_label>
        <response_label ident="C"><material><mattext>7</mattext></material></response_label>
      </render_choice>
    </response_lid>
  </presentation>
  <resprocessing>
    <respcondition>
      <conditionvar><varequal respident="RESPONSE">B</varequal></conditionvar>
      <setvar varname="SCORE" action="Set">1</setvar>
    </respcondition>
  </resprocessing>
</item>`,
      importedDraft: {
        type: 'single_select',
        title: 'Solve A Linear Equation',
        bodyHtml: '<p>Solve: 3x + 7 = 22</p>',
        promptHtml: 'Choose the correct value of x.',
        choices: [
          { id: 'A', text: '3' },
          { id: 'B', text: '5' },
          { id: 'C', text: '7' },
        ],
        correctId: 'B',
        required: true,
      },
      createdQuestionId: null,
      createdRevision: null,
      decision: 'accepted',
      reviewNote:
        'Text, choices, correct response, and scoring intent match the source item. Ready to commit.',
      reviewedBy: 'sample-user',
      reviewedAt: REVIEWED_AT,
      createdAt: CREATED_AT,
    },
    {
      id: 'graph-image-alt',
      runId: 'sample-qti-migration',
      sourceHref: 'items/ALG-014.xml',
      sourceIdentifier: 'ALG_014',
      title: 'Interpret A Line Graph',
      itemType: 'single_select',
      itemTypeLabel: 'Single Select',
      position: 2,
      readiness: 'minor_review',
      warnings: [{
        code: 'IMAGE_ALT_MISSING',
        message: 'images/line-graph.png imported without alternative text.',
      }],
      sourceXml: `<?xml version="1.0" encoding="UTF-8"?>
<item ident="ALG_014" title="Interpret A Line Graph">
  <presentation>
    <material>
      <matimage uri="images/line-graph.png"/>
      <mattext texttype="text/html"><![CDATA[<p>Which statement matches the graph?</p>]]></mattext>
    </material>
    <response_lid ident="RESPONSE" rcardinality="Single">
      <render_choice>
        <response_label ident="A"><material><mattext>The line increases.</mattext></material></response_label>
        <response_label ident="B"><material><mattext>The line decreases.</mattext></material></response_label>
      </render_choice>
    </response_lid>
  </presentation>
</item>`,
      importedDraft: {
        type: 'single_select',
        title: 'Interpret A Line Graph',
        bodyHtml:
          '<p><img src="/sample-assets/line-graph.svg" alt=""> Which statement matches the graph?</p>',
        promptHtml: 'Choose the best description.',
        choices: [
          { id: 'A', text: 'The line increases from left to right.' },
          { id: 'B', text: 'The line decreases from left to right.' },
          { id: 'C', text: 'The line is horizontal.' },
        ],
        correctId: 'A',
        required: true,
      },
      createdQuestionId: null,
      createdRevision: null,
      decision: 'rejected',
      reviewNote:
        'Add meaningful alt text that describes the graph trend before accepting this item.',
      reviewedBy: 'sample-user',
      reviewedAt: '2026-04-23T15:39:00.000Z',
      createdAt: CREATED_AT,
    },
    {
      id: 'modeling-audio',
      runId: 'sample-qti-migration',
      sourceHref: 'items/ALG-022.xml',
      sourceIdentifier: 'ALG_022',
      title: 'Audio Modeling Scenario',
      itemType: 'multi_select',
      itemTypeLabel: 'Multi Select',
      position: 3,
      readiness: 'minor_review',
      warnings: [{
        code: 'MISSING_TRANSCRIPT',
        message: 'audio/modeling-scenario.mp3 was imported without a transcript reference.',
      }],
      sourceXml: `<?xml version="1.0" encoding="UTF-8"?>
<item ident="ALG_022" title="Audio Modeling Scenario">
  <presentation>
    <material><matapplication uri="audio/modeling-scenario.mp3"/></material>
    <material><mattext>Select the two equations described in the audio.</mattext></material>
  </presentation>
</item>`,
      importedDraft: {
        type: 'multi_select',
        title: 'Audio Modeling Scenario',
        bodyHtml:
          '<p>Listen to the scenario and select the two equations that match the relationship.</p>',
        promptHtml: 'Select two equations.',
        choices: [
          { id: 'A', text: 'y = 2x + 4' },
          { id: 'B', text: 'y = 4x + 2' },
          { id: 'C', text: '2y = x + 4' },
          { id: 'D', text: 'y - 4 = 2x' },
        ],
        correctIds: ['A', 'D'],
        minChoices: 2,
        maxChoices: 2,
      },
      createdQuestionId: null,
      createdRevision: null,
      decision: 'pending',
      reviewNote: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: CREATED_AT,
    },
    {
      id: 'matching-pairs',
      runId: 'sample-qti-migration',
      sourceHref: 'items/ALG-031.xml',
      sourceIdentifier: 'ALG_031',
      title: 'Match Slopes To Graphs',
      itemType: 'single_select',
      itemTypeLabel: 'Single Select',
      position: 4,
      readiness: 'major_review',
      warnings: [{
        code: 'INCOMPLETE_MATCH',
        message: 'One source matching pair was missing a mapped target identifier.',
      }],
      sourceXml: `<?xml version="1.0" encoding="UTF-8"?>
<item ident="ALG_031" title="Match Slopes To Graphs">
  <presentation>
    <response_grp ident="RESPONSE">
      <render_choice shuffle="No">
        <response_label ident="SLOPE_POS"><material><mattext>Positive slope</mattext></material></response_label>
        <response_label ident="SLOPE_NEG"><material><mattext>Negative slope</mattext></material></response_label>
      </render_choice>
    </response_grp>
  </presentation>
  <resprocessing>
    <respcondition>
      <conditionvar><varequal respident="SLOPE_POS">GRAPH_A</varequal></conditionvar>
    </respcondition>
  </resprocessing>
</item>`,
      importedDraft: {
        type: 'single_select',
        title: 'Match Slopes To Graphs',
        bodyHtml:
          '<p>The source matching item imported with one incomplete pair. Review the original XML before accepting.</p>',
        promptHtml: 'Which graph has positive slope?',
        choices: [
          { id: 'GRAPH_A', text: 'Graph A' },
          { id: 'GRAPH_B', text: 'Graph B' },
        ],
        correctId: 'GRAPH_A',
        required: true,
      },
      createdQuestionId: null,
      createdRevision: null,
      decision: 'rejected',
      reviewNote:
        'Confirm whether the missing target should be Graph B, then rebuild as a full matching item.',
      reviewedBy: 'sample-user',
      reviewedAt: '2026-04-23T15:41:00.000Z',
      createdAt: CREATED_AT,
    },
    {
      id: 'proprietary-widget',
      runId: 'sample-qti-migration',
      sourceHref: 'items/ALG-044.xml',
      sourceIdentifier: 'ALG_044',
      title: 'Vendor Graphing Widget',
      itemType: 'single_select',
      itemTypeLabel: 'Compatibility Stub',
      position: 5,
      readiness: 'blocked',
      warnings: [{
        code: 'UNSUPPORTED_ITEM_STUBBED',
        message:
          'The source item used a proprietary graphing interaction that cannot be mapped directly.',
      }],
      sourceXml: `<?xml version="1.0" encoding="UTF-8"?>
<item ident="ALG_044" title="Vendor Graphing Widget">
  <presentation>
    <material><mattext>Plot the line and submit the graph.</mattext></material>
    <qticomment>vendor:graphTool interaction data preserved in extension metadata</qticomment>
  </presentation>
  <itemmetadata>
    <qtimetadata>
      <qtimetadatafield>
        <fieldlabel>vendorInteraction</fieldlabel>
        <fieldentry>acme-graph-tool-v4</fieldentry>
      </qtimetadatafield>
    </qtimetadata>
  </itemmetadata>
</item>`,
      importedDraft: {
        type: 'single_select',
        title: 'Vendor Graphing Widget',
        bodyHtml:
          '<p>This item uses an unsupported proprietary graphing interaction. Original QTI XML is preserved for rebuild.</p>',
        promptHtml: 'Compatibility stub created for reviewer correction.',
        choices: [
          { id: 'A', text: 'Rebuild required before delivery' },
          { id: 'B', text: 'Accept placeholder intentionally' },
        ],
        correctId: 'A',
        required: true,
      },
      createdQuestionId: null,
      createdRevision: null,
      decision: 'pending',
      reviewNote: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: CREATED_AT,
    },
  ].map((item, index) => {
    const evidence = [{
      kind: 'package_entry' as const,
      artifactId: 'sample-normalized',
      artifactHash: 'sample-normalized-hash',
      path: item.sourceHref,
      identifier: item.sourceIdentifier,
    }];
    const extractionUncertainties = index === 1
      ? [{
        code: 'IMAGE_ALT_MISSING' as const,
        message: 'An imported image is missing alternative text.',
        blockId: 'package-entry-2',
      }]
      : [];
    const contentHash = `sample-content-${item.id}`;
    const contextHash = `sample-context-${item.id}`;
    const actor = {
      id: 'sample-user',
      displayName: 'Sample Reviewer',
      email: 'reviewer@example.edu',
    };
    return {
      ...item,
      evidence,
      extractionUncertainties,
      contentHash,
      contextHash,
      acceptedSnapshot: item.decision === 'accepted'
        ? {
          version: 1,
          contentHash,
          contextHash,
          origin: {
            _tag: 'Imported',
            artifact: {
              id: 'sample-original',
              filename: 'district-algebra-qti12-export.zip',
              mimeType: 'application/zip',
              size: 4_872_192,
              sha256: 'sample-original-hash',
            },
            migrationRunId: 'sample-qti-migration',
            migrationItemId: item.id,
            href: item.sourceHref,
            identifier: item.sourceIdentifier,
            providedBy: actor,
            assistance: {
              _tag: 'DeterministicImport',
              adapter: { id: 'qti12', label: 'QTI 1.2/1.2.1', version: '1' },
            },
            evidence,
            review: {
              decision: 'accepted',
              reviewer: actor,
              reviewedAt: item.reviewedAt ?? REVIEWED_AT,
              note: item.reviewNote ?? null,
              contentHash,
              contextHash,
            },
          },
        }
        : null,
      acceptedSnapshotHash: item.decision === 'accepted' ? 'sample-accepted-snapshot-hash' : null,
    };
  }) as MigrationRunRecord['items'],
  artifacts: [
    {
      id: 'sample-original',
      kind: 'original',
      filename: 'district-algebra-qti12-export.zip',
      mimeType: 'application/zip',
      size: 4_872_192,
      sha256: 'sample-original-hash',
      storageKey: 'conversion-sources/sample/original/sample-original-hash',
      document: null,
      createdAt: CREATED_AT,
    },
    {
      id: 'sample-normalized',
      kind: 'normalized',
      filename: 'district-algebra-qti12-export.zip.normalized.json',
      mimeType: 'application/vnd.qflow.structured-source+json',
      size: 512,
      sha256: 'sample-normalized-hash',
      storageKey: 'conversion-sources/sample/normalized/sample-normalized-hash',
      document: {
        version: 1,
        title: 'District Algebra Benchmark',
        sourceKind: 'package',
        blocks: [
          {
            id: 'package-entry-1',
            kind: 'paragraph',
            text: 'items/ALG-001.xml: Solve A Linear Equation',
          },
          {
            id: 'package-entry-2',
            kind: 'paragraph',
            text: 'items/ALG-014.xml: Interpret A Line Graph',
          },
        ],
        text:
          'items/ALG-001.xml: Solve A Linear Equation\n\nitems/ALG-014.xml: Interpret A Line Graph',
        uncertainties: [{
          code: 'STRUCTURE_INFERRED',
          message:
            'Normalized view lists package entries recovered by the import adapter; original bytes remain the authority.',
        }],
      },
      createdAt: CREATED_AT,
    },
  ],
};
