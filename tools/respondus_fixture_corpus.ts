#!/usr/bin/env -S node --import tsx
import { runCommand as executeCommand } from './process_command.ts';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';
import * as _url from 'node:url';

import { isAbsolute, join } from 'node:path';
import { fileURLToPath as fromFileUrl, pathToFileURL as toFileUrl } from 'node:url';

import { extractDocxDocument } from '../lib/conversion/extract_docx_source.ts';
import { sha256Hex } from '../lib/sha256.ts';

const repoRoot = fromFileUrl(new URL('..', import.meta.url));
const fixtureDir = join(repoRoot, 'tests', 'fixtures', 'import', 'respondus');
const generatorPath = join(repoRoot, 'tools', 'generate_respondus_fixture_corpus.py');
const manifestPath = join(fixtureDir, 'manifest.json');

const generatedFiles = [
  'loose-numbered-quiz.pdf',
  'word-automatic-numbering.docx',
  'word-embedded-media.docx',
  'word-visible-numbering.docx',
] as const;

const docxFiles = generatedFiles.filter((filename) => filename.endsWith('.docx'));

type CorpusMode = 'check' | 'write';

type CorpusManifest = {
  readonly schema: 'qflow.respondus-fixture-corpus.v1';
  readonly generator: 'tools/generate_respondus_fixture_corpus.py';
  readonly files: readonly {
    readonly name: (typeof generatedFiles)[number];
    readonly bytes: number;
    readonly sha256: string;
  }[];
};

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  const libreOffice = parseLibreOfficeBinary(process.env['QFLOW_LIBREOFFICE_BIN']);
  const temporaryRoot = await _fs.mkdtemp(_path.join(_os.tmpdir(), 'qflow-respondus-corpus-'));
  try {
    const generatedDir = join(temporaryRoot, 'generated');
    const roundTripDir = join(temporaryRoot, 'libreoffice');
    const profileDir = join(temporaryRoot, 'libreoffice-profile');
    await Promise.all([
      _fs.mkdir(generatedDir, { recursive: true }),
      _fs.mkdir(roundTripDir, { recursive: true }),
      _fs.mkdir(profileDir, { recursive: true }),
    ]);

    await runGenerator(generatedDir);
    await roundTripWithLibreOffice(libreOffice, generatedDir, roundTripDir, profileDir);
    await verifyRoundTrip(generatedDir, roundTripDir);
    const manifest = await createManifest(generatedDir);

    if (mode === 'write') {
      await writeCorpus(generatedDir, manifest);
      console.log(`Respondus fixture corpus written to ${fixtureDir}`);
      return;
    }
    await checkCorpus(generatedDir, manifest);
    console.log('Respondus fixture corpus is reproducible.');
  } finally {
    await _fs.rm(temporaryRoot, { recursive: true });
  }
}

function parseMode(args: readonly string[]): CorpusMode {
  if (args.length === 1 && args[0] === '--check') return 'check';
  if (args.length === 1 && args[0] === '--write') return 'write';
  throw new Error('Usage: pnpm run fixtures:respondus [--check|--write]');
}

function parseLibreOfficeBinary(input: string | undefined): string {
  if (!input?.trim()) {
    throw new Error('Set QFLOW_LIBREOFFICE_BIN to the LibreOffice soffice executable.');
  }
  if (!isAbsolute(input)) {
    throw new Error('QFLOW_LIBREOFFICE_BIN must be an absolute path.');
  }
  return input;
}

async function runGenerator(outputDir: string): Promise<void> {
  await runCommand('uv', [
    'run',
    '--frozen',
    'python',
    generatorPath,
    '--output-dir',
    outputDir,
  ], 'Pinned Respondus fixture generation');
}

async function roundTripWithLibreOffice(
  executable: string,
  generatedDir: string,
  outputDir: string,
  profileDir: string,
): Promise<void> {
  const version = await executeCommand(executable, ['--version']);
  if (!version.success) throw new Error('Could not read the configured LibreOffice version.');
  console.log(new TextDecoder().decode(version.stdout).trim());

  await runCommand(
    executable,
    [
      `-env:UserInstallation=${toFileUrl(profileDir).href}`,
      '--headless',
      '--convert-to',
      'docx',
      '--outdir',
      outputDir,
      ...docxFiles.map((filename) => join(generatedDir, filename)),
    ],
    'LibreOffice DOCX round trip',
  );
}

async function verifyRoundTrip(generatedDir: string, roundTripDir: string): Promise<void> {
  for (const filename of docxFiles) {
    const [generated, roundTripped] = await Promise.all([
      readDocx(join(generatedDir, filename)),
      readDocx(join(roundTripDir, filename)),
    ]);
    if (normalizeExtractedText(generated.text) !== normalizeExtractedText(roundTripped.text)) {
      throw new Error(`LibreOffice changed the extracted text in ${filename}.`);
    }
    if (imageCount(generated) !== imageCount(roundTripped)) {
      throw new Error(`LibreOffice changed the embedded-image count in ${filename}.`);
    }
  }
}

function normalizeExtractedText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

async function readDocx(path: string) {
  return await extractDocxDocument(path, await _fs.readFile(path));
}

function imageCount(document: Awaited<ReturnType<typeof extractDocxDocument>>): number {
  return document.blocks.filter((block) => block.kind === 'image').length;
}

async function createManifest(generatedDir: string): Promise<CorpusManifest> {
  const files = await Promise.all(generatedFiles.map(async (name) => {
    const bytes = await _fs.readFile(join(generatedDir, name));
    return {
      name,
      bytes: bytes.byteLength,
      sha256: await sha256Hex(bytes),
    };
  }));
  return {
    schema: 'qflow.respondus-fixture-corpus.v1',
    generator: 'tools/generate_respondus_fixture_corpus.py',
    files,
  };
}

async function writeCorpus(generatedDir: string, manifest: CorpusManifest): Promise<void> {
  await Promise.all(
    generatedFiles.map((filename) =>
      _fs.copyFile(join(generatedDir, filename), join(fixtureDir, filename))
    ),
  );
  await _fs.writeFile(manifestPath, serializeManifest(manifest), 'utf8');
}

async function checkCorpus(generatedDir: string, manifest: CorpusManifest): Promise<void> {
  for (const filename of generatedFiles) {
    const [generated, committed] = await Promise.all([
      _fs.readFile(join(generatedDir, filename)),
      _fs.readFile(join(fixtureDir, filename)),
    ]);
    if (!equalBytes(generated, committed)) {
      throw new Error(
        `${filename} does not match the pinned generator. Run pnpm run fixtures:respondus.`,
      );
    }
  }
  const committedManifest = await _fs.readFile(manifestPath, 'utf8');
  if (committedManifest !== serializeManifest(manifest)) {
    throw new Error('Respondus fixture manifest does not match the generated corpus.');
  }
}

function serializeManifest(manifest: CorpusManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

async function runCommand(
  command: string,
  args: readonly string[],
  label: string,
): Promise<void> {
  const status = await executeCommand(command, args, { cwd: repoRoot, output: 'inherit' });
  if (!status.success) throw new Error(`${label} failed with exit code ${status.code}.`);
}

if ((process.argv[1] && _path.resolve(process.argv[1]) === _url.fileURLToPath(import.meta.url))) {
  main().catch((cause: unknown) => {
    console.error(cause instanceof Error ? cause.message : 'Respondus fixture task failed.');
    process.exit(1);
  });
}
