import { useDomId } from '../../lib/rendering/island_context.tsx';
import { useEffect, useMemo } from 'preact/hooks';
import Button from '../../components/ui/Button.tsx';
import Checkbox from '../../components/ui/Checkbox.tsx';
import Input, { FieldIssueMessage } from '../../components/ui/Input.tsx';
import Radio from '../../components/ui/Radio.tsx';
import type { DriverUiContext } from './view_registry.ts';
import { HOTTEXT_MARKER_ATTR, type HottextSpan } from '../../lib/types/hottext.ts';
import { createHottextMarkerHtml, listHottextIds } from '../../lib/types/hottext.ts';
import { replaceAllMarkers } from '../../lib/qti_markers.ts';
import {
  commonContentProps,
  insertBodyHtml,
  setDraftFieldValue,
  setDraftListFieldValue,
} from './editor_shell.tsx';
import type { CommonContentProps } from './types.ts';
import { ResponseIdentifierDisclosure } from './response_identifier_disclosure.tsx';
import { attachStandardDriverViews } from './standard_driver_views.ts';
import { useI18n } from '../../lib/i18n/context.tsx';

export type HottextContentProps = CommonContentProps & {
  bodyHtml: string;
  hottexts: HottextSpan[];
  correctIds: string[];
  responseIdentifier: string;
  maxChoices?: number;

  insertHottext: () => void;
  insertHottextMarker: (id: string) => void;
  removeHottext: (id: string) => void;
  updateHottextText: (id: string, text: string) => void;
  setCorrectIds: (ids: string[]) => void;

  setResponseIdentifier: (id: string) => void;
};

function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id];
}

