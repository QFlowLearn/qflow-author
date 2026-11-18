import { type QtiTranscodeDiagnostic, transcodeQti3Item } from '@longsightgroup/qti3-transcoder';
import {
  childElements,
  findAllDescendantsByLocalName as descendants,
  findChildByLocalName as child,
  parseXmlStrict,
  serializer,
} from '../../import/xml_dom.ts';
import { xmlEscape } from '../../xml.ts';
import { prepareSakaiSource } from './sakai_source.ts';

/** Versioned Sakai question-pool transport; no QFlow assessment identity is created. */
export const SAKAI_POOL_CONTRACT = 'sakai-question-pool@1';
/** Exact input revisions and ordered content supplied by the frozen edition. */
export type SakaiPoolInput = {
  readonly id: string;
  readonly label: string;
  readonly items: readonly { readonly revisionId: string; readonly xml: string }[];
};
/** A usable pool includes an exact exclusion report; zero usable questions produces no artifact. */
export type SakaiPoolResult =
  | {
    readonly ok: true;
    readonly xml: string;
    readonly diagnostics: readonly QtiTranscodeDiagnostic[];
    readonly includedRevisionIds: readonly string[];
    readonly excluded: readonly { readonly revisionId: string; readonly code: string }[];
  }
  | {
    readonly ok: false;
    readonly blocked: readonly { readonly revisionId: string; readonly code: string }[];
  };

/** Adapt the shared QTI 1.2 writer to Sakai's pool envelope and supported scoring extraction. */
export function compileSakaiPool(input: SakaiPoolInput): SakaiPoolResult {
  const blocked: { revisionId: string; code: string }[] = [];
  const items: string[] = [];
  const diagnostics: QtiTranscodeDiagnostic[] = [];
  const includedRevisionIds: string[] = [];
  if (
    !input.id.trim() || !input.label.trim() || input.label.length > 160 ||
    !input.items.length || input.items.length > 1000 ||
    input.items.some((item) => !item.revisionId.trim()) ||
    input.items.reduce((total, item) => total + item.xml.length, 0) > 32_000_000 ||
    new Set(input.items.map((item) => item.revisionId)).size !== input.items.length
  ) {
    return { ok: false, blocked: [{ revisionId: '', code: 'invalid_revision_set' }] };
  }
  for (const source of input.items) {
    let canonical: Document;
    try {
      if (source.xml.length > 256_000 || /<!DOCTYPE|<!ENTITY/i.test(source.xml)) {
        blocked.push({ revisionId: source.revisionId, code: 'invalid_xml' });
        continue;
      }
      canonical = parseXmlStrict(source.xml, 'Sakai source revision');
    } catch {
      blocked.push({ revisionId: source.revisionId, code: 'invalid_xml' });
      continue;
    }
    const prepared = prepareSakaiSource(canonical.documentElement);
    if (!prepared.ok) {
      blocked.push({
        revisionId: source.revisionId,
        code: prepared.code,
      });
      continue;
    }
    const result = transcodeQti3Item({
      kind: 'xml',
      xml: serializer.serializeToString(canonical),
    }, {
      profile: 'qti12-standard@1',
    });
    if (
      !result.ok || result.fidelity === 'lossy' || result.report.mappings.length !== 1 ||
      result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    ) {
      blocked.push({
        revisionId: source.revisionId,
        code: result.ok ? 'sakai.lossy_conversion' : result.code,
      });
      continue;
    }
    const doc = parseXmlStrict(result.xml, 'QTI 1.2 compiler output');
    const item = child(doc.documentElement, 'item');
    const conditions = item ? descendants(item, 'respcondition') : [];
    const condition = conditions[0];
    const equality = condition && child(child(condition, 'conditionvar'), 'varequal');
    const setvar = condition && child(condition, 'setvar');
    const decvar = item && descendants(item, 'decvar')[0];
    const presentation = item && child(item, 'presentation');
    const responseProcessing = item && child(item, 'resprocessing');
    if (
      !item || !presentation || !responseProcessing ||
      childElements(responseProcessing).length !== 2 || conditions.length !== 1 || !equality ||
      !setvar || !decvar ||
      setvar.textContent !== '1' || setvar.getAttribute('action') !== 'Add' || result.assets.length
    ) {
      blocked.push({ revisionId: source.revisionId, code: 'sakai.unproven_qti12_shape' });
      continue;
    }
    const labels = descendants(item, 'response_label');
    const correctIndex = labels.findIndex((label) =>
      label.getAttribute('ident') === equality.textContent
    );
    if (
      correctIndex < 0 || labels.length < 2 || labels.length > 26
    ) {
      blocked.push({ revisionId: source.revisionId, code: 'sakai.invalid_choice_set' });
      continue;
    }
    labels.forEach((label, index) => label.setAttribute('ident', String.fromCharCode(65 + index)));
    // The proven source contains text only. Sakai consumes HTML material, so literal angle
    // brackets and ampersands must remain text after both XML parsing and HTML rendering.
    for (const material of descendants(presentation, 'mattext')) {
      material.textContent = xmlEscape(material.textContent ?? '').replaceAll('\n', '<br/>');
      material.setAttribute('texttype', 'text/html');
    }
    equality.textContent = String.fromCharCode(65 + correctIndex);
    decvar.setAttribute('maxvalue', '1');
    decvar.setAttribute('minvalue', '0');
    const metadata = doc.createElement('itemmetadata');
    const qtiMetadata = doc.createElement('qtimetadata');
    const field = doc.createElement('qtimetadatafield');
    const label = doc.createElement('fieldlabel');
    label.textContent = 'qmd_itemtype';
    const entry = doc.createElement('fieldentry');
    entry.textContent = 'Multiple Choice';
    field.appendChild(label);
    field.appendChild(entry);
    qtiMetadata.appendChild(field);
    metadata.appendChild(qtiMetadata);
    item.insertBefore(metadata, presentation);
    const feedback = doc.createElement('displayfeedback');
    feedback.setAttribute('feedbacktype', 'Response');
    feedback.setAttribute('linkrefid', 'Correct');
    condition.appendChild(feedback);
    item.setAttribute('ident', source.revisionId);
    const language = canonical.documentElement.getAttribute('xml:lang');
    if (language) item.setAttribute('xml:lang', language);
    // The document wrapper is transport syntax required by Sakai's pool importer.
    items.push(serializer.serializeToString(item));
    includedRevisionIds.push(source.revisionId);
    diagnostics.push(...prepared.warnings.map((code): QtiTranscodeDiagnostic => ({
      code,
      severity: 'warning',
      message: code === 'sakai.fixed_choice_order'
        ? 'Choices use the saved order instead of shuffling in the exported Sakai pool.'
        : 'Optional text formatting is omitted from the exported Sakai pool.',
      path: `items/${source.revisionId}.xml`,
    })));
    diagnostics.push(...result.diagnostics);
  }
  if (!items.length) return { ok: false, blocked };
  return {
    ok: true,
    diagnostics,
    includedRevisionIds,
    excluded: blocked,
    xml: `<?xml version="1.0" encoding="UTF-8"?>\n<questestinterop><assessment ident="${
      xmlEscape(input.id)
    }" title="${xmlEscape(input.label)}"><section ident="questions">${
      items.join('\n')
    }</section></assessment></questestinterop>`,
  };
}
