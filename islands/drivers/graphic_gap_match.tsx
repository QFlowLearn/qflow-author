import { useDomId } from '../../lib/rendering/island_context.tsx';
import { useEffect, useState } from 'preact/hooks';
import Button from '../../components/ui/Button.tsx';
import { AuthoringFieldGrid } from '../../components/ui/AuthoringLayout.tsx';
import Input, { FieldIssueMessage } from '../../components/ui/Input.tsx';
import ImageAssetEditor from '../../components/ui/ImageAssetEditor.tsx';
import Select from '../../components/ui/Select.tsx';
import Checkbox from '../../components/ui/Checkbox.tsx';
import Textarea from '../../components/ui/Textarea.tsx';
import type {
  GraphicGapChoice,
  GraphicGapPair,
  GraphicGapTarget,
} from '../../lib/types/graphic_gap_match.ts';
import type { DriverUiContext } from './view_registry.ts';
import type { ImageAsset } from '../../lib/types/image_asset.ts';
import { sanitizeIdentifier } from '../../lib/identifiers.ts';
import { attachStandardDriverViews } from './standard_driver_views.ts';
import { commonContentProps, setDraftFieldValue, setDraftListFieldValue } from './editor_shell.tsx';
import type { CommonContentProps } from './types.ts';
import { ResponseIdentifierDisclosure } from './response_identifier_disclosure.tsx';
import { HotspotCanvasEditor } from './hotspot_canvas_editor.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';

export type GraphicGapMatchContentProps = CommonContentProps & {
  graphicBackground: ImageAsset;
  graphicResponseId: string;

  graphicChoices: GraphicGapChoice[];
  graphicTargets: GraphicGapTarget[];
  graphicCorrectPairs: GraphicGapPair[];

  setGraphicBackground: (image: ImageAsset) => void;
  setGraphicResponseId: (id: string) => void;

  addGraphicChoice: () => void;
  removeGraphicChoice: (id: string) => void;
  updateGraphicChoiceId: (id: string, next: string) => void;
  updateGraphicChoiceKind: (id: string, kind: GraphicGapChoice['kind']) => void;
  updateGraphicChoiceText: (id: string, text: string) => void;
  updateGraphicChoiceHtml: (id: string, html: string) => void;
  updateGraphicChoiceImage: (id: string, image: ImageAsset) => void;
  updateGraphicChoiceMatchMax: (id: string, val?: number) => void;
  setGraphicChoiceFixed: (id: string, fixed: boolean) => void;

  addGraphicTarget: () => void;
  removeGraphicTarget: (id: string) => void;
  updateGraphicTargetId: (id: string, next: string) => void;
  updateGraphicTargetShape: (id: string, shape: GraphicGapTarget['shape']) => void;
  updateGraphicTargetCoords: (id: string, coords: string) => void;
  updateGraphicTargetMatchMax: (id: string, val?: number) => void;

  setGraphicCorrectPair: (targetId: string, choiceId: string) => void;
};

