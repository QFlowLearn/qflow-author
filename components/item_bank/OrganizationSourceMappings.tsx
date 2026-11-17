import Button from '../ui/Button.tsx';
import Select from '../ui/Select.tsx';
import { BankField } from './ui.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';
import type { OrganizationSection } from '../../lib/organization_source_editor.ts';
import type { EnrichmentDefinition } from '../../lib/services/bank_enrichment_contract.ts';
import type { OrganizationSetup } from '../../lib/services/question_organization_contract.ts';

/** Source names are proposals; only explicit mappings become organization rules. */
export function OrganizationSourceMappings(props: {
  readonly sections: readonly OrganizationSection[];
  readonly mappings: OrganizationSetup['sourceMappings'];
  readonly definition: EnrichmentDefinition;
  readonly limited: boolean;
  readonly i18n: I18n;
  readonly onChange: (mappings: OrganizationSetup['sourceMappings']) => void;
  readonly onPropose: () => void;
}) {
  const { i18n, sections, mappings, definition } = props;
  const mapping = (source: OrganizationSection) =>
    mappings.find((m) =>
      m.sourceId === source.sourceId && m.sectionKey === source.sectionKey &&
      definition.topics.some((t) => t.id === m.topicId)
    );
  return (
    <fieldset class='space-y-3'>
      <legend class='font-medium'>{i18n.t('items.organization.sourceSections')}</legend>
      <p>{i18n.t('items.organization.sourceSectionsHelp')}</p>
      {props.limited && <p>{i18n.t('items.organization.sourceSectionsLimit')}</p>}
      <Button type='button' onClick={props.onPropose} disabled={sections.every((s) => mapping(s))}>
        {i18n.t('items.organization.useSectionTopics')}
      </Button>
      {sections.map((source) => (
        <div key={JSON.stringify([source.sourceId, source.sectionKey])} class='space-y-1'>
          <BankField label={source.title}>
            <Select
              name={`source-${source.sourceId}-${source.sectionKey}`}
              aria-label={source.title}
              value={mapping(source)?.topicId ?? ''}
              onChange={(event) =>
                props.onChange([
                  ...mappings.filter((m) =>
                    m.sourceId !== source.sourceId || m.sectionKey !== source.sectionKey
                  ),
                  ...(event.currentTarget.value
                    ? [{
                      sourceId: source.sourceId,
                      sectionKey: source.sectionKey,
                      topicId: event.currentTarget.value,
                    }]
                    : []),
                ])}
            >
              <option value=''>{i18n.t('items.organization.noSourceMapping')}</option>
              {definition.topics.filter((t) => t.label.trim()).map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </Select>
          </BankField>
          <p class='text-sm break-words'>
            {source.filename} · {i18n.t('items.organization.sourceCount', { count: source.count })}
          </p>
        </div>
      ))}
    </fieldset>
  );
}
