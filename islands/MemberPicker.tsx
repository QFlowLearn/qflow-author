import { uiEvent } from '../lib/client/ui_event.ts';
import { useDomId } from '../lib/rendering/island_context.tsx';
import { useEffect, useState } from 'preact/hooks';
import Button from '../components/ui/Button.tsx';
import Input from '../components/ui/Input.tsx';
import type { I18nPayload } from '../lib/i18n/payload.ts';
import { I18nProvider, useI18n } from '../lib/i18n/context.tsx';
import type { I18n } from '../lib/i18n/messages.ts';

type MemberOption = {
  readonly userId: string;
  readonly email?: string;
  readonly displayName: string | null;
  readonly label: string;
};

type MemberPickerProps = {
  readonly name: string;
  readonly label: string;
  readonly initialSelection?: MemberOption;
  readonly hint?: string;
  readonly required?: boolean;
  readonly payload: I18nPayload;
};

/** Render one closed MemberPicker status through the items catalog. */
export function memberPickerStatus(
  i18n: I18n,
  status: 'minLength' | 'loading' | 'noResults' | 'results' | 'selected' | 'failure',
  value?: number | string,
): string {
  switch (status) {
    case 'minLength':
      return i18n.t('items.memberPicker.minLength');
    case 'loading':
      return i18n.t('items.memberPicker.loading');
    case 'noResults':
      return i18n.t('items.memberPicker.noResults');
    case 'results':
      if (typeof value !== 'number') throw new Error('MemberPicker result count is required.');
      return i18n.t('items.memberPicker.resultCount', { count: value });
    case 'selected':
      if (typeof value !== 'string') throw new Error('MemberPicker selection label is required.');
      return i18n.t('items.memberPicker.selected', { label: value });
    case 'failure':
      return i18n.t('items.memberPicker.failure');
  }
}

/** Select one workspace member without loading the workspace roster into the page. */
export default function MemberPicker(
  props: MemberPickerProps,
) {
  return (
    <I18nProvider payload={props.payload}>
      <MemberPickerContent {...props} />
    </I18nProvider>
  );
}

function MemberPickerContent(
  { name, label, initialSelection, hint, required = true, payload: _payload }: MemberPickerProps,
) {
  const i18n = useI18n();
  const resolvedHint = hint ?? i18n.t('items.memberPicker.hint');
  const inputId = useDomId();
  const hintId = `${inputId}-hint`;
  const statusId = `${inputId}-status`;
  const [query, setQuery] = useState(initialSelection?.label ?? '');
  const [selection, setSelection] = useState<MemberOption | null>(initialSelection ?? null);
  const [results, setResults] = useState<readonly MemberOption[]>([]);
  const [status, setStatus] = useState('');

  useEffect(() => {
    const phrase = query.trim();
    if (selection?.label === query) {
      setResults([]);
      return;
    }
    if (phrase.length < 2) {
      setResults([]);
      setStatus(memberPickerStatus(i18n, 'minLength'));
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(
      uiEvent(async () => {
        setStatus(memberPickerStatus(i18n, 'loading'));
        try {
          const response = await fetch(`/api/members/search?q=${encodeURIComponent(phrase)}`, {
            signal: controller.signal,
          });
          if (!response.ok) throw new Error('member_search_failed');
          const members = parseMemberSearchResponse(await response.json());
          setResults(members);
          setStatus(
            members.length === 0
              ? memberPickerStatus(i18n, 'noResults')
              : memberPickerStatus(i18n, 'results', members.length),
          );
        } catch (cause: unknown) {
          if (cause instanceof DOMException && cause.name === 'AbortError') return;
          setResults([]);
          setStatus(memberPickerStatus(i18n, 'failure'));
        }
      }),
      250,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [i18n, query, selection]);

  return (
    <div class='flex flex-col min-w-60 flex-1 gap-1'>
      <label class='text-xs font-medium text-base-content/70' htmlFor={inputId}>{label}</label>
      <input type='hidden' name={name} value={selection?.userId ?? ''} />
      <Input
        id={inputId}
        type='search'
        value={query}
        required={required}
        autocomplete='off'
        aria-describedby={`${hintId} ${statusId}`}
        onInput={(event) => {
          setQuery(event.currentTarget.value);
          setSelection(null);
        }}
      />
      <p id={hintId} class='text-xs text-base-content/60'>{resolvedHint}</p>
      <p id={statusId} class='min-h-4 text-xs text-base-content/60' aria-live='polite'>
        {status}
      </p>
      {results.length > 0 && (
        <ul class='max-h-56 space-y-1 overflow-auto rounded-lg border border-base-300 p-1'>
          {results.map((member) => (
            <li key={member.userId}>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                class='h-auto w-full justify-start py-2 text-start'
                onClick={() => {
                  setSelection(member);
                  setQuery(member.label);
                  setResults([]);
                  setStatus(memberPickerStatus(i18n, 'selected', member.label));
                }}
              >
                <span>
                  <span class='block'>{member.label}</span>
                  {member.email && member.label !== member.email && (
                    <span class='block text-xs font-normal text-base-content/60'>
                      {member.email}
                    </span>
                  )}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function parseMemberSearchResponse(value: unknown): readonly MemberOption[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  // SAFETY: The response object is checked above; every returned member field is checked below.
  const members = (value as Record<string, unknown>).members;
  if (!Array.isArray(members)) return [];
  const parsed: MemberOption[] = [];
  for (const value of members) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    // SAFETY: The candidate is an object and every consumed field is checked below.
    const member = value as Record<string, unknown>;
    if (
      typeof member.userId !== 'string' || typeof member.email !== 'string' ||
      typeof member.label !== 'string' ||
      !(typeof member.displayName === 'string' || member.displayName === null)
    ) continue;
    parsed.push({
      userId: member.userId,
      email: member.email,
      displayName: member.displayName,
      label: member.label,
    });
  }
  return parsed;
}
