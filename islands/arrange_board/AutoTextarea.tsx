import { useEffect, useRef } from 'preact/hooks';
import Textarea from '../../components/ui/Textarea.tsx';

export default function AutoTextarea(
  props: { value: string; onInput: (e: Event) => void; rows?: number; class?: string },
) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  function autosize(el: HTMLTextAreaElement | null) {
    if (!el?.style) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }
  useEffect(() => {
    autosize(ref.current);
  }, [props.value]);
  return (
    <Textarea
      textareaRef={ref}
      rows={props.rows ?? 3}
      class={props.class}
      value={props.value}
      onInput={(e) => {
        autosize(ref.current);
        props.onInput(e as Event);
      }}
    />
  );
}
