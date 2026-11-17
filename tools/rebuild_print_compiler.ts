import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import manifest from '../vendor/typst/manifest.json' with { type: 'json' };

/** Opt-in compiler rebuild on the recorded host; routine pnpm checks never install or execute Rust. */
export async function rebuildPrintCompiler(): Promise<void> {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw Error('This artifact recipe is pinned and verified on macOS arm64.');
  }
  await mkdir('.artifacts', { recursive: true });
  const root = await mkdtemp(resolve('.artifacts/print-compiler-'));
  const env = {
    ...process.env,
    CARGO_HOME: resolve(root, '.cargo'),
    RUSTUP_HOME: resolve(root, '.rustup'),
    RUSTFLAGS: `--remap-path-prefix=${root}=/qflow-print-compiler-build`,
  };
  const downloads = [
    [
      'source.tar.gz',
      `https://api.github.com/repos/Myriad-Dreamin/typst.ts/tarball/${manifest.commit}`,
      '8b6e32a83918e9781f4f788f7accc2312d0cedd7db4050b91f130671b043f3dd',
    ],
    [
      'rustup-init',
      'https://static.rust-lang.org/rustup/archive/1.28.2/aarch64-apple-darwin/rustup-init',
      '20ef5516c31b1ac2290084199ba77dbbcaa1406c45c1d978ca68558ef5964ef5',
    ],
    [
      'bindgen.tar.gz',
      'https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.118/wasm-bindgen-0.2.118-aarch64-apple-darwin.tar.gz',
      'f76553ae8d084dc3e96a7cef748813bf2dac4d78326166409328fc74646eef76',
    ],
  ] as const;
  for (const [name, url, sha] of downloads) await download(url, resolve(root, name), sha);
  await chmod(resolve(root, 'rustup-init'), 0o755);
  for (const path of ['source', 'tools', 'artifact']) await mkdir(resolve(root, path));
  await command(
    'tar',
    ['-xzf', resolve(root, 'source.tar.gz'), '-C', resolve(root, 'source'), '--strip-components=1'],
    root,
    env,
  );
  await command(
    'tar',
    ['-xzf', resolve(root, 'bindgen.tar.gz'), '-C', resolve(root, 'tools'), '--strip-components=1'],
    root,
    env,
  );
  await command(
    resolve(root, 'rustup-init'),
    [
      '-y',
      '--no-modify-path',
      '--profile',
      'minimal',
      '--default-toolchain',
      manifest.rust,
      '--target',
      manifest.target,
    ],
    root,
    env,
  );
  const bin = resolve(root, `.rustup/toolchains/${manifest.rust}-aarch64-apple-darwin/bin`);
  const buildEnv = { ...env, PATH: `${bin}:${process.env.PATH ?? ''}` };
  await command(
    resolve(bin, 'cargo'),
    [
      'build',
      '--locked',
      '--release',
      '--target',
      manifest.target,
      '--package',
      'typst-ts-web-compiler',
      '--no-default-features',
      '--features',
      'web,pdf',
      '--jobs',
      '2',
    ],
    resolve(root, 'source'),
    buildEnv,
  );
  await command(
    resolve(root, 'tools/wasm-bindgen'),
    [
      '--target',
      'web',
      '--remove-name-section',
      '--remove-producers-section',
      '--out-name',
      'typst_ts_web_compiler',
      '--out-dir',
      resolve(root, 'artifact'),
      resolve(root, 'source/target/wasm32-unknown-unknown/release/typst_ts_web_compiler.wasm'),
    ],
    root,
    buildEnv,
  );
  await copyFile(resolve(root, 'source/LICENSE'), resolve(root, 'artifact/compiler-LICENSE'));
  await copyFile(resolve(root, 'source/Cargo.lock'), resolve(root, 'artifact/Cargo.lock'));
  for (
    const file of manifest.files.filter((file) =>
      file.name.endsWith('.bin') || file.name === 'fonts-NOTICE'
    )
  ) {
    const suffix = file.name === 'fonts-NOTICE'
      ? 'NOTICE'
      : `files/fonts/${file.name.slice(0, -4)}`;
    await download(
      `https://raw.githubusercontent.com/typst/typst-assets/${manifest.fontSourceCommit}/${suffix}`,
      resolve(root, 'artifact', file.name),
      file.sha256,
    );
  }
  // Compare before replacing anything: a different generated artifact requires a reviewed manifest update.
  for (const file of manifest.files) {
    const bytes = await readFile(resolve(root, 'artifact', file.name));
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) {
      throw Error(`Rebuilt artifact differs: ${file.name}`);
    }
  }
  for (const file of manifest.files) {
    await copyFile(resolve(root, 'artifact', file.name), resolve('vendor/typst', file.name));
  }
  console.log('Pinned compiler, matching glue/types, fonts, licenses and lockfile reproduced.');
}
async function download(url: string, path: string, expected: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw Error('Pinned build download failed.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256(bytes) !== expected) throw Error('Pinned build download integrity mismatch.');
  await writeFile(path, bytes);
}
function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
async function command(
  program: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await new Promise<void>((done, reject) => {
    const process = spawn(program, [...args], { cwd, env, stdio: 'inherit' });
    process.once('error', reject);
    process.once(
      'close',
      (code) => code === 0 ? done() : reject(Error('Pinned compiler build command failed.')),
    );
  });
}
if (import.meta.main) await rebuildPrintCompiler();
