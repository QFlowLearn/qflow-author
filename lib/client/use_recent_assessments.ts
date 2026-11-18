import { reportUiError } from './ui_event.ts';
import { useEffect, useState } from 'preact/hooks';
import { isCanonicalUuid } from '../uuid.ts';

type RecentAssessment = { readonly id: string; readonly title: string };

/** Own quick-switch loading for this assessment and discard results after navigation. */
export function useRecentAssessments(assessmentId: string): readonly RecentAssessment[] {
  const [recent, setRecent] = useState<readonly RecentAssessment[]>([]);
  useEffect(() => {
    const request = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/assessments?limit=6', { signal: request.signal });
        if (!response.ok) return;
        const parsed = parseRecentAssessments(await response.json());
        if (parsed && !request.signal.aborted) {
          setRecent(parsed.filter((entry) => entry.id !== assessmentId));
        }
      } catch {
        // Quick switching is optional; the current assessment remains usable on request failure.
      }
    }
    load().catch(reportUiError);
    return () => request.abort();
  }, [assessmentId]);
  return recent;
}

/** Project the listing envelope into the two fields used by quick switching. */
export function parseRecentAssessments(value: unknown): readonly RecentAssessment[] | null {
  if (
    !value || typeof value !== 'object' || !('assessments' in value) ||
    !Array.isArray(value.assessments)
  ) return null;
  const result: RecentAssessment[] = [];
  for (const entry of value.assessments) {
    if (
      !entry || typeof entry !== 'object' || !('id' in entry) || !isCanonicalUuid(entry.id) ||
      !('title' in entry) || typeof entry.title !== 'string'
    ) return null;
    result.push({ id: entry.id, title: entry.title });
  }
  return result;
}
