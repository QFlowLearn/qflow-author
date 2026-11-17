# Pinned paper compiler

This directory contains one open-source Typst WASM compiler, matching generated JavaScript/types,
four New Computer Modern fonts, their licenses, and the upstream Cargo lockfile. `manifest.json`
records the exact upstream commit, build tool versions, features and SHA-256 of every shipped file.
The compiler is unmodified upstream source at commit
`404730ffa34071df78ecc6e5c15233f81e0353fa`. It exposes supported `evict_cache(0)`; published compiler
packages tested before this source build retained too much memory across repeated documents.

Ordinary development and verification use the vendored bytes and need no Rust installation:

```sh
pnpm check:runtime
```

An optional rebuild recipe downloads integrity-pinned build tools into a newly created
`.artifacts/print-compiler-*` directory. It does not change global toolchains. The recorded and
verified build host is macOS arm64, with Rust/Cargo 1.92.0, wasm-bindgen 0.2.118, and the upstream
locked dependencies. Parallelism is limited to two jobs. Rebuilding needs network access and several
minutes; it does not deploy or provision anything:

```sh
node --import tsx tools/rebuild_print_compiler.ts
```

The recipe compiles only `web,pdf`, remaps its complete isolated build root, removes WASM name and
producer sections, and verifies every generated artifact before replacing any vendored file. A
manifest change requires code review and the Worker renderer/memory/bundle checks. Do not patch
generated glue, enable request-time evaluation, or download compiler assets at runtime.

The Worker initializes one immutable compiler/template/font set at module startup. Each request
uses a data-only independent world. Every success and failure frees that world and calls
`evict_cache(0)` in nested cleanup. The local evidence demonstrates a stable WASM buffer under
25 MiB across the tested corpus, including repeated 100-question papers and real compiler failures.
This is WASM allocation evidence, not total isolate memory or deployed startup/CPU attestation.
No PDF/UA claim is made. Unsupported content produces a preflight blocker rather than dropped text.