export function GraphicGapMatchContent(props: GraphicGapMatchContentProps) {
  const i18n = useI18n();
  const issueId = useDomId();
  const choicesIssue = props.fieldHasIssue('choices') || props.fieldHasIssue('matchSources');
  const pairIssue = props.fieldHasIssue('matchPairs') || props.fieldHasIssue('correct');
  const targetsIssue = props.fieldHasIssue('matchTargets') || pairIssue;
  const choices = props.graphicChoices;
  const targets = props.graphicTargets;
  const correctByTarget = new Map(props.graphicCorrectPairs.map((p) => [p.targetId, p.choiceId]));
  const choiceIds = choices.map((c) => c.id);
  const [activeTargetId, setActiveTargetId] = useState<string>(() => targets[0]?.id ?? '');

  useEffect(() => {
    if (!targets.length) {
      if (activeTargetId) setActiveTargetId('');
      return;
    }
    if (!targets.some((t) => t.id === activeTargetId)) {
      setActiveTargetId(targets[0]?.id ?? '');
    }
  }, [targets, activeTargetId]);

  return (
    <div class='space-y-5'>
      {props.renderPromptField(i18n.t('driver.graphicGapMatchPrompt'))}
      <ResponseIdentifierDisclosure
        value={props.graphicResponseId}
        onChange={props.setGraphicResponseId}
      />

      <ImageAssetEditor
        labels={{
          source: i18n.t('driver.graphicGapMatchBackgroundSource'),
          alt: i18n.t('driver.graphicGapMatchBackgroundAlt'),
          altPlaceholder: i18n.t('driver.graphicGapMatchBackgroundAltPlaceholder'),
          longDescription: i18n.t('driver.graphicGapMatchBackgroundLongDescription'),
          mimeType: i18n.t('driver.graphicGapMatchBackgroundMimeType'),
        }}
        value={props.graphicBackground}
        fields={['longDescription', 'mimeType']}
        onChange={props.setGraphicBackground}
      />

      <div
        class='space-y-3'
        data-editor-field='choices'
        role='group'
        tabIndex={-1}
        aria-label={i18n.t('driver.graphicGapMatchChoices')}
        aria-invalid={choicesIssue || undefined}
        aria-describedby={choicesIssue ? `${issueId}-choices` : undefined}
      >
        <div class='flex items-center justify-between'>
          <strong class='text-sm text-base-content/80'>
            {i18n.t('driver.graphicGapMatchChoices')}
          </strong>
          <Button size='sm' type='button' onClick={props.addGraphicChoice}>
            + {i18n.t('driver.graphicGapMatchAddChoice')}
          </Button>
        </div>
        {choicesIssue && (
          <FieldIssueMessage
            id={`${issueId}-choices`}
            message={props.fieldIssueText('choices') ?? props.fieldIssueText('matchSources') ?? ''}
          />
        )}
        {choices.length === 0 && (
          <p class='text-sm text-base-content/60'>
            {i18n.t('driver.graphicGapMatchChoicesEmpty')}
          </p>
        )}
        <div class='space-y-2'>
          {choices.map((choice, index) => (
            <div
              key={choice.id}
              class='space-y-3 rounded-lg border border-base-200 bg-base-100 p-3'
            >
              <div class='flex items-center justify-between gap-2'>
                <strong class='text-sm text-base-content/80'>
                  {i18n.t('driver.graphicGapMatchChoice', { number: index + 1 })}
                </strong>
                <Button
                  size='xs'
                  variant='danger-ghost'
                  type='button'
                  disabled={choices.length <= 1}
                  onClick={() => props.removeGraphicChoice(choice.id)}
                  aria-label={i18n.t('driver.graphicGapMatchRemoveChoice', { number: index + 1 })}
                >
                  {i18n.t('driver.remove')}
                </Button>
              </div>
              <div class='grid gap-2 md:grid-cols-[8rem_1fr_7rem]'>
                <label class='ds-form-control'>
                  <span class='text-xs'>{i18n.t('driver.graphicGapMatchKind')}</span>
                  <Select
                    size='sm'
                    value={choice.kind}
                    onInput={(e) =>
                      props.updateGraphicChoiceKind(
                        choice.id,
                        (e.target as HTMLSelectElement).value as GraphicGapChoice['kind'],
                      )}
                  >
                    <option value='text'>{i18n.t('driver.graphicGapMatchText')}</option>
                    <option value='image'>{i18n.t('driver.graphicGapMatchImage')}</option>
                  </Select>
                </label>
                {choice.kind === 'text'
                  ? (
                    <label class='ds-form-control'>
                      <span class='text-xs'>{i18n.t('driver.graphicGapMatchText')}</span>
                      <Input
                        size='sm'
                        value={choice.text ?? ''}
                        onInput={(e) =>
                          props.updateGraphicChoiceText(
                            choice.id,
                            (e.target as HTMLInputElement).value,
                          )}
                        placeholder={i18n.t('driver.graphicGapMatchTextPlaceholder')}
                      />
                    </label>
                  )
                  : (
                    <ImageAssetEditor
                      variant='compact'
                      labels={{
                        source: i18n.t('driver.graphicGapMatchChoiceImageSource'),
                        alt: i18n.t('driver.graphicGapMatchChoiceImageAlt'),
                        altPlaceholder: i18n.t('driver.graphicGapMatchChoiceImageAltPlaceholder'),
                        mimeType: i18n.t('driver.graphicGapMatchChoiceImageMimeType'),
                      }}
                      value={{
                        source: choice.imgSrc ?? '',
                        alt: choice.imgAlt ?? '',
                        mimeType: choice.imgType,
                      }}
                      fields={['mimeType']}
                      onChange={(image) => props.updateGraphicChoiceImage(choice.id, image)}
                    />
                  )}
                <label class='ds-form-control'>
                  <span class='text-xs'>{i18n.t('driver.graphicGapMatchMatchMax')}</span>
                  <Input
                    size='sm'
                    type='number'
                    min={0}
                    value={choice.matchMax ?? ''}
                    onInput={(e) => {
                      const raw = (e.target as HTMLInputElement).value;
                      const val = raw === '' ? undefined : Math.max(0, Number(raw) || 0);
                      props.updateGraphicChoiceMatchMax(choice.id, val);
                    }}
                  />
                </label>
              </div>
              <details class='rounded-lg border border-base-300 bg-base-100'>
                <summary class='cursor-pointer px-3 py-2 text-xs font-medium text-base-content/70'>
                  {i18n.t('driver.graphicGapMatchAdvanced')}
                </summary>
                <div class='space-y-2 border-t border-base-300 p-3'>
                  <label class='ds-form-control'>
                    <span class='text-xs'>{i18n.t('driver.graphicGapMatchChoiceIdentifier')}</span>
                    <Input
                      value={choice.id}
                      onInput={(e) =>
                        props.updateGraphicChoiceId(
                          choice.id,
                          (e.target as HTMLInputElement).value,
                        )}
                      placeholder='A'
                    />
                  </label>
                  {choice.kind === 'text' && (
                    <label class='ds-form-control'>
                      <span class='text-xs'>{i18n.t('driver.graphicGapMatchHtmlLabel')}</span>
                      <Textarea
                        rows={2}
                        value={choice.html ?? ''}
                        onInput={(e) =>
                          props.updateGraphicChoiceHtml(
                            choice.id,
                            (e.target as HTMLTextAreaElement).value,
                          )}
                        placeholder={`<em>${i18n.t('driver.graphicGapMatchHtmlPlaceholder')}</em>`}
                      />
                    </label>
                  )}
                  <label class='flex items-center gap-2 text-xs text-base-content/70'>
                    <Checkbox
                      checked={!!choice.fixed}
                      onChange={(e) =>
                        props.setGraphicChoiceFixed(
                          choice.id,
                          (e.target as HTMLInputElement).checked,
                        )}
                    />
                    <span>{i18n.t('driver.graphicGapMatchFixed')}</span>
                  </label>
                </div>
              </details>
            </div>
          ))}
        </div>
      </div>

      <div class='space-y-3'>
        <div class='flex items-center justify-between'>
          <strong class='text-sm text-base-content/80'>
            {i18n.t('driver.graphicGapMatchTargets')}
          </strong>
          <Button size='sm' type='button' onClick={props.addGraphicTarget}>
            + {i18n.t('driver.graphicGapMatchAddTarget')}
          </Button>
        </div>
        <p class='text-xs text-base-content/60'>
          {i18n.t('driver.graphicGapMatchTargetsHelp')}
        </p>
        {targetsIssue && (
          <FieldIssueMessage
            id={`${issueId}-targets`}
            message={props.fieldIssueText('matchTargets') ?? props.fieldIssueText('matchPairs') ??
              props.fieldIssueText('correct') ?? ''}
          />
        )}
        {targets.length === 0 && (
          <p class='text-sm text-base-content/60'>{i18n.t('driver.graphicGapMatchTargetsEmpty')}</p>
        )}
        <div class='space-y-2'>
          {targets.map((tgt) => (
            <AuthoringFieldGrid
              key={tgt.id}
              selected={tgt.id === activeTargetId}
            >
              <label class='ds-form-control'>
                <span class='text-xs'>{i18n.t('driver.graphicGapMatchTargetId')}</span>
                <Input
                  value={tgt.id}
                  data-editor-field='matchTargets'
                  aria-invalid={props.fieldHasIssue('matchTargets') || undefined}
                  aria-describedby={props.fieldHasIssue('matchTargets')
                    ? `${issueId}-targets`
                    : undefined}
                  onInput={(e) =>
                    props.updateGraphicTargetId(tgt.id, (e.target as HTMLInputElement).value)}
                  placeholder='T1'
                />
              </label>
              <label class='ds-form-control'>
                <span class='text-xs'>{i18n.t('driver.graphicGapMatchTargetShape')}</span>
                <Select
                  value={tgt.shape}
                  onInput={(e) =>
                    props.updateGraphicTargetShape(
                      tgt.id,
                      (e.target as HTMLSelectElement).value as GraphicGapTarget['shape'],
                    )}
                >
                  <option value='rect'>{i18n.t('driver.graphicGapMatchRect')}</option>
                  <option value='circle'>{i18n.t('driver.graphicGapMatchCircle')}</option>
                  <option value='poly'>{i18n.t('driver.graphicGapMatchPoly')}</option>
                </Select>
              </label>
              <label class='ds-form-control'>
                <span class='text-xs'>{i18n.t('driver.graphicGapMatchCoords')}</span>
                <Input
                  value={tgt.coords}
                  placeholder={tgt.shape === 'circle' ? 'x,y,r' : 'x1,y1,x2,y2'}
                  readOnly
                />
              </label>
              <label class='ds-form-control'>
                <span class='text-xs'>{i18n.t('driver.graphicGapMatchMatchMax')}</span>
                <Input
                  type='number'
                  min={0}
                  value={tgt.matchMax ?? ''}
                  onInput={(e) => {
                    const raw = (e.target as HTMLInputElement).value;
                    const val = raw === '' ? undefined : Math.max(0, Number(raw) || 0);
                    props.updateGraphicTargetMatchMax(tgt.id, val);
                  }}
                />
              </label>
              <label class='ds-form-control'>
                <span class='text-xs'>{i18n.t('driver.graphicGapMatchCorrectChoice')}</span>
                <Select
                  value={correctByTarget.get(tgt.id) ?? ''}
                  data-editor-field='matchPairs'
                  aria-invalid={pairIssue || undefined}
                  aria-describedby={pairIssue ? `${issueId}-targets` : undefined}
                  onInput={(e) =>
                    props.setGraphicCorrectPair(tgt.id, (e.target as HTMLSelectElement).value)}
                >
                  <option value=''>{i18n.t('driver.graphicGapMatchSelectChoice')}</option>
                  {choiceIds.map((cid) => <option key={cid} value={cid}>{cid}</option>)}
                </Select>
              </label>
              <div class='flex items-center justify-end gap-3'>
                <Button
                  size='xs'
                  type='button'
                  variant={tgt.id === activeTargetId ? 'primary' : 'ghost'}
                  onClick={() => setActiveTargetId(tgt.id)}
                  aria-label={i18n.t('driver.graphicGapMatchEditTarget', {
                    number: targets.indexOf(tgt) + 1,
                  })}
                >
                  {i18n.t('driver.edit')}
                </Button>
                <Button
                  size='xs'
                  variant='danger-ghost'
                  type='button'
                  disabled={targets.length <= 1}
                  onClick={() => props.removeGraphicTarget(tgt.id)}
                  aria-label={i18n.t('driver.graphicGapMatchRemoveTarget', {
                    number: targets.indexOf(tgt) + 1,
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
            {i18n.t('driver.graphicGapMatchTargetEditor')}
          </strong>
          {targets.length > 0 && (
            <label class='flex items-center gap-2'>
              <span class='text-xs text-base-content/60'>
                {i18n.t('driver.graphicGapMatchEditingTarget')}
              </span>
              <span class='block w-20'>
                <Select
                  size='sm'
                  value={activeTargetId}
                  onInput={(e) => setActiveTargetId((e.target as HTMLSelectElement).value)}
                >
                  {targets.map((t) => <option key={t.id} value={t.id}>{t.id}</option>)}
                </Select>
              </span>
            </label>
          )}
        </div>
        <HotspotCanvasEditor
          backgroundSrc={props.graphicBackground.source}
          backgroundAlt={props.graphicBackground.alt}
          hotspots={targets}
          activeHotspotId={activeTargetId}
          updateHotspotCoords={props.updateGraphicTargetCoords}
          emptyMessage={i18n.t('driver.graphicGapMatchCanvasEmpty')}
        />
      </div>
    </div>
  );
}

function GraphicGapMatchEditor(ctx: DriverUiContext<'graphic_gap_match'>) {
  const { editor, draft, update } = ctx;
  const graphicChoices = draft.choices;
  const graphicTargets = draft.targets;
  const graphicCorrectPairs = draft.correctPairs;

  const setGraphicBackground = (image: ImageAsset) =>
    update({
      ...draft,
      graphicBackgroundSrc: image.source,
      graphicBackgroundAlt: image.alt,
      graphicBackgroundLongDesc: image.longDescription,
      graphicBackgroundType: image.mimeType,
    });
  const setGraphicResponseId = (value: string) =>
    setDraftFieldValue(editor, draft, update, 'responseIdentifier', value);
  const setGraphicChoices = (
    value: GraphicGapChoice[] | ((prev: GraphicGapChoice[]) => GraphicGapChoice[]),
  ) => setDraftListFieldValue(editor, draft, update, 'choices', value);
  const setGraphicTargets = (
    value: GraphicGapTarget[] | ((prev: GraphicGapTarget[]) => GraphicGapTarget[]),
  ) => setDraftListFieldValue(editor, draft, update, 'targets', value);
  const setGraphicCorrectPairs = (
    value: GraphicGapPair[] | ((prev: GraphicGapPair[]) => GraphicGapPair[]),
  ) => setDraftListFieldValue(editor, draft, update, 'correctPairs', value);

  const nextGraphicChoiceId = () => {
    const existing = new Set(graphicChoices.map((choice) => (choice.id ?? '').toUpperCase()));
    for (let i = 0; i < 26; i++) {
      const candidate = String.fromCharCode('A'.charCodeAt(0) + i);
      if (!existing.has(candidate)) return candidate;
    }
    let idx = existing.size + 1;
    let candidate = `CHOICE_${idx}`;
    while (existing.has(candidate.toUpperCase())) {
      idx += 1;
      candidate = `CHOICE_${idx}`;
    }
    return candidate;
  };

  const nextGraphicTargetId = () => {
    const existing = new Set(graphicTargets.map((target) => (target.id ?? '').toUpperCase()));
    let idx = graphicTargets.length + 1;
    let candidate = `T${idx}`;
    while (existing.has(candidate.toUpperCase())) {
      idx += 1;
      candidate = `T${idx}`;
    }
    return candidate;
  };

  return (
    <GraphicGapMatchContent
      {...commonContentProps(editor)}
      graphicBackground={{
        source: draft.graphicBackgroundSrc ?? '',
        alt: draft.graphicBackgroundAlt ?? '',
        longDescription: draft.graphicBackgroundLongDesc,
        mimeType: draft.graphicBackgroundType,
      }}
      graphicResponseId={draft.responseIdentifier ?? 'RESPONSE'}
      graphicChoices={graphicChoices}
      graphicTargets={graphicTargets}
      graphicCorrectPairs={graphicCorrectPairs}
      setGraphicBackground={setGraphicBackground}
      setGraphicResponseId={setGraphicResponseId}
      addGraphicChoice={() => {
        const id = nextGraphicChoiceId();
        setGraphicChoices((prev) => [
          ...prev,
          { id, kind: 'image', imgSrc: `choice-${id}.png`, imgAlt: `Choice ${id}`, matchMax: 1 },
        ]);
      }}
      removeGraphicChoice={(id) => {
        setGraphicChoices((prev) => prev.filter((choice) => choice.id !== id));
        setGraphicCorrectPairs((prev) => prev.filter((pair) => pair.choiceId !== id));
      }}
      updateGraphicChoiceId={(id, nextInput) => {
        const sanitizedBase = sanitizeIdentifier(nextInput || id, id);
        let finalId = sanitizedBase;
        if (graphicChoices.some((choice) => choice.id === finalId && choice.id !== id)) {
          let suffix = 2;
          const base = sanitizedBase.replace(/_\d+$/, '');
          while (graphicChoices.some((choice) => choice.id === `${base}_${suffix}`)) suffix += 1;
          finalId = `${base}_${suffix}`;
        }
        setGraphicChoices((prev) =>
          prev.map((choice) => (choice.id === id ? { ...choice, id: finalId } : choice))
        );
        setGraphicCorrectPairs((prev) =>
          prev.map((pair) => (pair.choiceId === id ? { ...pair, choiceId: finalId } : pair))
        );
      }}
      updateGraphicChoiceKind={(id, kind) =>
        setGraphicChoices((prev) =>
          prev.map((choice) => {
            if (choice.id !== id) return choice;
            if (kind === 'text') {
              const text = (choice.text ?? '').trim() ? choice.text : `Choice ${id}`;
              return { ...choice, kind, text };
            }
            const imgSrc = (choice.imgSrc ?? '').trim() ? choice.imgSrc : `choice-${id}.png`;
            return { ...choice, kind, imgSrc };
          })
        )}
      updateGraphicChoiceText={(id, text) =>
        setGraphicChoices((prev) =>
          prev.map((choice) => (choice.id === id ? { ...choice, kind: 'text', text } : choice))
        )}
      updateGraphicChoiceHtml={(id, html) =>
        setGraphicChoices((prev) =>
          prev.map((choice) => (choice.id === id ? { ...choice, kind: 'text', html } : choice))
        )}
      updateGraphicChoiceImage={(id, image) =>
        setGraphicChoices((prev) =>
          prev.map((choice) =>
            choice.id === id
              ? {
                ...choice,
                imgSrc: image.source,
                imgAlt: image.alt,
                imgType: image.mimeType,
              }
              : choice
          )
        )}
      updateGraphicChoiceMatchMax={(id, val) =>
        setGraphicChoices((prev) =>
          prev.map((choice) => (choice.id === id ? { ...choice, matchMax: val } : choice))
        )}
      setGraphicChoiceFixed={(id, fixed) =>
        setGraphicChoices((prev) =>
          prev.map((choice) => (choice.id === id ? { ...choice, fixed } : choice))
        )}
      addGraphicTarget={() => {
        const id = nextGraphicTargetId();
        setGraphicTargets((prev) => [
          ...prev,
          { id, shape: 'rect', coords: '0,0,100,50', matchMax: 1 },
        ]);
      }}
      removeGraphicTarget={(id) => {
        setGraphicTargets((prev) => prev.filter((target) => target.id !== id));
        setGraphicCorrectPairs((prev) => prev.filter((pair) => pair.targetId !== id));
      }}
      updateGraphicTargetId={(id, nextInput) => {
        const sanitizedBase = sanitizeIdentifier(nextInput || id, id);
        let finalId = sanitizedBase;
        if (graphicTargets.some((target) => target.id === finalId && target.id !== id)) {
          let suffix = 2;
          const base = sanitizedBase.replace(/_\d+$/, '');
          while (graphicTargets.some((target) => target.id === `${base}_${suffix}`)) suffix += 1;
          finalId = `${base}_${suffix}`;
        }
        setGraphicTargets((prev) =>
          prev.map((target) => (target.id === id ? { ...target, id: finalId } : target))
        );
        setGraphicCorrectPairs((prev) =>
          prev.map((pair) => (pair.targetId === id ? { ...pair, targetId: finalId } : pair))
        );
      }}
      updateGraphicTargetShape={(id, shape) =>
        setGraphicTargets((prev) =>
          prev.map((target) => (target.id === id ? { ...target, shape } : target))
        )}
      updateGraphicTargetCoords={(id, coords) =>
        setGraphicTargets((prev) =>
          prev.map((target) => (target.id === id ? { ...target, coords } : target))
        )}
      updateGraphicTargetMatchMax={(id, val) =>
        setGraphicTargets((prev) =>
          prev.map((target) => (target.id === id ? { ...target, matchMax: val } : target))
        )}
      setGraphicCorrectPair={(targetId, choiceId) =>
        setGraphicCorrectPairs((prev) => {
          const next = prev.filter((pair) => pair.targetId !== targetId);
          if (!choiceId) return next;
          return [...next, { targetId, choiceId }];
        })}
    />
  );
}

attachStandardDriverViews('graphic_gap_match', GraphicGapMatchEditor);
