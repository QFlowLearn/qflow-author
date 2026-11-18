import { uiEvent } from '../lib/client/ui_event.ts';
import { canonicalJsonStringify } from '../lib/canonical_json.ts';
import { useEffect, useRef, useState } from 'preact/hooks';
import Button from '../components/ui/Button.tsx';
import Input from '../components/ui/Input.tsx';
import Select from '../components/ui/Select.tsx';
import { BankAlert, BankField } from '../components/item_bank/ui.tsx';
import { BankEnrichmentVocabulary } from '../components/item_bank/BankEnrichmentVocabulary.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import type { I18nPayload } from '../lib/i18n/payload.ts';
import type { OrganizationHome } from '../lib/services/question_organization_workspace.ts';
import {
  type EnrichmentDefinition,
  parseEnrichmentDefinition,
} from '../lib/services/bank_enrichment_contract.ts';
import { proposeSectionTopics } from '../lib/organization_source_editor.ts';
import { OrganizationSourceMappings } from '../components/item_bank/OrganizationSourceMappings.tsx';
import { OrganizationOutlineTopics } from '../components/item_bank/OrganizationOutlineTopics.tsx';
import { submitEnrichmentAction } from '../lib/bank_enrichment_client.ts';

const emptyDefinition = (): EnrichmentDefinition => ({
  name: '',
  audience: '',
  instructions: '',
  subjects: [{ id: 'subject', label: '', definition: '' }],
  topics: [{ id: 'topic', subjectId: 'subject', label: '', definition: '' }],
  difficulty: [],
  examples: [],
  replacements: [],
});

