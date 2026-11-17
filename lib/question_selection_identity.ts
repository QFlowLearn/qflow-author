import { DOMParser } from '@xmldom/xmldom';
import { projectCanonicalQtiSemantics } from './question_qti_semantics.ts';
import { canonicalJsonStringify } from './canonical_json.ts';
import { sha256Hex } from './sha256.ts';

/** Equality contract: complete, self-contained QTI semantics, ignoring only item title/identity. */
export const QUESTION_SELECTION_IDENTITY_VERSION = 'qti-self-contained-v1';
/** Bound complete XML comparison work; larger content remains available for manual selection. */
export const QUESTION_SELECTION_MAX_BYTES = 256_000;

/**
 * Exact content equality, never similarity. External resources and executable/custom content
 * need a separate resolved-content contract; a matching URL is not evidence of matching bytes.
 */
export async function questionSelectionIdentity(xml: string): Promise<string | null> {
  if (
    new TextEncoder().encode(xml).length > QUESTION_SELECTION_MAX_BYTES ||
    /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(xml)
  ) return null;
  try {
    let invalid = false;
    const doc = new DOMParser({
      errorHandler: {
        warning: () => {
          invalid = true;
        },
        error: () => {
          invalid = true;
        },
        fatalError: () => {
          invalid = true;
        },
      },
    }).parseFromString(xml, 'application/xml');
    if (invalid) return null;
    for (const node of Array.from(doc.getElementsByTagName('*'))) {
      if (
        /^(script|style|iframe|object|embed|qti-custom-interaction|qti-portable-custom-interaction|qti-custom-operator|qti-stylesheet|qti-assessment-stimulus-ref|include)$/i
          .test(node.localName)
      ) return null;
      for (const attr of Array.from(node.attributes)) {
        const name = attr.localName.toLowerCase(), value = attr.value.trim();
        if (name.startsWith('on') || /url\s*\(|@import/i.test(value)) return null;
        if (
          [
            'src',
            'href',
            'data',
            'poster',
            'srcset',
            'longdesc',
            'altimg',
            'template-location',
            'base',
            'background',
          ].includes(name) && value &&
          !(name === 'href' && value.startsWith('#') && doc.getElementById(value.slice(1))) &&
          !/^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(value)
        ) return null;
        if (
          name === 'template' &&
          !/^https?:\/\/purl\.imsglobal\.org\/spec\/qti\/v3p0\/rptemplates\/(match_correct|map_response|map_response_point)$/
            .test(value)
        ) return null;
      }
    }
    const content = projectCanonicalQtiSemantics(xml);
    return `${QUESTION_SELECTION_IDENTITY_VERSION}:${await sha256Hex(
      new TextEncoder().encode(canonicalJsonStringify(content)),
    )}`;
  } catch {
    return null;
  }
}
