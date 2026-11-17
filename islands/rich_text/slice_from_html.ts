import { nodeFromHTML } from '@prosekit/core';
import { Fragment, type ProseMirrorNode, type Schema, Slice } from '@prosekit/pm/model';

export function sliceFromHtml(clean: string, schema: Schema, asInline: boolean) {
  const parsed = nodeFromHTML(clean, { schema });
  let fragment = parsed.content;
  if (asInline) {
    const inlineNodes: ProseMirrorNode[] = [];
    fragment.forEach((node) => {
      if (node.isTextblock) {
        node.content.forEach((child) => inlineNodes.push(child));
      } else {
        inlineNodes.push(node);
      }
    });
    fragment = Fragment.fromArray(inlineNodes);
  }
  if (!fragment.size) return null;
  return new Slice(fragment, 0, 0);
}
