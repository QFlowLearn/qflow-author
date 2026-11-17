import { useDomId } from '../../lib/rendering/island_context.tsx';
import { useState } from 'preact/hooks';
import AssessmentContentEditorFields from '../ui/AssessmentContentEditorFields.tsx';
import type { RefObject } from 'preact';
import { useI18n } from '../../lib/i18n/context.tsx';
import type { AuthoringState } from '../../islands/assessment_builder/types.ts';
import type { CapturedAssessmentParts } from './useAssessmentParts.ts';
import AssessmentContentEditorCard from '../ui/AssessmentContentEditorCard.tsx';
import { AssessmentDraftSwitchGuard, type DraftGuard } from './AssessmentDraftGuard.tsx';
import { useAssessmentContentEdit } from './useAssessmentContentEdit.ts';
import type { AssessmentContentPlacement } from '../../lib/assessment_standalone_content.ts';

/** The unified canvas owns content selection, structural capture and draft continuation. */
export type AssessmentContentEditorProps = {
  readonly assessmentId: string;
  readonly editing: Extract<AuthoringState, { _tag: 'EditingContent' | 'CreatingContent' }>;
  readonly captureOrder: () => CapturedAssessmentParts;
  readonly guard: RefObject<DraftGuard | null>;
  readonly onClose: () => Promise<unknown>;
  readonly onReload: () => Promise<unknown>;
  readonly onSelected: (partId: string, placement: AssessmentContentPlacement) => void;
  readonly onRemoved: () => void;
};

/** Content editing stays in the unified canvas and canonical arrangement persistence path. */
export default function AssessmentContentEditor(props: AssessmentContentEditorProps) {
  const i18n = useI18n();
  const errorId = useDomId();
  const [uploadCount, setUploadCount] = useState(0);
  const edit = useAssessmentContentEdit({
    uploading: uploadCount > 0,
    ...props,
    onCopied: (placement) => props.onSelected(props.editing.partId, placement),
    onCreated: (placement) => props.onSelected(props.editing.partId, placement),
    onRemoved: () => {
      props.onRemoved();
      requestAnimationFrame(() =>
        document.getElementById(`part-${props.editing.partId}-heading`)?.focus()
      );
    },
  });
  const prefix = edit.content.kind === 'text'
    ? 'assessments.textEditor'
    : 'assessments.contentEditor';
  const key = (suffix: string) => `${prefix}.${suffix}`;
  const error = edit.status === 'invalid' || edit.status === 'uncertain' ||
      edit.status === 'conflict' || edit.status === 'rejected'
    ? i18n.t(key(edit.status))
    : null;
  const message = edit.status === 'saving'
    ? i18n.t('editor.saving')
    : edit.dirty
    ? i18n.t('editor.unsavedChanges')
    : edit.status === 'saved'
    ? i18n.t(key('saved'))
    : i18n.t(key('ready'));
  async function changeStructure(operation: 'Duplicate' | 'Remove') {
    const guard = props.guard.current;
    if (!guard || !await guard()) return;
    if (operation === 'Duplicate') await edit.duplicate();
    else if (globalThis.confirm(i18n.t(key('removeConfirm')))) {
      await edit.remove();
    }
  }
  return (
    <>
      <AssessmentDraftSwitchGuard
        guard={props.guard}
        title={i18n.t(key('keepDraftTitle'))}
        help={i18n.t(key('keepDraftHelp'))}
        draft={{
          dirty: edit.dirty,
          blocked: edit.blocked,
          canSave: edit.canSave,
          error,
          errors: [],
          save: edit.save,
          discard: edit.discard,
        }}
      />
      <AssessmentContentEditorCard
        title={i18n.t(
          edit.content.kind === 'text'
            ? 'assessments.builder.textBlock'
            : edit.content.kind === 'image'
            ? 'assessments.builder.imageBlock'
            : 'assessments.builder.videoBlock',
        )}
        action={`/api/assessments/${props.assessmentId}/arrange`}
        saveLabel={edit.status === 'saving' ? i18n.t('editor.saving') : i18n.t(key('save'))}
        cancelLabel={edit.dirty ? i18n.t('editor.cancel') : i18n.t(key('done'))}
        message={message}
        error={error}
        errorId={errorId}
        busy={edit.blocked}
        structuralActions={props.editing._tag === 'EditingContent'}
        frozen={edit.structurePending}
        duplicateLabel={i18n.t(key('duplicate'))}
        removeLabel={i18n.t(key('remove'))}
        onDuplicate={() => changeStructure('Duplicate')}
        onRemove={() => changeStructure('Remove')}
        canSave={edit.canSave}
        saved={!edit.dirty && edit.status === 'saved'}
        retryLabel={edit.status === 'uncertain' ? i18n.t(key('retry')) : undefined}
        reloadLabel={edit.status === 'conflict' ? i18n.t(key('reload')) : undefined}
        onSave={edit.save}
        onClose={async () => {
          await props.onClose();
          requestAnimationFrame(() =>
            (props.editing._tag === 'EditingContent'
              ? document.getElementById(`edit-text-${props.editing.placement.id}`)
              : document.getElementById(`part-${props.editing.partId}-heading`))?.focus()
          );
        }}
        onReload={props.onReload}
      >
        <AssessmentContentEditorFields
          content={edit.content}
          error={error}
          errorId={errorId}
          invalid={edit.status === 'invalid'}
          frozen={edit.structurePending}
          busy={uploadCount > 0 || edit.blocked}
          onChange={edit.change}
          onUploadBusy={(busy) => setUploadCount((count) => count + (busy ? 1 : -1))}
        />
      </AssessmentContentEditorCard>
    </>
  );
}
