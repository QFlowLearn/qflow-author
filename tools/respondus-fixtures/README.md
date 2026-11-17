# Respondus fixture generator

This Python project generates the synthetic Word and PDF files used by Respondus import tests.
Python and its dependencies are pinned here; they are not needed to run Author or its normal tests.

Install [uv](https://docs.astral.sh/uv/) and LibreOffice. Set `QFLOW_LIBREOFFICE_BIN` to the
absolute path of the `soffice` executable. From the repository root, run:

```sh
pnpm fixtures:respondus
pnpm fixtures:respondus:check
```

The Node task runs uv in this directory, generates deterministic files, and checks a temporary
LibreOffice round trip. It writes fixture files and their manifest to
`tests/fixtures/import/respondus/`.

To run only the Python generator from the repository root:

```sh
uv --directory tools/respondus-fixtures run --frozen python generate.py --output-dir /absolute/path/to/output
```

This command does not perform the LibreOffice checks or update the committed fixture manifest.
