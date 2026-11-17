import { useDomId } from '../../lib/rendering/island_context.tsx';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useI18n } from '../../lib/i18n/context.tsx';
import Button from '../../components/ui/Button.tsx';
import Input, { FieldIssueMessage } from '../../components/ui/Input.tsx';
import Select from '../../components/ui/Select.tsx';
import { selectPointCardinalityPolicy } from '../../lib/types/select_point_cardinality.ts';

type Point = { x: number; y: number };
type ImageSize = { width: number; height: number };
type ClientRect = { left: number; top: number; width: number; height: number };

export function parseSelectPoint(value: string): Point | null {
  const parts = value.replace(/,/g, ' ').trim().split(/\s+/).map(Number);
  if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part))) return null;
  return { x: parts[0], y: parts[1] };
}

export function formatSelectPoint(point: Point): string {
  return `${Math.round(point.x)} ${Math.round(point.y)}`;
}

export function clientPositionToImagePoint(
  clientX: number,
  clientY: number,
  rect: ClientRect,
  imageSize: ImageSize,
): Point | null {
  if (!rect.width || !rect.height || !imageSize.width || !imageSize.height) return null;
  return {
    x: clamp(((clientX - rect.left) / rect.width) * imageSize.width, 0, imageSize.width),
    y: clamp(((clientY - rect.top) / rect.height) * imageSize.height, 0, imageSize.height),
  };
}

export function moveSelectPoint(
  point: Point,
  key: string,
  step: number,
  imageSize: ImageSize,
): Point {
  const delta = Math.max(1, step);
  if (key === 'ArrowLeft') {
    return { ...point, x: clamp(point.x - delta, 0, imageSize.width) };
  }
  if (key === 'ArrowRight') {
    return { ...point, x: clamp(point.x + delta, 0, imageSize.width) };
  }
  if (key === 'ArrowUp') {
    return { ...point, y: clamp(point.y - delta, 0, imageSize.height) };
  }
  if (key === 'ArrowDown') {
    return { ...point, y: clamp(point.y + delta, 0, imageSize.height) };
  }
  return point;
}

