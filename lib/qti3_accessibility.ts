import {
  parseQtiXml,
  type QtiAssessmentItem,
  type QtiContentNode,
  type QtiInteraction,
} from '@longsightgroup/qti3-core';
import { usesColorOnlyInstruction } from './color_only_instruction.ts';

/** Pinned parser version used to inspect canonical QTI item XML. */
export const QTI3_ACCESSIBILITY_CORE_VERSION = '0.13.4' as const;

/** QFlow policy applied to the QTI document model returned by qti3-core. */
export const QTI3_ACCESSIBILITY_POLICY_VERSION = 'qflow.accessibility.v1' as const;

/** One accessibility finding tied to a final QTI item. */
export type Qti3AccessibilityFinding = {
  readonly itemId: string;
  readonly code: string;
  readonly severity: 'warning' | 'error';
  readonly message: string;
  readonly path?: string;
};

/** Deterministic accessibility evidence for all final canonical QTI items. */
export type Qti3AccessibilityReport = {
  /** Exact parser release that produced this immutable evidence. */
  readonly qti3CoreVersion: string;
  readonly policyVersion: typeof QTI3_ACCESSIBILITY_POLICY_VERSION;
  readonly outcome: 'passed' | 'review';
  readonly findings: readonly Qti3AccessibilityFinding[];
};

/** Parse accessibility evidence from a serialized export receipt. */
export function parseQti3AccessibilityReport(value: unknown): Qti3AccessibilityReport {
  const report = record(value, 'Accessibility report must be an object.');
  assertExactKeys(
    report,
    ['qti3CoreVersion', 'policyVersion', 'outcome', 'findings'],
    'accessibility report',
  );
  const qti3CoreVersion = nonEmptyString(
    report.qti3CoreVersion,
    'Accessibility QTI parser version is required.',
  );
  if (
    report.qti3CoreVersion !== qti3CoreVersion ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(qti3CoreVersion)
  ) {
    throw new Error('Accessibility QTI parser version must be an exact stable release.');
  }
  if (report.policyVersion !== QTI3_ACCESSIBILITY_POLICY_VERSION) {
    throw new Error(`Accessibility policy must be ${QTI3_ACCESSIBILITY_POLICY_VERSION}.`);
  }
  if (report.outcome !== 'passed' && report.outcome !== 'review') {
    throw new Error('Accessibility outcome must be passed or review.');
  }
  if (!Array.isArray(report.findings)) {
    throw new Error('Accessibility findings must be an array.');
  }
  const findings = report.findings.map((entry, index) => {
    const finding = record(entry, `Accessibility finding ${index + 1} must be an object.`);
    const expected = finding.path === undefined
      ? ['itemId', 'code', 'severity', 'message']
      : ['itemId', 'code', 'severity', 'message', 'path'];
    assertExactKeys(finding, expected, `accessibility finding ${index + 1}`);
    const itemId = nonEmptyString(
      finding.itemId,
      `Accessibility finding ${index + 1} item ID is required.`,
    );
    const code = nonEmptyString(
      finding.code,
      `Accessibility finding ${index + 1} code is required.`,
    );
    if (finding.severity !== 'warning' && finding.severity !== 'error') {
      throw new Error(`Accessibility finding ${index + 1} severity is invalid.`);
    }
    const severity: Qti3AccessibilityFinding['severity'] = finding.severity;
    const message = nonEmptyString(
      finding.message,
      `Accessibility finding ${index + 1} message is required.`,
    );
    const path = finding.path === undefined ? undefined : nonEmptyString(
      finding.path,
      `Accessibility finding ${index + 1} path must be non-empty.`,
    );
    return {
      itemId,
      code,
      severity,
      message,
      ...(path ? { path } : {}),
    };
  });
  const findingKeys = findings.map((finding) =>
    `${finding.itemId}:${finding.code}:${finding.message}:${finding.path ?? ''}`
  );
  if (new Set(findingKeys).size !== findingKeys.length) {
    throw new Error('Accessibility findings must be unique.');
  }
  if (report.outcome === 'passed' && findings.length) {
    throw new Error('A passed accessibility report cannot contain findings.');
  }
  if (report.outcome === 'review' && !findings.length) {
    throw new Error('An accessibility report marked for review requires findings.');
  }
  return {
    qti3CoreVersion,
    policyVersion: QTI3_ACCESSIBILITY_POLICY_VERSION,
    outcome: report.outcome,
    findings,
  };
}

/** Parse final QTI through qti3-core, then apply the QFlow accessibility policy. */
export function validateQti3Accessibility(
  itemsXml: Readonly<Record<string, string>>,
): Qti3AccessibilityReport {
  const findings = Object.entries(itemsXml).flatMap(([itemId, xml]) =>
    validateItemAccessibility(itemId, xml)
  );
  return {
    qti3CoreVersion: QTI3_ACCESSIBILITY_CORE_VERSION,
    policyVersion: QTI3_ACCESSIBILITY_POLICY_VERSION,
    outcome: findings.length ? 'review' : 'passed',
    findings,
  };
}

