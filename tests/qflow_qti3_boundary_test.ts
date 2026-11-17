import { expect, test as testCase } from 'vitest';

import {
  parseQtiXml,
  sharedVocabularyFieldById,
  sharedVocabularyInteractionFields,
} from '@longsightgroup/qti3-core';
import { QFLOW_TO_QTI3_INTERACTION, qti3InteractionToQflowTypes } from '../lib/qti3_support.ts';
import { injectItemMetadataIntoXml } from '../lib/catalog_metadata.ts';
import {
  SHARED_VOCABULARY_INTERACTION_DEFINITION_TABLE,
  SHARED_VOCABULARY_INTERACTION_DEFINITIONS,
} from '../lib/shared_vocabulary.ts';
import { isQuestionTypeId, QUESTION_TYPE_IDS } from '../lib/types/registry.ts';

testCase('every QFlow question type maps to a qti3 interaction', () => {
  for (const typeId of QUESTION_TYPE_IDS) {
    const interaction = QFLOW_TO_QTI3_INTERACTION[typeId];
    if (!interaction) expect.unreachable(`${typeId}: missing qti3 interaction mapping`);
  }

  expect(qti3InteractionToQflowTypes('choice')).toStrictEqual(['single_select', 'multi_select']);
  expect(QFLOW_TO_QTI3_INTERACTION.custom_interaction).toStrictEqual('custom');
});

testCase('interaction field order covers all qti3 interaction vocabulary fields', () => {
  const coreIds = sharedVocabularyInteractionFields.map((field) => field.id).sort();
  const tableIds = SHARED_VOCABULARY_INTERACTION_DEFINITION_TABLE.map((entry) => entry.qtiFieldId)
    .sort();
  expect(tableIds).toStrictEqual(coreIds);
});

testCase('definition table covers interaction vocabulary in display order', () => {
  expect(SHARED_VOCABULARY_INTERACTION_DEFINITION_TABLE.length).toStrictEqual(
    SHARED_VOCABULARY_INTERACTION_DEFINITIONS.length,
  );
});

testCase('field maps are bijective with interaction definitions', () => {
  const fieldIds = new Set<string>();
  const properties = new Set<string>();
  for (const entry of SHARED_VOCABULARY_INTERACTION_DEFINITION_TABLE) {
    if (fieldIds.has(entry.qtiFieldId)) {
      expect.unreachable(`duplicate qti field id ${entry.qtiFieldId}`);
    }
    if (properties.has(entry.property)) {
      expect.unreachable(`duplicate property ${entry.property}`);
    }
    fieldIds.add(entry.qtiFieldId);
    properties.add(entry.property);
    const field = sharedVocabularyFieldById(entry.qtiFieldId);
    if (!field) expect.unreachable(`${entry.property}: unknown qti field ${entry.qtiFieldId}`);
  }
  expect(fieldIds.size).toStrictEqual(SHARED_VOCABULARY_INTERACTION_DEFINITION_TABLE.length);
  expect(properties.size).toStrictEqual(SHARED_VOCABULARY_INTERACTION_DEFINITION_TABLE.length);
});

testCase('shared vocabulary definitions reference registered types and qti3 fields', () => {
  for (const entry of SHARED_VOCABULARY_INTERACTION_DEFINITIONS) {
    for (const typeId of entry.types) {
      if (!(isQuestionTypeId(typeId))) {
        expect.unreachable(`${entry.property}: unknown type ${typeId}`);
      }
    }
    const field = sharedVocabularyFieldById(entry.qtiFieldId);
    if (!field) expect.unreachable(`${entry.property}: unknown qti field ${entry.qtiFieldId}`);
    for (const typeId of entry.types) {
      if (!field) continue;
      if (!(field.interactions.includes(QFLOW_TO_QTI3_INTERACTION[typeId]))) {
        expect.unreachable(
          `${entry.property}: qti field ${entry.qtiFieldId} does not apply to ${typeId}`,
        );
      }
    }
  }
});

testCase('qflow catalog authoring output is visible to qti3 catalog parsing', () => {
  const xml = injectItemMetadataIntoXml(
    `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="item-1" title="Item" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
    <qti-correct-response>
      <qti-value>A</qti-value>
    </qti-correct-response>
  </qti-response-declaration>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
  <qti-item-body>
    <p><span data-catalog-idref="cat-1">Term</span></p>
    <qti-choice-interaction response-identifier="RESPONSE" max-choices="1">
      <qti-simple-choice identifier="A">A</qti-simple-choice>
      <qti-simple-choice identifier="B">B</qti-simple-choice>
    </qti-choice-interaction>
  </qti-item-body>
  <qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct"/>
</qti-assessment-item>`,
    [{
      id: 'cat-1',
      cards: [{
        support: { kind: 'predefined', value: 'keyword-translation' },
        entries: [{
          language: 'es',
          contentHtml: '<p>Translated term</p>',
          attributes: { 'data-reading-type': 'computer-read-aloud' },
        }],
      }],
    }],
    [],
  );

  const parsed = parseQtiXml(xml);
  if (!(parsed.ok)) {
    expect.unreachable(parsed.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  }
  const item = parsed.document?.item;
  if (!item) expect.unreachable('qti3 parser did not return an item');
  expect(item.catalogReferences.map((reference) => reference.idref)).toStrictEqual(['cat-1']);
  expect(item.catalogInfo?.catalogs.length).toStrictEqual(1);
  const catalog = item.catalogInfo?.catalogs[0];
  if (!catalog) expect.unreachable('qti3 parser did not return catalog info');
  expect(catalog.id).toStrictEqual('cat-1');
  expect(catalog.cards[0]?.support).toStrictEqual('keyword-translation');
  expect(catalog.cards[0]?.entries[0]?.attributes['data-reading-type']).toStrictEqual(
    'computer-read-aloud',
  );
  expect(catalog.cards[0]?.entries[0]?.htmlContent?.text).toStrictEqual('Translated term');
});
