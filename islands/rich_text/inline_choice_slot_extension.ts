import { defineCommands, defineNodeSpec, type Extension, insertNode, union } from '@prosekit/core';
import type { ProseMirrorNode } from '@prosekit/pm/model';
import { INLINE_CHOICE_MARKER_ATTR } from '../../lib/types/inline_choice.ts';

export type InlineChoiceSlotAttrs = {
  slotId: string;
  label: string;
};

export type InlineChoiceSlotExtension = Extension<{
  Nodes: {
    inlineChoiceSlot: InlineChoiceSlotAttrs;
  };
  Commands: {
    insertInlineChoiceSlot: [attrs: InlineChoiceSlotAttrs];
  };
}>;

export function defineInlineChoiceSlot(): InlineChoiceSlotExtension {
  const node = defineNodeSpec({
    name: 'inlineChoiceSlot',
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
        tag: `span[${INLINE_CHOICE_MARKER_ATTR}]`,
        getAttrs: (dom: Element) => {
          if (!(dom instanceof HTMLElement)) return false;
          const slotId = dom.getAttribute(INLINE_CHOICE_MARKER_ATTR)?.trim();
          if (!slotId) return false;
          return {
            slotId,
            label: dom.textContent?.trim() ?? slotId,
          } satisfies InlineChoiceSlotAttrs;
        },
      },
    ],
    toDOM: (node: ProseMirrorNode) => {
      const { slotId, label } = node.attrs as InlineChoiceSlotAttrs;
      const classes = [
        'qti-inline-choice-slot',
        'ds-badge',
        'ds-badge-primary',
      ].join(' ');
      return [
        'span',
        {
          [INLINE_CHOICE_MARKER_ATTR]: slotId,
          'data-qti-label': label,
          class: classes,
          contenteditable: 'false',
        },
        label || slotId,
      ];
    },
  });

  const commands = defineCommands({
    insertInlineChoiceSlot: (attrs: InlineChoiceSlotAttrs) => {
      const slotId = attrs.slotId?.trim();
      if (!slotId) return () => false;
      return insertNode({
        type: 'inlineChoiceSlot',
        attrs: {
          slotId,
          label: attrs.label?.trim() || slotId,
        },
      });
    },
  });

  return union(node, commands);
}
