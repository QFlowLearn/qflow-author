import Select from '../../components/ui/Select.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';
import { listAssessmentExportDestinations } from '../../lib/export/assessment_export_targets.ts';

/** Shared selector distinguishes paper output from package-only QTI destinations. */
export default function AssessmentExportDestinationSelect({
  value,
  onChange,
  targetLabel,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly targetLabel: (
    id: Exclude<
      ReturnType<typeof listAssessmentExportDestinations>[number]['id'],
      'printable-pack'
    >,
  ) => string;
}) {
  const i18n = useI18n();
  return (
    <div class='mt-4 max-w-xl'>
      <label for='assessment-export-target' class='text-sm font-medium'>
        {i18n.t('delivery.preflight.destination')}
      </label>
      <Select
        id='assessment-export-target'
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        <option value=''>{i18n.t('delivery.preflight.chooseDestination')}</option>
        {listAssessmentExportDestinations().map((target) => (
          <option key={target.id} value={target.id}>
            {target.id === 'printable-pack' ? i18n.t('print.destination') : targetLabel(target.id)}
          </option>
        ))}
      </Select>
    </div>
  );
}
