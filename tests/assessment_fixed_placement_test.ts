import { expect, test as testCase } from 'vitest';

import { parseQtiFixedTestOrdering, prepareQtiFixedTestOrder } from '@longsightgroup/qti3-core';
import { parseAssessmentArrangeRequest } from '../lib/assessment_arrangement.ts';
import { assessmentArrangementVersion } from '../lib/assessment_arrangement_version.ts';
import {
  assessmentCanvasMoveBounds,
  moveAssessmentCanvasPlacement,
} from '../lib/assessment_canvas_move.ts';
import { buildAssessmentTestXml } from '../lib/test_export.ts';
import { compileAdaptiveAssessment } from '../lib/assessment_adaptive_export.ts';
import { adaptiveExportFixture } from './helpers/adaptive_export_fixture.ts';
import { assessmentExportSettingsDiagnostics } from '../lib/export/assessment_export_settings.ts';
import { listSelectableAssessmentExportTargets } from '../lib/export/assessment_export_targets.ts';

const parts = [{
  id: 'part',
  title: 'Part',
  options: { shuffleQuestions: true },
  placements: ['A', 'B', 'C', 'D', 'E'].map((id, index) => ({
    id,
    itemId: id,
    fixed: index === 1 || index === 2,
  })),
}, {
  id: 'other',
  title: 'Other',
  options: { shuffleQuestions: false },
  placements: ['F', 'G'].map((id) => ({ id, itemId: id, fixed: false })),
}];

testCase(
  'canvas move bounds match protected-slot behavior for every pattern of up to six placements',
  () => {
    expect(assessmentCanvasMoveBounds({ id: 'empty', placements: [] }).size).toStrictEqual(0);
    for (let count = 1; count <= 6; count++) {
      for (let mask = 0; mask < 2 ** count; mask++) {
        const part = {
          id: 'part',
          placements: Array.from(
            { length: count },
            (_, index) => ({ id: `place-${index}`, fixed: (mask & (1 << index)) !== 0 }),
          ),
        };
        const bounds = assessmentCanvasMoveBounds(part);
        for (let from = 0; from < count; from++) {
          const range = bounds.get(part.placements[from].id);
          if (!range) expect.unreachable('Expected range');
          for (let position = 0; position < count; position++) {
            const candidate = [...part.placements];
            const [source] = candidate.splice(from, 1);
            candidate.splice(position, 0, source);
            const preservesSlots = part.placements.every((placement, index) =>
              !placement.fixed || candidate[index].id === placement.id
            );
            expect(position >= range.first && position <= range.last).toStrictEqual(preservesSlots);
            const result = moveAssessmentCanvasPlacement([part], {
              partId: part.id,
              placementId: source.id,
              position,
            });
            expect(result.ok).toStrictEqual(preservesSlots);
            if (result.ok) expect(result.parts[0].placements).toStrictEqual(candidate);
            const linearBounds = assessmentCanvasMoveBounds({
              ...part,
              options: { navigationMode: 'linear' },
            }).get(source.id);
            expect(linearBounds).toStrictEqual({ first: from, last: from });
          }
        }
      }
    }
  },
);

testCase('fixed-position export warnings do not require any optional part settings', () => {
  const document = {
    assessment: { id: 'fixed-without-options' },
    parts: [{ id: 'part', title: 'Part', placements: [{ id: 'A', itemId: 'A', fixed: true }] }],
  };
  for (const target of listSelectableAssessmentExportTargets()) {
    const diagnostics = assessmentExportSettingsDiagnostics(document, target);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toStrictEqual(
      target.id === 'qti3-conformant' ? [] : ['qflow.export.part_fixed_positions_omitted'],
    );
    expect(assessmentExportSettingsDiagnostics({
      ...document,
      parts: [{ ...document.parts[0], placements: [{ id: 'A', itemId: 'A', fixed: false }] }],
    }, target)).toStrictEqual([]);
  }
});

