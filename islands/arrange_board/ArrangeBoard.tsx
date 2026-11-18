import { uiEvent } from '../../lib/client/ui_event.ts';
import { assessmentQuestionPlacements } from '../../lib/assessment_content.ts';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useAssessmentArrangementSave } from '../../components/assessment_arrangement/useAssessmentArrangementSave.ts';
import Button from '../../components/ui/Button.tsx';
import Alert from '../../components/ui/Alert.tsx';
import Input from '../../components/ui/Input.tsx';
import { ASSESSMENT_TOOL_IDS, assessmentToolHref } from '../../lib/assessment_authoring_tool.ts';
import PartSettingsModal from './PartSettingsModal.tsx';
import { ITEM_ROW_ACTIVE, ITEM_ROW_BASE, type Part, PART_CARD } from './types.ts';
import {
  type ArrangeDragState,
  type ArrangeSelection,
  createArrangeDnDHandlers,
  createArrangeMutations,
} from './useArrangeDnD.ts';
import { useArrangeBoardKeyboard } from './useArrangeBoardKeyboard.ts';
import { I18nProvider, useI18n } from '../../lib/i18n/context.tsx';
import type { I18nPayload } from '../../lib/i18n/payload.ts';

function DragHandleIcon() {
  return (
    <svg
      aria-hidden='true'
      viewBox='0 0 18 18'
      width='18'
      height='18'
      fill='currentColor'
    >
      <circle cx='5.5' cy='3.5' r='1.25' />
      <circle cx='12.5' cy='3.5' r='1.25' />
      <circle cx='5.5' cy='9' r='1.25' />
      <circle cx='12.5' cy='9' r='1.25' />
      <circle cx='5.5' cy='14.5' r='1.25' />
      <circle cx='12.5' cy='14.5' r='1.25' />
    </svg>
  );
}

export default function ArrangeBoard(
  props: {
    assessmentId: string;
    initialVersion: string;
    deliveryPreviewUrl?: string | null;
    initialParts: Part[];
    items: Record<string, { id: string; title: string; questionType?: string }>;
    payload: I18nPayload;
  },
) {
  return (
    <I18nProvider payload={props.payload}>
      <ArrangeBoardContent {...props} />
    </I18nProvider>
  );
}

