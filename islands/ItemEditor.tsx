import ItemEditorCanvas from './item_editor/ItemEditorCanvas.tsx';
import ItemEditorInspector from './item_editor/ItemEditorInspector.tsx';
import ItemEditorProvider from './item_editor/ItemEditorProvider.tsx';
import type { ItemEditorProps } from './item_editor/types.ts';
import { I18nProvider } from '../lib/i18n/context.tsx';

export type { ItemEditorProps } from './item_editor/types.ts';

/** Standalone item editor composition used by revision editing routes. */
export default function ItemEditor(props: ItemEditorProps) {
  return (
    <I18nProvider payload={props.payload}>
      <ItemEditorProvider {...props}>
        <ItemEditorCanvas persistenceStatusLocation='canvas' />
        <ItemEditorInspector />
      </ItemEditorProvider>
    </I18nProvider>
  );
}
