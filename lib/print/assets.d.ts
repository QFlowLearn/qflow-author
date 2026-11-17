declare module '*.bin' {
  const data: ArrayBuffer;
  export default data;
}
declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}
declare module '*.txt' {
  const text: string;
  export default text;
}
declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' {
  const url: string;
  export default url;
}

interface ImportMeta {
  readonly env: { readonly SSR: boolean };
}
