import { useDomId } from '../../lib/rendering/island_context.tsx';
import { useState } from 'preact/hooks';
import Button from '../../components/ui/Button.tsx';
import Input from '../../components/ui/Input.tsx';
import Radio from '../../components/ui/Radio.tsx';
import Select from '../../components/ui/Select.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';
import { BANK_SELECTION_LIMIT } from '../../lib/assessment_bank_selection.ts';
import type { useBankProposals } from './useBankProposals.ts';

/** One count per configured level, with exact availability and no implicit substitutions. */
export default function BankQuestionChooser(props: {
  readonly proposals: ReturnType<typeof useBankProposals>;
  readonly selectedCount: number;
  readonly disabled: boolean;
}) {
  const i18n = useI18n(), id = useDomId();
  const [versionId, setVersionId] = useState('');
  const [request, setRequest] = useState<
    { versionId: string; quantities: ReadonlyMap<string, string> }
  >({ versionId: '', quantities: new Map() });
  const { proposals } = props;
  const availability = proposals.availability;
  const versions = availability.kind === 'availability' ? availability.versions : [];
  const version = versions.find((version) => version.id === versionId) ??
    (versions.length === 1 ? versions[0] : null);
  const quantities = request.versionId === `${proposals.mode}:${version?.id}`
    ? request.quantities
    : new Map<string, string>();
  const counts = version?.levels.map((level) => ({
    categoryId: level.id,
    count: Number(quantities.get(level.id) || '0'),
  })) ?? [];
  const total = counts.reduce((sum, entry) => sum + entry.count, 0);
  const overCapacity = total + props.selectedCount > BANK_SELECTION_LIMIT;
  const invalid = !version || !Number.isSafeInteger(total) || total < 1 || overCapacity ||
    counts.some((entry, index) =>
      !Number.isSafeInteger(entry.count) || entry.count < 0 ||
      entry.count > version.levels[index].available
    );
  return (
    <section class='space-y-3' aria-label={i18n.t('assessments.builder.proposal.title')}>
      <Button
        type='button'
        variant='default'
        size='sm'
        disabled={props.disabled}
        aria-expanded={proposals.open}
        aria-controls={`${id}-form`}
        onClick={proposals.toggle}
      >
        {i18n.t('assessments.builder.proposal.title')}
      </Button>
      {proposals.open && (
        <div id={`${id}-form`} class='space-y-3 border-y border-base-300 py-4'>
          <fieldset class='flex flex-wrap gap-4' disabled={props.disabled}>
            <legend class='mb-2 text-sm font-medium'>
              {i18n.t('assessments.builder.proposal.mode')}
            </legend>
            {(['topic', 'difficulty'] as const).map((mode) => (
              <label class='flex min-h-11 items-center gap-2 text-sm' key={mode}>
                <Radio
                  name={`${id}-mode`}
                  value={mode}
                  checked={proposals.mode === mode}
                  onChange={() =>
                    proposals.setMode(mode)}
                />
                {i18n.t(`assessments.builder.proposal.mode.${mode}`)}
              </label>
            ))}
          </fieldset>
          {availability.kind === 'loading' && (
            <p role='status' class='text-sm'>{i18n.t('assessments.builder.proposal.loading')}</p>
          )}
          {availability.kind === 'failed' && (
            <div role='alert' class='space-y-2 text-sm'>
              <p>{i18n.t(`assessments.builder.proposal.error.${availability.reason}`)}</p>
              {availability.reason === 'failed' && (
                <Button variant='text' onClick={proposals.retry}>
                  {i18n.t('assessments.builder.library.retry')}
                </Button>
              )}
            </div>
          )}
          {availability.kind === 'availability' && (
            <form
              class='space-y-3'
              onSubmit={(event) => {
                event.preventDefault();
                if (!invalid && version && !props.disabled) {
                  void proposals.choose(version.id, counts.filter((entry) => entry.count > 0));
                }
              }}
            >
              {versions.length > 1 && (
                <label class='block space-y-1 text-sm'>
                  <span>{i18n.t('assessments.builder.proposal.version')}</span>
                  <Select
                    name='proposal-version'
                    value={version?.id ?? ''}
                    disabled={props.disabled}
                    onChange={(event) => setVersionId(event.currentTarget.value)}
                  >
                    <option value=''>{i18n.t('assessments.builder.proposal.chooseVersion')}</option>
                    {versions.map((version) => (
                      <option key={version.id} value={version.id}>
                        {i18n.t('assessments.builder.proposal.versionOption', {
                          version: version.version,
                          audience: version.audience,
                        })}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              {version && (
                <>
                  <p class='text-sm'>
                    {i18n.t('items.browse.audience', { audience: version.audience })}
                  </p>
                  <p class='text-xs text-base-content/80'>
                    {i18n.t(`assessments.builder.proposal.eligibility.${proposals.mode}`)}
                  </p>
                  {version.unsupported > 0 && (
                    <p class='text-sm' role='status'>
                      {i18n.t('assessments.builder.proposal.unsupported', {
                        count: version.unsupported,
                      })}
                    </p>
                  )}
                  <div class='grid gap-3 sm:grid-cols-3'>
                    {version.levels.map((level) => {
                      const count = Number(quantities.get(level.id) || '0'),
                        available = level.available;
                      const short = count > available;
                      return (
                        <div
                          key={level.id}
                          class='flex flex-wrap items-start justify-between gap-x-4 gap-y-1'
                        >
                          <label class='min-w-0 flex-1 py-2 text-sm' for={`${id}-${level.id}`}>
                            {level.label}{' '}
                            <span
                              class='block text-xs text-base-content/80'
                              id={`${id}-${level.id}-available`}
                            >
                              {i18n.t('assessments.builder.proposal.available', {
                                count: available,
                              })}
                            </span>
                          </label>
                          <div class='w-28'>
                            <Input
                              id={`${id}-${level.id}`}
                              name={level.id}
                              type='number'
                              inputMode='numeric'
                              min={0}
                              max={BANK_SELECTION_LIMIT}
                              step={1}
                              size='sm'
                              disabled={props.disabled}
                              value={quantities.get(level.id) ?? '0'}
                              aria-describedby={`${id}-${level.id}-available${
                                short ? ` ${id}-${level.id}-error` : ''
                              }`}
                              aria-invalid={short || !Number.isSafeInteger(count) || count < 0}
                              onInput={(event) => {
                                const value = event.currentTarget.value;
                                setRequest({
                                  versionId: `${proposals.mode}:${version.id}`,
                                  quantities: new Map(quantities).set(level.id, value),
                                });
                              }}
                            />
                            {short && (
                              <p id={`${id}-${level.id}-error`} class='mt-1 text-xs text-error'>
                                {i18n.t('assessments.builder.proposal.shortfall', {
                                  count: available,
                                })}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p role='status' class='text-sm'>
                    {i18n.t('assessments.builder.proposal.total', {
                      count: Number.isSafeInteger(total) ? total : 0,
                      selected: props.selectedCount,
                    })}
                  </p>
                  {overCapacity && (
                    <p role='alert' class='text-sm text-error'>
                      {i18n.t('assessments.builder.proposal.capacity', {
                        count: BANK_SELECTION_LIMIT - props.selectedCount,
                      })}
                    </p>
                  )}
                  {proposals.action.kind === 'rejected' &&
                    proposals.action.change.kind === 'append' &&
                    proposals.action.reason === 'failed' && (
                    <p role='alert' class='text-sm text-error'>
                      {i18n.t('assessments.builder.proposal.error.failed')}
                    </p>
                  )}
                  {proposals.action.kind === 'rejected' &&
                    proposals.action.change.kind === 'append' &&
                    proposals.action.reason === 'shortfall' && (
                    <p role='alert' class='text-sm text-error'>
                      {i18n.t('assessments.builder.proposal.mixShortfall', {
                        count: proposals.action.available,
                      })}
                    </p>
                  )}
                  <Button type='submit' variant='default' disabled={props.disabled || invalid}>
                    {i18n.t(
                      proposals.action.kind === 'pending' &&
                        proposals.action.change.kind === 'append'
                        ? 'assessments.builder.proposal.choosing'
                        : 'assessments.builder.proposal.choose',
                    )}
                  </Button>
                </>
              )}
            </form>
          )}
        </div>
      )}
    </section>
  );
}
