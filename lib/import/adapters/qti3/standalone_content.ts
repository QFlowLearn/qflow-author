import { parseQtiModalFeedbackFragment } from '@longsightgroup/qti3-core';
import type { AssessmentStandaloneContent } from '../../../assessment_standalone_content.ts';
import { parseStandaloneRubric } from '../../../assessment_content_qti.ts';
import { resolvePackageAssetPath } from '../../../asset_refs.ts';
import { attr, findChildrenByLocalName, serializer } from '../../xml_dom.ts';

/** Adapt only supported static candidate rubrics through the shared content parser. */
export function importSectionContent(
  section: Element,
  sourceHref: string,
): AssessmentStandaloneContent[] {
  return findChildrenByLocalName(section, 'qti-rubric-block')
    .filter((rubric) => (attr(rubric, 'view') ?? '').split(/\s+/).includes('candidate'))
    .map((rubric) => {
      const parsed = parseQtiModalFeedbackFragment(serializer.serializeToString(rubric));
      const node = parsed.content[0];
      if (
        parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error') ||
        parsed.content.length !== 1 || node?.kind !== 'element'
      ) {
        throw new Error('Standalone section instructions contain unsupported content.');
      }
      const content = parseStandaloneRubric(node);
      if (!content) throw new Error('Candidate instructions have no supported content.');
      if (content.kind === 'image') {
        return { ...content, src: packageReference(content.src, sourceHref) };
      }
      if (content.kind === 'video') {
        return {
          ...content,
          src: packageReference(content.src, sourceHref),
          captionSrc: packageReference(content.captionSrc, sourceHref),
        };
      }
      return content;
    });
}

function packageReference(reference: string, sourceHref: string): string {
  const path = resolvePackageAssetPath(reference, sourceHref);
  if (!path) throw new Error('Standalone media must reference a file inside the imported package.');
  return path;
}
