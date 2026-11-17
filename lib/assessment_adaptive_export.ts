import type {
  QtiOutcomeDeclaration,
  QtiTestDefinition,
  QtiTestExpression,
  QtiTestSection,
} from '@longsightgroup/qti3-core';
import type { AdaptiveAssessmentPlan } from './assessment_adaptive_plan.ts';
import type { Part } from './test_export.ts';
import { toPackageIdentifier } from './qti_identifiers.ts';

/** Compile the frozen pool into standard forward branches; exported QTI owns runtime routing. */
export function compileAdaptiveAssessment(
  assessment: { id: string; title?: string },
  parts: readonly Part[],
  plan: AdaptiveAssessmentPlan,
): QtiTestDefinition {
  const part = parts[0];
  if (
    parts.length !== 1 || !part || part.id !== plan.partId ||
    part.placements.length !== 3 * plan.settings.questionCount - 15 ||
    Object.keys(part.options ?? {}).length ||
    part.placements.some((placement) => placement.fixed === true)
  ) throw new Error('Adaptive assessment membership or options do not match its plan.');
  const placements = new Map(part.placements.map((placement) => [placement.id, placement]));
  const assigned = plan.blocks.flatMap((block) => block.placementIds);
  if (
    placements.size !== part.placements.length || new Set(assigned).size !== placements.size ||
    assigned.some((id) => !placements.has(id))
  ) throw new Error('Adaptive assessment has missing or repeated placements.');
  const sectionId = (group: number, level: number) => `block_${group}_${level}`;
  const sections: QtiTestSection[] = plan.blocks.map((block) => {
    const identifier = sectionId(block.group, block.level);
    const score = { type: 'variable', identifier: `${identifier}_score` } as const;
    const threshold = (operator: 'gte' | 'lte', value: number): QtiTestExpression => ({
      type: 'numericCompare',
      operator,
      left: score,
      right: { type: 'baseValue', baseType: 'integer', value },
    });
    const always = { type: 'baseValue', baseType: 'boolean', value: true } as const;
    const branches = block.group === plan.settings.questionCount / 5 - 1
      ? [{ target: 'EXIT_TEST', expression: always }]
      : [
        {
          target: sectionId(block.group + 1, Math.min(block.level + 1, 2)),
          expression: threshold('gte', 4),
        },
        {
          target: sectionId(block.group + 1, Math.max(block.level - 1, 0)),
          expression: threshold('lte', 1),
        },
        { target: sectionId(block.group + 1, block.level), expression: always },
      ];
    return {
      identifier,
      title: `${plan.levels[block.level].label} — ${block.group + 1}`,
      branches,
      items: block.placementIds.map((id) => {
        const placement = placements.get(id);
        if (!placement || !('itemId' in placement)) {
          throw new Error('Adaptive placement is unavailable.');
        }
        return {
          identifier: adaptiveItemReferenceId(id),
          href: `items/${placement.itemId}.xml`,
          categories: [identifier, `QFLOW_LEVEL_${block.level}`],
        };
      }),
    };
  });
  const constants: QtiOutcomeDeclaration[] = [
    declaration('QFLOW_ADAPTIVE_TARGET', plan.settings.questionCount),
    declaration('QFLOW_ADAPTIVE_AUDIENCE', plan.audience),
    declaration('QFLOW_ADAPTIVE_CATEGORY_VERSION', plan.settings.versionId),
    ...plan.levels.flatMap((
      level,
      index,
    ) => [
      declaration(`QFLOW_LEVEL_${index}_ID`, level.id),
      declaration(`QFLOW_LEVEL_${index}_LABEL`, level.label),
    ]),
  ];
  return {
    identifier: toPackageIdentifier(`test_${assessment.id}`, 'test'),
    title: assessment.title || 'Adaptive assessment',
    partIdentifier: toPackageIdentifier(`part_${part.id}`, 'part'),
    sections,
    outcomeDeclarations: [
      ...constants,
      // QTI item SCORE aggregation produces a float even when each score is 0 or 1.
      ...sections.map((section): QtiOutcomeDeclaration => ({
        ...declaration(`${section.identifier}_score`, 0),
        baseType: 'float',
      })),
    ],
    outcomeProcessing: sections.map((section) => ({
      type: 'setOutcomeValue',
      identifier: `${section.identifier}_score`,
      expression: {
        type: 'sum',
        expressions: [{
          type: 'testVariables',
          variableIdentifier: 'SCORE',
          includeCategory: section.identifier,
        }],
      },
    })),
  };
}

function declaration(identifier: string, value: string | number): QtiOutcomeDeclaration {
  return {
    kind: 'outcome',
    identifier,
    cardinality: 'single',
    baseType: typeof value === 'number' ? 'integer' : 'string',
    defaultValue: value,
    attributes: {},
  };
}

/** Stable binding between a frozen placement and its QTI item reference. */
export function adaptiveItemReferenceId(placementId: string): string {
  return toPackageIdentifier(`ref_${placementId}`, 'ref');
}