/** Saved rules are editable here; preview never enables automatic work. */
export default function QuestionOrganizationSetup(
  props: {
    home: OrganizationHome;
    initialCollectionId: string;
    operationId: string;
    payload: I18nPayload;
  },
) {
  const i18n = createI18n(props.payload.locale, props.payload.namespaces);
  const [collectionId, setCollectionId] = useState(props.initialCollectionId);
  const selected = props.home.setups.find((s) => s.collectionId === collectionId);
  const [definition, setDefinition] = useState<EnrichmentDefinition>(
    selected?.definition ?? emptyDefinition(),
  );
  const [sourceMappings, setSourceMappings] = useState(selected?.policy.sourceMappings ?? []);
  const [classifier, setClassifier] = useState<'clef' | 'source_only'>(
    selected?.policy.classifier.kind ?? 'clef',
  );
  const sections = props.home.sources.sections.filter((s) => s.collectionId === collectionId);
  const [filing, setFiling] = useState(selected?.policy.filing ?? []);
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const submission = useRef<{ id: string; input: string | null }>({
    id: props.operationId,
    input: null,
  });
  const pending = useRef(false),
    request = useRef<AbortController | null>(null),
    errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setReady(true);
    return () => request.current?.abort();
  }, []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  const activation = props.home.activation.find((a) => a.collectionId === collectionId);
  async function send(command: Record<string, unknown>) {
    if (pending.current) return;
    const input = canonicalJsonStringify(command);
    if (submission.current.input !== null && submission.current.input !== input) {
      submission.current.id = crypto.randomUUID();
    }
    submission.current.input = input;
    pending.current = true;
    setBusy(true);
    setError(null);
    request.current = new AbortController();
    const result = await submitEnrichmentAction('/items/organize', {
      ...command,
      operationId: submission.current.id,
    }, {
      signal: request.current.signal,
    });
    if (request.current.signal.aborted) return;
    if (result && 'url' in result) {
      location.assign(result.url);
      return;
    }
    setError(result && 'error' in result ? result.error : i18n.t('items.organize.errorNetwork'));
    pending.current = false;
    setBusy(false);
  }
  return (
    <form
      action='/items/organize'
      method='post'
      class='max-w-2xl space-y-5'
      onSubmit={uiEvent(async (event) => {
        event.preventDefault();
        const parsed = parseEnrichmentDefinition(definition);
        if (!parsed) {
          setError(i18n.t('items.organize.errorInput'));
          return;
        }
        await send({
          action: 'organization-preview',
          classifier,
          collectionId,
          expectedVersion: selected?.version ?? 0,
          definition: parsed,
          filing: filing.filter((f) => parsed.topics.some((t) => t.id === f.topicId)),
          sourceMappings: sourceMappings.filter((m) =>
            parsed.topics.some((t) => t.id === m.topicId)
          ),
        });
      })}
    >
      {error && (
        <div ref={errorRef} tabIndex={-1}>
          <BankAlert tone='error'>{error}</BankAlert>
        </div>
      )}
      <fieldset disabled={!ready || busy} class='space-y-5'>
        <legend class='sr-only'>{i18n.t('items.organize.title')}</legend>
        <BankField label={i18n.t('items.organization.collection')}>
          <Select
            name='collection'
            required
            value={collectionId}
            onChange={(event) => {
              const id = event.currentTarget.value,
                saved = props.home.setups.find((s) => s.collectionId === id);
              setCollectionId(id);
              setDefinition(saved?.definition ?? emptyDefinition());
              setFiling(saved?.policy.filing ?? []);
              setSourceMappings(saved?.policy.sourceMappings ?? []);
              setClassifier(saved?.policy.classifier.kind ?? 'clef');
              setError(null);
            }}
          >
            <option value=''>{i18n.t('items.organization.chooseCollection')}</option>
            {props.home.collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </BankField>
        <p>{i18n.t('items.organization.collectionScope')}</p>
        {activation?.setupId && (
          <div class='space-y-2'>
            <p>{i18n.t('items.organization.enabled')}</p>
            <p>{i18n.t('items.organization.activeRulesHelp')}</p>
            <Button
              type='button'
              variant='default'
              onClick={uiEvent(() =>
                send({
                  action: 'organization-activation',
                  collectionId,
                  setupId: null,
                  expectedRevision: activation.revision,
                })
              )}
            >
              {i18n.t('items.organization.disable')}
            </Button>
          </div>
        )}
        {collectionId && (
          <>
            {sections.length > 0 && (
              <OrganizationSourceMappings
                sections={sections}
                mappings={sourceMappings}
                definition={definition}
                limited={props.home.sources.limited}
                i18n={i18n}
                onChange={setSourceMappings}
                onPropose={() => {
                  const proposed = proposeSectionTopics({
                    definition,
                    mappings: sourceMappings.filter((m) =>
                      definition.topics.some((t) => t.id === m.topicId)
                    ),
                    sections,
                    collectionName: props.home.collections.find((c) => c.id === collectionId)!.name,
                    audience: i18n.t('items.organization.sourceAudience'),
                    newId: () => crypto.randomUUID(),
                  });
                  if (!proposed) {
                    setError(i18n.t('items.organization.sourceTopicLimit'));
                    return;
                  }
                  setDefinition(proposed.definition);
                  setSourceMappings(proposed.mappings);
                  setClassifier('source_only');
                }}
              />
            )}
            <BankField label={i18n.t('items.organization.unmappedQuestions')}>
              <Select
                name='classifier'
                aria-label={i18n.t('items.organization.unmappedQuestions')}
                value={classifier}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  if (value !== 'clef' && value !== 'source_only') return;
                  setClassifier(value);
                  if (value === 'source_only' && !definition.audience) {
                    setDefinition({
                      ...definition,
                      audience: i18n.t('items.organization.sourceAudience'),
                    });
                  }
                }}
              >
                <option value='source_only'>{i18n.t('items.organization.sourceOnly')}</option>
                <option value='clef'>{i18n.t('items.organization.useClef')}</option>
              </Select>
            </BankField>
            <p>
              {i18n.t(
                classifier === 'source_only'
                  ? 'items.organization.sourceOnlyHelp'
                  : 'items.organization.useClefHelp',
              )}
            </p>
            <BankField label={i18n.t('items.organize.schemeName')}>
              <Input
                name='name'
                required
                maxLength={160}
                value={definition.name}
                onInput={(e) => setDefinition({ ...definition, name: e.currentTarget.value })}
              />
            </BankField>
            {classifier === 'clef' && (
              <BankField label={i18n.t('items.organize.audience')}>
                <Input
                  name='audience'
                  required
                  maxLength={1000}
                  value={definition.audience}
                  placeholder={i18n.t('items.organize.audiencePlaceholder')}
                  onInput={(e) => setDefinition({ ...definition, audience: e.currentTarget.value })}
                />
              </BankField>
            )}
            <OrganizationOutlineTopics
              key={collectionId}
              definition={definition}
              collectionName={props.home.collections.find((c) => c.id === collectionId)!.name}
              i18n={i18n}
              onChange={setDefinition}
            />
            <BankEnrichmentVocabulary draft={definition} onChange={setDefinition} i18n={i18n} />
            <fieldset class='space-y-3'>
              <legend class='font-medium'>{i18n.t('items.organization.destinations')}</legend>
              <p>{i18n.t('items.organization.destinationsHelp')}</p>
              {definition.topics.map((topic) => (
                <BankField key={topic.id} label={topic.label || i18n.t('items.browse.topic')}>
                  <Select
                    name={`destination-${topic.id}`}
                    value={filing.find((f) => f.topicId === topic.id)?.collectionId ?? ''}
                    onChange={(e) =>
                      setFiling([
                        ...filing.filter((f) => f.topicId !== topic.id),
                        ...(e.currentTarget.value
                          ? [{ topicId: topic.id, collectionId: e.currentTarget.value }]
                          : []),
                      ])}
                  >
                    <option value=''>{i18n.t('items.organization.noDestination')}</option>
                    {props.home.collections.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                </BankField>
              ))}
            </fieldset>
            <p>{i18n.t('items.organization.previewHelp')}</p>
            <Button type='submit' variant='primary' aria-busy={busy}>
              {i18n.t(busy ? 'items.organize.starting' : 'items.organization.preview')}
            </Button>
          </>
        )}
      </fieldset>
    </form>
  );
}
