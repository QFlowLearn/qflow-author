import PageNavigation from '../ui/PageNavigation.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';

type BankSection = 'questions' | 'overview' | 'collections' | 'reviews' | 'releases';

/** Navigation between the bank's main destinations, with one current location. */
export default function BankSectionNavigation({ current, questionsHref, overviewHref, i18n }: {
  readonly current: BankSection;
  readonly questionsHref: string;
  readonly overviewHref: string;
  readonly i18n: I18n;
}) {
  return (
    <PageNavigation
      label={i18n.t('nav.library')}
      links={[
        {
          href: questionsHref,
          label: i18n.t('items.overview.questions'),
          current: current === 'questions',
        },
        {
          href: overviewHref,
          label: i18n.t('items.overview.title'),
          current: current === 'overview',
        },
        {
          href: '/items/collections',
          label: i18n.t('items.collections.title'),
          current: current === 'collections',
        },
        {
          href: '/items/reviews',
          label: i18n.t('items.reviews.title'),
          current: current === 'reviews',
        },
        {
          href: '/releases',
          label: i18n.t('releases.title'),
          current: current === 'releases',
        },
      ]}
    />
  );
}
