import { parseQtiTest, startQtiTest, submitQtiTestAnswer } from '@longsightgroup/qti3-core';

export type AdaptivePreviewScenario = 'strong' | 'struggling' | 'mixed';
/** Runs the exact serialized test. Synthetic scores remain in the author preview only. */
export function previewAdaptiveAssessment(xml: string, scenario: AdaptivePreviewScenario) {
  const parsed = parseQtiTest(xml);
  if (!parsed.ok) throw new Error('Adaptive preview requires a supported QTI test.');
  const test = parsed.value;
  const refs = new Map(
    test.sections.flatMap((section) =>
      section.items.map((item) => [item.identifier, { item, section: section.identifier }] as const)
    ),
  );
  const started = startQtiTest(test);
  if (!started.ok) throw new Error('Adaptive preview test cannot start.');
  let session = started.value;
  const route: Array<{ section: string; level: string; itemRef: string; score: number }> = [];
  while (session.status === 'active') {
    if (route.length >= 100) throw new Error('Adaptive preview exceeded its answer limit.');
    const current = refs.get(session.currentItemRef);
    if (!current) throw new Error('Preview item is missing.');
    const level = current.item.categories.find((category) => /^QFLOW_LEVEL_[012]$/.test(category));
    if (!level) throw new Error('Preview level is missing.');
    const score = scenario === 'strong'
      ? 1
      : scenario === 'struggling'
      ? 0
      : [1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 0][route.length % 15];
    route.push({ section: current.section, level, itemRef: session.currentItemRef, score });
    const next = submitQtiTestAnswer(test, session, { itemRef: session.currentItemRef, score });
    if (!next.ok) throw new Error('Preview transition failed.');
    session = next.value;
  }
  return { answered: route.length, route };
}
