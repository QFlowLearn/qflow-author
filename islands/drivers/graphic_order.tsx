import { useDomId } from '../../lib/rendering/island_context.tsx';
import { useEffect, useState } from 'preact/hooks';
import { setDraftFieldValue, setDraftListFieldValue } from './editor_shell.tsx';
import Button from '../../components/ui/Button.tsx';
import { AuthoringSectionHeader } from '../../components/ui/AuthoringLayout.tsx';
import Input, { FieldIssueMessage } from '../../components/ui/Input.tsx';
import ImageAssetEditor from '../../components/ui/ImageAssetEditor.tsx';
import Select from '../../components/ui/Select.tsx';
import type { DriverUiContext } from './view_registry.ts';
import {
  defaultsGraphicOrder,
  type GraphicOrderHotspot,
  type GraphicOrderShape,
} from '../../lib/types/graphic_order.ts';
import { sanitizeIdentifier } from '../../lib/identifiers.ts';
import { attachStandardDriverViews } from './standard_driver_views.ts';
import type { CommonContentProps } from './types.ts';
import { ResponseIdentifierDisclosure } from './response_identifier_disclosure.tsx';
import { HotspotCanvasEditor } from './hotspot_canvas_editor.tsx';
import type { ImageAsset } from '../../lib/types/image_asset.ts';
import { useI18n } from '../../lib/i18n/context.tsx';

export type GraphicOrderContentProps = CommonContentProps & {
  promptHtml: string;
  background: ImageAsset;
  graphicOrderResponseId: string;
  graphicOrderHotspots: GraphicOrderHotspot[];
  graphicOrderOrder: string[];
  dragIndex: number | null;

  setPromptHtml: (html: string) => void;
  setBackground: (image: ImageAsset) => void;
  setGraphicOrderResponseId: (id: string) => void;

  addGraphicOrderHotspot: () => void;
  removeGraphicOrderHotspot: (id: string) => void;
  updateGraphicOrderHotspotId: (id: string, next: string) => void;
  updateGraphicOrderHotspotShape: (id: string, shape: GraphicOrderShape) => void;
  updateGraphicOrderHotspotCoords: (id: string, coords: string) => void;
  updateGraphicOrderHotspotLabel: (id: string, label: string) => void;

  setGraphicOrderOrder: (order: string[]) => void;
  setDragIndex: (index: number | null) => void;
  reorderGraphicOrder: (from: number, to: number) => void;
};

