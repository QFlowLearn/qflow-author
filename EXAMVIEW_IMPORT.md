# ExamView import

QFlow imports the published ExamView XML 4 interchange format. It does not decode native ExamView
project files or bypass their passwords.

Every imported question enters the same reviewable `Draft` model as other recovery adapters. After
approval, QTI 3 remains the canonical assessment. Canvas, Moodle, and other LMS packages are export
targets.

## Supported inputs

| Input                                                      | QFlow behavior                                                    | Why                                                                           |
| ---------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| ExamView XML with `app-version="4.x"`                      | Deterministic import through `examview-xml@1`                     | The XML shape is published and has an established independent importer.       |
| Canvas, Blackboard, or Moodle package exported by ExamView | Import through the existing package adapter that owns that format | QFlow does not add a second ExamView-specific parser for an LMS package.      |
| Native `.tst` test                                         | Show the author an export path; do not parse                      | The format is versioned, proprietary, and may be password-protected.          |
| Native `.bnk` question bank                                | Show the author an export path; do not parse                      | The format is versioned, proprietary, and may be password-protected.          |
| ExamView XML without a 4.x version                         | Reject                                                            | QFlow does not guess that an undocumented XML version has the same semantics. |

ExamView reached end of life on June 30, 2024. Echo360 no longer provides updates, security patches,
or technical support for it. See
[ExamView Software](https://support.echo360.com/hc/en-us/articles/40532081868557-ExamView-Software).

## Native `.tst` and `.bnk` files

ExamView test and bank files changed across product versions. The vendor documentation says newer
versions can open earlier files, but a file saved by a newer version may no longer open in an older
version. The same documentation lets authors assign passwords to both tests and question banks.
QFlow therefore treats the extension as guidance, not as a reliable parse contract.

QFlow does not:

- infer a native file version from undocumented bytes;
- decrypt or bypass a test or bank password;
- bundle ExamView software or publisher question banks;
- send a native file to a third-party conversion service.

To migrate a native file, open it with software you are licensed to use and export a Canvas,
Blackboard, or Moodle package. Bring that package back to QFlow. ExamView's documented export
options are listed in the
[ExamView Test Generator guide](https://mysavvastraining.com/assets/files/documents/ExamViewTestGeneratorUserGuide_1700149555.pdf).
Echo360 also documents native `.tst` and `.bnk` import into its successor product, including the
supported-version floor and current conversion limits:
[test files](https://support.echo360.com/hc/en-us/articles/20036173850765-EchoExam-Importing-Test-Files)
and
[question banks](https://support.echo360.com/hc/en-us/articles/16788801910285-EchoExam-Importing-Question-Bank-Files).

## ExamView XML 4 coverage

`examview-xml@1` supports the question codes exercised by the published XML importer:

| ExamView code              | QFlow draft                       | Import rule                                                                           |
| -------------------------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| `tf`                       | Single select                     | Preserve the `T` or `F` key.                                                          |
| `yn`                       | Single select                     | Preserve the `Y` or `N` key.                                                          |
| `mc`                       | Single select                     | Preserve choices labeled `A` through `Z` and require one valid key.                   |
| `co`                       | Text entry                        | Preserve each non-empty answer line as an accepted answer.                            |
| `sa`                       | Extended text                     | Keep the response manually scored and preserve the source answer as grading guidance. |
| `nr`                       | Numeric text entry                | Accept integer and decimal answer values only.                                        |
| `es`, `pr`, `ca`, `ot`     | Extended text                     | Preserve the source answer as grading guidance.                                       |
| `ma` plus `matching-group` | Match                             | Consolidate members into one match interaction and require every pair to resolve.     |
| Other codes                | Blocked extended-text placeholder | Preserve the prompt, answer, and evidence without claiming semantic recovery.         |

The parser is based on the public ExamView XML 4 shape exercised by
[Moodle's ExamView importer](https://github.com/moodle/moodle/blob/MOODLE_27_STABLE/question/format/examview/format.php).
QFlow's fixtures are original synthetic content. They do not contain publisher questions or
ExamView-generated files.

## Explicit review outcomes

The adapter never defaults a missing or invalid answer. It emits blocking diagnostics when:

- a prompt or required choice is missing;
- an answer key references a missing choice;
- a numeric answer is not an integer or decimal;
- a matching group or pair is incomplete;
- media lacks a verified asset binding;
- dynamic ExamView content cannot be represented;
- an item contains an XML element whose assessment meaning is not classified;
- the source question type is not supported.

The adapter emits review warnings when visible text is preserved but formatting in a prompt, choice,
or answer is flattened, or when rationale, response-space guidance, or ExamView-specific metadata is
not mapped. Document instructions and presentation settings remain in normalized source evidence and
produce one document-level warning. Unknown document elements cause the import to stop instead of
being ignored. Matching-group evidence includes each member's prompt, answer, rationale, and
metadata, so grouping does not hide source loss. Documents with narratives are rejected because the
published XML 4 grammar does not provide enough verified behavior for QFlow to preserve their
question associations.

All migration warning codes are registered in one typed policy catalog. Each import dependency owns
an exact diagnostic allowlist. Unknown dependency diagnostics block acceptance until QFlow assigns
them an explicit policy.

Echo360 publishes a similar conversion boundary for its own native-file migration: some source types
change shape, some open-response answer information is not imported, and non-decimal numeric
requirements become short answer. Those vendor mappings are useful evidence, but QFlow does not
silently copy them. See
[EchoExam: Importing Test Files](https://support.echo360.com/hc/en-us/articles/20036173850765-EchoExam-Importing-Test-Files).

## Content rights

Authors must have the right to use and migrate the content they upload. QFlow's repository contains
only synthetic ExamView fixtures. It does not include publisher test banks.

Echo360's license places separate restrictions on publisher and learning-series content. Review the
license that applies to the source before moving or redistributing it:
[Echo360 End User License Agreement](https://echo360.com/eula/).
