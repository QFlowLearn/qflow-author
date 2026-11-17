import { canonicalJsonStringify } from '../../lib/canonical_json.ts';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  type AssessmentContentPlacement,
  type AssessmentStandaloneContent,
  parseAssessmentStandaloneContent,
} from '../../lib/assessment_standalone_content.ts';
import type { AssessmentArrangementSaveCommand } from '../../lib/client/assessment_arrangement_save.ts';
import type { AuthoringState, Part } from '../../islands/assessment_builder/types.ts';
import type { CapturedAssessmentParts } from './useAssessmentParts.ts';
import { insertAssessmentPlacements } from '../../lib/assessment_insertion.ts';

type ContentEditStatus =
  | 'ready'
  | 'saving'
  | 'saved'
  | 'invalid'
  | 'uncertain'
  | 'conflict'
  | 'rejected';

/** Edit one ordered content block through the existing captured full-arrangement write. */
export function useAssessmentContentEdit(props: {
  readonly assessmentId: string;
  readonly uploading: boolean;
  readonly editing: Extract<AuthoringState, { _tag: 'EditingContent' | 'CreatingContent' }>;
  readonly captureOrder: () => CapturedAssessmentParts;
  readonly onCopied: (placement: AssessmentContentPlacement) => void;
  readonly onCreated: (placement: AssessmentContentPlacement) => void;
  readonly onRemoved: () => void;
}) {
  const creating = props.editing._tag === 'CreatingContent';
  const placementId = props.editing._tag === 'EditingContent'
    ? props.editing.placement.id
    : props.editing.placementId;
  const created = useRef(false);
  const [content, setContent] = useState(
    props.editing._tag === 'EditingContent'
      ? props.editing.placement.content
      : props.editing.initialDraft,
  );
  const raw = useRef(content);
  raw.current = content;
  const baseline = useRef(content);
  const [status, setStatus] = useState<ContentEditStatus>('ready');
  const pending = useRef<
    {
      readonly capture: CapturedAssessmentParts;
      readonly ordered: Part[];
      readonly content: AssessmentStandaloneContent;
      readonly action: { readonly _tag: 'Save' } | {
        readonly _tag: 'Duplicate';
        readonly placement: AssessmentContentPlacement;
      } | { readonly _tag: 'Remove' };
      command?: AssessmentArrangementSaveCommand;
    } | null
  >(null);
  const inFlight = useRef<AbortController | null>(null);
  const unloadWarning = useRef<((event: BeforeUnloadEvent) => void) | null>(null);
  const alive = useRef(true);
  const dirty = !sameContent(content, baseline.current);
  const blocked = props.uploading || status === 'saving' || status === 'uncertain';
  function clearUnloadWarning() {
    if (unloadWarning.current) {
      globalThis.removeEventListener('beforeunload', unloadWarning.current);
      unloadWarning.current = null;
    }
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      inFlight.current?.abort();
      pending.current?.capture.release();
    };
  }, []);
  useEffect(() => {
    if (!dirty && !blocked) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    unloadWarning.current = warn;
    globalThis.addEventListener('beforeunload', warn);
    return () => {
      globalThis.removeEventListener('beforeunload', warn);
      if (unloadWarning.current === warn) unloadWarning.current = null;
    };
  }, [dirty, blocked]);

  async function persist(): Promise<boolean> {
    const write = pending.current;
    if (!write || inFlight.current) return false;
    const controller = new AbortController();
    inFlight.current = controller;
    setStatus('saving');
    try {
      const [{ assessmentArrangementVersion }, { saveAssessmentArrangement }] = await Promise.all([
        import('../../lib/assessment_arrangement_version.ts'),
        import('../../lib/client/assessment_arrangement_save.ts'),
      ]);
      if (controller.signal.aborted) return false;
      write.command ??= {
        expectedVersion: await assessmentArrangementVersion(
          props.assessmentId,
          write.capture.parts,
        ),
        parts: write.ordered,
      };
      if (controller.signal.aborted) return false;
      const outcome = await saveAssessmentArrangement(
        props.assessmentId,
        write.command,
        controller.signal,
      );
      if (!alive.current || controller.signal.aborted) return false;
      if (outcome.ok) {
        write.capture.confirm(write.ordered);
        if (creating) created.current = true;
        baseline.current = write.content;
        pending.current = null;
        const unchanged = sameContent(raw.current, write.content);
        setStatus(
          unchanged
            ? 'saved'
            : parseAssessmentStandaloneContent(raw.current).ok
            ? 'ready'
            : 'invalid',
        );
        // Newer input remains dirty, and Save-and-continue cannot discard it.
        if (unchanged) clearUnloadWarning();
        if (unchanged && creating && write.action._tag === 'Save') {
          props.onCreated({
            id: placementId,
            content: write.content,
            fixed: true,
          });
        }
        if (unchanged && write.action._tag === 'Duplicate') props.onCopied(write.action.placement);
        if (unchanged && write.action._tag === 'Remove') props.onRemoved();
        return unchanged;
      }
      if (outcome.kind !== 'cancelled') {
        const kind = outcome.kind === 'uncertain'
          ? 'uncertain'
          : outcome.kind === 'conflict'
          ? 'conflict'
          : 'rejected';
        if (kind !== 'uncertain') {
          write.capture.release();
          pending.current = null;
        }
        setStatus(kind);
      }
      return false;
    } catch (_cause: unknown) {
      if (alive.current && !controller.signal.aborted) setStatus('uncertain');
      return false;
    } finally {
      inFlight.current = null;
    }
  }

  async function save(): Promise<boolean> {
    if (props.uploading) return false;
    if (pending.current) return await persist();
    if (status === 'conflict') return false;
    const parsed = parseAssessmentStandaloneContent(raw.current);
    if (!parsed.ok) {
      setStatus('invalid');
      return false;
    }
    if (sameContent(raw.current, baseline.current) && (!creating || created.current)) return true;
    const capture = props.captureOrder();
    const part = capture.parts.find((entry) => entry.id === props.editing.partId);
    const placement = part?.placements.find((entry) => entry.id === placementId);
    const inserting = creating && !created.current;
    const beforeId = props.editing._tag === 'CreatingContent'
      ? props.editing.beforePlacementId
      : undefined;
    if (
      !part ||
      (inserting
        ? placement !== undefined ||
          (beforeId !== undefined && !part.placements.some((entry) => entry.id === beforeId))
        : !placement || !('content' in placement) ||
          !sameContent(placement.content, baseline.current))
    ) {
      capture.release();
      setStatus('conflict');
      return false;
    }
    const saved: AssessmentContentPlacement = {
      id: placementId,
      content: parsed.content,
      fixed: true,
    };
    const ordered = capture.parts.map((entry) =>
      entry.id !== part.id ? entry : {
        ...entry,
        placements: inserting
          ? insertAssessmentPlacements(entry.placements, [saved], beforeId)
          : entry.placements.map((placement) => placement.id === placementId ? saved : placement),
      }
    );
    pending.current = { capture, ordered, content: parsed.content, action: { _tag: 'Save' } };
    return await persist();
  }

  async function changeStructure(operation: 'Duplicate' | 'Remove'): Promise<boolean> {
    if (
      props.uploading || creating || pending.current || inFlight.current ||
      !sameContent(raw.current, baseline.current) ||
      status === 'conflict'
    ) return false;
    const capture = props.captureOrder();
    const sourcePart = capture.parts.find((part) => part.id === props.editing.partId);
    const source = sourcePart?.placements.find((entry) => entry.id === placementId);
    if (
      !sourcePart || !source || !('content' in source) ||
      !sameContent(source.content, baseline.current)
    ) {
      capture.release();
      setStatus('conflict');
      return false;
    }
    const action = operation === 'Duplicate'
      ? {
        _tag: 'Duplicate' as const,
        placement: {
          ...source,
          id: crypto.randomUUID(),
          content: source.content,
        },
      }
      : { _tag: 'Remove' as const };
    const ordered = capture.parts.map((part) =>
      part.id === sourcePart.id
        ? {
          ...part,
          placements: part.placements.flatMap((entry) =>
            entry.id !== source.id
              ? [entry]
              : action._tag === 'Duplicate'
              ? [entry, action.placement]
              : []
          ),
        }
        : part
    );
    pending.current = { capture, ordered, content: baseline.current, action };
    return await persist();
  }

  return {
    content,
    status,
    dirty,
    blocked,
    structurePending: pending.current !== null && pending.current.action._tag !== 'Save',
    duplicate: () => changeStructure('Duplicate'),
    remove: () => changeStructure('Remove'),
    save,
    discard() {
      // Explicit discard precedes a possible synchronous navigation. Effect cleanup is too late.
      raw.current = baseline.current;
      setContent(baseline.current);
      setStatus('ready');
      clearUnloadWarning();
    },
    canSave: dirty && !blocked && status !== 'conflict' &&
      parseAssessmentStandaloneContent(content).ok,
    change(value: AssessmentStandaloneContent) {
      if (pending.current && pending.current.action._tag !== 'Save') return;
      raw.current = value;
      setContent(value);
      if (!pending.current && status !== 'conflict') {
        setStatus(
          parseAssessmentStandaloneContent(value).ok ? 'ready' : 'invalid',
        );
      }
    },
  };
}

function sameContent(a: AssessmentStandaloneContent, b: AssessmentStandaloneContent): boolean {
  return canonicalJsonStringify(a) === canonicalJsonStringify(b);
}