function ArrangeBoardContent(
  props: Parameters<typeof ArrangeBoard>[0],
) {
  const i18n = useI18n();
  const [parts, setParts] = useState<Part[]>(props.initialParts);
  const [drag, setDrag] = useState<ArrangeDragState>(null);
  const { dirty: savedPartsDirty, saving, notice, save: saveArrangement } =
    useAssessmentArrangementSave(
      props.assessmentId,
      props.initialVersion,
      parts,
    );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [sel, setSel] = useState<ArrangeSelection>(null);
  const [collapsedParts, setCollapsedParts] = useState<Record<string, boolean>>({});
  const [partSettingsId, setPartSettingsId] = useState<string | null>(null);
  const [invalidPartIds, setInvalidPartIds] = useState<ReadonlySet<string>>(new Set());
  const invalidPart = parts.find((part) => invalidPartIds.has(part.id));
  const dirty = savedPartsDirty || Boolean(invalidPart);
  const effectiveNotice = notice === 'saved' && invalidPart ? 'newerEdits' : notice;
  const toast = effectiveNotice
    ? {
      type: effectiveNotice === 'saved' || effectiveNotice === 'newerEdits' ? 'success' : 'error',
      text: i18n.t(
        `assessments.arrange.${effectiveNotice === 'failed' ? 'saveFailed' : effectiveNotice}`,
      ),
    }
    : null;

  function save() {
    if (invalidPart) {
      setPartSettingsId(invalidPart.id);
      return;
    }
    return saveArrangement();
  }
  const partSettingsReturnFocusRef = useRef<HTMLElement | null>(null);
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [partTitleDraft, setPartTitleDraft] = useState('');
  const exitingRef = useRef(false);

  const { movePart, moveItem, removeItem, moveItemTo, dropPart, dropItem } = createArrangeMutations(
    setParts,
  );
  const dnd = createArrangeDnDHandlers({
    drag,
    setDrag,
    dropPart: (targetIdx) => dropPart(drag, targetIdx),
    dropItem: (partIdx, idx) => dropItem(drag, partIdx, idx),
  });

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (!dirty || exitingRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    globalThis.addEventListener('beforeunload', h as EventListener);
    return () => globalThis.removeEventListener('beforeunload', h as EventListener);
  }, [dirty]);
  function addPart() {
    setParts((
      prev,
    ) => [...prev, {
      id: crypto.randomUUID(),
      title: i18n.t('assessments.arrange.newPart'),
      placements: [],
    }]);
  }
  function togglePartCollapsed(partId: string) {
    setCollapsedParts((prev) => ({ ...prev, [partId]: !prev[partId] }));
  }
  function openPartSettings(partId: string, opener?: HTMLElement) {
    partSettingsReturnFocusRef.current = opener ?? null;
    setPartSettingsId(partId);
  }
  function closePartSettings() {
    const returnFocusTo = partSettingsReturnFocusRef.current;
    setPartSettingsId(null);
    setTimeout(() => {
      const fallback = document.querySelector<HTMLElement>('[data-arrange-part-settings]');
      const target = returnFocusTo && document.contains(returnFocusTo) ? returnFocusTo : fallback;
      target?.focus();
    }, 50);
  }
  function renamePart(i: number, title: string) {
    setParts((prev) => prev.map((p, idx) => idx === i ? { ...p, title } : p));
  }
  function startEditPart(part: Part) {
    setEditingPartId(part.id);
    setPartTitleDraft(part.title);
  }
  function commitPartTitle(i: number, fallbackTitle: string) {
    const nextTitle = partTitleDraft.trim() || fallbackTitle ||
      i18n.t('assessments.arrange.untitledPart');
    renamePart(i, nextTitle);
    setEditingPartId(null);
    setPartTitleDraft('');
  }
  function cancelEditPart() {
    setEditingPartId(null);
    setPartTitleDraft('');
  }
  function deletePart(i: number) {
    const targetId = parts[i]?.id;
    if (targetId && partSettingsId === targetId) setPartSettingsId(null);
    setParts((prev) => prev.filter((_, idx) => idx !== i));
  }

  function exitArrange() {
    if (saving) return;
    if (dirty && !globalThis.confirm(i18n.t('assessments.arrange.discardConfirm'))) return;
    exitingRef.current = true;
    location.href = `/assessments/${props.assessmentId}`;
  }
  function openItemInEditor(itemId: string) {
    try {
      localStorage.setItem(`qflow-last-edited-${props.assessmentId}`, itemId);
    } catch (_err) {
      /* ignore storage failures */
    }
    location.href = `/assessments/${props.assessmentId}`;
  }

  useArrangeBoardKeyboard({
    containerRef,
    sel,
    setSel,
    parts,
    onSave: uiEvent(save),
    movePart,
    moveItem,
    moveItemTo,
  });

  useEffect(() => {
    if (!partSettingsId) return;
    const exists = parts.some((part) => part.id === partSettingsId);
    if (!exists) setPartSettingsId(null);
  }, [partSettingsId, parts]);

  const activePartIndex = partSettingsId
    ? parts.findIndex((part) => part.id === partSettingsId)
    : -1;
  const activePart = activePartIndex >= 0 ? parts[activePartIndex] : null;

  return (
    <div ref={containerRef} tabIndex={0}>
      {toast && (notice === 'conflict'
        ? (
          <Alert tone='neutral' role='alert'>
            <div>
              <p>{toast.text}</p>
              <Button
                size='sm'
                variant='ghost'
                onClick={() => {
                  if (
                    dirty && !globalThis.confirm(i18n.t('assessments.arrange.discardConfirm'))
                  ) return;
                  exitingRef.current = true;
                  location.reload();
                }}
              >
                {i18n.t('assessments.arrange.reloadSaved')}
              </Button>
            </div>
          </Alert>
        )
        : (
          <div
            class={`ds-alert ${
              toast.type === 'success' ? 'ds-alert-success' : 'ds-alert-error'
            } toast`}
            role={toast.type === 'error' ? 'alert' : 'status'}
            aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
          >
            {toast.text}
          </div>
        ))}
      <div class='flex flex-wrap items-center justify-between gap-3'>
        <div class='flex items-center gap-2'>
          <h1 class='text-lg font-medium'>{i18n.t('assessments.arrange.title')}</h1>
          {dirty && (
            <span class='ds-badge ds-badge-warning ds-badge-sm'>
              {i18n.t('assessments.arrange.unsaved')}
            </span>
          )}
        </div>
        <div class='flex items-center gap-2'>
          <Button
            type='button'
            size='sm'
            variant='ghost'
            onClick={exitArrange}
            disabled={saving}
          >
            {i18n.t('assessments.arrange.cancel')}
          </Button>
          <Button
            size='sm'
            variant='primary'
            onClick={uiEvent(save)}
            disabled={!dirty || saving || Boolean(invalidPart)}
          >
            {saving ? i18n.t('assessments.arrange.saving') : i18n.t('assessments.arrange.save')}
          </Button>
          <div class='ds-dropdown ds-dropdown-end'>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              square
              aria-label={i18n.t('assessments.arrange.actions')}
              tabIndex={0}
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
            <ul
              tabIndex={0}
              class='ds-dropdown-content ds-menu bg-base-100 rounded-box w-56 shadow-lg z-10'
            >
              <li>
                <a
                  href={assessmentToolHref(props.assessmentId, ASSESSMENT_TOOL_IDS.export)}
                >
                  {i18n.t('assessments.arrange.export')}
                </a>
              </li>
              {props.deliveryPreviewUrl && (
                <li>
                  <a href={props.deliveryPreviewUrl} target='_blank' rel='noreferrer'>
                    {i18n.t('assessments.arrange.launch')}
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
      <div class='mt-4 grid gap-4'>
        {parts.map((p, pi) => {
          const isCollapsed = collapsedParts[p.id];
          const isEditing = editingPartId === p.id;
          const partTitle = (p.title || i18n.t('assessments.arrange.untitledPart')).trim() ||
            i18n.t('assessments.arrange.untitledPart');
          return (
            <div
              class={PART_CARD}
              key={p.id}
              onDragOver={dnd.onPartDragOver as any}
              onDrop={() => dnd.onPartDrop(pi)}
            >
              <div
                class='flex flex-wrap items-center justify-between gap-3 border-b border-base-200/70 px-4 py-3'
                onClick={() => setSel({ partIdx: pi })}
              >
                <div class='flex min-w-0 items-center gap-2'>
                  <Button
                    type='button'
                    size='xs'
                    variant='ghost'
                    square
                    aria-label={isCollapsed
                      ? i18n.t('assessments.arrange.expand')
                      : i18n.t('assessments.arrange.collapse')}
                    onClick={() => togglePartCollapsed(p.id)}
                  >
                    {isCollapsed ? '▸' : '▾'}
                  </Button>
                  <Button
                    type='button'
                    size='xs'
                    variant='ghost'
                    square
                    class='cursor-grab text-base-content/45 hover:text-base-content/75 active:cursor-grabbing'
                    aria-label={i18n.t('assessments.arrange.dragPart', {
                      count: pi + 1,
                      title: partTitle,
                    })}
                    title={i18n.t('assessments.arrange.dragToReorder')}
                    draggable
                    onDragStart={(e) => dnd.onPartDragStart(e as DragEvent, pi)}
                    onDragEnd={dnd.clearDrag}
                  >
                    <DragHandleIcon />
                  </Button>
                  {isEditing
                    ? (
                      <div class='flex min-w-0 items-center gap-2'>
                        <span class='text-xs font-medium uppercase tracking-wide text-base-content/60'>
                          {i18n.t('assessments.arrange.partNumber', { count: pi + 1 })}
                        </span>
                        <Input
                          size='sm'
                          class='min-w-[200px]'
                          value={partTitleDraft}
                          autoFocus
                          onInput={(e) => setPartTitleDraft((e.target as HTMLInputElement).value)}
                          onBlur={() => commitPartTitle(pi, partTitle)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitPartTitle(pi, partTitle);
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelEditPart();
                            }
                          }}
                        />
                      </div>
                    )
                    : (
                      <Button
                        type='button'
                        variant='ghost'
                        size='xs'
                        class='min-w-0 truncate justify-start text-sm font-medium normal-case text-base-content/90'
                        onClick={() => startEditPart(p)}
                      >
                        {i18n.t('assessments.arrange.partLabel', {
                          count: pi + 1,
                          title: partTitle,
                        })}
                      </Button>
                    )}
                  <span class='text-xs text-base-content/60'>
                    {i18n.t('assessments.arrange.itemCount', {
                      count: assessmentQuestionPlacements(p.placements).length,
                    })}
                  </span>
                </div>
                <div class='flex items-center gap-2'>
                  <Button
                    type='button'
                    size='xs'
                    variant='ghost'
                    class='normal-case'
                    aria-label={i18n.t('assessments.arrange.partSettings')}
                    title={i18n.t('assessments.arrange.partSettings')}
                    data-arrange-part-settings
                    onClick={(e) => openPartSettings(p.id, e.currentTarget as HTMLElement)}
                  >
                    <svg
                      xmlns='http://www.w3.org/2000/svg'
                      fill='none'
                      viewBox='0 0 24 24'
                      stroke-width='1.2'
                      stroke='currentColor'
                      width='18'
                      height='18'
                    >
                      <path
                        stroke-linecap='round'
                        stroke-linejoin='round'
                        d='M10.5 6h9.75M3.75 6h3m-3 12h9.75m-9.75-6h15m-12-6a2.25 2.25 0 114.5 0 2.25 2.25 0 01-4.5 0zm9 12a2.25 2.25 0 114.5 0 2.25 2.25 0 01-4.5 0zm-4.5-6a2.25 2.25 0 114.5 0 2.25 2.25 0 01-4.5 0z'
                      />
                    </svg>
                    <span>{i18n.t('assessments.arrange.settings')}</span>
                  </Button>
                  <div class='ds-dropdown ds-dropdown-end'>
                    <Button
                      type='button'
                      variant='ghost'
                      size='xs'
                      square
                      aria-label={i18n.t('assessments.arrange.partActions')}
                      tabIndex={0}
                    >
                      <svg
                        xmlns='http://www.w3.org/2000/svg'
                        fill='none'
                        viewBox='0 0 24 24'
                        stroke-width='1.2'
                        stroke='currentColor'
                        width='18'
                        height='18'
                      >
                        <path
                          stroke-linecap='round'
                          stroke-linejoin='round'
                          d='M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z'
                        />
                      </svg>
                    </Button>
                    <ul
                      tabIndex={0}
                      class='ds-dropdown-content ds-menu bg-base-100 rounded-box w-48 shadow-lg z-10'
                    >
                      <li>
                        <button
                          type='button'
                          onClick={() => movePart(pi, -1)}
                          disabled={pi === 0}
                        >
                          {i18n.t('assessments.arrange.moveUp')}
                        </button>
                      </li>
                      <li>
                        <button
                          type='button'
                          onClick={() => movePart(pi, 1)}
                          disabled={pi === parts.length - 1}
                        >
                          {i18n.t('assessments.arrange.moveDown')}
                        </button>
                      </li>
                      <li class='ds-divider' />
                      <li>
                        <button
                          type='button'
                          class='text-error'
                          onClick={() => deletePart(pi)}
                          disabled={parts.length <= 1}
                        >
                          {i18n.t('assessments.arrange.deletePart')}
                        </button>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
              {!isCollapsed && (
                <div class='px-4 py-3'>
                  <div
                    class='space-y-1'
                    onDragOver={dnd.onItemDragOver as any}
                    onDrop={(e) => {
                      e.stopPropagation();
                      dnd.onItemDrop(pi, p.placements.length);
                    }}
                  >
                    {(p.placements ?? []).length === 0 && (
                      <div class='rounded-md border border-dashed border-base-200/70 px-3 py-3 text-sm text-base-content/60'>
                        {i18n.t('assessments.arrange.dropQuestions')}
                      </div>
                    )}
                    {(p.placements ?? []).map((pl, idx) => {
                      const isActive = !!(sel && sel.partIdx === pi && sel.idx === idx);
                      const item = props.items[pl.id];
                      let title: string, type: string;
                      if ('content' in pl) {
                        title = pl.content.kind === 'text'
                          ? pl.content.text
                          : pl.content.kind === 'image'
                          ? pl.content.alt
                          : pl.content.title;
                        type = i18n.t(
                          pl.content.kind === 'text'
                            ? 'assessments.builder.textBlock'
                            : pl.content.kind === 'image'
                            ? 'assessments.builder.imageBlock'
                            : 'assessments.builder.videoBlock',
                        );
                      } else {
                        if (!item) throw new Error('Arrange question metadata is missing.');
                        title = item.title;
                        type = i18n.t('items.detail.questionType', {
                          type: item.questionType ?? 'other',
                        });
                      }
                      return (
                        <div
                          class={`${ITEM_ROW_BASE} ${isActive ? ITEM_ROW_ACTIVE : ''}`}
                          key={pl.id}
                          onClick={() => setSel({ partIdx: pi, idx })}
                          onDragOver={(e) => {
                            dnd.onItemDragOver(e as any);
                            e.stopPropagation();
                          }}
                          onDrop={(e) => {
                            e.stopPropagation();
                            dnd.onItemDrop(pi, idx);
                          }}
                        >
                          <div class='flex min-w-0 flex-1 items-center gap-2'>
                            <Button
                              type='button'
                              size='xs'
                              variant='ghost'
                              square
                              class='cursor-grab text-base-content/45 hover:text-base-content/75 active:cursor-grabbing'
                              aria-label={'content' in pl
                                ? i18n.t('assessments.arrange.dragContentBlock', { title })
                                : i18n.t('assessments.arrange.dragQuestion', {
                                  count: assessmentQuestionPlacements(p.placements.slice(0, idx))
                                    .length + 1,
                                  title,
                                })}
                              title={i18n.t('assessments.arrange.dragToReorder')}
                              draggable
                              onDragStart={(e) => dnd.onItemDragStart(e as DragEvent, pi, idx)}
                              onDragEnd={dnd.clearDrag}
                            >
                              <DragHandleIcon />
                            </Button>
                            <span class='w-6 text-right text-xs font-medium text-base-content/60'>
                              {'itemId' in pl
                                ? `${
                                  i18n.formatNumber(
                                    assessmentQuestionPlacements(p.placements.slice(0, idx))
                                      .length + 1,
                                  )
                                }.`
                                : '—'}
                            </span>
                            <div class='min-w-0 flex-1 truncate font-medium' title={title}>
                              {title}
                            </div>
                          </div>
                          <span class='ds-badge ds-badge-ghost ds-badge-sm shrink-0 text-xs'>
                            {type}
                          </span>
                          <div class='ds-dropdown ds-dropdown-end'>
                            <Button
                              type='button'
                              variant='ghost'
                              size='xs'
                              square
                              aria-label={i18n.t(
                                'content' in pl
                                  ? 'assessments.arrange.contentBlockActions'
                                  : 'assessments.arrange.questionActions',
                              )}
                              tabIndex={0}
                            >
                              <svg
                                xmlns='http://www.w3.org/2000/svg'
                                fill='none'
                                viewBox='0 0 24 24'
                                stroke-width='1.2'
                                stroke='currentColor'
                                width='18'
                                height='18'
                              >
                                <path
                                  stroke-linecap='round'
                                  stroke-linejoin='round'
                                  d='M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z'
                                />
                              </svg>
                            </Button>
                            <ul
                              tabIndex={0}
                              class='ds-dropdown-content ds-menu bg-base-100 rounded-box w-56 shadow-lg z-10'
                            >
                              {'itemId' in pl && (
                                <li>
                                  <button
                                    type='button'
                                    onClick={() => openItemInEditor(pl.itemId)}
                                  >
                                    {i18n.t('assessments.arrange.edit')}
                                  </button>
                                </li>
                              )}
                              <li class='ds-menu-title'>
                                <span>{i18n.t('assessments.arrange.moveTo')}</span>
                              </li>
                              {parts.map((pp, pidx) => (
                                <li key={`${pl.id}-move-${pp.id}`}>
                                  <button
                                    type='button'
                                    disabled={pidx === pi}
                                    onClick={() => moveItemTo(pi, idx, pidx)}
                                  >
                                    {i18n.t('assessments.arrange.partLabel', {
                                      count: pidx + 1,
                                      title: pp.title || i18n.t('assessments.arrange.untitledPart'),
                                    })}
                                  </button>
                                </li>
                              ))}
                              <li class='ds-divider' />
                              <li>
                                <button
                                  type='button'
                                  class='text-error'
                                  onClick={() => removeItem(pi, idx)}
                                >
                                  {i18n.t('assessments.arrange.remove')}
                                </button>
                              </li>
                            </ul>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {invalidPart && !partSettingsId && (
        <Alert tone='neutral' role='alert'>
          <span>{i18n.t('assessments.partSettings.review')}</span>
          <Button onClick={() => openPartSettings(invalidPart.id)}>
            {i18n.t('assessments.builder.open')}
          </Button>
        </Alert>
      )}
      <PartSettingsModal
        items={props.items}
        open={Boolean(partSettingsId && activePart)}
        activePart={activePart ?? null}
        activePartIndex={activePartIndex}
        returnFocusRef={partSettingsReturnFocusRef}
        onClose={closePartSettings}
        setParts={setParts}
        onValidityChange={(partId, valid) =>
          setInvalidPartIds((current) => {
            const next = new Set(current);
            if (valid) next.delete(partId);
            else next.add(partId);
            return next;
          })}
      />
      <div class='mt-4'>
        <Button onClick={addPart} variant='ghost' size='sm'>
          {i18n.t('assessments.arrange.addPart')}
        </Button>
      </div>
    </div>
  );
}