function GraphicOrderEditor(ctx: DriverUiContext<'graphic_order'>) {
  const { editor, draft, update } = ctx;
  const graphicOrderBackgroundSrc = draft.graphicOrderBackgroundSrc ?? '';
  const graphicOrderBackgroundAlt = draft.graphicOrderBackgroundAlt ?? '';
  const graphicOrderBackgroundLongDesc = draft.graphicOrderBackgroundLongDesc ?? '';
  const graphicOrderBackgroundType = draft.graphicOrderBackgroundType ?? '';
  const graphicOrderBackgroundWidth = draft.graphicOrderBackgroundWidth;
  const graphicOrderBackgroundHeight = draft.graphicOrderBackgroundHeight;
  const graphicOrderResponseId = draft.responseIdentifier ?? 'RESPONSE';
  const graphicOrderHotspots = draft.graphicOrderHotspots;
  const graphicOrderOrder = draft.graphicOrderCorrectOrder ?? [];
  const promptHtml = draft.promptHtml ?? '';
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const setDraftField = <K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K] | ((prev: (typeof draft)[K]) => (typeof draft)[K]),
  ) => setDraftFieldValue(editor, draft, update, key, value);

  useEffect(() => {
    if (graphicOrderHotspots.length > 0) return;
    const defaults = defaultsGraphicOrder();
    update({
      ...draft,
      graphicOrderBackgroundSrc: defaults.graphicOrderBackgroundSrc ?? '',
      graphicOrderBackgroundAlt: defaults.graphicOrderBackgroundAlt ?? '',
      graphicOrderBackgroundLongDesc: defaults.graphicOrderBackgroundLongDesc ?? '',
      graphicOrderBackgroundType: defaults.graphicOrderBackgroundType ?? '',
      graphicOrderBackgroundWidth: defaults.graphicOrderBackgroundWidth,
      graphicOrderBackgroundHeight: defaults.graphicOrderBackgroundHeight,
      responseIdentifier: defaults.responseIdentifier ?? 'RESPONSE',
      graphicOrderHotspots: defaults.graphicOrderHotspots ?? [],
      graphicOrderCorrectOrder: defaults.graphicOrderCorrectOrder ?? [],
      minChoices: typeof defaults.minChoices === 'number' ? defaults.minChoices : undefined,
      maxChoices: typeof defaults.maxChoices === 'number' ? defaults.maxChoices : undefined,
    });
  }, [graphicOrderHotspots.length]);

  useEffect(() => {
    const ids = graphicOrderHotspots.map((h) => h.id);
    const normalized = normalizeOrder(graphicOrderOrder, ids);
    if (!arraysEqual(normalized, graphicOrderOrder)) {
      setDraftField('graphicOrderCorrectOrder', normalized);
    }
  }, [graphicOrderHotspots, graphicOrderOrder]);

  const setBackground = (image: ImageAsset) =>
    update({
      ...draft,
      graphicOrderBackgroundSrc: image.source,
      graphicOrderBackgroundAlt: image.alt,
      graphicOrderBackgroundLongDesc: image.longDescription,
      graphicOrderBackgroundType: image.mimeType,
      graphicOrderBackgroundWidth: image.width,
      graphicOrderBackgroundHeight: image.height,
    });
  const setGraphicOrderResponseId = (value: string) => setDraftField('responseIdentifier', value);
  const setPromptHtml = (value: string) => setDraftField('promptHtml', value);

  const setGraphicOrderHotspots = (
    value: GraphicOrderHotspot[] | ((prev: GraphicOrderHotspot[]) => GraphicOrderHotspot[]),
  ) =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'graphicOrderHotspots',
      value,
    );

  const setGraphicOrderCorrectOrder = (
    value: string[] | ((prev: string[]) => string[]),
  ) =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'graphicOrderCorrectOrder',
      value,
    );

  const nextGraphicOrderHotspotId = (): string => {
    const existing = new Set(graphicOrderHotspots.map((h) => (h.id ?? '').toUpperCase()));
    for (let i = 0; i < 26; i++) {
      const candidate = String.fromCharCode('A'.charCodeAt(0) + i);
      if (!existing.has(candidate)) return candidate;
    }
    let idx = existing.size + 1;
    let candidate = `GO_${idx}`;
    while (existing.has(candidate.toUpperCase())) {
      idx += 1;
      candidate = `GO_${idx}`;
    }
    return candidate;
  };

  const addGraphicOrderHotspot = () => {
    const id = nextGraphicOrderHotspotId();
    setGraphicOrderHotspots((prev) => [
      ...prev,
      { id, shape: 'circle', coords: '60,60,10', label: '' },
    ]);
    setGraphicOrderCorrectOrder((prev) => [...prev, id]);
  };

  const removeGraphicOrderHotspot = (id: string) => {
    setGraphicOrderHotspots((prev) => prev.filter((h) => h.id !== id));
    setGraphicOrderCorrectOrder((prev) => prev.filter((value) => value !== id));
  };

  const updateGraphicOrderHotspotId = (id: string, nextInput: string) => {
    const sanitizedBase = sanitizeIdentifier(nextInput || id, id);
    let finalId = sanitizedBase;
    if (graphicOrderHotspots.some((h) => h.id === finalId && h.id !== id)) {
      let suffix = 2;
      const base = sanitizedBase.replace(/_\\d+$/, '');
      while (graphicOrderHotspots.some((h) => h.id === `${base}_${suffix}`)) suffix += 1;
      finalId = `${base}_${suffix}`;
    }
    setGraphicOrderHotspots((prev) => prev.map((h) => (h.id === id ? { ...h, id: finalId } : h)));
    setGraphicOrderCorrectOrder((prev) => prev.map((v) => (v === id ? finalId : v)));
  };

  const updateGraphicOrderHotspotShape = (id: string, shape: GraphicOrderShape) => {
    setGraphicOrderHotspots((prev) => prev.map((h) => (h.id === id ? { ...h, shape } : h)));
  };

  const updateGraphicOrderHotspotCoords = (id: string, coords: string) => {
    setGraphicOrderHotspots((prev) => prev.map((h) => (h.id === id ? { ...h, coords } : h)));
  };

  const updateGraphicOrderHotspotLabel = (id: string, label: string) => {
    setGraphicOrderHotspots((prev) => prev.map((h) => (h.id === id ? { ...h, label } : h)));
  };

  const setGraphicOrderOrder = (order: string[]) => {
    setGraphicOrderCorrectOrder(order);
  };

  const reorderGraphicOrder = (from: number, to: number) => {
    if (
      from === to || from < 0 || to < 0 || from >= graphicOrderOrder.length ||
      to >= graphicOrderOrder.length
    ) {
      return;
    }
    const next = [...graphicOrderOrder];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setGraphicOrderCorrectOrder(next);
  };

  return (
    <GraphicOrderContent
      renderPromptField={editor.renderPromptField ?? (() => null)}
      fieldHasIssue={editor.fieldHasIssue ?? (() => false)}
      fieldIssueText={editor.fieldIssueText ?? (() => undefined)}
      promptHtml={promptHtml}
      setPromptHtml={setPromptHtml}
      background={{
        source: graphicOrderBackgroundSrc,
        alt: graphicOrderBackgroundAlt,
        longDescription: graphicOrderBackgroundLongDesc,
        mimeType: graphicOrderBackgroundType,
        width: graphicOrderBackgroundWidth,
        height: graphicOrderBackgroundHeight,
      }}
      graphicOrderResponseId={graphicOrderResponseId}
      graphicOrderHotspots={graphicOrderHotspots}
      graphicOrderOrder={graphicOrderOrder}
      dragIndex={dragIndex}
      setBackground={setBackground}
      setGraphicOrderResponseId={setGraphicOrderResponseId}
      addGraphicOrderHotspot={addGraphicOrderHotspot}
      removeGraphicOrderHotspot={removeGraphicOrderHotspot}
      updateGraphicOrderHotspotId={updateGraphicOrderHotspotId}
      updateGraphicOrderHotspotShape={updateGraphicOrderHotspotShape}
      updateGraphicOrderHotspotCoords={updateGraphicOrderHotspotCoords}
      updateGraphicOrderHotspotLabel={updateGraphicOrderHotspotLabel}
      setGraphicOrderOrder={setGraphicOrderOrder}
      setDragIndex={setDragIndex}
      reorderGraphicOrder={reorderGraphicOrder}
    />
  );
}

