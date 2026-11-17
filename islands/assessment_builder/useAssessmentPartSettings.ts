import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
  createPartSettingsDraft,
  parsePartSettingsDraft,
  type PartSettingsDraft,
} from '../../lib/assessment_part_settings_draft.ts';
import type { AssessmentArrangementSaveCommand } from '../../lib/client/assessment_arrangement_save.ts';
import type { CapturedAssessmentParts } from '../../components/assessment_builder/useAssessmentParts.ts';
import type { Part } from './types.ts';

type SettingsSaveStatus = 'idle' | 'saving' | 'saved' | 'uncertain' | 'conflict' | 'rejected';

/** Part edits use the existing arrangement command and confirmed own-mutation capture. */
export function useAssessmentPartSettings(input: {
  readonly assessmentId: string;
  readonly parts: readonly Part[];
  readonly captureOrder: () => CapturedAssessmentParts;
}) {
  const [drafts, setDrafts] = useState<ReadonlyMap<string, PartSettingsDraft>>(new Map());
  const latest = useRef(drafts);
  const [fixedDrafts, setFixedDrafts] = useState<ReadonlyMap<string, boolean>>(new Map());
  const latestFixed = useRef(fixedDrafts);
  const [status, setStatus] = useState<SettingsSaveStatus>('idle');
  const inFlight = useRef<AbortController | null>(null);
  const pending = useRef<
    {
      readonly capture: CapturedAssessmentParts;
      readonly parts: Part[];
      readonly drafts: ReadonlyMap<string, PartSettingsDraft>;
      readonly fixedDrafts: ReadonlyMap<string, boolean>;
      command?: AssessmentArrangementSaveCommand;
    } | null
  >(null);
  const alive = useRef(true);
  const exiting = useRef(false);
  useLayoutEffect(() => {
    latest.current = drafts;
    latestFixed.current = fixedDrafts;
  }, [drafts, fixedDrafts]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      inFlight.current?.abort();
      pending.current?.capture.release();
    };
  }, []);
  const activeDrafts = [...drafts].filter(([id]) => input.parts.some((part) => part.id === id));
  const activePlacementIds = new Set(
    input.parts.flatMap((part) => part.placements.map((placement) => placement.id)),
  );
  const dirty = activeDrafts.length > 0 ||
    [...fixedDrafts.keys()].some((id) => activePlacementIds.has(id));
  const invalid = activeDrafts.find(([, draft]) => !parsePartSettingsDraft(draft).ok)?.[0];
  const blocked = dirty || status === 'saving' || status === 'uncertain' || status === 'conflict';
  useEffect(() => {
    if (!blocked) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (exiting.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    globalThis.addEventListener('beforeunload', warn);
    return () => globalThis.removeEventListener('beforeunload', warn);
  }, [blocked]);

  function change(part: Part, draft: PartSettingsDraft) {
    const parsed = parsePartSettingsDraft(draft);
    setDrafts((current) => {
      const next = new Map(current);
      if (
        !pending.current && parsed.ok &&
        JSON.stringify(parsed.options) === JSON.stringify(part.options ?? {})
      ) {
        next.delete(part.id);
      } else next.set(part.id, draft);
      latest.current = next;
      return next;
    });
  }

  function changeFixed(placement: Part['placements'][number], fixed: boolean) {
    setFixedDrafts((current) => {
      const next = new Map(current);
      if (!pending.current && fixed === (placement.fixed === true)) next.delete(placement.id);
      else next.set(placement.id, fixed);
      latestFixed.current = next;
      return next;
    });
  }

  async function persist() {
    const write = pending.current;
    if (!write || inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setStatus('saving');
    try {
      const [{ assessmentArrangementVersion }, { saveAssessmentArrangement }] = await Promise.all([
        import('../../lib/assessment_arrangement_version.ts'),
        import('../../lib/client/assessment_arrangement_save.ts'),
      ]);
      if (controller.signal.aborted) return;
      write.command ??= {
        expectedVersion: await assessmentArrangementVersion(
          input.assessmentId,
          write.capture.parts,
        ),
        parts: write.parts,
      };
      if (controller.signal.aborted) return;
      const outcome = await saveAssessmentArrangement(
        input.assessmentId,
        write.command,
        controller.signal,
      );
      if (!alive.current || controller.signal.aborted) return;
      if (outcome.ok) {
        write.capture.confirm(write.parts);
        pending.current = null;
        setDrafts((current) => {
          const next = new Map(current);
          for (const [id, draft] of write.drafts) {
            if (JSON.stringify(next.get(id)) === JSON.stringify(draft)) next.delete(id);
          }
          latest.current = next;
          return next;
        });
        setFixedDrafts((current) => {
          const next = new Map(current);
          for (const [id, fixed] of write.fixedDrafts) {
            if (next.get(id) === fixed) next.delete(id);
          }
          latestFixed.current = next;
          return next;
        });
        setStatus('saved');
      } else if (outcome.kind !== 'cancelled') {
        if (outcome.kind !== 'uncertain') {
          write.capture.release();
          pending.current = null;
        }
        setStatus(
          outcome.kind === 'uncertain'
            ? 'uncertain'
            : outcome.kind === 'conflict'
            ? 'conflict'
            : 'rejected',
        );
      }
    } catch (_cause: unknown) {
      if (alive.current && !controller.signal.aborted) setStatus('uncertain');
    } finally {
      inFlight.current = null;
    }
  }
  async function save() {
    if (inFlight.current || status === 'conflict') return;
    if (pending.current) return await persist();
    const entries = new Map(latest.current);
    const fixedEntries = new Map(latestFixed.current);
    if (entries.size === 0 && fixedEntries.size === 0) return;
    const capture = input.captureOrder();
    const parts = structuredClone(capture.parts);
    for (const part of parts) {
      for (const placement of part.placements) {
        const fixed = fixedEntries.get(placement.id);
        if (fixed !== undefined && 'itemId' in placement) placement.fixed = fixed;
      }
      const draft = entries.get(part.id);
      if (!draft) continue;
      const parsed = parsePartSettingsDraft(draft);
      if (!parsed.ok) {
        capture.release();
        return;
      }
      part.options = parsed.options;
    }
    pending.current = { capture, parts, drafts: entries, fixedDrafts: fixedEntries };
    await persist();
  }
  return {
    status,
    dirty,
    invalid,
    blocked,
    save,
    draftFor: (part: Part) => drafts.get(part.id) ?? createPartSettingsDraft(part.options ?? {}),
    change,
    fixedFor: (placement: Part['placements'][number]) =>
      fixedDrafts.get(placement.id) ?? (placement.fixed === true),
    changeFixed,
    allowExit: () => {
      exiting.current = true;
    },
  };
}