export function HottextContent(props: HottextContentProps) {
  const i18n = useI18n();
  const answersIssueId = useDomId();
  const placedIds = useMemo(() => new Set(listHottextIds(props.bodyHtml ?? '')), [props.bodyHtml]);
  const maxChoices = props.maxChoices ?? null;
  const singleChoice = maxChoices === 1;

  return (
    <div class='space-y-5'>
      {props.renderPromptField(i18n.t('driver.hottextPrompt'))}
      <ResponseIdentifierDisclosure
        value={props.responseIdentifier}
        onChange={props.setResponseIdentifier}
      />

      <div class='space-y-3'>
        <div class='flex items-center justify-between'>
          <strong class='text-sm text-base-content/80'>{i18n.t('driver.hottextSpans')}</strong>
          <Button size='sm' type='button' onClick={props.insertHottext}>
            + {i18n.t('driver.hottextAddSpan')}
          </Button>
        </div>
        {(props.fieldHasIssue('choices') || props.fieldHasIssue('correct')) && (
          <FieldIssueMessage
            id={answersIssueId}
            message={props.fieldIssueText('choices') ?? props.fieldIssueText('correct') ?? ''}
          />
        )}
        {props.hottexts.length === 0 && (
          <p class='text-sm text-base-content/60'>
            {i18n.t('driver.hottextEmpty')}
          </p>
        )}
        <div class='space-y-2'>
          {props.hottexts.map((span, idx) => {
            const placed = placedIds.has(span.id);
            const selected = props.correctIds.includes(span.id);
            return (
              <div
                key={span.id}
                class={`grid gap-3 rounded-lg border px-3 py-2.5 md:grid-cols-[9rem_minmax(0,1fr)_auto] md:items-end ${
                  selected
                    ? 'border-secondary/70 bg-secondary/10 ring-1 ring-secondary/30'
                    : 'border-base-300 bg-base-100'
                }`}
              >
                <label class='flex min-h-10 items-center gap-2 text-sm font-medium text-base-content/80 md:self-end'>
                  {singleChoice
                    ? (
                      <Radio
                        class='ds-radio-sm'
                        name='hottext-correct'
                        checked={selected}
                        data-editor-field='correct'
                        aria-invalid={props.fieldHasIssue('correct') || undefined}
                        aria-describedby={props.fieldHasIssue('correct')
                          ? answersIssueId
                          : undefined}
                        aria-label={i18n.t('driver.hottextCorrect', { number: idx + 1 })}
                        onChange={() => props.setCorrectIds(span.id ? [span.id] : [])}
                      />
                    )
                    : (
                      <Checkbox
                        size='sm'
                        checked={selected}
                        data-editor-field='correct'
                        aria-invalid={props.fieldHasIssue('correct') || undefined}
                        aria-describedby={props.fieldHasIssue('correct')
                          ? answersIssueId
                          : undefined}
                        aria-label={i18n.t('driver.hottextCorrect', { number: idx + 1 })}
                        onChange={() => props.setCorrectIds(toggleId(props.correctIds, span.id))}
                      />
                    )}
                  <span>{i18n.t('driver.correct')}</span>
                </label>
                <label class='flex flex-col min-w-0'>
                  <span class='text-xs'>{i18n.t('driver.hottextSpan', { number: idx + 1 })}</span>
                  <Input
                    size='sm'
                    value={span.text ?? ''}
                    data-editor-field='choices'
                    aria-invalid={props.fieldHasIssue('choices') || undefined}
                    aria-describedby={props.fieldHasIssue('choices') ? answersIssueId : undefined}
                    onInput={(e) =>
                      props.updateHottextText(span.id, (e.target as HTMLInputElement).value)}
                    placeholder={i18n.t('driver.hottextSelectablePlaceholder')}
                  />
                </label>
                <div class='flex min-h-10 flex-wrap items-center justify-end gap-2 md:self-end'>
                  <span
                    class={`ds-badge ds-badge-sm ${
                      placed ? 'ds-badge-success' : 'ds-badge-warning'
                    }`}
                  >
                    {placed ? i18n.t('driver.hottextPlaced') : i18n.t('driver.hottextNotPlaced')}
                  </span>
                  {!placed && (
                    <Button
                      size='xs'
                      variant='ghost'
                      type='button'
                      onClick={() => props.insertHottextMarker(span.id)}
                      aria-label={i18n.t('driver.hottextInsert', { number: idx + 1 })}
                    >
                      {i18n.t('driver.hottextInsertAction')}
                    </Button>
                  )}
                  <Button
                    size='xs'
                    variant='danger-ghost'
                    type='button'
                    disabled={props.hottexts.length <= 1}
                    onClick={() => props.removeHottext(span.id)}
                    aria-label={i18n.t('driver.hottextRemove', { number: idx + 1 })}
                  >
                    {i18n.t('driver.remove')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function HottextEditor(ctx: DriverUiContext<'hottext'>) {
  const { editor, draft, update } = ctx;
  const bodyHtml = draft.bodyHtml ?? '';
  const hottexts = draft.hottexts;
  const correctIds = draft.correctIds ?? [];

  const setBodyHtml = (value: string | ((prev: string) => string)) => {
    setDraftFieldValue(
      editor,
      draft,
      update,
      'bodyHtml',
      typeof value === 'function' ? (prev) => value(prev ?? '') : value,
    );
  };

  const setHottexts = (
    value: HottextSpan[] | ((prev: HottextSpan[]) => HottextSpan[]),
  ) => {
    setDraftListFieldValue(editor, draft, update, 'hottexts', value);
  };

  const setCorrectIds = (value: string[] | ((prev: string[]) => string[])) => {
    setDraftListFieldValue(editor, draft, update, 'correctIds', value);
  };

  useEffect(() => {
    if (!hottexts.length) {
      const defaults: HottextSpan[] = [
        { id: 'A', text: 'first option' },
        { id: 'B', text: 'second option' },
      ];
      const markers = defaults.map((entry) =>
        createHottextMarkerHtml({
          id: entry.id,
          label: entry.text,
        })
      );
      update({
        ...draft,
        hottexts: defaults,
        correctIds: ['B'],
        responseIdentifier: draft.responseIdentifier ?? 'RESPONSE',
        maxChoices: draft.maxChoices ?? 1,
        minChoices: undefined,
        minChoicesMessage: '',
        maxChoicesMessage: '',
        bodyHtml: draft.bodyHtml?.trim() && draft.bodyHtml.trim() !== '<p></p>'
          ? `${draft.bodyHtml}${draft.bodyHtml.trim().endsWith('</p>') ? '' : ' '}<p>${
            markers.join(' ')
          }</p>`
          : `<p>${markers.join(' ')}</p>`,
      });
      return;
    }
    if (listHottextIds(bodyHtml).length) return;
    const markers = hottexts.map((entry) =>
      createHottextMarkerHtml({ id: entry.id, label: entry.text })
    );
    setBodyHtml((prev) =>
      prev?.trim() && prev.trim() !== '<p></p>'
        ? `${prev}${prev.trim().endsWith('</p>') ? '' : ' '}<p>${markers.join(' ')}</p>`
        : `<p>${markers.join(' ')}</p>`
    );
  }, [bodyHtml, draft, hottexts]);

  const nextHottextId = () => {
    const existing = new Set(hottexts.map((entry) => (entry.id ?? '').toUpperCase()));
    const toAlphaId = (index: number) => {
      let value = index;
      let out = '';
      while (value > 0) {
        const remainder = (value - 1) % 26;
        out = String.fromCharCode('A'.charCodeAt(0) + remainder) + out;
        value = Math.floor((value - 1) / 26);
      }
      return out;
    };
    let idx = 1;
    while (true) {
      const candidate = toAlphaId(idx);
      if (!existing.has(candidate.toUpperCase())) return candidate;
      idx += 1;
    }
  };

  const replaceHottextMarkers = (oldId: string, replacementHtml: string) => {
    setBodyHtml((prev) => {
      const { html } = replaceAllMarkers(
        prev ?? '',
        HOTTEXT_MARKER_ATTR,
        (info) => info.id === oldId ? replacementHtml : info.match,
      );
      return html;
    });
  };

  const removeHottextMarkers = (id: string) => {
    setBodyHtml((prev) => {
      const { html } = replaceAllMarkers(
        prev ?? '',
        HOTTEXT_MARKER_ATTR,
        (info) => info.id === id ? '' : info.match,
      );
      return html;
    });
  };

  return (
    <HottextContent
      {...commonContentProps(editor)}
      bodyHtml={bodyHtml}
      hottexts={hottexts}
      correctIds={correctIds}
      responseIdentifier={draft.responseIdentifier ?? 'RESPONSE'}
      maxChoices={draft.maxChoices}
      insertHottext={() => {
        const id = nextHottextId();
        const span: HottextSpan = { id, text: `Hot text ${hottexts.length + 1}` };
        setHottexts((prev) => [...prev, span]);
        insertBodyHtml(
          editor,
          setBodyHtml,
          createHottextMarkerHtml({ id: span.id, label: span.text }),
        );
      }}
      insertHottextMarker={(id) => {
        const span = hottexts.find((entry) => entry.id === id);
        insertBodyHtml(
          editor,
          setBodyHtml,
          createHottextMarkerHtml({ id, label: span?.text ?? id }),
        );
      }}
      removeHottext={(id) => {
        setHottexts((prev) => prev.filter((entry) => entry.id !== id));
        setCorrectIds((prev) => prev.filter((cid) => cid !== id));
        removeHottextMarkers(id);
      }}
      updateHottextText={(id, text) => {
        const span = hottexts.find((entry) => entry.id === id);
        if (!span) return;
        const updated: HottextSpan = { ...span, text };
        setHottexts((prev) => prev.map((entry) => (entry.id === id ? updated : entry)));
        replaceHottextMarkers(
          id,
          createHottextMarkerHtml({ id: updated.id, label: updated.text ?? updated.id }),
        );
      }}
      setCorrectIds={(ids) => setCorrectIds(ids)}
      setResponseIdentifier={(id) =>
        setDraftFieldValue(editor, draft, update, 'responseIdentifier', id)}
    />
  );
}

attachStandardDriverViews('hottext', HottextEditor);
