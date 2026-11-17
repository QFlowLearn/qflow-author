import Button from '../components/ui/Button.tsx';
import Input from '../components/ui/Input.tsx';
import Select from '../components/ui/Select.tsx';
import {
  type AssessmentBlueprintFormDraft,
  BLUEPRINT_COGNITIVE_DEMANDS,
  BLUEPRINT_DIFFICULTIES,
} from '../lib/assessment_blueprint.ts';
import { type QuestionTypeId } from '../lib/types/registry.ts';
import { useI18n } from '../lib/i18n/context.tsx';
import type { I18n } from '../lib/i18n/messages.ts';

type Props = {
  readonly value: AssessmentBlueprintFormDraft;
  readonly onChange: (value: AssessmentBlueprintFormDraft) => void;
  readonly allowedQuestionTypes: readonly QuestionTypeId[];
};

/** Editable blueprint fields shared by generation and saved blueprint panels. */
export default function BlueprintEditorFields({ value, onChange, allowedQuestionTypes }: Props) {
  const i18n = useI18n();
  if (!allowedQuestionTypes.length) throw new Error('Blueprint question types are required.');
  function updateOutcome(index: number, patch: Partial<(typeof value.outcomes)[number]>) {
    onChange({
      ...value,
      outcomes: value.outcomes.map((outcome, candidate) =>
        candidate === index ? { ...outcome, ...patch } : outcome
      ),
    });
  }

  function addOutcome() {
    const number = nextNumber(value.outcomes.map((outcome) => outcome.id), 'outcome');
    onChange({
      ...value,
      outcomes: [...value.outcomes, {
        id: `outcome-${number}`,
        title: i18n.t('imports.blueprint.outcomeNumber', { index: number }),
        weight: 0,
      }],
    });
  }

  function removeOutcome(index: number) {
    if (value.outcomes.length === 1) return;
    const outcome = value.outcomes[index];
    onChange({
      ...value,
      outcomes: value.outcomes.filter((_entry, candidate) => candidate !== index),
      targets: value.targets.filter((target) => target.outcomeId !== outcome.id),
    });
  }

  function updateTarget(index: number, patch: Partial<(typeof value.targets)[number]>) {
    onChange({
      ...value,
      targets: value.targets.map((target, candidate) =>
        candidate === index ? { ...target, ...patch } : target
      ),
    });
  }

  function addTarget() {
    const number = nextNumber(value.targets.map((target) => target.id), 'target');
    onChange({
      ...value,
      targets: [...value.targets, {
        id: `target-${number}`,
        outcomeId: value.outcomes[0].id,
        count: 1,
        cognitiveDemand: 'understand',
        difficulty: 'medium',
        questionType: allowedQuestionTypes[0],
      }],
    });
  }

  function removeTarget(index: number) {
    if (value.targets.length === 1) return;
    onChange({
      ...value,
      targets: value.targets.filter((_entry, candidate) => candidate !== index),
    });
  }

  const totalWeight = value.outcomes.reduce((sum, outcome) => sum + outcome.weight, 0);
  const questionCount = value.targets.reduce((sum, target) => sum + target.count, 0);

  return (
    <div class='space-y-6'>
      <fieldset class='space-y-3'>
        <legend class='text-sm font-semibold'>
          {i18n.t('imports.blueprint.learningOutcomes')}
        </legend>
        <div class='flex flex-wrap items-end justify-between gap-3'>
          <div>
            <p class='text-xs leading-5 text-base-content/65'>
              {i18n.t('imports.blueprint.weightsHelp')}
            </p>
          </div>
          <Button type='button' size='sm' onClick={addOutcome}>
            {i18n.t('imports.blueprint.addOutcome')}
          </Button>
        </div>
        <div class='space-y-3'>
          {value.outcomes.map((outcome, index) => (
            <div
              key={outcome.id}
              class='grid gap-3 rounded-lg border border-base-300 p-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-end'
            >
              <label class='flex flex-col gap-1'>
                <span class='text-xs font-medium'>{i18n.t('imports.blueprint.outcome')}</span>
                <Input
                  value={outcome.title}
                  required
                  onInput={(event) => updateOutcome(index, { title: event.currentTarget.value })}
                />
              </label>
              <label class='flex flex-col gap-1'>
                <span class='text-xs font-medium'>{i18n.t('imports.blueprint.weight')}</span>
                <Input
                  type='number'
                  min={1}
                  max={100}
                  value={outcome.weight}
                  required
                  onInput={(event) =>
                    updateOutcome(index, { weight: event.currentTarget.valueAsNumber || 0 })}
                />
              </label>
              <Button
                type='button'
                size='sm'
                variant='ghost'
                aria-label={i18n.t('imports.blueprint.removeOutcome', {
                  index: index + 1,
                  title: outcome.title,
                })}
                disabled={value.outcomes.length === 1}
                onClick={() => removeOutcome(index)}
              >
                {i18n.t('imports.blueprint.remove')}
              </Button>
            </div>
          ))}
        </div>
        <p
          class={`text-xs font-medium ${totalWeight === 100 ? 'text-success' : 'text-warning'}`}
          role='status'
        >
          {i18n.t('imports.blueprint.outcomeWeight', { value: totalWeight / 100 })}
        </p>
      </fieldset>

      <fieldset class='space-y-3'>
        <legend class='text-sm font-semibold'>{i18n.t('imports.blueprint.targets')}</legend>
        <div class='flex flex-wrap items-end justify-between gap-3'>
          <div>
            <p class='text-xs leading-5 text-base-content/65'>
              {i18n.t('imports.blueprint.targetsHelp')}
            </p>
          </div>
          <Button type='button' size='sm' onClick={addTarget}>
            {i18n.t('imports.blueprint.addTarget')}
          </Button>
        </div>
        <div class='space-y-3'>
          {value.targets.map((target, index) => (
            <div key={target.id} class='rounded-lg border border-base-300 p-3'>
              <div class='grid gap-3 sm:grid-cols-2 xl:grid-cols-5'>
                <label class='flex flex-col gap-1'>
                  <span class='text-xs font-medium'>{i18n.t('imports.blueprint.outcome')}</span>
                  <Select
                    value={target.outcomeId}
                    onChange={(event) =>
                      updateTarget(index, { outcomeId: event.currentTarget.value })}
                  >
                    {value.outcomes.map((outcome) => (
                      <option key={outcome.id} value={outcome.id}>{outcome.title}</option>
                    ))}
                  </Select>
                </label>
                <label class='flex flex-col gap-1'>
                  <span class='text-xs font-medium'>
                    {i18n.t('imports.blueprint.cognitiveDemand')}
                  </span>
                  <Select
                    value={target.cognitiveDemand}
                    onChange={(event) =>
                      updateTarget(index, {
                        cognitiveDemand: event.currentTarget.value as typeof target.cognitiveDemand,
                      })}
                  >
                    {BLUEPRINT_COGNITIVE_DEMANDS.map((demand) => (
                      <option key={demand} value={demand}>
                        {i18n.t('imports.blueprint.demandLabel', { value: demand })}
                      </option>
                    ))}
                  </Select>
                </label>
                <label class='flex flex-col gap-1'>
                  <span class='text-xs font-medium'>{i18n.t('imports.blueprint.difficulty')}</span>
                  <Select
                    value={target.difficulty}
                    onChange={(event) =>
                      updateTarget(index, {
                        difficulty: event.currentTarget.value as typeof target.difficulty,
                      })}
                  >
                    {BLUEPRINT_DIFFICULTIES.map((difficulty) => (
                      <option key={difficulty} value={difficulty}>
                        {i18n.t('imports.blueprint.difficultyLabel', { value: difficulty })}
                      </option>
                    ))}
                  </Select>
                </label>
                <label class='flex flex-col gap-1'>
                  <span class='text-xs font-medium'>
                    {i18n.t('imports.blueprint.questionType')}
                  </span>
                  <Select
                    value={target.questionType}
                    onChange={(event) =>
                      updateTarget(index, {
                        questionType: event.currentTarget.value as QuestionTypeId,
                      })}
                  >
                    {allowedQuestionTypes.map((type) => (
                      <option key={type} value={type}>
                        {i18n.t('imports.blueprint.typeLabel', { type })}
                      </option>
                    ))}
                  </Select>
                </label>
                <label class='flex flex-col gap-1'>
                  <span class='text-xs font-medium'>{i18n.t('imports.blueprint.count')}</span>
                  <Input
                    type='number'
                    min={1}
                    max={50}
                    value={target.count}
                    required
                    onInput={(event) =>
                      updateTarget(index, { count: event.currentTarget.valueAsNumber || 0 })}
                  />
                </label>
              </div>
              <div class='mt-3 flex justify-end'>
                <Button
                  type='button'
                  size='sm'
                  variant='ghost'
                  aria-label={i18n.t('imports.blueprint.removeTarget', { index: index + 1 })}
                  disabled={value.targets.length === 1}
                  onClick={() => removeTarget(index)}
                >
                  {i18n.t('imports.blueprint.removeTargetLabel')}
                </Button>
              </div>
            </div>
          ))}
        </div>
        <p class='text-xs font-medium text-base-content/70' role='status'>
          {i18n.t('imports.blueprint.plannedTotal', { count: questionCount })}
        </p>
      </fieldset>
    </div>
  );
}

/** Visible starter contract that becomes explicit only when the author saves or generates. */
export function createStarterBlueprintFormDraft(i18n: I18n): AssessmentBlueprintFormDraft {
  return {
    _tag: 'Defined',
    version: 1,
    outcomes: [{ id: 'outcome-1', title: i18n.t('imports.blueprint.primaryOutcome'), weight: 100 }],
    targets: [{
      id: 'target-1',
      outcomeId: 'outcome-1',
      count: 5,
      cognitiveDemand: 'understand',
      difficulty: 'medium',
      questionType: 'single_select',
    }],
  };
}

function nextNumber(ids: readonly string[], prefix: string): number {
  const used = new Set(ids);
  let candidate = 1;
  while (used.has(`${prefix}-${candidate}`)) candidate += 1;
  return candidate;
}