function validateItemAccessibility(itemId: string, xml: string): Qti3AccessibilityFinding[] {
  const parsed = parseQtiXml(xml);
  if (!parsed.document) {
    const diagnostic = parsed.diagnostics.find((entry) => entry.severity === 'error');
    return [{
      itemId,
      code: 'qti3_accessibility.parse_failed',
      severity: 'error',
      message: diagnostic?.message ??
        'qti3-core could not parse this item for accessibility review.',
      ...(diagnostic?.path ? { path: diagnostic.path } : {}),
    }];
  }
  const item = parsed.document.item;
  const findings: Qti3AccessibilityFinding[] = [];

  for (const node of accessibilityContentNodes(item)) {
    if (node.kind === 'element' && node.qtiName.toLocaleLowerCase() === 'img') {
      if (Object.hasOwn(node.attributes, 'alt')) continue;
      findings.push(warning(
        itemId,
        'qti3_accessibility.missing_alt_text',
        'An image in the final QTI is missing alt text.',
        node.source?.path,
      ));
    }
  }
  for (const interaction of item.interactions.filter((entry) => entry.type === 'media')) {
    if (!hasTextAttribute(interaction.attributes, 'label')) {
      findings.push(warning(
        itemId,
        'qti3_accessibility.missing_media_label',
        'A media interaction in the final QTI is missing its label.',
        interaction.source?.path,
      ));
    }
    if (interaction.object && !hasTextAttribute(interaction.object.attributes, 'label')) {
      findings.push(warning(
        itemId,
        'qti3_accessibility.missing_object_label',
        'A media object in the final QTI is missing its label.',
        interaction.object.source?.path,
      ));
    }
    if (isVideoInteraction(interaction) && !hasCaptions(interaction)) {
      findings.push(warning(
        itemId,
        'qti3_accessibility.missing_captions',
        'A video in the final QTI has no captions track.',
        interaction.object?.source?.path ?? interaction.source?.path,
      ));
    }
    if (isAudioOrVideoInteraction(interaction) && !hasTranscript(item)) {
      findings.push(warning(
        itemId,
        'qti3_accessibility.missing_transcript',
        'Audio or video in the final QTI has no transcript text.',
        interaction.source?.path,
      ));
    }
  }
  if (usesColorOnlyInstruction(item.bodyText)) {
    findings.push(warning(
      itemId,
      'qti3_accessibility.color_only_instruction',
      'An instruction may rely on color alone. Add another visible cue.',
    ));
  }
  return dedupeFindings(findings);
}

function accessibilityContentNodes(item: QtiAssessmentItem): QtiContentNode[] {
  const roots = [
    ...item.body,
    ...item.interactions.flatMap((interaction) => [
      ...(interaction.promptContent ?? []),
      ...interaction.choices.flatMap((choice) => choice.content ?? []),
      ...(interaction.customInteraction?.interactionMarkup ?? []),
      ...(interaction.portableCustom?.interactionMarkup ?? []),
    ]),
    ...(item.catalogInfo?.catalogs.flatMap((catalog) =>
      catalog.cards.flatMap((card) => [
        ...(card.htmlContent?.children ?? []),
        ...card.entries.flatMap((entry) => entry.htmlContent?.children ?? []),
      ])
    ) ?? []),
  ];
  const nodes: QtiContentNode[] = [];
  const visit = (node: QtiContentNode): void => {
    nodes.push(node);
    if (node.kind === 'element' || node.kind === 'feedback') {
      node.children.forEach(visit);
    }
  };
  roots.forEach(visit);
  return nodes;
}

function warning(
  itemId: string,
  code: string,
  message: string,
  path?: string,
): Qti3AccessibilityFinding {
  return { itemId, code, severity: 'warning', message, ...(path ? { path } : {}) };
}

function hasTextAttribute(attributes: Readonly<Record<string, string>>, name: string): boolean {
  return Boolean(attributes[name]?.trim());
}

function isVideoInteraction(interaction: QtiInteraction): boolean {
  const object = interaction.object;
  if (!object) return false;
  return object.type?.toLocaleLowerCase().startsWith('video/') === true ||
    object.sources.some((source) => mediaSourceKind(source.type, source.src) === 'video');
}

function isAudioOrVideoInteraction(interaction: QtiInteraction): boolean {
  const object = interaction.object;
  if (!object) return false;
  return isVideoInteraction(interaction) ||
    object.type?.toLocaleLowerCase().startsWith('audio/') === true ||
    object.sources.some((source) => mediaSourceKind(source.type, source.src) === 'audio');
}

function mediaSourceKind(
  mimeType: string | undefined,
  source: string | undefined,
): 'audio' | 'video' | null {
  const normalizedType = mimeType?.toLocaleLowerCase();
  if (normalizedType?.startsWith('audio/')) return 'audio';
  if (normalizedType?.startsWith('video/')) return 'video';
  const path = source?.toLocaleLowerCase().split(/[?#]/, 1)[0] ?? '';
  if (['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.wav', '.flac'].some((ext) => path.endsWith(ext))) {
    return 'audio';
  }
  if (['.mp4', '.m4v', '.webm', '.ogv', '.mov'].some((ext) => path.endsWith(ext))) {
    return 'video';
  }
  return null;
}

function hasCaptions(interaction: QtiInteraction): boolean {
  return interaction.object?.tracks.some((track) =>
    track.kind?.toLocaleLowerCase() === 'captions'
  ) ??
    false;
}

function hasTranscript(item: QtiAssessmentItem): boolean {
  return item.companionMaterials?.physicalMaterials.some((material) => material.text.trim()) ??
    false;
}

function dedupeFindings(
  findings: readonly Qti3AccessibilityFinding[],
): Qti3AccessibilityFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.itemId}:${finding.code}:${finding.message}:${finding.path ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message);
  return value.trim();
}

function assertExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string,
): void {
  const allowed = new Set(expected);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  const missing = expected.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length || missing.length) {
    throw new Error(
      `Invalid ${label}. Missing: ${missing.join(', ') || 'none'}; unknown: ${
        unknown.join(', ') || 'none'
      }.`,
    );
  }
}
