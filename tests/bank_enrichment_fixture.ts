import {
  type EnrichmentDefinition,
  parseEnrichmentDefinition,
} from '../lib/services/bank_enrichment_contract.ts';

/** A small, defined audience and vocabulary used through the production parser. */
export function enrichmentDefinitionFixture(): EnrichmentDefinition {
  const definition = parseEnrichmentDefinition({
    name: 'Middle school science',
    audience: 'Grade 6 science',
    instructions: '',
    subjects: [
      { id: 'life', label: 'Life science', definition: 'Living things and ecosystems.' },
      { id: 'physical', label: 'Physical science', definition: 'Matter, forces and energy.' },
    ],
    topics: [
      {
        id: 'cells',
        label: 'Cells',
        definition: 'Cell structures and functions.',
        subjectId: 'life',
      },
      {
        id: 'energy',
        label: 'Energy',
        definition: 'Forms and transfers of energy.',
        subjectId: 'physical',
      },
    ],
    difficulty: [
      { id: 'easy', label: 'Easy', definition: 'Recall a familiar fact.' },
      { id: 'moderate', label: 'Moderate', definition: 'Apply one familiar principle.' },
      { id: 'hard', label: 'Hard', definition: 'Combine principles in an unfamiliar situation.' },
    ],
    examples: [],
    replacements: [],
  });
  if (!definition) throw new Error('Invalid enrichment test definition.');
  return definition;
}
