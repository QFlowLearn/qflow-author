import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
const virtualId = 'virtual:qflow-assets';
/** One manifest reader owns client assets in production builds and retained workerd tests. */
export function clientAssetsPlugin(
  { edgeBuild, mode, developmentOrigin }: {
    readonly developmentOrigin?: string;
    readonly edgeBuild: boolean;
    readonly mode: 'built' | 'development';
  },
): Plugin {
  return {
    name: 'qflow:assets',
    resolveId(id) {
      if (id === virtualId) return '\0' + virtualId;
    },
    load(id) {
      if (id !== '\0' + virtualId) return;
      if (mode === 'development') {
        return 'export const developmentOrigin=' + JSON.stringify(developmentOrigin) +
          '; export const edgeBuild=false; export const appAssets=' +
          JSON.stringify({
            styles: ['/tw.css', '/styles.css'],
            preloads: ['/@vite/client'],
            bootstrap: '/client/entries/bootstrap.ts',
          }) + ';';
      }
      const manifest: unknown = JSON.parse(
        readFileSync('.cloudflare/output/v1/workers/default/assets/.vite/manifest.json', 'utf8'),
      );
      if (!manifest || typeof manifest !== 'object') {
        throw new Error('Missing client manifest.');
      }
      const parsedManifest = manifest;
      const entry: unknown = Reflect.get(parsedManifest, 'client/entries/bootstrap.ts');
      if (
        !entry || typeof entry !== 'object' || typeof Reflect.get(entry, 'file') !== 'string'
      ) throw new Error('Missing declared bootstrap entry.');
      const styles: string[] = [];
      const preloads: string[] = [];
      const visited = new Set<string>();
      function collect(key: string) {
        if (visited.has(key)) return;
        visited.add(key);
        const chunk: unknown = Reflect.get(parsedManifest, key);
        if (!chunk || typeof chunk !== 'object') throw new Error('Missing manifest import.');
        const css: unknown = Reflect.get(chunk, 'css');
        if (css !== undefined) {
          if (
            !Array.isArray(css) || !css.every((value: unknown) => typeof value === 'string')
          ) throw new Error('Invalid manifest CSS.');
          styles.push(...css.map((file: string) => '/' + file));
        }
        const imports: unknown = Reflect.get(chunk, 'imports');
        if (imports !== undefined) {
          if (
            !Array.isArray(imports) ||
            !imports.every((value: unknown) => typeof value === 'string')
          ) throw new Error('Invalid manifest imports.');
          for (const key of imports) {
            const imported: unknown = Reflect.get(parsedManifest, key);
            if (
              !imported || typeof imported !== 'object' ||
              typeof Reflect.get(imported, 'file') !== 'string'
            ) throw new Error('Invalid imported asset.');
            preloads.push('/' + Reflect.get(imported, 'file'));
            collect(key);
          }
        }
      }
      collect('client/entries/bootstrap.ts');
      return 'export const appAssets = ' +
        JSON.stringify({
          styles: [...new Set(styles)],
          preloads: [...new Set(preloads)],
          bootstrap: '/' + Reflect.get(entry, 'file'),
        }) + '; export const developmentOrigin=undefined; export const edgeBuild = ' +
        JSON.stringify(edgeBuild) + ';';
    },
    generateBundle(_options, bundle) {
      if (this.environment.name !== 'client') return;
      for (const item of Object.values(bundle)) {
        if (
          item.type === 'chunk' &&
          [...item.imports, ...item.dynamicImports].some((id) => id.startsWith('node:'))
        ) throw new Error('Node builtin in browser output.');
      }
    },
  };
}
