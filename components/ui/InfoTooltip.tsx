type Props = {
  text: string;
  class?: string;
  placement?: 'top' | 'right' | 'bottom' | 'left';
};

export default function InfoTooltip({ text, class: cls, placement = 'top' }: Props) {
  const placementClass = `ds-tooltip-${placement}`;
  const classes = ['ds-tooltip', placementClass, 'inline-flex items-center', cls || '']
    .filter(Boolean)
    .join(' ');
  return (
    <span class={classes} data-tip={text} tabIndex={0} aria-label={text}>
      <span class='inline-flex h-4 w-4 items-center justify-center rounded-[10px] border border-base-300 text-[10px] font-medium text-base-content/60'>
        i
      </span>
    </span>
  );
}
