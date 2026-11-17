import type { AssessmentQuestionPointDefault } from '../../lib/assessment_question_defaults.ts';
import { useMemo, useRef, useState } from 'preact/hooks';
import {
  AuthoringSettingsChanges,
  type CapturedAuthoringSettings,
} from '../../lib/authoring_settings_changes.ts';
import {
  type AuthoringPreference,
  type AuthoringSettingsPatch,
  changedAuthoringSettings,
  mergeAuthoringPreferences,
} from '../../lib/authoring_preferences.ts';
import type { Draft } from '../../lib/types/draft.ts';
import type { QuestionTypeId } from '../../lib/types/registry.ts';
import {
  type InstructorDefaults,
  resolveAuthoringPreferences,
} from '../../lib/instructor_defaults.ts';

type Capture = {
  readonly pending: CapturedAuthoringSettings;
  readonly patch: AuthoringSettingsPatch;
};
/** Own explicit pending setting changes separately from loaded question settings. */
export function useAuthoringPreferences(
  assessmentId: string,
  initial: readonly AuthoringPreference[],
  instructorDefaults: InstructorDefaults,
  assessmentQuestionPointDefault: AssessmentQuestionPointDefault,
) {
  const [preferences, setPreferences] = useState(initial);
  const effectivePreferences = useMemo(
    () =>
      resolveAuthoringPreferences(instructorDefaults, preferences, assessmentQuestionPointDefault),
    [instructorDefaults, preferences, assessmentQuestionPointDefault],
  );
  const [remember, setRemember] = useState(true);
  const [resetState, setResetState] = useState<'idle' | 'resetting' | 'saved' | 'failed'>('idle');
  const generation = useRef(0);
  const pending = useRef(new AuthoringSettingsChanges());
  const observedDropdown = useRef<Draft | null>(null);
  const resetInFlight = useRef(false);
  function begin(options: { readonly preserveRemember?: boolean } = {}) {
    generation.current++;
    pending.current.clear();
    observedDropdown.current = null;
    if (!options.preserveRemember) setRemember(true);
    setResetState(resetInFlight.current ? 'resetting' : 'idle');
  }
  function record(type: QuestionTypeId, before: Draft, after: Draft) {
    pending.current.record(changedAuthoringSettings(type, before, after));
  }
  /** Observe slot edits after the initial loaded draft; never remember question loading. */
  function observeDropdownDraft(draft: Draft) {
    const previous = observedDropdown.current;
    observedDropdown.current = draft.type === 'inline_choice' ? draft : null;
    if (draft.type !== 'inline_choice' || previous?.type !== 'inline_choice') return;
    const changed = changedAuthoringSettings('inline_choice', previous, draft);
    if (changed.shuffle !== undefined) pending.current.record({ shuffle: changed.shuffle });
  }
  function capture(): Capture {
    const captured = pending.current.capture();
    return {
      pending: captured,
      patch: remember ? captured.patch : {},
    };
  }
  function committed(type: QuestionTypeId, saved: Capture) {
    setPreferences((current) => mergeAuthoringPreferences(current, type, saved.patch));
    pending.current.acknowledge(saved.pending);
  }
  async function reset(type: QuestionTypeId) {
    if (resetInFlight.current) return;
    resetInFlight.current = true;
    const activeGeneration = generation.current;
    const pendingAtReset = pending.current.capture();
    setResetState('resetting');
    try {
      const response = await fetch(`/api/assessments/${assessmentId}/authoring-preferences`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ typeId: type }),
      });
      if (response.status !== 204) {
        if (activeGeneration === generation.current) setResetState('failed');
        return;
      }
      setPreferences((current) => current.filter((p) => p.typeId !== type));
      pending.current.acknowledge(pendingAtReset);
      if (activeGeneration === generation.current) {
        setResetState('saved');
      }
    } catch {
      if (activeGeneration === generation.current) setResetState('failed');
    } finally {
      resetInFlight.current = false;
      if (activeGeneration !== generation.current) setResetState('idle');
    }
  }
  return {
    preferences: effectivePreferences,
    remember,
    setRemember,
    resetState,
    begin,
    record,
    observeDropdownDraft,
    capture,
    committed,
    reset,
  };
}
