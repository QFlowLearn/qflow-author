import { useDomId } from '../../lib/rendering/island_context.tsx';
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

/** A selectable tab's stable value, visible label, and optional pointer-focus target. */
export type TabDefinition = {
  readonly value: string;
  readonly label: string;
  readonly focusPanelSelector?: string;
};

type TabItems = readonly [TabDefinition, ...ReadonlyArray<TabDefinition>];

type Props<Items extends TabItems> = {
  readonly value: NoInfer<Items[number]['value']>;
  readonly items: Items;
  readonly onChange: (value: NoInfer<Items[number]['value']>) => void;
  readonly renderPanel: (value: Items[number]['value']) => ComponentChildren;
  readonly ariaLabel: string;
  readonly keepMounted?: readonly NoInfer<Items[number]['value']>[];
};

/**
 * Renders a controlled horizontal tab set with linked panels and automatic keyboard activation.
 */
export default function Tabs<const Items extends TabItems>({
  value,
  items,
  onChange,
  renderPanel,
  ariaLabel,
  keepMounted = [],
}: Props<Items>) {
  const id = useDomId();
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const panelsRef = useRef<Array<HTMLDivElement | null>>([]);
  const [panelFocusRequest, setPanelFocusRequest] = useState<
    {
      readonly index: number;
      readonly selector: string;
    } | null
  >(null);
  const selectedIndex = items.findIndex((item) => item.value === value);
  if (selectedIndex < 0) {
    throw new Error(`Tabs "${ariaLabel}" received an unknown value: ${value}.`);
  }

  useEffect(() => {
    if (!panelFocusRequest || panelFocusRequest.index !== selectedIndex) return;
    const frame = requestAnimationFrame(() => {
      panelsRef.current[panelFocusRequest.index]
        ?.querySelector<HTMLElement>(panelFocusRequest.selector)
        ?.focus();
      setPanelFocusRequest(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [panelFocusRequest, selectedIndex]);

  function selectFromKeyboard(
    event: JSX.TargetedKeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowLeft':
        nextIndex = (currentIndex - 1 + items.length) % items.length;
        break;
      case 'ArrowRight':
        nextIndex = (currentIndex + 1) % items.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = items.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const nextItem = items[nextIndex];
    if (!nextItem) return;
    onChange(nextItem.value);
    buttonsRef.current[nextIndex]?.focus();
  }

  return (
    <div>
      <div
        role='tablist'
        aria-label={ariaLabel}
        aria-orientation='horizontal'
        class='ds-tabs ds-tabs-bordered ds-tabs-md w-fit max-w-full overflow-x-auto'
      >
        {items.map((item, index) => {
          const selected = index === selectedIndex;
          const tabId = `${id}-tab-${index}`;
          const panelId = `${id}-panel-${index}`;
          return (
            <button
              key={item.value}
              ref={(button) => {
                buttonsRef.current[index] = button;
              }}
              id={tabId}
              role='tab'
              type='button'
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              class={[
                'ds-tab transition-colors duration-150',
                selected
                  ? 'ds-tab-active font-medium text-base-content'
                  : 'text-base-content/65 hover:text-base-content',
              ].join(' ')}
              onClick={(event) => {
                onChange(item.value);
                if (event.detail > 0 && item.focusPanelSelector) {
                  setPanelFocusRequest({ index, selector: item.focusPanelSelector });
                }
              }}
              onKeyDown={(event) => selectFromKeyboard(event, index)}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {items.map((item, index) => {
        const selected = index === selectedIndex;
        return (
          <div
            key={item.value}
            ref={(panel) => {
              panelsRef.current[index] = panel;
            }}
            id={`${id}-panel-${index}`}
            role='tabpanel'
            aria-labelledby={`${id}-tab-${index}`}
            tabIndex={0}
            hidden={!selected}
            class='mt-4 min-w-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary'
          >
            {selected || keepMounted.includes(item.value) ? renderPanel(item.value) : null}
          </div>
        );
      })}
    </div>
  );
}