/** Edit the complete correct-point collection, including visual placement. */
export function SelectPointCorrectPointsEditor(props: {
  imageSrc: string;
  imageAlt?: string;
  imageWidth?: number;
  imageHeight?: number;
  maxChoices?: number;
  value: readonly string[];
  issue?: string;
  onChange: (points: string[]) => void;
}) {
  const i18n = useI18n();
  const correctIssueId = useDomId();
  const [activePointIndex, setActivePointIndex] = useState(0);
  const policy = selectPointCardinalityPolicy(props.maxChoices);
  const isSinglePoint = policy.pointLimit === 1;
  const isAtPointLimit = policy.pointLimit !== undefined &&
    props.value.length >= policy.pointLimit;

  useEffect(() => {
    setActivePointIndex((current) =>
      props.value.length === 0 ? 0 : Math.min(current, props.value.length - 1)
    );
  }, [props.value.length]);

  const addPoint = (value = '') => {
    if (isAtPointLimit) return;
    setActivePointIndex(props.value.length);
    props.onChange([...props.value, value]);
  };

  const updatePoint = (index: number, value: string) => {
    if (props.value.length === 0) {
      addPoint(value);
      return;
    }
    props.onChange(props.value.map((point, pointIndex) => pointIndex === index ? value : point));
  };

  const removePoint = (index: number) => {
    props.onChange(props.value.filter((_, pointIndex) => pointIndex !== index));
  };

  return (
    <div class='space-y-3'>
      <div class='flex flex-wrap items-center justify-between gap-2'>
        <div class='flex items-center gap-2'>
          <strong class='text-sm text-base-content/80'>
            {isSinglePoint
              ? i18n.t('driver.selectPointCorrectPoint')
              : i18n.t('driver.selectPointCorrectPoints')}
          </strong>
          {!isSinglePoint && (
            <span class='text-xs text-base-content/55'>
              {policy.pointLimit === undefined
                ? i18n.t('driver.selectPointCount', { count: props.value.length })
                : i18n.t('driver.selectPointCountOfLimit', {
                  count: props.value.length,
                  limit: policy.pointLimit,
                })}
            </span>
          )}
        </div>
        {(!isSinglePoint || props.value.length === 0) && (
          <Button
            size='sm'
            type='button'
            disabled={isAtPointLimit}
            data-editor-field={props.value.length === 0 ? 'correct' : undefined}
            aria-describedby={props.issue !== undefined ? correctIssueId : undefined}
            onClick={() => addPoint()}
          >
            {isSinglePoint
              ? i18n.t('driver.selectPointSetPoint')
              : i18n.t('driver.selectPointAddPoint')}
          </Button>
        )}
      </div>

      {props.issue !== undefined && <FieldIssueMessage id={correctIssueId} message={props.issue} />}

      {props.value.length === 0 && (
        <p class='text-sm text-base-content/60'>
          {isSinglePoint
            ? i18n.t('driver.selectPointEmptySingle')
            : i18n.t('driver.selectPointEmptyMultiple')}
        </p>
      )}

      {props.value.length > 0 && (
        <ol class='space-y-2' role='list'>
          {props.value.map((point, index) => (
            <li
              key={`select-point-correct-${index}`}
              class={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1 ${
                index === activePointIndex ? 'bg-primary/5 ring-1 ring-primary/25' : ''
              }`}
            >
              <label class='contents'>
                <span class='text-xs font-medium text-base-content/65'>
                  {i18n.t('driver.selectPointIndexed', { number: index + 1 })}
                </span>
                <Input
                  size='sm'
                  value={point}
                  data-editor-field='correct'
                  aria-invalid={props.issue !== undefined || undefined}
                  aria-describedby={props.issue !== undefined ? correctIssueId : undefined}
                  onFocus={() => setActivePointIndex(index)}
                  onInput={(event) => updatePoint(index, event.currentTarget.value)}
                  placeholder='x y'
                />
              </label>
              <div class='flex items-center gap-1'>
                {index === activePointIndex
                  ? (
                    <span class='ds-badge ds-badge-sm border-primary/25 bg-base-200 text-base-content/75'>
                      {i18n.t('driver.editing')}
                    </span>
                  )
                  : (
                    <Button
                      size='xs'
                      variant='ghost'
                      type='button'
                      onClick={() => setActivePointIndex(index)}
                    >
                      {i18n.t('driver.selectPointEdit', { number: index + 1 })}
                    </Button>
                  )}
                <Button
                  size='xs'
                  variant='danger-ghost'
                  type='button'
                  onClick={() => removePoint(index)}
                >
                  {i18n.t('driver.selectPointRemove', { number: index + 1 })}
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div class='space-y-2'>
        <div class='flex flex-wrap items-center gap-2'>
          <strong class='text-sm text-base-content/80'>
            {i18n.t('driver.selectPointEditor')}
          </strong>
          {props.value.length > 1 && (
            <label class='flex items-center gap-2'>
              <span class='text-xs text-base-content/60'>
                {i18n.t('driver.selectPointEditing')}
              </span>
              <span class='block w-24'>
                <Select
                  size='sm'
                  value={activePointIndex}
                  onInput={(event) => setActivePointIndex(Number(event.currentTarget.value))}
                >
                  {props.value.map((_, index) => (
                    <option key={`select-point-option-${index}`} value={index}>
                      {i18n.t('driver.selectPointIndexed', { number: index + 1 })}
                    </option>
                  ))}
                </Select>
              </span>
            </label>
          )}
        </div>
        <SelectPointCanvas
          imageSrc={props.imageSrc}
          imageAlt={props.imageAlt}
          imageWidth={props.imageWidth}
          imageHeight={props.imageHeight}
          points={props.value}
          activePointIndex={activePointIndex}
          onPlacePoint={updatePoint}
        />
      </div>
    </div>
  );
}

function SelectPointCanvas(props: {
  imageSrc: string;
  imageAlt?: string;
  imageWidth?: number;
  imageHeight?: number;
  points: readonly string[];
  activePointIndex: number;
  onPlacePoint: (index: number, value: string) => void;
}) {
  const i18n = useI18n();
  const instructionId = useDomId();
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageSize, setImageSize] = useState<ImageSize>(() => ({
    width: props.imageWidth ?? 640,
    height: props.imageHeight ?? 360,
  }));

  useEffect(() => {
    if (!props.imageWidth && !props.imageHeight) return;
    setImageSize((current) => ({
      width: props.imageWidth ?? current.width,
      height: props.imageHeight ?? current.height,
    }));
  }, [props.imageWidth, props.imageHeight]);

  const parsedPoints = useMemo(
    () =>
      props.points
        .map((value, index) => ({ index, point: parseSelectPoint(value) }))
        .filter((entry): entry is { index: number; point: Point } => entry.point !== null),
    [props.points],
  );

  const activeIndex = props.points.length === 0
    ? 0
    : clamp(props.activePointIndex, 0, props.points.length - 1);
  const activePoint = parseSelectPoint(props.points[activeIndex] ?? '');
  const activeLabel = i18n.t('driver.selectPointIndexed', { number: activeIndex + 1 });

  const placePoint = (point: Point) => {
    props.onPlacePoint(activeIndex, formatSelectPoint(point));
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const isArrow = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key);
    if (isArrow) {
      event.preventDefault();
      const start = activePoint ?? {
        x: imageSize.width / 2,
        y: imageSize.height / 2,
      };
      placePoint(moveSelectPoint(start, event.key, event.shiftKey ? 10 : 1, imageSize));
      return;
    }

    if ((event.key === 'Enter' || event.key === ' ') && !activePoint) {
      event.preventDefault();
      placePoint({ x: imageSize.width / 2, y: imageSize.height / 2 });
    }
  };

  return (
    <div class='rounded-lg border border-base-200 bg-base-100 p-3'>
      {props.imageSrc
        ? (
          <div class='space-y-2'>
            <button
              type='button'
              class='relative block w-full max-w-3xl cursor-crosshair overflow-hidden rounded-md border border-base-200 bg-base-100 p-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
              aria-label={i18n.t('driver.selectPointPlace', { number: activeIndex + 1 })}
              aria-describedby={instructionId}
              onClick={(event) => {
                if (event.detail === 0) return;
                const rect = imageRef.current?.getBoundingClientRect();
                if (!rect) return;
                const point = clientPositionToImagePoint(
                  event.clientX,
                  event.clientY,
                  rect,
                  imageSize,
                );
                if (point) placePoint(point);
              }}
              onKeyDown={(event) => handleKeyDown(event as unknown as KeyboardEvent)}
            >
              <img
                ref={imageRef}
                src={props.imageSrc}
                alt={props.imageAlt ?? ''}
                class='block h-auto w-full'
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (image.naturalWidth && image.naturalHeight) {
                    setImageSize({
                      width: image.naturalWidth,
                      height: image.naturalHeight,
                    });
                  }
                }}
              />
              <svg
                aria-hidden='true'
                viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
                class='pointer-events-none absolute inset-0 h-full w-full'
              >
                {parsedPoints.map(({ index, point }) => {
                  const active = index === activeIndex;
                  return (
                    <g
                      key={`select-point-marker-${index}`}
                      class={active ? 'text-primary' : 'text-base-content/60'}
                    >
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={active ? 11 : 8}
                        fill='currentColor'
                        fill-opacity={active ? 0.2 : 0.12}
                        stroke='currentColor'
                        stroke-width={active ? 3 : 2}
                      />
                      <path
                        d={`M ${point.x - 15} ${point.y} H ${point.x + 15} M ${point.x} ${
                          point.y - 15
                        } V ${point.y + 15}`}
                        fill='none'
                        stroke='currentColor'
                        stroke-width={active ? 3 : 2}
                        stroke-linecap='round'
                      />
                    </g>
                  );
                })}
              </svg>
            </button>
            <p id={instructionId} class='text-xs text-base-content/65'>
              {i18n.t('driver.selectPointInstruction', { point: activeLabel })}
            </p>
          </div>
        )
        : (
          <div class='flex min-h-[240px] items-center justify-center rounded-md border border-dashed border-base-300 bg-base-200/20 px-6 py-8 text-center'>
            <p class='max-w-md text-sm text-base-content/65'>
              {i18n.t('driver.selectPointNoImage')}
            </p>
          </div>
        )}
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
