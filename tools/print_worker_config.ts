import { resolve } from 'node:path';

/** Derive the compiler deployment from the selected application's explicit service binding. */
export function printWorkerConfig(input: unknown) {
  if (!input || typeof input !== 'object') {
    throw Error('Selected Worker configuration is required.');
  }
  const services: unknown = Reflect.get(input, 'services');
  if (!Array.isArray(services)) {
    throw Error('QFLOW_PRINT_RENDERER service configuration is required.');
  }
  const matches = services.filter((value) =>
    value && typeof value === 'object' && Reflect.get(value, 'binding') === 'QFLOW_PRINT_RENDERER'
  );
  if (matches.length !== 1 || Object.keys(matches[0]).sort().join(',') !== 'binding,service') {
    throw Error('Configure one default-entrypoint QFLOW_PRINT_RENDERER service target.');
  }
  const service: unknown = matches.length === 1 ? Reflect.get(matches[0], 'service') : undefined;
  const date: unknown = Reflect.get(input, 'compatibility_date');
  const flags: unknown = Reflect.get(input, 'compatibility_flags');
  const account: unknown = Reflect.get(input, 'account_id');
  const limits: unknown = Reflect.get(input, 'limits');
  const cpu: unknown = limits && typeof limits === 'object'
    ? Reflect.get(limits, 'cpu_ms')
    : undefined;
  if (
    typeof service !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(service) ||
    service === Reflect.get(input, 'name') ||
    typeof date !== 'string' || !Array.isArray(flags) ||
    !flags.every((flag): flag is string => typeof flag === 'string') ||
    (account !== undefined && typeof account !== 'string') || typeof cpu !== 'number' ||
    !Number.isSafeInteger(cpu) || cpu <= 0
  ) {
    throw Error('Invalid print renderer deployment configuration.');
  }
  return {
    name: service,
    main: resolve('deploy/cloudflare/print_worker.entry.ts'),
    account_id: account,
    compatibility_date: date,
    compatibility_flags: flags,
    workers_dev: false,
    preview_urls: false,
    limits: { cpu_ms: cpu },
    observability: { enabled: true, head_sampling_rate: 1 },
  };
}
