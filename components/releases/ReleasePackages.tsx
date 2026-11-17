import Button from '../ui/Button.tsx';
import Input from '../ui/Input.tsx';
import Checkbox from '../ui/Checkbox.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';
import type { ReleasePreview } from '../../lib/services/bank_release_preview.ts';
import {
  RELEASE_COMPILER,
  RELEASE_DESTINATION,
  RELEASE_POLICY,
} from '../../lib/banks/release_artifact.ts';

/** Frozen destination packages keep generation, acknowledgement and manual LMS import distinct. */
export default function ReleasePackages({ data, i18n }: { data: ReleasePreview; i18n: I18n }) {
  const path = `/releases/${data.release.id}/packages`,
    allowed = data.canPublish && data.release.distribution === 'available';
  const current = data.artifacts.find((artifact) =>
    artifact.destination === RELEASE_DESTINATION && artifact.compiler === RELEASE_COMPILER &&
    artifact.policy === RELEASE_POLICY
  );
  const question = (revisionId: string) =>
    data.release.manifest.items.find((item) => item.revisionId === revisionId);
  const questionReason = (item: { revisionId: string; code: string }) => {
    const source = question(item.revisionId);
    return (
      <li key={`${item.revisionId}:${item.code}`}>
        {source && <a href={`/items/${source.questionId}`} class='ds-link'>{source.title}</a>}
        {source && ': '}
        {packageReason(i18n, item.code)}
      </li>
    );
  };
  const buildForm = (previousAttemptId: string | null) => (
    <form method='post' action={path} class='space-y-2'>
      <Input type='hidden' name='action' value='build' />
      <Input type='hidden' name='attemptId' value={crypto.randomUUID()} />
      <Input type='hidden' name='previousAttemptId' value={previousAttemptId ?? ''} />
      <Button type='submit'>
        {i18n.t(previousAttemptId ? 'releases.package.retry' : 'releases.package.build')}
      </Button>
    </form>
  );
  return (
    <section
      class='space-y-4 border-t border-base-300 pt-5'
      aria-label={i18n.t('releases.package.title')}
    >
      <h2 class='text-xl font-medium'>{i18n.t('releases.package.title')}</h2>
      <p class='max-w-prose'>{i18n.t('releases.package.scope')}</p>
      <p class='max-w-prose'>{i18n.t('releases.package.manual')}</p>
      {!current && allowed && buildForm(null)}
      {data.artifacts.map((artifact) => (
        <article key={artifact.id} class='space-y-3 border border-base-300 rounded-lg p-4'>
          <h3 class='font-medium'>
            {i18n.t('releases.package.sakai')} ·{' '}
            {i18n.t(`releases.package.state.${artifact.state}`)}
          </h3>
          {(['queued', 'running'] as string[]).includes(artifact.state) && (
            <Button href={`/releases/${data.release.id}`} variant='default'>
              {i18n.t('releases.reload')}
            </Button>
          )}
          {artifact.report && artifact.report.blocked.length > 0 && (
            <div role='alert'>
              <p>{i18n.t('releases.package.blocked')}</p>
              <ul class='list-disc pl-5'>
                {artifact.report.blocked.map(questionReason)}
              </ul>
            </div>
          )}
          {artifact.report && artifact.report.excluded.length > 0 && (
            <div role='status'>
              <p>
                {i18n.t('releases.package.partialSummary', {
                  included: data.release.manifest.items.length - artifact.report.excluded.length,
                  excluded: artifact.report.excluded.length,
                })}
              </p>
              <ul class='mt-2 list-disc pl-5'>{artifact.report.excluded.map(questionReason)}</ul>
            </div>
          )}
          {artifact.report && artifact.report.warnings.length > 0 && (
            <ul class='list-disc pl-5'>
              {artifact.report.warnings.map((warning) => (
                <li key={warning}>
                  {packageReason(i18n, warning)}
                </li>
              ))}
            </ul>
          )}
          {allowed && artifact.state === 'candidate' && artifact.actorId === data.actorId && (
            <form method='post' action={path} class='space-y-3'>
              <Input type='hidden' name='action' value='acknowledge' />
              <Input type='hidden' name='attemptId' value={artifact.attemptId} />
              <Input type='hidden' name='candidateDigest' value={artifact.candidateDigest ?? ''} />
              <Input type='hidden' name='policy' value={artifact.policy} />
              <label class='flex gap-2 items-start'>
                <Checkbox required name='confirm' value='yes' />
                {i18n.t('releases.package.confirm')}
              </label>
              <Button type='submit'>
                {i18n.t(
                  artifact.report?.excluded.length
                    ? 'releases.package.acceptSupported'
                    : 'releases.package.acknowledge',
                )}
              </Button>
            </form>
          )}
          {artifact === current && allowed && artifact.state === 'failed' &&
            buildForm(artifact.attemptId)}
          {artifact.receipt && (
            <>
              <p class='break-all text-sm'>
                SHA-256: <code>{artifact.receipt.sha256}</code>
              </p>
              {allowed && (
                <form method='post' action={path}>
                  <Input type='hidden' name='action' value='download' />
                  <Input type='hidden' name='artifactId' value={artifact.id} />
                  <Input type='hidden' name='operationId' value={crypto.randomUUID()} />
                  <Button type='submit'>{i18n.t('releases.package.download')}</Button>
                </form>
              )}
              <details>
                <summary>{i18n.t('releases.package.receipt')}</summary>
                <pre class='overflow-x-auto text-xs'>{JSON.stringify(artifact.receipt,null,2)}</pre>
              </details>
            </>
          )}
        </article>
      ))}
    </section>
  );
}

function packageReason(i18n: I18n, code: string): string {
  switch (code) {
    case 'sakai.flat_pool':
      return i18n.t('releases.package.flatPool');
    case 'sakai.presentation_simplified':
      return i18n.t('releases.package.presentationSimplified');
    case 'sakai.fixed_choice_order':
      return i18n.t('releases.package.fixedChoiceOrder');
    case 'sakai.questions_excluded':
      return i18n.t('releases.package.questionsExcluded');
    case 'sakai.essential_content_unsupported':
      return i18n.t('releases.package.essentialContent');
    case 'invalid_xml':
      return i18n.t('releases.package.invalidXml');
    case 'source_identity_mismatch':
    case 'invalid_source_archive':
      return i18n.t('releases.package.sourceRepair');
    default:
      return i18n.t('releases.package.unsupportedQuestion');
  }
}
