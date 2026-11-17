// Minimal HTML sanitizer for inline content in prompts.
// - Allows a conservative set of inline/structural tags
// - Filters attributes to safe subsets (href/target/rel/class)
// - Escapes text between tags and disallowed tags

const INLINE_ALLOWED_TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'sup',
  'sub',
  'code',
  'span',
  'a',
  'br',
  'p',
  'ul',
  'ol',
  'li',
  'img',
]);

const BODY_ALLOWED_TAGS = new Set([
  ...INLINE_ALLOWED_TAGS,
  'p',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'hr',
  'figure',
  'figcaption',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'audio',
  'source',
  'track',
]);

const VOID_TAGS = new Set([
  'br',
  'img',
  'hr',
  'source',
  'track',
]);

declare const SANITIZED_HTML: unique symbol;

/** HTML that has passed through QFlow's allowlist sanitizer. */
export type SanitizedHtml = string & { readonly [SANITIZED_HTML]: true };

const HTML_ENTITY_PREFIX = /&(?!(?:amp|lt|gt|quot|apos);)/gi;

function escapeAmpersands(s: string): string {
  return s.replace(HTML_ENTITY_PREFIX, '&amp;');
}

function escapeText(s: string): string {
  return escapeAmpersands(s).replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttrVal(s: string): string {
  return escapeAmpersands(s).replaceAll('"', '&quot;');
}

function isSafeHref(href: string): boolean {
  if (!href) return false;
  const trimmed = href.trim();
  if (trimmed.startsWith('#') || trimmed.startsWith('/')) return true;
  try {
    const url = new URL(trimmed, 'http://example.local');
    return ['http:', 'https:', 'mailto:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function isSafeSrc(src: string): boolean {
  if (!src) return false;
  const t = src.trim();
  if (t.startsWith('#') || t.startsWith('/')) return true;
  if (t.startsWith('data:')) {
    // allow data URLs for images only
    return /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);/i.test(t);
  }
  try {
    const url = new URL(t, 'http://example.local');
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function isSafeId(id: string): boolean {
  if (!id) return false;
  return /^[A-Za-z][A-Za-z0-9_\-:.]*$/.test(id);
}

function isSafeRole(role: string): boolean {
  if (!role) return false;
  return /^[A-Za-z0-9_\-]+(\s+[A-Za-z0-9_\-]+)*$/.test(role);
}

/**
 * Sanitizes author-provided inline HTML for an HTML rendering sink.
 * Clipboard callers can unwrap unsupported tags while retaining their text content.
 */
export function sanitizeInlineHtml(
  input: string,
  options: { disallowedTags?: 'escape' | 'unwrap' } = {},
): SanitizedHtml {
  return sanitizeWithAllowedTags(input, INLINE_ALLOWED_TAGS, options.disallowedTags ?? 'escape');
}

/** Sanitizes author-provided block HTML for an HTML rendering sink. */
export function sanitizeBodyHtml(input: string): SanitizedHtml {
  return sanitizeWithAllowedTags(input, BODY_ALLOWED_TAGS);
}

function sanitizeWithAllowedTags(
  input: string,
  allowedTags: Set<string>,
  disallowedTags: 'escape' | 'unwrap' = 'escape',
): SanitizedHtml {
  if (!input) return sanitizedHtml('');
  // Normalize nbsp to regular space early to avoid editor weirdness
  // Handles both entity and U+00A0 char.
  // Then remove comments.
  const s = input.replace(/\u00a0|&nbsp;/gi, ' ').replace(/<!--([\s\S]*?)-->/g, '');
  const TAG_RE = /<\/?([a-zA-Z0-9-]+)([^>]*)>/g;
  let out = '';
  let lastIdx = 0;

  for (const m of s.matchAll(TAG_RE)) {
    const idx = m.index ?? 0;
    // text before tag
    out += escapeText(s.slice(lastIdx, idx));
    lastIdx = idx + m[0].length;

    const raw = m[0];
    const closing = raw.startsWith('</');
    const tag = (m[1] || '').toLowerCase();
    const attrsRaw = m[2] || '';

    if (!allowedTags.has(tag)) {
      if (disallowedTags === 'escape') out += escapeText(raw);
      continue;
    }

    if (closing) {
      if (VOID_TAGS.has(tag)) {
        // Ignore invalid closing tags for void elements.
        continue;
      }
      out += `</${tag}>`;
      continue;
    }

    // Parse attributes conservatively
    const allowedAttrs: Record<string, string> = {};
    const ATTR_RE = /(\w[\w:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+)))?/g;
    for (const a of attrsRaw.matchAll(ATTR_RE)) {
      const name = (a[1] || '').toLowerCase();
      const val = a[2] ?? a[3] ?? a[4] ?? '';
      if (!name || name.startsWith('on') || name === 'style') continue;
      if (name === 'class') {
        const cls = val.trim().replace(/[^a-zA-Z0-9_\-\s:]/g, '');
        if (cls) allowedAttrs['class'] = cls;
        continue;
      }
      if (name === 'id') {
        const safe = val.trim();
        if (isSafeId(safe)) allowedAttrs.id = safe;
        continue;
      }
      if (name === 'role') {
        const safe = val.trim();
        if (isSafeRole(safe)) allowedAttrs.role = safe;
        continue;
      }
      if (name.startsWith('aria-')) {
        allowedAttrs[name] = val.slice(0, 500);
        continue;
      }
      if (name.startsWith('data-')) {
        allowedAttrs[name] = val.slice(0, 400);
        continue;
      }
      if (name === 'contenteditable') {
        const normalized = val.trim().toLowerCase();
        if (normalized === 'false' || normalized === 'true') {
          allowedAttrs[name] = normalized;
        }
        continue;
      }
      if (tag === 'a') {
        if (name === 'href' && isSafeHref(val)) {
          allowedAttrs.href = val;
        } else if (name === 'target') {
          const t = val === '_blank' ? '_blank' : '_self';
          allowedAttrs.target = t;
        }
        continue;
      }
      if (tag === 'img') {
        if (name === 'src' && isSafeSrc(val)) allowedAttrs.src = val;
        else if (name === 'alt') allowedAttrs.alt = val.slice(0, 500);
        else if (name === 'width' || name === 'height') {
          const n = String(val).replace(/[^0-9]/g, '');
          if (n) allowedAttrs[name] = n;
        }
        continue;
      }
      if (tag === 'audio') {
        if (name === 'src' && isSafeSrc(val)) allowedAttrs.src = val;
        else if (
          name === 'controls' || name === 'autoplay' || name === 'loop' || name === 'muted'
        ) {
          allowedAttrs[name] = name;
        } else if (name === 'preload' && ['none', 'metadata', 'auto'].includes(val)) {
          allowedAttrs.preload = val;
        }
        continue;
      }
      if (tag === 'source' || tag === 'track') {
        if (name === 'src' && isSafeSrc(val)) allowedAttrs.src = val;
        else if (name === 'type') allowedAttrs.type = val.slice(0, 100);
        else if (tag === 'track' && ['kind', 'srclang', 'label'].includes(name)) {
          allowedAttrs[name] = val.slice(0, 100);
        }
        continue;
      }
      // Ignore other attributes
    }

    if (tag === 'a' && allowedAttrs.target === '_blank') {
      allowedAttrs.rel = 'noopener noreferrer';
    }

    const attrsStr = Object.entries(allowedAttrs)
      .map(([k, v]) => ` ${k}="${escapeAttrVal(v)}"`)
      .join('');
    if (VOID_TAGS.has(tag)) {
      out += `<${tag}${attrsStr}/>`;
    } else {
      out += `<${tag}${attrsStr}>`;
    }
  }

  // trailing text
  out += escapeText(s.slice(lastIdx));
  return sanitizedHtml(out);
}

function sanitizedHtml(value: string): SanitizedHtml {
  // SAFETY: this module only calls the branding function after applying the allowlist sanitizer.
  return value as SanitizedHtml;
}
