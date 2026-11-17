import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { AssessmentArrangementSnapshot } from '../../lib/assessment_arrangement_version.ts';
import type { AssessmentArrangementSaveCommand } from '../../lib/client/assessment_arrangement_save.ts';

/** Save notices preserve the distinction between committed and newer local edits. */
export type ArrangementSaveNotice = 'saved' | 'newerEdits' | 'conflict' | 'failed' | null;

/** Keep local edits independent of the captured command and authoritative saved version. */
export function useAssessmentArrangementSave(
  assessmentId: string,
  initialVersion: string,
  parts: AssessmentArrangementSnapshot,
) {
  const latestParts = useRef(parts);
  const version = useRef(initialVersion);
  const inFlight = useRef<AbortController | null>(null);
  const retry = useRef<AssessmentArrangementSaveCommand | null>(null);
  const alive = useRef(true);
  const [savedParts, setSavedParts] = useState(() => JSON.stringify(parts));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<ArrangementSaveNotice>(null);
  useLayoutEffect(() => {
    latestParts.current = parts;
  }, [parts]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      inFlight.current?.abort();
    };
  }, []);
  const dirty = JSON.stringify(parts) !== savedParts || retry.current !== null;

  async function save() {
    if (inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    const command = retry.current ?? {
      expectedVersion: version.current,
      parts: structuredClone(latestParts.current),
    };
    retry.current = command;
    setSaving(true);
    setNotice(null);
    try {
      const { saveAssessmentArrangement } = await import(
        '../../lib/client/assessment_arrangement_save.ts'
      );
      if (controller.signal.aborted) return;
      const result = await saveAssessmentArrangement(assessmentId, command, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      if (result.ok) {
        version.current = result.version;
        retry.current = null;
        const snapshot = JSON.stringify(command.parts);
        setSavedParts(snapshot);
        setNotice(JSON.stringify(latestParts.current) === snapshot ? 'saved' : 'newerEdits');
      } else if (result.kind !== 'cancelled') {
        if (result.kind !== 'uncertain') retry.current = null;
        setNotice(result.kind === 'conflict' ? 'conflict' : 'failed');
      }
    } catch (_cause: unknown) {
      // Loading the deferred adapter can fail too; keep the exact command available to retry.
      if (alive.current && !controller.signal.aborted) setNotice('failed');
    } finally {
      inFlight.current = null;
      if (alive.current) setSaving(false);
    }
  }
  return { dirty, saving, notice, save };
}
