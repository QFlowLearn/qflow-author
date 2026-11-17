/**
 * QFlowLearn wordmark.
 */
export function QFlowLearnLogo(
  { class: className, size = 'md', tone = 'default' }: {
    class?: string;
    size?: 'md' | 'hero';
    tone?: 'default' | 'inverse';
  },
) {
  const isHero = size === 'hero';
  const toneClass = tone === 'inverse' ? 'qflow-wordmark--inverse' : '';

  return (
    <strong
      class={`qflow-wordmark ${toneClass} ${isHero ? 'text-[clamp(3rem,9vw,6.2rem)]' : 'text-xl'} ${
        className ?? ''
      }`}
    >
      <span>QFlow</span>
      <span>Learn</span>
    </strong>
  );
}
