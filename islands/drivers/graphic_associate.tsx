import { useDomId } from '../../lib/rendering/island_context.tsx';
import { useEffect, useState } from 'preact/hooks';
import { setDraftFieldValue, setDraftListFieldValue } from './editor_shell.tsx';
import Button from '../../components/ui/Button.tsx';
import {
  AuthoringFieldGrid,
  AuthoringSectionHeader,
} from '../../components/ui/AuthoringLayout.tsx';
import Input, { FieldIssueMessage } from '../../components/ui/Input.tsx';
import ImageAssetEditor from '../../components/ui/ImageAssetEditor.tsx';
import Select from '../../components/ui/Select.tsx';
import AssociateMatrix from '../AssociateMatrix.tsx';
import type { DriverUiContext } from './view_registry.ts';
import {
  defaultsGraphicAssociate,
  type GraphicAssociateHotspot,
  type GraphicAssociatePair,
} from '../../lib/types/graphic_associate.ts';
import { sanitizeIdentifier } from '../../lib/identifiers.ts';
import { attachStandardDriverViews } from './standard_driver_views.ts';
import type { CommonContentProps } from './types.ts';
import { ResponseIdentifierDisclosure } from './response_identifier_disclosure.tsx';
import { HotspotCanvasEditor } from './hotspot_canvas_editor.tsx';
import { AssociationLimitField } from './association_limit_field.tsx';
import type { ImageAsset } from '../../lib/types/image_asset.ts';
import { useI18n } from '../../lib/i18n/context.tsx';

export type GraphicAssociateContentProps = CommonContentProps & {
  promptHtml: string;
  background: ImageAsset;
  graphicAssociateResponseId: string;
  graphicAssociateHotspots: GraphicAssociateHotspot[];
  graphicAssociateCorrectPairs: GraphicAssociatePair[];
  maxAssociations?: number;

  setPromptHtml: (html: string) => void;
  setBackground: (image: ImageAsset) => void;
  setGraphicAssociateResponseId: (id: string) => void;

  addGraphicAssociateHotspot: () => void;
  removeGraphicAssociateHotspot: (id: string) => void;
  updateGraphicAssociateHotspotId: (id: string, next: string) => void;
  updateGraphicAssociateHotspotShape: (id: string, shape: GraphicAssociateHotspot['shape']) => void;
  updateGraphicAssociateHotspotCoords: (id: string, coords: string) => void;
  updateGraphicAssociateHotspotMatchMax: (id: string, val?: number) => void;

  setGraphicAssociatePairs: (pairs: GraphicAssociatePair[]) => void;
};

