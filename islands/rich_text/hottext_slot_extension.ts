import { defineCommands, defineNodeSpec, type Extension, insertNode, union } from '@prosekit/core';
import type { ProseMirrorNode } from '@prosekit/pm/model';
import { HOTTEXT_MARKER_ATTR } from '../../lib/types/hottext.ts';

export type HottextSlotAttrs = {
  slotId: string;
  label: string;
};

export type HottextSlotExtension = Extension<{
  Nodes: {
    hottextSlot: HottextSlotAttrs;
  };
  Commands: {
    insertHottextSlot: [attrs: HottextSlotAttrs];
  };
}>;

export function defineHottextSlot(): HottextSlotExtension {
  const node = defineNodeSpec({
    name: 'hottextSlot',
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
        tag: `span[${HOTTEXT_MARKER_ATTR}]`,
        getAttrs: (dom: Element) => {
          if (!(dom instanceof HTMLElement)) return false;
          const slotId = dom.getAttribute(HOTTEXT_MARKER_ATTR)?.trim();
          if (!slotId) return false;
          const label = dom.getAttribute('data-qti-label')?.trim() || dom.textContent?.trim() ||
            slotId;
          return {
            slotId,
            label,
          } satisfies HottextSlotAttrs;
        },
      },
    ],
    toDOM: (node: ProseMirrorNode) => {
      const { slotId, label } = node.attrs as HottextSlotAttrs;
      const classes = [
        'qti-hottext-marker',
        'ds-badge',
        'ds-badge-ghost',
      ].join(' ');
      return [
        'span',
        {
          [HOTTEXT_MARKER_ATTR]: slotId,
          'data-qti-label': label,
          class: classes,
          contenteditable: 'false',
        },
        label || slotId,
      ];
    },
  });

  const commands = defineCommands({
    insertHottextSlot: (attrs: HottextSlotAttrs) => {
      const slotId = attrs.slotId?.trim();
      if (!slotId) return () => false;
      return insertNode({
        type: 'hottextSlot',
        attrs: {
          slotId,
          label: attrs.label?.trim() || slotId,
        },
      });
    },
  });

  return union(node, commands);
}
