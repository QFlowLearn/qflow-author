import type { ComponentChildren } from 'preact';
import Button from './ui/Button.tsx';

type Props = {
  children: ComponentChildren;
  class?: string;
  buttonClass?: string;
  title?: string;
  variant?: 'default' | 'primary' | 'ghost';
  size?: 'xs' | 'sm' | 'md';
};

export default function NewAssessmentButton({
  children,
  class: className,
  buttonClass,
  title,
  variant = 'primary',
  size = 'md',
}: Props) {
  return (
    <form method='post' action='/assessments/new' class={className}>
      <Button type='submit' variant={variant} size={size} class={buttonClass} title={title}>
        <span aria-hidden='true'>+</span>
        {children}
      </Button>
    </form>
  );
}