function GraphicAssociateEditor(ctx: DriverUiContext<'graphic_associate'>) {
  const { editor, draft, update } = ctx;
  const graphicAssociateBackgroundSrc = draft.graphicAssociateBackgroundSrc ?? '';
  const graphicAssociateBackgroundAlt = draft.graphicAssociateBackgroundAlt ?? '';
  const graphicAssociateBackgroundLongDesc = draft.graphicAssociateBackgroundLongDesc ?? '';
  const graphicAssociateBackgroundType = draft.graphicAssociateBackgroundType ?? '';
  const graphicAssociateBackgroundWidth = draft.graphicAssociateBackgroundWidth;
  const graphicAssociateBackgroundHeight = draft.graphicAssociateBackgroundHeight;
  const graphicAssociateResponseId = draft.responseIdentifier ?? 'RESPONSE';
  const graphicAssociateHotspots = draft.graphicAssociateHotspots;
  const graphicAssociateCorrectPairs = draft.graphicAssociateCorrectPairs;
  const maxAssociations = draft.maxAssociations;
  const promptHtml = draft.promptHtml ?? '';

  const setDraftField = <K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K] | ((prev: (typeof draft)[K]) => (typeof draft)[K]),
  ) => setDraftFieldValue(editor, draft, update, key, value);

  useEffect(() => {
    if (graphicAssociateHotspots.length > 0) return;
    const defaults = defaultsGraphicAssociate();
    update({
      ...draft,
      graphicAssociateBackgroundSrc: defaults.graphicAssociateBackgroundSrc ?? '',
      graphicAssociateBackgroundAlt: defaults.graphicAssociateBackgroundAlt ?? '',
      graphicAssociateBackgroundLongDesc: defaults.graphicAssociateBackgroundLongDesc ?? '',
      graphicAssociateBackgroundType: defaults.graphicAssociateBackgroundType ?? '',
      graphicAssociateBackgroundWidth: defaults.graphicAssociateBackgroundWidth,
      graphicAssociateBackgroundHeight: defaults.graphicAssociateBackgroundHeight,
      responseIdentifier: defaults.responseIdentifier ?? 'RESPONSE',
      graphicAssociateHotspots: defaults.graphicAssociateHotspots ?? [],
      graphicAssociateCorrectPairs: defaults.graphicAssociateCorrectPairs ?? [],
      minAssociations: typeof defaults.minAssociations === 'number'
        ? defaults.minAssociations
        : undefined,
      maxAssociations: typeof defaults.maxAssociations === 'number'
        ? defaults.maxAssociations
        : undefined,
    });
  }, [graphicAssociateHotspots.length]);

  const setBackground = (image: ImageAsset) =>
    update({
      ...draft,
      graphicAssociateBackgroundSrc: image.source,
      graphicAssociateBackgroundAlt: image.alt,
      graphicAssociateBackgroundLongDesc: image.longDescription,
      graphicAssociateBackgroundType: image.mimeType,
      graphicAssociateBackgroundWidth: image.width,
      graphicAssociateBackgroundHeight: image.height,
    });
  const setGraphicAssociateResponseId = (value: string) =>
    setDraftField('responseIdentifier', value);
  const setPromptHtml = (value: string) => setDraftField('promptHtml', value);

  const setGraphicAssociateHotspots = (
    value:
      | GraphicAssociateHotspot[]
      | ((prev: GraphicAssociateHotspot[]) => GraphicAssociateHotspot[]),
  ) =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'graphicAssociateHotspots',
      value,
    );

  const setGraphicAssociateCorrectPairs = (
    value: GraphicAssociatePair[] | ((prev: GraphicAssociatePair[]) => GraphicAssociatePair[]),
  ) =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'graphicAssociateCorrectPairs',
      value,
    );

  const nextGraphicAssociateHotspotId = (): string => {
    const existing = new Set(graphicAssociateHotspots.map((h) => (h.id ?? '').toUpperCase()));
    for (let i = 0; i < 26; i++) {
      const candidate = String.fromCharCode('A'.charCodeAt(0) + i);
      if (!existing.has(candidate)) return candidate;
    }
    let idx = existing.size + 1;
    let candidate = `GA_${idx}`;
    while (existing.has(candidate.toUpperCase())) {
      idx += 1;
      candidate = `GA_${idx}`;
    }
    return candidate;
  };

  const addGraphicAssociateHotspot = () => {
    const id = nextGraphicAssociateHotspotId();
    setGraphicAssociateHotspots((prev) => [
      ...prev,
      { id, shape: 'circle', coords: '50,50,10', matchMax: 2 },
    ]);
  };

  const removeGraphicAssociateHotspot = (id: string) => {
    setGraphicAssociateHotspots((prev) => prev.filter((h) => h.id !== id));
    setGraphicAssociateCorrectPairs((prev) =>
      prev.filter((p) => p.sourceId !== id && p.targetId !== id)
    );
  };

  const updateGraphicAssociateHotspotId = (id: string, nextInput: string) => {
    const sanitizedBase = sanitizeIdentifier(nextInput || id, id);
    let finalId = sanitizedBase;
    if (graphicAssociateHotspots.some((h) => h.id === finalId && h.id !== id)) {
      let suffix = 2;
      const base = sanitizedBase.replace(/_\\d+$/, '');
      while (graphicAssociateHotspots.some((h) => h.id === `${base}_${suffix}`)) suffix += 1;
      finalId = `${base}_${suffix}`;
    }
    setGraphicAssociateHotspots((prev) =>
      prev.map((h) => (h.id === id ? { ...h, id: finalId } : h))
    );
    setGraphicAssociateCorrectPairs((prev) =>
      prev.map((p) => {
        if (p.sourceId === id) return { ...p, sourceId: finalId };
        if (p.targetId === id) return { ...p, targetId: finalId };
        return p;
      })
    );
  };

  const updateGraphicAssociateHotspotShape = (
    id: string,
    shape: GraphicAssociateHotspot['shape'],
  ) => {
    setGraphicAssociateHotspots((prev) => prev.map((h) => (h.id === id ? { ...h, shape } : h)));
  };

  const updateGraphicAssociateHotspotCoords = (id: string, coords: string) => {
    setGraphicAssociateHotspots((prev) => prev.map((h) => (h.id === id ? { ...h, coords } : h)));
  };

  const updateGraphicAssociateHotspotMatchMax = (id: string, val?: number) => {
    setGraphicAssociateHotspots((prev) =>
      prev.map((h) => (h.id === id ? { ...h, matchMax: val } : h))
    );
  };

  const setGraphicAssociatePairs = (pairs: GraphicAssociatePair[]) => {
    setGraphicAssociateCorrectPairs(pairs);
  };

  return (
    <GraphicAssociateContent
      renderPromptField={editor.renderPromptField ?? (() => null)}
      fieldHasIssue={editor.fieldHasIssue ?? (() => false)}
      fieldIssueText={editor.fieldIssueText ?? (() => undefined)}
      promptHtml={promptHtml}
      setPromptHtml={setPromptHtml}
      background={{
        source: graphicAssociateBackgroundSrc,
        alt: graphicAssociateBackgroundAlt,
        longDescription: graphicAssociateBackgroundLongDesc,
        mimeType: graphicAssociateBackgroundType,
        width: graphicAssociateBackgroundWidth,
        height: graphicAssociateBackgroundHeight,
      }}
      graphicAssociateResponseId={graphicAssociateResponseId}
      graphicAssociateHotspots={graphicAssociateHotspots}
      graphicAssociateCorrectPairs={graphicAssociateCorrectPairs}
      maxAssociations={maxAssociations}
      setBackground={setBackground}
      setGraphicAssociateResponseId={setGraphicAssociateResponseId}
      addGraphicAssociateHotspot={addGraphicAssociateHotspot}
      removeGraphicAssociateHotspot={removeGraphicAssociateHotspot}
      updateGraphicAssociateHotspotId={updateGraphicAssociateHotspotId}
      updateGraphicAssociateHotspotShape={updateGraphicAssociateHotspotShape}
      updateGraphicAssociateHotspotCoords={updateGraphicAssociateHotspotCoords}
      updateGraphicAssociateHotspotMatchMax={updateGraphicAssociateHotspotMatchMax}
      setGraphicAssociatePairs={setGraphicAssociatePairs}
    />
  );
}

