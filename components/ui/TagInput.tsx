import { useState } from 'preact/hooks';
import Button from './Button.tsx';
import Input from './Input.tsx';

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  removeLabel: (tag: string) => string;
};

function addUniqueTags(existing: string[], raw: string): string[] {
  const seen = new Set(existing.map((tag) => tag.toLowerCase()));
  const next = [...existing];
  for (const part of raw.split(',')) {
    const cleaned = part.trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(cleaned);
  }
  return next;
}

export default function TagInput({ value, onChange, placeholder, removeLabel }: Props) {
  const [inputValue, setInputValue] = useState('');

  const commit = (raw: string) => {
    const next = addUniqueTags(value, raw);
    if (next.length !== value.length) onChange(next);
  };

  const handleInput = (next: string) => {
    if (!next.includes(',')) {
      setInputValue(next);
      return;
    }
    const parts = next.split(',');
    const tail = parts.pop() ?? '';
    commit(parts.join(','));
    setInputValue(tail);
  };

  return (
    <div class='space-y-2'>
      {value.length > 0 && (
        <div class='flex flex-wrap gap-2'>
          {value.map((tag, index) => (
            <span
              key={`${tag}-${index}`}
              class='ds-badge inline-flex min-h-7 max-w-full items-center gap-1 border border-secondary/30 bg-base-200 px-2 py-0 text-secondary'
            >
              <span class='max-w-[12rem] truncate' title={tag}>{tag}</span>
              <Button
                type='button'
                size='xs'
                variant='ghost'
                class='qf-chip-remove'
                aria-label={removeLabel(tag)}
                onClick={() => onChange(value.filter((_, idx) => idx !== index))}
              >
                x
              </Button>
            </span>
          ))}
        </div>
      )}
      <Input
        value={inputValue}
        placeholder={placeholder}
        onInput={(e) => handleInput((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit(inputValue);
            setInputValue('');
          }
        }}
        onBlur={() => {
          if (!inputValue.trim()) return;
          commit(inputValue);
          setInputValue('');
        }}
      />
    </div>
  );
}
