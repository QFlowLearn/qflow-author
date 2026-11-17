import { parseUserSettings } from '../../lib/settings.ts';
const parseAccountSettings = (value: unknown) => parseUserSettings(value, 'complete');
import { describe, expect, it } from 'vitest';
import { createElement } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { encodeRootPayload, parseRootPayload } from '../../lib/client/root_payload.ts';
import { HydrationRoot } from '../../lib/server/HydrationRoot.tsx';
import { parseAccountPayload } from '../../lib/client/account_payload.ts';
import { mountIsland } from '../../lib/rendering/mount_island.ts';
import { OwnedIsland } from '../../lib/rendering/island_context.tsx';
import LocalizedTimestamp from '../../islands/LocalizedTimestamp.tsx';
import { RootRendererContext } from '../../lib/rendering/root_renderer.ts';

describe('explicit hydration transport', () => {
  it('rejects malformed account responses and incomplete settings before rendering', () => {
    expect(
      parseAccountPayload({
        user: { id: 'u', email: 'e', displayName: {} },
        tenant: { id: 't', slug: 't', name: 'Tenant' },
        role: 'owner',
      }),
    ).toBeNull();
    expect(parseAccountPayload({ user: null, tenant: {}, role: 'owner' })).toBeNull();
    expect(parseAccountSettings({ theme: 'dark', choiceRichText: false })).toBeNull();
    expect(
      parseAccountSettings({
        theme: 'dark',
        choiceRichText: false,
        interfaceLocale: 'sv-SE',
        extra: true,
      }),
    ).toBeNull();
    expect(parseAccountSettings({ theme: 'dark', choiceRichText: false, interfaceLocale: 'sv-SE' }))
      .toEqual({ theme: 'dark', choiceRichText: false, interfaceLocale: 'sv-SE' });
  });
  it('preserves hostile catalog strings as inert JSON rather than script markup', () => {
    const text = '</script><script>alert("x")</script>&\u2028\u2029';
    const parsed = parseRootPayload({
      id: 'qf-account',
      component: 'AccountMenu',
      props: { payload: { locale: 'en-US', namespaces: { core: { greeting: text } } } },
    });
    expect(parsed._tag).toBe('Parsed');
    if (parsed._tag !== 'Parsed') throw new Error('Fixture rejected.');
    const encoded = encodeRootPayload(parsed.value);
    expect(encoded).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(encoded)).toEqual(parsed.value);
  });

  it('rejects malformed envelopes and unknown roots without re-validating server-owned props', () => {
    for (
      const candidate of [
        null,
        [],
        {},
        { id: 'qf-x', component: 'Unknown', props: {} },
        { id: 'unsafe"id', component: 'AccountMenu', props: {} },
        { id: 'qf-x', component: 'AccountMenu', props: [] },
        { id: 'qf-x', component: 'AccountMenu', props: null },
        { id: 'qf-x', component: 'AccountMenu', props: {}, extra: true },
      ]
    ) expect(parseRootPayload(candidate)._tag).toBe('Invalid');
  });

  it('renders a standalone timestamp with UTC SSR and an exact parsed payload', () => {
    const payload = {
      id: 'qf-timestamp-1',
      component: 'LocalizedTimestamp',
      props: { value: '2026-10-20T00:00:00.000Z', locale: 'en-US', showTime: false },
    } as const;
    const html = renderToString(createElement(HydrationRoot, { payload }));
    expect(html).toContain('data-qflow-state="pending"');
    expect(html).toContain('datetime="2026-10-20T00:00:00.000Z"');
    expect(html).toContain('Oct 20, 2026');
    expect(html).toContain('type="application/json"');
    expect(html).not.toContain('fresh-island');
  });
});

it('scopes root rendering to each provider and restores the outer renderer after nested pages', () => {
  const payload = {
    id: 'qf-time',
    component: 'LocalizedTimestamp',
    props: { value: '2026-10-20', locale: 'en-US' },
  } as const;
  const Probe = mountIsland({ component: 'LocalizedTimestamp', View: LocalizedTimestamp });
  const html = renderToString(createElement(RootRendererContext.Provider, {
    value: () => 'outer',
    children: [
      createElement(Probe, payload.props),
      createElement(RootRendererContext.Provider, {
        value: () => 'inner',
        children: createElement(Probe, payload.props),
      }),
      createElement(Probe, payload.props),
    ],
  }));
  expect(html).toBe('outerinnerouter');
  expect(() => renderToString(createElement(Probe, payload.props))).toThrow(
    'Hydration root renderer is not configured.',
  );
});

it('server transport rejects structural extra callbacks, VNodes and rich values before emitting JSON', () => {
  const timestamp = { value: '2026-10-20T00:00:00.000Z', locale: 'en-US' } as const;
  for (const unexpected of [() => {}, createElement('b', {}), new Date(), new Map(), Number.NaN]) {
    const props = { ...timestamp, unexpected };
    expect(() =>
      encodeRootPayload({ id: 'qf-strict-json', component: 'LocalizedTimestamp', props })
    ).toThrow();
  }
  const props = { ...timestamp, dateStyle: undefined };
  expect(
    JSON.parse(encodeRootPayload({ id: 'qf-optional', component: 'LocalizedTimestamp', props }))
      .props,
  ).toEqual(timestamp);
});

it('assigns distinct sibling mount ids and keeps nested mounts inside their owning island', () => {
  const Timestamp = mountIsland({ component: 'LocalizedTimestamp', View: LocalizedTimestamp });
  const props = { value: '2026-10-20T00:00:00.000Z', locale: 'en-US' } as const;
  const ids: string[] = [];
  const html = renderToString(createElement(RootRendererContext.Provider, {
    value: (payload) => {
      ids.push(payload.id);
      return createElement(HydrationRoot, { payload });
    },
    children: [createElement(Timestamp, props), createElement(Timestamp, props)],
  }));
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  expect(html.match(/data-qflow-root=/g)).toHaveLength(2);
  const nested = renderToString(createElement(OwnedIsland, {
    id: 'parent',
    children: createElement(Timestamp, props),
  }));
  expect(nested).toContain('<time');
  expect(nested).not.toContain('data-qflow-root');
});