testCase(
  'fixed placement flags use the existing closed arrangement command and participate in freshness',
  async () => {
    const partId = crypto.randomUUID(),
      placementId = crypto.randomUUID(),
      itemId = crypto.randomUUID();
    const base = {
      expectedVersion: 'a'.repeat(64),
      parts: [{ id: partId, title: 'Part', placements: [{ id: placementId, itemId }] }],
    };
    const absent = parseAssessmentArrangeRequest(base);
    if (!(absent.ok)) expect.unreachable('Expected absent.ok');
    expect(absent.request.parts[0].placements[0].fixed).toStrictEqual(false);
    for (const fixed of [true, false]) {
      const parsed = parseAssessmentArrangeRequest({
        ...base,
        parts: [{ ...base.parts[0], placements: [{ ...base.parts[0].placements[0], fixed }] }],
      });
      if (!(parsed.ok)) expect.unreachable('Expected parsed.ok');
      expect(parsed.request.parts[0].placements[0].fixed).toStrictEqual(fixed);
      const placement = parsed.request.parts[0].placements[0];
      if (!('itemId' in placement)) expect.unreachable("Expected 'itemId' in placement");
      expect(placement.snapshotRev).toStrictEqual(null);
    }
    for (const fixed of ['true', 0, 1, null, {}, []]) {
      expect(
        parseAssessmentArrangeRequest({
          ...base,
          parts: [{ ...base.parts[0], placements: [{ ...base.parts[0].placements[0], fixed }] }],
        }).ok,
      ).toStrictEqual(false);
    }
    expect(await assessmentArrangementVersion('assessment', parts)).not.toStrictEqual(
      await assessmentArrangementVersion(
        'assessment',
        parts.map((part) => ({
          ...part,
          placements: part.placements.map((p) => ({ ...p, fixed: false })),
        })),
      ),
    );
    expect(
      await assessmentArrangementVersion('assessment', [{
        id: 'part',
        title: 'Part',
        placements: [{ id: 'A', itemId: 'A' }],
      }]),
    ).toStrictEqual(
      await assessmentArrangementVersion('assessment', [{
        id: 'part',
        title: 'Part',
        placements: [{ id: 'A', itemId: 'A', fixed: false }],
      }]),
    );
  },
);

testCase(
  'shared ordering preserves dependent fixed slots and part boundaries without inventing an ordinary ordering policy',
  () => {
    const before = structuredClone(parts);
    const xml = buildAssessmentTestXml({ id: 'fixed-policy' }, parts);
    const parsed = parseQtiFixedTestOrdering(xml);
    if (!(parsed.ok)) expect.unreachable('Expected parsed.ok');
    expect(parsed.value.sections[0].items.map((item) => item.fixed)).toStrictEqual([
      false,
      true,
      true,
      false,
      false,
    ]);
    const variations = new Set<string>();
    for (let seed = 0; seed < 24; seed++) {
      const generated = prepareQtiFixedTestOrder(parsed.value, { kind: 'new', seed });
      if (!(generated.ok)) expect.unreachable('Expected generated.ok');
      const first = generated.value.sections[0];
      expect(first.itemRefs.slice(1, 3)).toStrictEqual(
        parsed.value.sections[0].items.slice(1, 3).map((item) => item.identifier),
      );
      expect(generated.value.sections[1].itemRefs).toStrictEqual(
        parsed.value.sections[1].items.map((item) => item.identifier),
      );
      expect([...first.itemRefs].sort()).toStrictEqual(
        parsed.value.sections[0].items.map((item) => item.identifier).sort(),
      );
      const restored = prepareQtiFixedTestOrder(parsed.value, {
        kind: 'restore',
        state: generated.value,
      });
      if (!(restored.ok)) expect.unreachable('Expected restored.ok');
      expect(restored.value).toStrictEqual(generated.value);
      variations.add(first.itemRefs.join(','));
      const moved = {
        ...generated.value,
        sections: generated.value.sections.map((section, index) =>
          index === 0
            ? { ...section, itemRefs: [...section.itemRefs.slice(1), section.itemRefs[0]] }
            : section
        ),
      };
      expect(prepareQtiFixedTestOrder(parsed.value, { kind: 'restore', state: moved }).ok)
        .toStrictEqual(false);
    }
    if (!(variations.size > 1)) expect.unreachable('Expected variations.size > 1');
    expect(parts).toStrictEqual(before);
    const ordinary = buildAssessmentTestXml({ id: 'ordinary' }, [{
      id: 'part',
      title: 'Part',
      placements: [{ id: 'A', itemId: 'A', fixed: false }],
    }]);
    if (ordinary.includes(' fixed=')) {
      expect.unreachable("Expected !ordinary.includes(' fixed=')");
    }
    if (ordinary.includes('<qti-ordering')) {
      expect.unreachable("Expected !ordinary.includes('<qti-ordering')");
    }
    const adaptive = adaptiveExportFixture();
    expect(() =>
      compileAdaptiveAssessment(adaptive.assessment, [{
        ...adaptive.part,
        placements: adaptive.part.placements.map((p, index) => ({ ...p, fixed: index === 0 })),
      }], adaptive.plan)
    ).toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('do not match its plan')
      ),
    );
  },
);

testCase(
  'canvas moves cannot move a fixed slot or cross dependent slots, but ordinary moves within a free span remain available',
  () => {
    for (const [placementId, position] of [['B', 0], ['A', 4], ['D', 0]] as const) {
      expect(moveAssessmentCanvasPlacement(parts, { partId: 'part', placementId, position }))
        .toStrictEqual({
          ok: false,
          reason: 'constrained',
        });
    }
    const moved = moveAssessmentCanvasPlacement(parts, {
      partId: 'part',
      placementId: 'E',
      position: 3,
    });
    if (!(moved.ok)) expect.unreachable('Expected moved.ok');
    expect(moved.parts[0].placements.map((p) => p.id)).toStrictEqual(['A', 'B', 'C', 'E', 'D']);
    expect(moved.parts[1]).toStrictEqual(parts[1]);
  },
);
