import Button from '../../components/ui/Button.tsx';
import type { DeliveryPublishCapability } from '../../lib/delivery_publish.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import { DELIVERY_CAPABILITY_FAILURE_CODES } from '../../lib/delivery_publish_failure.ts';
import { formatDeliveryPublishError } from './assessment_delivery.ts';

type Props = {
  readonly capability: DeliveryPublishCapability;
  readonly busy: boolean;
  readonly onPublish: () => void;
};

/** Publishes the canonical assessment through the workspace's configured delivery service. */
export default function HostedDeliveryPanel({ capability, busy, onPublish }: Props) {
  const i18n = useI18n();
  const controls = hostedDeliveryControls(capability, busy, onPublish, i18n);
  return (
    <section
      class='pt-3'
      aria-labelledby='hosted-delivery-heading'
    >
      <h2 id='hosted-delivery-heading' class='text-sm font-semibold text-base-content'>
        {i18n.t('delivery.hosted.title')}
      </h2>
      <p class='mt-1 max-w-2xl text-sm leading-6 text-base-content/70'>
        {i18n.t('delivery.hosted.description')}
      </p>
      {controls}
    </section>
  );
}

function hostedDeliveryControls(
  capability: DeliveryPublishCapability,
  busy: boolean,
  onPublish: () => void,
  i18n: ReturnType<typeof useI18n>,
) {
  switch (capability.status) {
    case 'configured':
      return (
        <Button
          variant='primary'
          type='button'
          class='mt-3'
          disabled={busy}
          aria-busy={busy}
          onClick={onPublish}
        >
          {busy ? i18n.t('delivery.hosted.publishing') : i18n.t('delivery.hosted.publish')}
        </Button>
      );
    case 'unavailable':
    case 'not_configured':
    case 'invalid_config':
    case 'not_linked':
    case 'not_entitled':
      return (
        <p class='mt-3 text-sm text-base-content/65' role='status'>
          {formatDeliveryPublishError(i18n, {
            error: DELIVERY_CAPABILITY_FAILURE_CODES[capability.status],
          }, 'publishFailed')}
        </p>
      );
    default: {
      const unhandledCapability: never = capability;
      throw new Error(`Unhandled hosted delivery capability: ${unhandledCapability}`);
    }
  }
}
