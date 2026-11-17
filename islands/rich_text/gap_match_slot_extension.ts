import { defineCommands, defineNodeSpec, type Extension, insertNode, union } from '@prosekit/core';
import type { ProseMirrorNode } from '@prosekit/pm/model';
import { GAP_MARKER_ATTR } from '../../lib/types/gap_match.ts';

export type GapMatchSlotAttrs = {
  slotId: string;
  label: string;
};

export type GapMatchSlotExtension = Extension<{
  Nodes: {
    gapMatchSlot: GapMatchSlotAttrs;
  };
  Commands: {
    insertGapMatchSlot: [attrs: GapMatchSlotAttrs];
  };
}>;

export function defineGapMatchSlot(): GapMatchSlotExtension {
  const node = defineNodeSpec({
    name: 'gapMatchSlot',
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    draggable: false,
    marks: '',
    attrs: {
      slotId: { default: '' },
      label: { default: '' },
    },
    parseDOM: [
      {
        tag: `span[${GAP_MARKER_ATTR}]`,
        getAttrs: (dom: Element) => {
          if (!(dom instanceof HTMLElement)) return false;
          const slotId = dom.getAttribute(GAP_MARKER_ATTR)?.trim();
          if (!slotId) return false;
          const label = dom.getAttribute('data-qti-label')?.trim() || dom.textContent?.trim() ||
            slotId;
          return {
            slotId,
            label,
          } satisfies GapMatchSlotAttrs;
        },
      },
    ],
    toDOM: (node: ProseMirrorNode) => {
      const { slotId, label } = node.attrs as GapMatchSlotAttrs;
      const classes = [
        'qti-gap-marker',
        'ds-badge',
        'ds-badge-ghost',
      ].join(' ');
      return [
        'span',
        {
          [GAP_MARKER_ATTR]: slotId,
          'data-qti-label': label,
          class: classes,
          contenteditable: 'false',
        },
        label || slotId,
      ];
    },
  });

  const commands = defineCommands({
    insertGapMatchSlot: (attrs: GapMatchSlotAttrs) => {
      const slotId = attrs.slotId?.trim();
      if (!slotId) return () => false;
      return insertNode({
        type: 'gapMatchSlot',
        attrs: {
          slotId,
          label: attrs.label?.trim() || slotId,
        },
      });
    },
  });

  return union(node, commands);
}
