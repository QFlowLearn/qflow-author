import { reportUiError } from '../lib/client/ui_event.ts';
import { useEffect, useRef, useState } from 'preact/hooks';
import Button from '../components/ui/Button.tsx';
import { ASSESSMENT_TOOL_IDS, assessmentToolHref } from '../lib/assessment_authoring_tool.ts';
import { requestAssessmentDeliveryPublication } from '../lib/client/delivery_publish.ts';
import type { I18nPayload } from '../lib/i18n/payload.ts';
import { I18nProvider, useI18n } from '../lib/i18n/context.tsx';
import {
  formatDeliveryPublishError,
  formatDeliveryPublishSuccess,
  formatDeliveryWarningConfirmation,
} from './assessment_builder/assessment_delivery.ts';

type AssessmentActionsMenuProps = {
  assessmentId: string;
  assessmentTitle: string;
  deliveryPreviewUrl?: string | null;
  deliveryAdminUrl?: string | null;
  deliveryPublishAvailable?: boolean;
  onDelete?: () => void;
  onDuplicate?: (newId: string) => void;
  payload: I18nPayload;
};

type BusyAction = 'delete' | 'duplicate' | 'deliveryPublish' | null;
type MenuPosition = { top: number; left: number };

export default function AssessmentActionsMenu(props: AssessmentActionsMenuProps) {
  return (
    <I18nProvider payload={props.payload}>
      <AssessmentActionsMenuInner {...props} />
    </I18nProvider>
  );
}