export function GraphicAssociateContent(props: GraphicAssociateContentProps) {
  const i18n = useI18n();
  const issueId = useDomId();
  const pairIssue = props.fieldHasIssue('matchPairs') || props.fieldHasIssue('correct');
  const [activeHotspotId, setActiveHotspotId] = useState<string>(() =>
    props.graphicAssociateHotspots[0]?.id ?? ''
  );

  useEffect(() => {
    if (!props.graphicAssociateHotspots.length) {
      if (activeHotspotId) setActiveHotspotId('');
      return;
    }
    if (!props.graphicAssociateHotspots.some((h) => h.id === activeHotspotId)) {
      setActiveHotspotId(props.graphicAssociateHotspots[0]?.id ?? '');
    }
  }, [props.graphicAssociateHotspots, activeHotspotId]);

  const matrixChoices = props.graphicAssociateHotspots.map((h) => ({
    id: h.id,
    text: h.id,
    matchMax: h.matchMax,
  }));

  return (
    <div class='space-y-5'>
      {props.renderPromptField(i18n.t('driver.graphicAssociatePrompt'))}
      <ResponseIdentifierDisclosure
        value={props.graphicAssociateResponseId}
        onChange={props.setGraphicAssociateResponseId}
      />

      <ImageAssetEditor
        labels={{
          source: i18n.t('driver.graphicAssociateBackgroundSource'),
          alt: i18n.t('driver.graphicAssociateBackgroundAlt'),
          altPlaceholder: i18n.t('driver.graphicAssociateBackgroundAltPlaceholder'),
          longDescription: i18n.t('driver.graphicAssociateBackgroundLongDescription'),
          mimeType: i18n.t('driver.graphicAssociateBackgroundMimeType'),
          width: i18n.t('driver.graphicAssociateBackgroundWidth'),
          height: i18n.t('driver.graphicAssociateBackgroundHeight'),
        }}
        value={props.background}
        fields={['longDescription', 'mimeType', 'width', 'height']}
        minimumDimension={0}
        onChange={props.setBackground}
      />

      <div class='space-y-3'>
        <AuthoringSectionHeader
          heading={
            <strong class='text-sm text-base-content/80'>
              {i18n.t('driver.graphicAssociateHotspots')}
            </strong>
          }
        >
          <Button size='sm' type='button' onClick={props.addGraphicAssociateHotspot}>
            + {i18n.t('driver.graphicAssociateAddHotspot')}
          </Button>
        </AuthoringSectionHeader>
        <p class='text-xs text-base-content/60'>
          {i18n.t('driver.graphicAssociateHotspotsHelp')}
        </p>
        {props.fieldHasIssue('choices') && (
          <FieldIssueMessage
            id={`${issueId}-choices`}
            message={props.fieldIssueText('choices') ?? ''}
          />
        )}
        {props.graphicAssociateHotspots.length === 0 && (
          <p class='text-sm text-base-content/60'>
            {i18n.t('driver.graphicAssociateHotspotsEmpty')}
          </p>
        )}
        <div class='space-y-2'>
          {props.graphicAssociateHotspots.map((spot) => (
            <AuthoringFieldGrid
              key={spot.id}
              selected={spot.id === activeHotspotId}
            >
              <label class='ds-form-control'>
                <span class='text-xs'>{i18n.t('driver.graphicAssociateId')}</span>
                <Input
                  value={spot.id}
                  data-editor-field='choices'
                  aria-invalid={props.fieldHasIssue('choices') || undefined}
                  aria-describedby={props.fieldHasIssue('choices')
                    ? `${issueId}-choices`
                    : undefined}
                  onInput={(e) =>
                    props.updateGraphicAssociateHotspotId(
                      spot.id,
                      (e.target as HTMLInputElement).value,
                    )}
                  placeholder='A'
                />
              </label>
              <label class='ds-form-control'>
                <span class='text-xs'>{i18n.t('driver.graphicAssociateShape')}</span>
                <Select
                  value={spot.shape}
                  aria-invalid={props.fieldHasIssue('choices') || undefined}
                  aria-describedby={props.fieldHasIssue('choices')
                    ? `${issueId}-choices`
                    : undefined}
                  onInput={(e) => props.updateGraphicAssociateHotspotShape(
                    spot.id,
                    (e.target as HTMLSelectElement).value as GraphicAssociateHotspot['shape'],
                  )}
                >
                  <option value='rect'>{i18n.t('driver.graphicAssociateRect')}</option>
                  <option value='circle'>{i18n.t('driver.graphicAssociateCircle')}</option>
                  <option value='poly'>{i18n.t('driver.graphicAssociatePoly')}</option>
                </Select>
              </label>
              <label class='ds-form-control'>
                <span class='text-xs'>{i18n.t('driver.graphicAssociateCoords')}</span>
                <Input
                  value={spot.coords}
                  placeholder={spot.shape === 'circle' ? 'x,y,r' : 'x1,y1,x2,y2'}
                  readOnly
                />
              </label>
              <AssociationLimitField
                value={spot.matchMax}
                onChange={(value) => props.updateGraphicAssociateHotspotMatchMax(spot.id, value)}
                ariaLabel={i18n.t('driver.graphicAssociateMaximumLinks', { id: spot.id })}
                label={i18n.t('driver.graphicAssociateMaxLinks')}
                hint={null}
                widthClass='w-full'
              />
              <div class='flex items-center justify-end gap-3'>
                <Button
                  size='xs'
                  type='button'
                  variant={spot.id === activeHotspotId ? 'primary' : 'ghost'}
                  onClick={() => setActiveHotspotId(spot.id)}
                  aria-label={i18n.t('driver.graphicAssociateEditHotspot', {
                    number: props.graphicAssociateHotspots.indexOf(spot) + 1,
                  })}
                >
                  {i18n.t('driver.edit')}
                </Button>
                <Button
                  size='xs'
                  variant='danger-ghost'
                  type='button'
                  disabled={props.graphicAssociateHotspots.length <= 2}
                  onClick={() => props.removeGraphicAssociateHotspot(spot.id)}
                  aria-label={i18n.t('driver.graphicAssociateRemoveHotspot', {
                    number: props.graphicAssociateHotspots.indexOf(spot) + 1,
                  })}
                >
                  {i18n.t('driver.remove')}
                </Button>
              </div>
            </AuthoringFieldGrid>
          ))}
        </div>
      </div>

      <div class='space-y-2'>
        <div class='flex flex-wrap items-center gap-2'>
          <strong class='text-sm text-base-content/80'>
            {i18n.t('driver.graphicAssociateHotspotEditor')}
          </strong>
          {props.graphicAssociateHotspots.length > 0 && (
            <label class='flex items-center gap-2'>
              <span class='text-xs text-base-content/60'>
                {i18n.t('driver.graphicAssociateEditingHotspot')}
              </span>
              <span class='block w-20'>
                <Select
                  size='sm'
                  value={activeHotspotId}
                  onInput={(e) => setActiveHotspotId((e.target as HTMLSelectElement).value)}
                >
                  {props.graphicAssociateHotspots.map((h) => (
                    <option key={h.id} value={h.id}>{h.id}</option>
                  ))}
                </Select>
              </span>
            </label>
          )}
        </div>
        <HotspotCanvasEditor
          backgroundSrc={props.background.source}
          backgroundAlt={props.background.alt}
          backgroundWidth={props.background.width}
          backgroundHeight={props.background.height}
          hotspots={props.graphicAssociateHotspots}
          activeHotspotId={activeHotspotId}
          updateHotspotCoords={props.updateGraphicAssociateHotspotCoords}
        />
      </div>

      <div class='space-y-3'>
        <div class='flex items-center justify-between'>
          <strong class='text-sm text-base-content/80'>
            {i18n.t('driver.graphicAssociateCorrectPairs')}
          </strong>
        </div>
        {pairIssue && (
          <FieldIssueMessage
            id={`${issueId}-pairs`}
            message={props.fieldIssueText('matchPairs') ?? props.fieldIssueText('correct') ?? ''}
          />
        )}
        <AssociateMatrix
          choices={matrixChoices}
          pairs={props.graphicAssociateCorrectPairs}
          onChange={props.setGraphicAssociatePairs}
          maxAssociations={props.maxAssociations}
          issueId={pairIssue ? `${issueId}-pairs` : undefined}
          rowLabel={i18n.t('driver.graphicAssociateMatrixRowLabel')}
        />
        <p class='text-xs text-base-content/60'>
          {i18n.t('driver.graphicAssociateUnorderedPairHelp')}
        </p>
      </div>
    </div>
  );
}

attachStandardDriverViews('graphic_associate', GraphicAssociateEditor);
