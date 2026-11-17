import { assessmentQuestionPlacements } from '../../lib/assessment_content.ts';
import type { RefObject } from 'preact';
import { useState } from 'preact/hooks';
import Button from '../../components/ui/Button.tsx';
import Modal from '../../components/ui/Modal.tsx';
import PartSettingsFields from '../../components/ui/PartSettingsFields.tsx';
import QuestionProtectionFields from '../../components/ui/QuestionProtectionFields.tsx';
import {
  createPartSettingsDraft,
  parsePartSettingsDraft,
  type PartSettingsDraft,
} from '../../lib/assessment_part_settings_draft.ts';
import type { Part } from './types.ts';
import { useI18n } from '../../lib/i18n/context.tsx';

export default function PartSettingsModal({
  open,
  activePart,
  activePartIndex,
  items,
  returnFocusRef,
  onClose,
  setParts,
  onValidityChange,
}: {
  open: boolean;
  activePart: Part | null;
  activePartIndex: number;
  items: Readonly<Record<string, { readonly title: string }>>;
  returnFocusRef: RefObject<HTMLElement>;
  onClose: () => void;
  setParts: (updater: (prev: Part[]) => Part[]) => void;
  onValidityChange: (partId: string, valid: boolean) => void;
}) {
  const i18n = useI18n();
  // Retain raw, invalid edits when the modal closes; none are written to canonical options.
  const [drafts, setDrafts] = useState<ReadonlyMap<string, PartSettingsDraft>>(new Map());
  if (!activePart) return null;
  const draft = drafts.get(activePart.id) ?? createPartSettingsDraft(activePart.options ?? {});
  function change(next: PartSettingsDraft) {
    if (!activePart) return;
    const partId = activePart.id;
    setDrafts((current) => new Map(current).set(partId, next));
    const parsed = parsePartSettingsDraft(next);
    onValidityChange(partId, parsed.ok);
    if (parsed.ok) {
      setParts((parts) =>
        parts.map((part) => part.id === partId ? { ...part, options: parsed.options } : part)
      );
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel={i18n.t('assessments.arrange.modal.title', { part: activePartIndex + 1 })}
      boxClass='w-full max-w-3xl space-y-4 p-4 sm:p-6'
      initialFocusSelector='[data-modal-initial-focus="part-settings"]'
      returnFocusRef={returnFocusRef}
    >
      <div class='flex items-center justify-between gap-3'>
        <div class='text-base font-medium'>
          {i18n.t('assessments.arrange.modal.title', { part: activePartIndex + 1 })}
        </div>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          aria-label={i18n.t('assessments.arrange.modal.close')}
          onClick={onClose}
        >
          ✕
        </Button>
      </div>
      <PartSettingsFields draft={draft} onChange={change} />
      <QuestionProtectionFields
        questions={assessmentQuestionPlacements(activePart.placements).map((placement, index) => {
          const item = items[placement.id];
          if (!item) throw new Error('Protected question metadata is missing.');
          return {
            id: placement.id,
            number: `${activePartIndex + 1}.${index + 1}`,
            title: item.title,
            fixed: placement.fixed === true,
          };
        })}
        onChange={(id, fixed) => {
          const partId = activePart.id;
          setParts((parts) =>
            parts.map((part) =>
              part.id === partId
                ? {
                  ...part,
                  placements: part.placements.map((placement) =>
                    'itemId' in placement && placement.id === id
                      ? { ...placement, fixed }
                      : placement
                  ),
                }
                : part
            )
          );
        }}
      />
    </Modal>
  );
}
