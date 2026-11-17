import Button from '../../components/ui/Button.tsx';
import Alert from '../../components/ui/Alert.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';
import type { QtiBuildIssue } from '../../lib/qti_build.ts';

/** Feedback belongs to the active placement so a later edit cannot inherit another question's error. */
export type QuestionExportNotice =
  & {
    readonly placementId: string;
  }
  & (
    | { readonly _tag: 'OmittedStylesheets'; readonly count: number }
    | { readonly _tag: 'NeedsRepair'; readonly issues: readonly QtiBuildIssue[] }
  );

/** Show concrete export repairs or the optional styles omitted from the downloaded derivative. */
export default function QuestionExportFeedback({ notice, i18n, onOpenSettings }: {
  readonly notice: QuestionExportNotice;
  readonly i18n: I18n;
  readonly onOpenSettings: (trigger: HTMLElement) => void;
}) {
  if (notice._tag === 'OmittedStylesheets') {
    return (
      <Alert tone='info'>
        <p>{i18n.t('assessments.builder.exportStylesheetsOmitted', { count: notice.count })}</p>
      </Alert>
    );
  }
  return (
    <Alert tone='warning' role='alert'>
      <div>
        <p class='font-medium'>{i18n.t('assessments.builder.exportNeedsRepair')}</p>
        <ul class='mt-2 list-disc pl-5'>
          {notice.issues.map((issue, index) => <li key={index}>{issue.message}</li>)}
        </ul>
        <Button type='button' size='sm' onClick={(event) => onOpenSettings(event.currentTarget)}>
          {i18n.t('assessments.builder.exportReviewSettings')}
        </Button>
      </div>
    </Alert>
  );
}
