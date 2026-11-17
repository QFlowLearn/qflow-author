import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { getBankRelease } from '../../../services/bank_releases.ts';
import { compareReleases } from '../../../banks/bank_release.ts';
import { INITIAL_ITEM_DETAIL_QUERY, itemDetailHref } from '../../../item_detail_query.ts';
const methods = {
  async GET(ctx) {
    const params = ctx.url.searchParams, i18n = ctx.state.i18n;
    if (
      [...params.keys()].length !== 2 || params.getAll('from').length !== 1 ||
      params.getAll('to').length !== 1
    ) return new Response(i18n.t('releases.error.invalid_input'), { status: 400 });
    const auth = requireAuthContext(ctx.state);
    const [left, right] = await Promise.all([
      getBankRelease(auth, params.get('from') ?? ''),
      getBankRelease(auth, params.get('to') ?? ''),
    ]);
    if (
      !left.ok || !right.ok || left.value.state !== 'frozen' || right.value.state !== 'frozen'
    ) return new Response(i18n.t('releases.error.not_frozen'), { status: 409 });
    const diff = compareReleases(left.value.manifest, right.value.manifest);
    return ctx.render(
      <section class='space-y-5'>
        <a class='link' href='/releases'>{i18n.t('releases.title')}</a>
        <h1 class='text-2xl font-medium'>{left.value.label} → {right.value.label}</h1>
        <dl class='flex flex-wrap gap-6'>
          {(['added', 'removed', 'changed', 'reordered'] as const).map((key) => (
            <div key={key}>
              <dt>{i18n.t(`releases.compare.${key}`)}</dt>
              <dd>{diff[key].length}</dd>
            </div>
          ))}
        </dl>
        {diff.metadataChanged && (
          <section class='space-y-3'>
            <h2>{i18n.t('releases.metadataChanged')}</h2>
            <div class='grid gap-4 sm:grid-cols-2'>
              {[left.value.manifest, right.value.manifest].map((manifest) => (
                <div key={manifest.label}>
                  <p class='font-medium'>{manifest.label}</p>
                  <p>{manifest.notes}</p>
                  <p>
                    {i18n.formatList(manifest.collections.map((c) =>
                      c.name
                    ))}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
        <ul class='space-y-3'>
          {diff.changed.map((row) => (
            <li key={row.after.questionId}>
              <a
                class='link'
                href={itemDetailHref(row.after.questionId, {
                  ...INITIAL_ITEM_DETAIL_QUERY,
                  comparison: {
                    fromRevision: Math.min(row.before.revision, row.after.revision),
                    toRevision: Math.max(row.before.revision, row.after.revision),
                  },
                }, 'comparison')}
              >
                {row.after.title} · {row.before.revision} → {row.after.revision}
              </a>
            </li>
          ))}
        </ul>
        {(['added', 'removed', 'reordered'] as const).map((key) =>
          diff[key].length > 0 && (
            <details key={key}>
              <summary>{i18n.t(`releases.compare.${key}`)}</summary>
              <ul>
                {diff[key].map((item) => (
                  <li key={item.questionId}>
                    {item.title} ·{' '}
                    {i18n.t('items.detail.revisionColumn', { revision: item.revision })}
                  </li>
                ))}
              </ul>
            </details>
          )
        )}
      </section>,
    );
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const releaseComparePageRoute = defineHttpRoute('/releases/compare', {
  ...methods,
  HEAD: methods.GET,
});
