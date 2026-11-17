import { useRef, useState } from 'preact/hooks';
import Button from '../ui/Button.tsx';
import Select from '../ui/Select.tsx';
import Textarea from '../ui/Textarea.tsx';
import { BankField } from './ui.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';
import type { EnrichmentDefinition } from '../../lib/services/bank_enrichment_contract.ts';
import { addOutlineTopics } from '../../lib/organization_outline_editor.ts';

/** Local draft preparation inside the existing setup form; no save or classification request. */
export function OrganizationOutlineTopics(props: {
  readonly definition: EnrichmentDefinition;
  readonly collectionName: string;
  readonly i18n: I18n;
  readonly onChange: (definition: EnrichmentDefinition) => void;
}) {
  const { i18n } = props;
  const [text, setText] = useState('');
  const [subjectId, setSubjectId] = useState(props.definition.subjects[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  return (
    <details class='space-y-3'>
      <summary class='cursor-pointer font-medium'>
        {i18n.t('items.organization.outlineTitle')}
      </summary>
      <p id='outline-help'>{i18n.t('items.organization.outlineHelp')}</p>
      <BankField label={i18n.t('items.organization.outlineText')}>
        <Textarea
          name='outline-topics'
          textareaRef={input}
          rows={5}
          value={text}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'outline-help outline-error' : 'outline-help'}
          onInput={(event) => {
            setText(event.currentTarget.value);
            setError(null);
            setStatus('');
          }}
        />
      </BankField>
      {props.definition.subjects.length > 1 && (
        <BankField label={i18n.t('items.organization.outlineSubject')}>
          <Select
            name='outline-subject'
            aria-label={i18n.t('items.organization.outlineSubject')}
            value={props.definition.subjects.some((s) => s.id === subjectId) ? subjectId : ''}
            onChange={(event) => {
              setSubjectId(event.currentTarget.value);
              setError(null);
            }}
          >
            <option value=''>{i18n.t('items.organization.outlineChooseSubject')}</option>
            {props.definition.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label || i18n.t('items.organize.untitledSubject')}
              </option>
            ))}
          </Select>
        </BankField>
      )}
      {error && <p id='outline-error' role='alert'>{error}</p>}
      <p role='status'>{status}</p>
      <Button
        type='button'
        variant='default'
        onClick={() => {
          const result = addOutlineTopics({
            text,
            definition: props.definition,
            subjectId: props.definition.subjects.length === 1
              ? props.definition.subjects[0].id
              : subjectId,
            collectionName: props.collectionName,
            newId: () => crypto.randomUUID(),
          });
          if (!result.ok) {
            const messages = {
              empty: 'items.organization.outlineEmpty',
              too_long: 'items.organization.outlineTooLong',
              topic_limit: 'items.organization.outlineTopicLimit',
              subject_missing: 'items.organization.outlineChooseSubject',
              label_length: 'items.organization.outlineLabelLength',
            } as const;
            setError(
              i18n.t(
                messages[result.code],
                result.code === 'label_length' ? { line: result.line } : {},
              ),
            );
            setStatus('');
            input.current?.focus();
            return;
          }
          props.onChange(result.definition);
          setText('');
          setError(null);
          setStatus(
            i18n.t('items.organization.outlineAdded', {
              added: result.added,
              skipped: result.skipped,
            }),
          );
        }}
      >
        {i18n.t('items.organization.outlineAdd')}
      </Button>
    </details>
  );
}
