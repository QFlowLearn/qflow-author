import type { Draft } from './types/draft.ts';
import {
  collectCatalogReferenceIds,
  validateCatalogMetadata,
  validateCatalogReferences,
} from './catalog_metadata.ts';
import { usesColorOnlyInstruction } from './color_only_instruction.ts';

export type A11yIssue = {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;
};

const ALLOWED_QTI_ARIA_ATTRS = new Set([
  'data-qti-aria-label',
  'data-qti-aria-labelledby',
  'data-qti-aria-describedby',
  'data-qti-aria-hidden',
]);

export function collectA11yIssues(draft: Draft): A11yIssue[] {
  const issues: A11yIssue[] = [];
  const htmlFragments = collectHtmlFragments(draft);

  const missingAltCount = countMissingAltText(htmlFragments.all);
  if (missingAltCount > 0) {
    issues.push({
      severity: 'warning',
      code: 'MISSING_ALT_TEXT',
      message: missingAltCount === 1
        ? 'One image is missing alt text.'
        : `${missingAltCount} images are missing alt text.`,
    });
  }

  const invalidSsmlCount = countInvalidDataSsml(htmlFragments.all);
  if (invalidSsmlCount > 0) {
    issues.push({
      severity: 'warning',
      code: 'INVALID_DATA_SSML',
      message: `${invalidSsmlCount} data-ssml attribute(s) contain invalid JSON.`,
    });
  }

  const unsupportedAttrs = listUnsupportedQtiAriaAttrs(htmlFragments.all);
  for (const attrName of unsupportedAttrs) {
    issues.push({
      severity: 'warning',
      code: 'UNSUPPORTED_A11Y_MARKUP',
      message: `Unsupported accessibility attribute found: ${attrName}`,
    });
  }

  const catalogIssues = checkCatalogIssues(
    draft,
    htmlFragments.itemContent,
  );
  issues.push(...catalogIssues);

  const mediaIssues = checkMediaAccessibility(draft, htmlFragments.all);
  issues.push(...mediaIssues);

  if (htmlFragments.all.some(usesColorOnlyInstruction)) {
    issues.push({
      severity: 'warning',
      code: 'COLOR_ONLY_INSTRUCTION',
      message:
        'An instruction may rely on color alone. Add a label, shape, pattern, or position cue.',
    });
  }

  return dedupeIssues(issues);
}

type HtmlFragments = {
  readonly all: string[];
  readonly itemContent: string[];
};

function collectHtmlFragments(draft: Draft): HtmlFragments {
  const fragments: HtmlFragments = { all: [], itemContent: [] };
  const visit = (value: unknown, keyHint = '', insideMetadata = false) => {
    if (value == null) return;
    if (typeof value === 'string') {
      const key = keyHint.toLowerCase();
      if (key.endsWith('html') || key.endsWith('markup') || key.includes('content')) {
        if (value.includes('<')) {
          fragments.all.push(value);
          if (!insideMetadata) fragments.itemContent.push(value);
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, '', insideMetadata));
      return;
    }
    if (typeof value === 'object') {
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        visit(entry, key, insideMetadata);
      }
    }
  };
  for (const [key, value] of Object.entries(draft)) {
    visit(value, key, key === 'catalogs' || key === 'stylesheets');
  }
  return fragments;
}

function countMissingAltText(htmlFragments: string[]): number {
  let count = 0;
  const imgRegex = /<img\b([^>]*)>/gi;
  for (const html of htmlFragments) {
    for (const match of html.matchAll(imgRegex)) {
      const attrs = match[1] ?? '';
      const altMatch = /\balt\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
      if (!altMatch) count += 1;
    }
  }
  return count;
}

function countInvalidDataSsml(htmlFragments: string[]): number {
  let invalidCount = 0;
  const ssmlRegex = /\bdata-ssml\s*=\s*("([^"]*)"|'([^']*)')/gi;
  for (const html of htmlFragments) {
    for (const match of html.matchAll(ssmlRegex)) {
      const raw = (match[2] ?? match[3] ?? '').trim();
      if (!raw) continue;
      const decoded = decodeHtmlEntities(raw);
      try {
        JSON.parse(decoded);
      } catch {
        invalidCount += 1;
      }
    }
  }
  return invalidCount;
}

function listUnsupportedQtiAriaAttrs(htmlFragments: string[]): string[] {
  const found = new Set<string>();
  const attrRegex = /\b(data-qti-aria-[a-z0-9_-]+)\s*=/gi;
  for (const html of htmlFragments) {
    for (const match of html.matchAll(attrRegex)) {
      const name = (match[1] ?? '').toLowerCase();
      if (!name || ALLOWED_QTI_ARIA_ATTRS.has(name)) continue;
      found.add(name);
    }
  }
  return Array.from(found.values());
}

function checkCatalogIssues(draft: Draft, htmlFragments: string[]): A11yIssue[] {
  const referencedIds = collectCatalogReferenceIds(htmlFragments.join('\n'));
  return [
    ...validateCatalogMetadata(draft.catalogs, draft.stylesheets),
    ...validateCatalogReferences(draft.catalogs, referencedIds),
  ];
}

function checkMediaAccessibility(draft: Draft, htmlFragments: string[]): A11yIssue[] {
  const warnings: A11yIssue[] = [];
  const mediaKind = draft.mediaKind;
  const mediaSources = Array.isArray(draft.mediaSources) ? draft.mediaSources : [];
  const captionSrc = (draft.mediaCaptionSrc ?? '').trim();
  const transcript = (draft.mediaTranscript ?? '').trim();
  const interactionLabel = (draft.mediaInteractionLabel ?? '').trim();
  const objectLabel = (draft.mediaObjectLabel ?? '').trim();
  if (mediaSources.length > 0 && (!interactionLabel || !objectLabel)) {
    warnings.push({
      severity: 'warning',
      code: 'MISSING_MEDIA_LABEL',
      message: 'Media needs both an interaction label and an object label.',
    });
  }
  if (mediaKind === 'video') {
    const hasCaptionSource = Boolean(captionSrc) ||
      mediaSources.some((source) =>
        /\.vtt(\?|#|$)/i.test(source.src ?? '') || /vtt/i.test(source.type ?? '')
      );
    if (!hasCaptionSource) {
      warnings.push({
        severity: 'warning',
        code: 'MISSING_CAPTIONS',
        message: 'Video item has no caption source (.vtt).',
      });
    }
  }
  if (mediaKind === 'video' || mediaKind === 'audio') {
    const combinedHtml = htmlFragments.join('\n').toLowerCase();
    if (!transcript && !combinedHtml.includes('transcript')) {
      warnings.push({
        severity: 'warning',
        code: 'MISSING_TRANSCRIPT',
        message: `${
          mediaKind[0].toUpperCase() + mediaKind.slice(1)
        } item appears to be missing transcript text.`,
      });
    }
  }
  return warnings;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#34;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function dedupeIssues(issues: A11yIssue[]): A11yIssue[] {
  const seen = new Set<string>();
  const out: A11yIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.severity}:${issue.code}:${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}
