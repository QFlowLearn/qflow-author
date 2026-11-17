import { defineCommands, defineNodeSpec, type Extension, insertNode, union } from '@prosekit/core';
import type { ProseMirrorNode } from '@prosekit/pm/model';

export type TextEntryBlankAttrs = {
  slotId: string;
  label: string;
  widthClass?: string;
};

export type TextEntryBlankExtension = Extension<{
  Nodes: {
    textEntryBlank: TextEntryBlankAttrs;
  };
  Commands: {
    insertTextEntryBlank: [attrs: TextEntryBlankAttrs];
  };
}>;

function getWidthClassFromDom(dom: Element): string {
  const classList = dom.getAttribute('class')?.split(/\s+/) ?? [];
  const width = classList.find((cls) => cls.startsWith('qti-input-width-'));
  return width ?? '';
}

export function defineTextEntryBlank(): TextEntryBlankExtension {
  const node = defineNodeSpec({
    name: 'textEntryBlank',
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    draggable: false,
    marks: '',
    attrs: {
      slotId: { default: '' },
      label: { default: '' },
      widthClass: { default: '' },
    },
    parseDOM: [
      {
        tag: 'span[data-qti-entry]',
        getAttrs: (dom: Element) => {
          if (!(dom instanceof HTMLElement)) return false;
          const slotId = dom.getAttribute('data-qti-entry')?.trim();
          if (!slotId) return false;
          return {
            slotId,
            label: dom.textContent?.trim() ?? slotId,
            widthClass: getWidthClassFromDom(dom),
          } satisfies TextEntryBlankAttrs;
        },
      },
    ],
    toDOM: (node: ProseMirrorNode) => {
      const { slotId, label, widthClass } = node.attrs as TextEntryBlankAttrs;
      const classes = [
        'qti-entry-slot',
        'ds-input',
        'ds-input-bordered',
        widthClass?.trim() ?? '',
      ].filter(Boolean).join(' ');
      return [
        'span',
        {
          'data-qti-entry': slotId,
          'data-qti-label': label,
          class: classes,
          contenteditable: 'false',
        },
        label || slotId,
      ];
    },
  });

  const commands = defineCommands({
    insertTextEntryBlank: (attrs: TextEntryBlankAttrs) => {
      const slotId = attrs.slotId?.trim();
      if (!slotId) {
        return () => false;
      }
      return insertNode({
        type: 'textEntryBlank',
        attrs: {
          slotId,
          label: attrs.label?.trim() || slotId,
          widthClass: attrs.widthClass?.trim() || '',
        },
      });
    },
  });

  return union(node, commands);
}
