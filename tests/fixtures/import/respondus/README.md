# Respondus fixture corpus

This directory contains the generated Word and PDF samples for Respondus import tests. Install
[uv](https://docs.astral.sh/uv/) and LibreOffice, then set `QFLOW_LIBREOFFICE_BIN` to the absolute
path of the `soffice` executable.

Regenerate the binary fixtures with:

```sh
pnpm run fixtures:respondus
```

Check that the committed fixtures still match the pinned generator with:

```sh
pnpm run fixtures:respondus:check
```

The Python generator and its pinned environment live in [`tools/respondus-fixtures/`](../../../../tools/respondus-fixtures/). The generator normalizes DOCX ZIP metadata and creates deterministic PDF metadata before
it writes the canonical files. The task also opens and saves temporary DOCX copies with LibreOffice,
then verifies that their extracted text and embedded-image counts did not change. The committed
fixtures remain the deterministic generator output.

Microsoft Word verification remains separate evidence. Do not infer it from this corpus.

| Fixture | Expected Respondus outcome |
| --- | --- |
| `standard-format.txt` | Supported; deterministic six-question recovery |
| `word-visible-numbering.docx` | Supported; literal Respondus markers remain authoritative |
| `word-automatic-numbering.docx` | Not detected; visual numbers and letters are Word list metadata |
| `word-embedded-media.docx` | Detected; item blocked until the embedded asset can be resolved |
| `loose-numbered-quiz.txt` | Not detected; possible numbered-choice structure only |
| `loose-numbered-quiz.pdf` | Not supported by the deterministic Respondus adapter |

`Points:` is sticky Respondus state. It remains active across questions until another `Points:`
directive changes it.