function AssessmentActionsMenuInner(
  {
    assessmentId,
    assessmentTitle,
    deliveryPreviewUrl,
    deliveryAdminUrl,
    deliveryPublishAvailable = false,
    onDelete,
    onDuplicate,
  }: AssessmentActionsMenuProps,
) {
  const i18n = useI18n();
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  const isBusy = busyAction !== null;
  const menuId = `assessment-actions-${assessmentId}`;

  const positionMenu = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const gap = 8;
    const menuWidth = menuRef.current?.offsetWidth ?? 224;
    const menuHeight = menuRef.current?.offsetHeight ?? 320;
    const maxLeft = Math.max(viewportPadding, globalThis.innerWidth - menuWidth - viewportPadding);
    const left = Math.min(maxLeft, Math.max(viewportPadding, rect.right - menuWidth));
    let top = rect.bottom + gap;

    if (top + menuHeight > globalThis.innerHeight - viewportPadding) {
      top = Math.max(viewportPadding, rect.top - menuHeight - gap);
    }

    setMenuPosition({ top, left });
  };

  useEffect(() => {
    if (!open) return;
    positionMenu();
    const frame = globalThis.requestAnimationFrame(positionMenu);

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (triggerRef.current?.contains(target) || menuRef.current?.contains(target))
      ) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const handleReposition = () => positionMenu();

    globalThis.addEventListener('pointerdown', handlePointerDown);
    globalThis.addEventListener('keydown', handleKeyDown);
    globalThis.addEventListener('resize', handleReposition);
    globalThis.addEventListener('scroll', handleReposition, true);

    return () => {
      globalThis.cancelAnimationFrame(frame);
      globalThis.removeEventListener('pointerdown', handlePointerDown);
      globalThis.removeEventListener('keydown', handleKeyDown);
      globalThis.removeEventListener('resize', handleReposition);
      globalThis.removeEventListener('scroll', handleReposition, true);
    };
  }, [open]);

  const toggleMenu = () => {
    if (open) {
      setOpen(false);
      return;
    }
    positionMenu();
    setOpen(true);
  };

  const confirmDelete = () => {
    const title = assessmentTitle?.trim();
    const message = title
      ? i18n.t('list.actions.delete.confirmNamed', { title })
      : i18n.t('list.actions.delete.confirmUnnamed');
    return confirm(message);
  };

  const handleDuplicate = async () => {
    if (isBusy) return;
    setBusyAction('duplicate');
    let failure: 'request' | 'invalidResponse' = 'request';
    try {
      const res = await fetch(`/api/assessments/${assessmentId}/duplicate`, { method: 'POST' });
      if (!res.ok) throw new Error('duplicate request failed');
      const data: unknown = await res.json().catch(() => null);
      const nextId = data && typeof data === 'object' && 'id' in data ? data.id : undefined;
      if (typeof nextId !== 'string' || nextId.length === 0) {
        failure = 'invalidResponse';
        throw new Error('duplicate response invalid');
      }
      if (onDuplicate) onDuplicate(nextId);
      else location.href = `/assessments/${nextId}`;
    } catch {
      alert(i18n.t(
        failure === 'invalidResponse'
          ? 'list.actions.duplicate.invalidResponse'
          : 'list.actions.duplicate.failure',
      ));
    } finally {
      setBusyAction(null);
    }
  };

  const handleDelete = async () => {
    if (isBusy) return;
    if (!confirmDelete()) return;
    setBusyAction('delete');
    try {
      const res = await fetch(`/api/assessments/${assessmentId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete request failed');
      if (onDelete) onDelete();
      else location.reload();
    } catch {
      alert(i18n.t('list.actions.delete.failure'));
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeliveryPublish = async () => {
    if (isBusy || !deliveryPublishAvailable) return;
    setBusyAction('deliveryPublish');
    try {
      const result = await requestAssessmentDeliveryPublication(assessmentId, {
        formatWarnings: (warningCodes) => formatDeliveryWarningConfirmation(i18n, warningCodes),
      });
      if (result._tag === 'Cancelled') return;
      if (result._tag === 'Failed') {
        alert(formatDeliveryPublishError(i18n, result.payload, result.reason));
        return;
      }
      const data = result.payload;
      const links = [data.previewUrl, data.adminUrl].filter(Boolean);
      if (links[0]) globalThis.open(links[0], '_blank', 'noopener,noreferrer');
      alert(formatDeliveryPublishSuccess(i18n, data.assessmentVersionId));
    } catch {
      alert(i18n.t('list.actions.publish.failure'));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <span ref={triggerRef} class='inline-flex'>
      <Button
        type='button'
        variant='ghost'
        size='sm'
        square
        aria-label={i18n.t('list.actions.trigger')}
        aria-haspopup='menu'
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggleMenu}
      >
        <svg
          xmlns='http://www.w3.org/2000/svg'
          fill='none'
          viewBox='0 0 24 24'
          stroke-width='1.2'
          stroke='currentColor'
          width='20'
          height='20'
        >
          <path
            stroke-linecap='round'
            stroke-linejoin='round'
            d='M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z'
          />
        </svg>
      </Button>
      {open && (
        <ul
          id={menuId}
          ref={menuRef}
          role='menu'
          tabIndex={-1}
          class='ds-menu fixed z-50 w-56 rounded-box border border-base-200 bg-base-100 p-2 shadow-lg'
          style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
          onClick={(event) => {
            const target = event.target as Element | null;
            if (target?.closest('a')) setOpen(false);
          }}
        >
          <li>
            <a href={`/assessments/${assessmentId}/arrange`}>{i18n.t('list.actions.arrange')}</a>
          </li>
          <li>
            <a href={assessmentToolHref(assessmentId, ASSESSMENT_TOOL_IDS.export)}>
              {i18n.t('list.actions.export')}
            </a>
          </li>
          {deliveryPreviewUrl && (
            <li>
              <a href={deliveryPreviewUrl} target='_blank' rel='noreferrer'>
                {i18n.t('list.actions.launch')}
              </a>
            </li>
          )}
          {deliveryAdminUrl && (
            <li>
              <a href={deliveryAdminUrl} target='_blank' rel='noreferrer'>
                {i18n.t('list.actions.manageDelivery')}
              </a>
            </li>
          )}
          {deliveryPublishAvailable && (
            <li>
              <button
                type='button'
                disabled={isBusy}
                onClick={() => {
                  setOpen(false);
                  handleDeliveryPublish().catch(reportUiError);
                }}
              >
                {i18n.t('list.actions.publish')}
              </button>
            </li>
          )}
          <li>
            <button
              type='button'
              disabled={isBusy}
              onClick={() => {
                setOpen(false);
                handleDuplicate().catch(reportUiError);
              }}
            >
              {i18n.t('list.actions.duplicate')}
            </button>
          </li>
          <li class='ds-divider' />
          <li>
            <button
              type='button'
              class='text-error'
              disabled={isBusy}
              onClick={() => {
                setOpen(false);
                handleDelete().catch(reportUiError);
              }}
            >
              {i18n.t('list.actions.delete')}
            </button>
          </li>
        </ul>
      )}
    </span>
  );
}
