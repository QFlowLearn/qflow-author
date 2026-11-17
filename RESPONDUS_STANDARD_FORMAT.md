# Respondus Standard Format compatibility

QFlow recovers documented Respondus Standard Format directly into reviewable QTI 3 drafts. The
adapter is deterministic: it does not call AI, default missing answers, or reinterpret malformed
syntax.

Automatic format detection requires a Respondus-specific marker: a `Type:` directive, a terminal
`Answers:` section, or an inline starred answer. A numbered question followed only by lettered
choices is not claimed as Respondus because that shape is common to unrelated quiz formats.

The grammar follows Respondus's
[Standard Format appendix](https://web.respondus.com/wp-content/uploads/2019/08/Respondus40UserGuideIMS.pdf).
Respondus's current support summary identifies multiple choice, true/false, multiple response,
fill-in-the-blank, matching, and essay as the common text/Word import types
[supported across LMS targets](https://support.respondus.com/hc/en-us/articles/4409595580955-Does-Respondus-4-support-question-types-unique-to-the-specific-LMS).

## Source containers

| Source                          | QFlow support     | Notes                                                                                                                |
| ------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| UTF-8 plain text                | Supported         | Number, choice, directive, feedback, points, and terminal answer-key lines are parsed directly.                      |
| DOCX                            | Supported         | Standard Format markers must exist in the document text. Typed numbering and lettering are supported.                |
| Word automatic numbering        | Not yet supported | DOCX numbering metadata is not interpreted as hidden Standard Format markers. Use visible numbering in the document. |
| RTF or legacy DOC               | Not supported     | Convert to UTF-8 TXT or DOCX before recovery.                                                                        |
| Respondus project/archive files | Not supported     | QFlow does not claim access to proprietary or encrypted Respondus projects.                                          |

## Question types

| Respondus form              | QFlow draft                          | Answer handling                                                                                            |
| --------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Multiple choice             | `single_select`                      | Inline `*` or the terminal `Answers:` section                                                              |
| True/false                  | `single_select`                      | `True`/`False`, `T`/`F`, or `A`/`B`                                                                        |
| `Type: MA` multiple answer  | `multi_select`                       | Inline `*` markers or comma/space-separated terminal keys                                                  |
| `Type: F` fill in the blank | `text_entry`                         | Multiple accepted forms are retained                                                                       |
| Numeric fill answer         | `text_entry` with a numeric response | Numeric text is supported through `Type: F`; Respondus Standard Format has no separate common numeric type |
| `Type: E` essay             | `extended_text`                      | An optional supplied answer becomes the review rubric                                                      |
| `Type: MT` matching         | `match`                              | Each documented `left = right` pair is retained                                                            |
| LMS-specific type codes     | Source-preserved blocked item        | QFlow does not silently coerce a platform-specific type                                                    |

## Fields and diagnostics

| Source feature                       | Behavior                                                                                                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Question numbers and boundaries      | Required and validated; duplicate numbers fail parsing                                                                                                                                             |
| Titles                               | Preserved without Respondus's historical 20-character display truncation                                                                                                                           |
| Missing correct answer               | Item is blocked; QFlow never defaults to choice A                                                                                                                                                  |
| Conflicting inline and terminal keys | Item is blocked with an answer-conflict diagnostic                                                                                                                                                 |
| Points                               | Sticky: the value applies to each following question until another `Points:` directive replaces it. Detected values remain review warnings because per-question point mapping is not yet available |
| General or choice feedback           | Detected and preserved in source evidence; draft feedback mapping is not yet available                                                                                                             |
| `[HTML]` blocks                      | Preserved as text and flagged for review                                                                                                                                                           |
| Image tags or embedded DOCX images   | Item is blocked when no importable sidecar asset is available                                                                                                                                      |

## Fixture evidence

The behavior tests use:

- `tests/fixtures/import/respondus/standard-format.txt`
- `tests/fixtures/import/respondus/standard-word-document.xml`, packaged as DOCX during the test
- missing-answer, conflicting-answer, and malformed-boundary fixtures

The DOCX fixture is a minimal OOXML package used to prove that the same visible grammar reaches the
adapter. It is not evidence for Word automatic numbering, relationship-based media, or real
Word-generated document fidelity. Task 10 requires that separate corpus.

Run:

```sh
pnpm run test:qa -- --database=qflow_test tests/respondus_standard_import_test.ts
```
