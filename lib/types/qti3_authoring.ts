import type { Draft } from './draft.ts';
import { normalizeDraftForDriver } from './draft_utils.ts';
import type { PublicBuildOpts, QuestionTypeId } from './registry.ts';
import { questionPointsErrors, TYPE_DRIVERS } from './registry.ts';
import {
  type Qti3AuthoringItem,
  type Qti3WriterDiagnostic,
  writeQflowQti3AssessmentItemResult,
} from './qti3_writer_adapter.ts';

export type Qti3AuthoringBuildOptions = PublicBuildOpts;

export class QflowQti3WriterExportError extends Error {
  readonly diagnostics: readonly Qti3WriterDiagnostic[];

  constructor(diagnostics: readonly Qti3WriterDiagnostic[]) {
    const details = diagnostics
      .map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`)
      .join('; ');
    super(`QTI 3 writer rejected qflow authoring item: ${details}`);
    this.name = 'QflowQti3WriterExportError';
    this.diagnostics = diagnostics;
  }
}

export function toQti3AuthoringItem(
  typeId: QuestionTypeId,
  draft: Draft,
  opts: Qti3AuthoringBuildOptions = {},
): Qti3AuthoringItem {
  const pointErrors = questionPointsErrors({ ...draft, type: typeId });
  if (pointErrors.length) {
    throw new QflowQti3WriterExportError(pointErrors.map((message) => ({
      code: 'invalid_question_points',
      path: 'maximumScore',
      message,
    })));
  }
  const driver = TYPE_DRIVERS[typeId];
  const normalized = normalizeDraftForDriver(typeId, draft);
  return driver.toQti3AuthoringItem(normalized, opts);
}

export function exportQti3AssessmentItemXml(
  typeId: QuestionTypeId,
  draft: Draft,
  opts: Qti3AuthoringBuildOptions = {},
): string {
  const item = toQti3AuthoringItem(typeId, draft, opts);
  const result = writeQflowQti3AssessmentItemResult(item);
  if (result.ok) return result.xml;
  throw new QflowQti3WriterExportError(result.diagnostics);
}
