import { clientAssetsPlugin } from './tools/client_assets.ts';
import { printWorkerConfig } from './tools/print_worker_config.ts';
import { resolve } from 'node:path';
import { assertSingleLocalEnvironment, localTls, parseLocalConfig } from './tools/local_config.ts';
import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

const configPath = process.env.QFLOW_WRANGLER_CONFIG;
if (!configPath) throw new Error('QFLOW_WRANGLER_CONFIG is required.');

export default defineConfig(({ command, isPreview }) => {
  if (isPreview) throw Error('Use pnpm preview for the owned local Worker preview.');
  if (command === 'serve') assertSingleLocalEnvironment();
  // Vite reloads this module in the same process. Its own Hyperdrive projection is not input.
  // The dev entrypoint rejects user-supplied overrides before starting Vite.
  const local = command === 'serve'
    ? parseLocalConfig({
      ...process.env,
      CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_QFLOW_DB: undefined,
    })
    : undefined;
  if (local) {
    // One local database setting; the platform-specific projection stays at the Vite seam.
    process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_QFLOW_DB = local.databaseUrl;
  }
  return ({
    server: {
      host: local?.listenOrigin.hostname,
      port: local ? Number(local.listenOrigin.port) : undefined,
      strictPort: true,
      https: local ? localTls(local) : undefined,
      allowedHosts: local ? [local.origin.hostname] : undefined,
      origin: local?.origin.origin,
      hmr: local && !local.tls
        ? {
          protocol: 'wss',
          host: local.origin.hostname,
          clientPort: local.origin.port ? Number(local.origin.port) : 443,
        }
        : undefined,
    },
    publicDir: 'static',
    build: { outDir: 'build' },
    esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
    resolve: { alias: { 'preact/debug': resolve('shims/preact_debug.ts') } },
    environments: {
      client: {
        build: {
          manifest: true,
          rollupOptions: {
            input: {
              bootstrap: resolve('client/entries/bootstrap.ts'),
              AssessmentBuilder: resolve('islands/AssessmentBuilder.tsx'),
            },
          },
        },
      },
    },
    builder: {
      async buildApp(builder) {
        const client = builder.environments.client;
        const worker = builder.environments.ssr;
        if (!client || !worker) throw new Error('Missing declared build environments.');
        await builder.build(client);
        await builder.build(worker);
        const renderer = builder.environments.print_renderer;
        if (!renderer) throw new Error('Missing print renderer build environment.');
        await builder.build(renderer);
      },
    },
    plugins: [
      cloudflare({
        configPath,
        viteEnvironment: { name: 'ssr' },
        remoteBindings: false,
        auxiliaryWorkers: [{
          viteEnvironment: { name: 'print_renderer' },
          config: (_config, { entryWorkerConfig }) => printWorkerConfig(entryWorkerConfig),
        }],
      }),
      clientAssetsPlugin({
        developmentOrigin: local?.origin.origin,
        edgeBuild: command === 'build',
        mode: command === 'build' ? 'built' : 'development',
      }),
    ],
  });
});