export function GraphicOrderContent(props: GraphicOrderContentProps) {
  const i18n = useI18n();
  const issueId = useDomId();
  const orderIssue = props.fieldHasIssue('order') || props.fieldHasIssue('correct');
  const [activeHotspotId, setActiveHotspotId] = useState<string>(() =>
    props.graphicOrderHotspots[0]?.id ?? ''
  );

  useEffect(() => {
    if (!props.graphicOrderHotspots.length) {
      if (activeHotspotId) setActiveHotspotId('');
      return;
    }
    if (!props.graphicOrderHotspots.some((h) => h.id === activeHotspotId)) {
      setActiveHotspotId(props.graphicOrderHotspots[0]?.id ?? '');
    }
  }, [props.graphicOrderHotspots, activeHotspotId]);

  return (
    <div class='space-y-5'>
      {props.renderPromptField(i18n.t('driver.graphicOrderPrompt'))}
      <ResponseIdentifierDisclosure
        value={props.graphicOrderResponseId}
        onChange={props.setGraphicOrderResponseId}
      />

      <ImageAssetEditor
        labels={{
          source: i18n.t('driver.graphicOrderBackgroundSource'),
          alt: i18n.t('driver.graphicOrderBackgroundAlt'),
          altPlaceholder: i18n.t('driver.graphicOrderBackgroundAltPlaceholder'),
          longDescription: i18n.t('driver.graphicOrderBackgroundLongDescription'),
          mimeType: i18n.t('driver.graphicOrderBackgroundMimeType'),
          width: i18n.t('driver.graphicOrderBackgroundWidth'),
          height: i18n.t('driver.graphicOrderBackgroundHeight'),
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
              {i18n.t('driver.graphicOrderHotspots')}
            </strong>
          }
        >
          <Button size='sm' type='button' onClick={props.addGraphicOrderHotspot}>
            + {i18n.t('driver.graphicOrderAddHotspot')}
          </Button>
        </AuthoringSectionHeader>
        <p class='text-xs text-base-content/60'>
          {i18n.t('driver.graphicOrderHotspotsHelp')}
        </p>
        {props.fieldHasIssue('choices') && (
          <FieldIssueMessage
            id={`${issueId}-choices`}
            message={props.fieldIssueText('choices') ?? ''}
          />
        )}
        {props.graphicOrderHotspots.length === 0 && (
          <p class='text-sm text-base-content/60'>{i18n.t('driver.graphicOrderHotspotsEmpty')}</p>
        )}
        <div class='space-y-2'>
          {props.graphicOrderHotspots.map((spot) => (
            <div
              key={spot.id}
              class={`grid gap-2 rounded-lg border border-base-200 bg-base-100 p-3 md:grid-cols-[6rem_7rem_1fr_1fr_auto] ${
                spot.id === activeHotspotId ? 'ring-1 ring-primary/40' : ''
              }`}
            >
              <label class='flex flex-col'>
                <span class='text-xs'>{i18n.t('driver.graphicOrderId')}</span>
                <Input
                  value={spot.id}
                  data-editor-field='choices'
                  aria-invalid={props.fieldHasIssue('choices') || undefined}
                  aria-describedby={props.fieldHasIssue('choices')
                    ? `${issueId}-choices`
                    : undefined}
                  onInput={(e) =>
                    props.updateGraphicOrderHotspotId(
                      spot.id,
                      (e.target as HTMLInputElement).value,
                    )}
                  placeholder='A'
                />
              </label>
              <label class='flex flex-col'>
                <span class='text-xs'>{i18n.t('driver.shape')}</span>
                <Select
                  value={spot.shape}
                  aria-invalid={props.fieldHasIssue('choices') || undefined}
                  aria-describedby={props.fieldHasIssue('choices')
                    ? `${issueId}-choices`
                    : undefined}
                  onInput={(e) =>
                    props.updateGraphicOrderHotspotShape(
                      spot.id,
                      (e.target as HTMLSelectElement).value as GraphicOrderShape,
                    )}
                >
                  <option value='rect'>{i18n.t('driver.graphicOrderRect')}</option>
                  <option value='circle'>{i18n.t('driver.circle')}</option>
                  <option value='poly'>{i18n.t('driver.graphicOrderPoly')}</option>
                  <option value='ellipse'>{i18n.t('driver.graphicOrderEllipse')}</option>
                  <option value='default'>{i18n.t('driver.graphicOrderDefaultShape')}</option>
                </Select>
              </label>
              <label class='flex flex-col'>
                <span class='text-xs'>{i18n.t('driver.graphicOrderCoords')}</span>
                <Input
                  value={spot.coords}
                  placeholder={spot.shape === 'circle' ? 'x,y,r' : 'x1,y1,x2,y2'}
                  readOnly
                />
              </label>
              <label class='flex flex-col'>
                <span class='text-xs'>{i18n.t('driver.label')}</span>
                <Input
                  value={spot.label ?? ''}
                  onInput={(e) =>
                    props.updateGraphicOrderHotspotLabel(
                      spot.id,
                      (e.target as HTMLInputElement).value,
                    )}
                  placeholder={i18n.t('driver.graphicOrderLabelPlaceholder')}
                />
              </label>
              <div class='flex items-center justify-end gap-3'>
                <Button
                  size='xs'
                  type='button'
                  variant={spot.id === activeHotspotId ? 'primary' : 'ghost'}
                  onClick={() => setActiveHotspotId(spot.id)}
                  aria-label={i18n.t('driver.graphicOrderEditHotspot', {
                    number: props.graphicOrderHotspots.indexOf(spot) + 1,
                  })}
                >
                  {i18n.t('driver.edit')}
                </Button>
                <Button
                  size='xs'
                  variant='danger-ghost'
                  type='button'
                  disabled={props.graphicOrderHotspots.length <= 2}
                  onClick={() => props.removeGraphicOrderHotspot(spot.id)}
                  aria-label={i18n.t('driver.graphicOrderRemoveHotspot', {
                    number: props.graphicOrderHotspots.indexOf(spot) + 1,
                  })}
                >
                  {i18n.t('driver.removeChoice')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div class='space-y-2'>
        <div class='flex flex-wrap items-center gap-2'>
          <strong class='text-sm text-base-content/80'>
            {i18n.t('driver.graphicOrderHotspotEditor')}
          </strong>
          {props.graphicOrderHotspots.length > 0 && (
            <label class='flex items-center gap-2'>
              <span class='text-xs text-base-content/60'>
                {i18n.t('driver.graphicOrderEditingHotspot')}
              </span>
              <span class='block w-20'>
                <Select
                  size='sm'
                  value={activeHotspotId}
                  onInput={(e) => setActiveHotspotId((e.target as HTMLSelectElement).value)}
                >
                  {props.graphicOrderHotspots.map((h) => (
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
          hotspots={props.graphicOrderHotspots}
          activeHotspotId={activeHotspotId}
          updateHotspotCoords={props.updateGraphicOrderHotspotCoords}
        />
      </div>

      <div class='space-y-3'>
        <div class='flex items-center justify-between'>
          <strong class='text-sm text-base-content/80'>
            {i18n.t('driver.graphicOrderCorrectOrder')}
          </strong>
        </div>
        {orderIssue && (
          <FieldIssueMessage
            id={`${issueId}-order`}
            message={props.fieldIssueText('order') ?? props.fieldIssueText('correct') ?? ''}
          />
        )}
        <div
          class='space-y-2'
          data-editor-field={props.graphicOrderOrder.length === 0 ? 'order' : undefined}
          role='group'
          tabIndex={props.graphicOrderOrder.length === 0 ? -1 : undefined}
          aria-label={i18n.t('driver.graphicOrderCorrectOrder')}
          aria-invalid={orderIssue || undefined}
          aria-describedby={orderIssue ? `${issueId}-order` : undefined}
        >
          {props.graphicOrderOrder.map((id, index) => (
            <div
              key={`${id}-${index}`}
              class='flex items-center justify-between rounded-lg border border-dashed border-base-300 bg-base-100 px-3 py-2 text-sm'
              draggable
              onDragStart={() => props.setDragIndex(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (props.dragIndex != null) props.reorderGraphicOrder(props.dragIndex, index);
                props.setDragIndex(null);
              }}
              tabIndex={0}
              data-editor-field='order'
              aria-label={i18n.t('driver.step', { number: index + 1 })}
              aria-invalid={orderIssue || undefined}
              aria-describedby={orderIssue ? `${issueId}-order` : undefined}
              onKeyDown={(e) => {
                if ((e as KeyboardEvent).altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                  e.preventDefault();
                  if (e.key === 'ArrowUp') props.reorderGraphicOrder(index, Math.max(0, index - 1));
                  else {
                    props.reorderGraphicOrder(
                      index,
                      Math.min(props.graphicOrderOrder.length - 1, index + 1),
                    );
                  }
                }
              }}
            >
              <div class='flex items-center gap-3'>
                <span class='text-xs uppercase text-base-content/60'>#{index + 1}</span>
                <span class='font-medium'>{id}</span>
              </div>
              <span class='text-xs text-base-content/60'>{i18n.t('driver.dragToReorder')}</span>
            </div>
          ))}
          {props.graphicOrderOrder.length === 0 && (
            <p class='text-sm text-base-content/60'>{i18n.t('driver.graphicOrderOrderEmpty')}</p>
          )}
        </div>
        <p class='text-xs text-base-content/60'>{i18n.t('driver.graphicOrderOrderHelp')}</p>
      </div>
    </div>
  );
}

attachStandardDriverViews('graphic_order', GraphicOrderEditor);

function normalizeOrder(order: string[], ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of order) {
    if (!ids.includes(entry) || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  for (const id of ids) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}
