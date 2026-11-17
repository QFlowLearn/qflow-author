import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import Button from '../../components/ui/Button.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';

export type CanvasHotspot = {
  id: string;
  shape: 'circle' | 'rect' | 'poly' | 'ellipse' | 'default';
  coords: string;
};

type Point = { x: number; y: number };
type DragShape = 'rect' | 'circle' | 'ellipse' | 'default';
type DragState = { start: Point; shape: DragShape };

export function HotspotCanvasEditor(props: {
  backgroundSrc?: string;
  backgroundAlt?: string;
  backgroundWidth?: number;
  backgroundHeight?: number;
  hotspots: CanvasHotspot[];
  activeHotspotId: string;
  updateHotspotCoords: (id: string, coords: string) => void;
  emptyMessage?: string;
}) {
  const i18n = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [imageSize, setImageSize] = useState<{ w: number; h: number }>(() => ({
    w: props.backgroundWidth ?? 640,
    h: props.backgroundHeight ?? 360,
  }));
  const [drag, setDrag] = useState<DragState | null>(null);

  useEffect(() => {
    if (props.backgroundWidth || props.backgroundHeight) {
      setImageSize((prev) => ({
        w: props.backgroundWidth ?? prev.w,
        h: props.backgroundHeight ?? prev.h,
      }));
    }
  }, [props.backgroundWidth, props.backgroundHeight]);

  const activeHotspot = useMemo(
    () => props.hotspots.find((h) => h.id === props.activeHotspotId),
    [props.hotspots, props.activeHotspotId],
  );

  const polyPoints = useMemo(
    () => (activeHotspot?.shape === 'poly' ? parsePoints(activeHotspot.coords ?? '') : []),
    [activeHotspot?.shape, activeHotspot?.coords],
  );

  const isDrawable = Boolean(props.backgroundSrc && activeHotspot);

  const setCoordsForActive = (coords: string) => {
    if (!activeHotspot) return;
    props.updateHotspotCoords(activeHotspot.id, coords);
  };

  const handlePointerDown = (e: PointerEvent) => {
    if (!isDrawable || !activeHotspot || !containerRef.current) return;
    const point = toImagePoint(e, containerRef.current, imageSize);
    if (!point) return;

    if (activeHotspot.shape === 'poly') {
      const next = [...polyPoints, point];
      setCoordsForActive(pointsToCoords(next));
      return;
    }

    const shape = activeHotspot.shape;
    if (!['rect', 'circle', 'ellipse', 'default'].includes(shape)) return;
    const rounded = roundPoint(point);
    setDrag({ start: rounded, shape: shape as DragShape });
    if (shape === 'rect' || shape === 'default') {
      setCoordsForActive(`${rounded.x},${rounded.y},${rounded.x},${rounded.y}`);
    } else if (shape === 'ellipse') {
      setCoordsForActive(`${rounded.x},${rounded.y},1,1`);
    } else {
      setCoordsForActive(`${rounded.x},${rounded.y},1`);
    }
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!drag || !activeHotspot || !containerRef.current) return;
    const point = toImagePoint(e, containerRef.current, imageSize);
    if (!point) return;
    const rounded = roundPoint(point);

    if (drag.shape === 'rect' || drag.shape === 'default') {
      const x1 = Math.min(drag.start.x, rounded.x);
      const y1 = Math.min(drag.start.y, rounded.y);
      const x2 = Math.max(drag.start.x, rounded.x);
      const y2 = Math.max(drag.start.y, rounded.y);
      setCoordsForActive(`${x1},${y1},${x2},${y2}`);
      return;
    }

    if (drag.shape === 'circle') {
      const r = Math.max(1, Math.round(distance(drag.start, rounded)));
      setCoordsForActive(`${drag.start.x},${drag.start.y},${r}`);
      return;
    }

    if (drag.shape === 'ellipse') {
      const rx = Math.max(1, Math.abs(rounded.x - drag.start.x));
      const ry = Math.max(1, Math.abs(rounded.y - drag.start.y));
      setCoordsForActive(`${drag.start.x},${drag.start.y},${Math.round(rx)},${Math.round(ry)}`);
    }
  };

  const stopDrag = (e?: PointerEvent) => {
    if (e?.pointerId != null) svgRef.current?.releasePointerCapture?.(e.pointerId);
    setDrag(null);
  };

  const handleUndoPoint = () => {
    if (!activeHotspot || activeHotspot.shape !== 'poly') return;
    const next = polyPoints.slice(0, -1);
    setCoordsForActive(pointsToCoords(next));
  };

  const handleClearPolygon = () => {
    if (!activeHotspot || activeHotspot.shape !== 'poly') return;
    setCoordsForActive('');
  };

  const instruction = (() => {
    if (!activeHotspot) return i18n.t('driver.hotspotInstructionSelect');
    if (activeHotspot.shape === 'poly') return i18n.t('driver.hotspotInstructionPolygon');
    if (activeHotspot.shape === 'rect' || activeHotspot.shape === 'default') {
      return i18n.t('driver.hotspotInstructionRectangle');
    }
    if (activeHotspot.shape === 'ellipse') return i18n.t('driver.hotspotInstructionEllipse');
    return i18n.t('driver.hotspotInstructionCircle');
  })();

  return (
    <div class='space-y-3'>
      <div class='rounded-lg border border-base-200 bg-base-100 p-3'>
        {props.backgroundSrc
          ? (
            <div ref={containerRef} class='relative w-full max-w-3xl'>
              <img
                src={props.backgroundSrc}
                alt={props.backgroundAlt ?? ''}
                class='block h-auto w-full rounded-md border border-base-200'
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img?.naturalWidth && img?.naturalHeight) {
                    setImageSize({ w: img.naturalWidth, h: img.naturalHeight });
                  }
                }}
              />
              <svg
                ref={svgRef}
                class='absolute inset-0 h-full w-full'
                viewBox={`0 0 ${imageSize.w} ${imageSize.h}`}
                onPointerDown={(e) => handlePointerDown(e as unknown as PointerEvent)}
                onPointerMove={(e) => handlePointerMove(e as unknown as PointerEvent)}
                onPointerUp={(e) => stopDrag(e as unknown as PointerEvent)}
                onPointerLeave={() => stopDrag()}
              >
                {props.hotspots.map((spot) =>
                  renderHotspotShape(spot, spot.id === props.activeHotspotId)
                )}
                {activeHotspot?.shape === 'poly' &&
                  polyPoints.map((pt, idx) => (
                    <circle
                      key={`${activeHotspot.id}-pt-${idx}`}
                      cx={pt.x}
                      cy={pt.y}
                      r={6}
                      fill='currentColor'
                      opacity={0.55}
                      class={activeHotspot.id === props.activeHotspotId
                        ? 'text-primary'
                        : 'text-base-content/60'}
                    />
                  ))}
              </svg>
            </div>
          )
          : (
            <div class='flex min-h-[280px] flex-col items-center justify-center rounded-md border border-dashed border-base-300 bg-base-200/20 px-6 py-8 text-center'>
              <div class='mb-4 flex h-20 w-20 items-center justify-center rounded-full border border-base-300 bg-base-100 text-base-content/55'>
                <svg
                  viewBox='0 0 64 64'
                  class='h-10 w-10'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2'
                  aria-hidden='true'
                >
                  <rect x='9' y='13' width='46' height='38' rx='6'></rect>
                  <circle cx='24' cy='27' r='5'></circle>
                  <path d='M14 45l12-12 10 10 7-7 7 9'></path>
                </svg>
              </div>
              <div class='space-y-2'>
                <p class='text-base font-medium text-base-content'>
                  {props.emptyMessage ?? i18n.t('driver.hotspotCanvasEmpty')}
                </p>
                <p class='max-w-md text-sm leading-relaxed text-base-content/65'>
                  {i18n.t('driver.hotspotCanvasFollowup')}
                </p>
              </div>
            </div>
          )}
      </div>

      <div class='flex flex-wrap items-center gap-2 text-xs text-base-content/70'>
        <span>{instruction}</span>
        {activeHotspot?.shape === 'poly' && (
          <>
            <Button size='xs' type='button' variant='ghost' onClick={handleUndoPoint}>
              {i18n.t('driver.undoPolygonPoint')}
            </Button>
            <Button size='xs' type='button' variant='ghost' onClick={handleClearPolygon}>
              {i18n.t('driver.clearPolygon')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function renderHotspotShape(spot: CanvasHotspot, isActive: boolean) {
  const numbers = parseNumbers(spot.coords ?? '');
  const strokeWidth = isActive ? 2 : 1;
  const stroke = 'currentColor';
  const className = isActive ? 'text-primary' : 'text-base-content/60';

  if (spot.shape === 'circle' && numbers.length >= 3) {
    const [cx, cy, r] = numbers;
    return (
      <circle
        key={spot.id}
        cx={cx}
        cy={cy}
        r={Math.max(1, r)}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill='currentColor'
        fillOpacity={0.15}
        class={className}
      />
    );
  }

  if ((spot.shape === 'rect' || spot.shape === 'default') && numbers.length >= 4) {
    const [x1, y1, x2, y2] = numbers;
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    return (
      <rect
        key={spot.id}
        x={x}
        y={y}
        width={w}
        height={h}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill='currentColor'
        fillOpacity={0.12}
        class={className}
      />
    );
  }

  if (spot.shape === 'ellipse' && numbers.length >= 4) {
    const [cx, cy, rx, ry] = numbers;
    return (
      <ellipse
        key={spot.id}
        cx={cx}
        cy={cy}
        rx={Math.max(1, rx)}
        ry={Math.max(1, ry)}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill='currentColor'
        fillOpacity={0.12}
        class={className}
      />
    );
  }

  if (spot.shape === 'poly' && numbers.length >= 4) {
    const points = numbersToPoints(numbers);
    if (!points.length) return null;
    const pointsAttr = points.map((p) => `${p.x},${p.y}`).join(' ');
    if (points.length >= 3) {
      return (
        <polygon
          key={spot.id}
          points={pointsAttr}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill='currentColor'
          fillOpacity={0.12}
          class={className}
        />
      );
    }
    return (
      <polyline
        key={spot.id}
        points={pointsAttr}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill='none'
        class={className}
      />
    );
  }

  return null;
}

function parseNumbers(coords: string): number[] {
  return coords
    .split(',')
    .map((raw) => Number(raw.trim()))
    .filter((val) => Number.isFinite(val));
}

function numbersToPoints(nums: number[]): Point[] {
  const points: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    points.push({ x: nums[i], y: nums[i + 1] });
  }
  return points;
}

function parsePoints(coords: string): Point[] {
  return numbersToPoints(parseNumbers(coords));
}

function pointsToCoords(points: Point[]): string {
  return points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(',');
}

function roundPoint(point: Point): Point {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function toImagePoint(
  e: PointerEvent,
  container: HTMLDivElement,
  size: { w: number; h: number },
): Point | null {
  const rect = container.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const x = ((e.clientX - rect.left) / rect.width) * size.w;
  const y = ((e.clientY - rect.top) / rect.height) * size.h;
  return {
    x: clamp(x, 0, size.w),
    y: clamp(y, 0, size.h),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
