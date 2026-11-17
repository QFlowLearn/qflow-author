export const RICH_CHOICE_ITEM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item
  xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
  identifier="rich-choice"
  title="Rich choice"
  xml:lang="en-US"
  time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
  <qti-item-body>
    <qti-choice-interaction response-identifier="RESPONSE">
      <qti-prompt>
        Choose <math alttext="x squared"><mi>x</mi></math>
        <annotation>teacher note</annotation>
      </qti-prompt>
      <qti-simple-choice identifier="A">
        <math alttext="alpha"><mi>a</mi></math>
      </qti-simple-choice>
      <qti-simple-choice identifier="B">
        <img src="b.png" alt="Beta image"/>
      </qti-simple-choice>
    </qti-choice-interaction>
  </qti-item-body>
</qti-assessment-item>`;
