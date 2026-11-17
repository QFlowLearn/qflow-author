import { useCallback, useEffect } from 'preact/hooks';
import type { Editor } from '@prosekit/core';
import { useEditor } from '@prosekit/preact';
import type { RichTextExtension } from './editor_types.ts';

export function EditorSurface(
  { minHeight, ariaLabelledBy, ariaInvalid, ariaDescribedBy }: {
    minHeight: number;
    ariaLabelledBy?: string;
    ariaInvalid?: boolean;
    ariaDescribedBy?: string;
  },
) {
  const editor = useEditor() as Editor<RichTextExtension>;
  const attach = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      editor.unmount();
      return;
    }
    editor.mount(node);
  }, [editor]);
  useEffect(() => {
    const editable = editor.view?.dom;
    if (!editable) return;
    for (
      const [name, value] of [
        ['aria-labelledby', ariaLabelledBy],
        ['aria-describedby', ariaDescribedBy],
        ['aria-invalid', ariaInvalid ? 'true' : undefined],
      ] as const
    ) {
      if (value === undefined) editable.removeAttribute(name);
      else editable.setAttribute(name, value);
    }
  }, [editor, ariaLabelledBy, ariaInvalid, ariaDescribedBy]);
  const minHeightClass = minHeight <= 48
    ? 'rte-editor--min-sm'
    : minHeight <= 120
    ? 'rte-editor--min-md'
    : 'rte-editor--min-lg';
  return (
    <div
      ref={attach}
      class={`rte-editor ${minHeightClass}`}
      aria-labelledby={ariaLabelledBy}
    />
  );
}
