type MetaImport = { readonly path: string; readonly kind: string; readonly external?: boolean };
type MetaInput = { readonly imports: readonly MetaImport[] };
type MetaOutput = {
  readonly entryPoint?: string;
  readonly imports: readonly MetaImport[];
  readonly inputs: Readonly<Record<string, unknown>>;
};
/** Static and dynamic bundle edges read from validated esbuild output. */
export type EsbuildMeta = {
  readonly inputs: Readonly<Record<string, MetaInput>>;
  readonly outputs: Readonly<Record<string, MetaOutput>>;
};

/** Reject malformed esbuild metadata before bundle-boundary assertions use it. */
export function parseMetafile(value: unknown): EsbuildMeta {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('invalid metafile');
  }
  // SAFETY: The metadata root is verified to be a non-null, non-array object above.
  const record = value as Record<string, unknown>;
  const inputsValue = record.inputs;
  const outputsValue = record.outputs;
  if (
    typeof inputsValue !== 'object' || inputsValue === null || Array.isArray(inputsValue) ||
    typeof outputsValue !== 'object' || outputsValue === null || Array.isArray(outputsValue)
  ) {
    throw new Error('invalid metafile sections');
  }
  const parseImports = (value: unknown): readonly MetaImport[] => {
    if (!Array.isArray(value)) throw new Error('invalid metafile imports');
    return value.map((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new Error('invalid metafile import');
      }
      // SAFETY: Each import entry is verified to be a non-null, non-array object above.
      const entry = item as Record<string, unknown>;
      if (typeof entry.path !== 'string' || typeof entry.kind !== 'string') {
        throw new Error('invalid metafile import');
      }
      return { path: entry.path, kind: entry.kind, external: entry.external === true };
    });
  };
  const inputs: Record<string, MetaInput> = {};
  for (const [key, item] of Object.entries(inputsValue)) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error('invalid metafile input');
    }
    // SAFETY: Each input is verified to be a non-null, non-array object above.
    inputs[key] = { imports: parseImports((item as Record<string, unknown>).imports ?? []) };
  }
  const outputs: Record<string, MetaOutput> = {};
  for (const [key, item] of Object.entries(outputsValue)) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error('invalid metafile output');
    }
    // SAFETY: Each output is verified to be a non-null, non-array object above.
    const output = item as Record<string, unknown>;
    const outputInputs = output.inputs;
    if (typeof outputInputs !== 'object' || outputInputs === null || Array.isArray(outputInputs)) {
      throw new Error('invalid metafile output inputs');
    }
    outputs[key] = {
      entryPoint: typeof output.entryPoint === 'string' ? output.entryPoint : undefined,
      imports: parseImports(output.imports ?? []),
      // SAFETY: The output input map is verified to be a non-null, non-array object above.
      inputs: outputInputs as Readonly<Record<string, unknown>>,
    };
  }
  return { inputs, outputs };
}
