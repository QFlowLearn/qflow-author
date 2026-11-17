import type { DriverUiContext } from './view_registry.ts';
import ImageAssetEditor from '../../components/ui/ImageAssetEditor.tsx';
import type { ImageAsset } from '../../lib/types/image_asset.ts';
import { commonContentProps, setDraftFieldValue } from './editor_shell.tsx';
import type { CommonContentProps } from './types.ts';
import { ResponseIdentifierDisclosure } from './response_identifier_disclosure.tsx';
import { attachStandardDriverViews } from './standard_driver_views.ts';
import { useI18n } from '../../lib/i18n/context.tsx';

export type DrawingContentProps = CommonContentProps & {
  responseIdentifier: string;
  image: ImageAsset;
  setResponseIdentifier: (id: string) => void;
  setImage: (image: ImageAsset) => void;
};

function DrawingEditor(ctx: DriverUiContext<'drawing'>) {
  const { editor, draft, update } = ctx;

  const setDraftField = <K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K] | ((prev: (typeof draft)[K]) => (typeof draft)[K]),
  ) => setDraftFieldValue(editor, draft, update, key, value);

  return (
    <DrawingContent
      {...commonContentProps(editor)}
      responseIdentifier={draft.responseIdentifier ?? 'RESPONSE'}
      image={{
        source: draft.drawingImageSrc ?? '',
        alt: draft.drawingImageAlt ?? '',
        longDescription: draft.drawingImageLongDesc,
        mimeType: draft.drawingImageType,
        width: draft.drawingImageWidth,
        height: draft.drawingImageHeight,
      }}
      setResponseIdentifier={(value) => setDraftField('responseIdentifier', value)}
      setImage={(image) =>
        update({
          ...draft,
          drawingImageSrc: image.source,
          drawingImageAlt: image.alt,
          drawingImageLongDesc: image.longDescription,
          drawingImageType: image.mimeType,
          drawingImageWidth: image.width,
          drawingImageHeight: image.height,
        })}
    />
  );
}

export function DrawingContent(props: DrawingContentProps) {
  const i18n = useI18n();
  return (
    <div class='space-y-5'>
      {props.renderPromptField(i18n.t('driver.drawingPrompt'))}
      <ResponseIdentifierDisclosure
        value={props.responseIdentifier}
        onChange={props.setResponseIdentifier}
      />

      <ImageAssetEditor
        labels={{
          source: i18n.t('driver.drawingImageSource'),
          alt: i18n.t('driver.drawingImageAlt'),
          altPlaceholder: i18n.t('driver.drawingImageAltPlaceholder'),
          longDescription: i18n.t('driver.drawingImageLongDescription'),
          mimeType: i18n.t('driver.drawingImageMimeType'),
          width: i18n.t('driver.drawingImageWidth'),
          height: i18n.t('driver.drawingImageHeight'),
        }}
        value={props.image}
        fields={['longDescription', 'mimeType', 'width', 'height']}
        onChange={props.setImage}
      />
    </div>
  );
}

attachStandardDriverViews('drawing', DrawingEditor);
