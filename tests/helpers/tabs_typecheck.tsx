import Tabs from '../../components/ui/Tabs.tsx';

// The strict source check covers this compile-time fixture. The function is
// intentionally not called; its body keeps the controlled value tied to the
// literal values declared by the tab items at compile time.
export function typeCheckTabsRejectsUnknownValues() {
  <Tabs
    ariaLabel='Invalid example'
    // @ts-expect-error "missing" is not one of the item values.
    value='missing'
    onChange={() => {}}
    items={[
      { value: 'content', label: 'Content' },
      { value: 'preview', label: 'Preview' },
    ]}
    renderPanel={() => null}
  />;
}
