import {
  type CanvasPublishDestination,
  parseCanvasPublishDestination,
} from './canvas_publish_contract.ts';

type CanvasPublishDestinationRecord = {
  readonly destinationKind: string;
  readonly courseId: string;
  readonly questionBankId: string | null;
  readonly questionBankName: string | null;
};

/** Reconstructs one canonical Canvas destination from its persistence projection. */
export function parseStoredCanvasPublishDestination(
  record: CanvasPublishDestinationRecord,
): CanvasPublishDestination | null {
  if (
    record.destinationKind === 'course' &&
    record.questionBankId === null &&
    record.questionBankName === null
  ) return parseCanvasPublishDestination({ _tag: 'Course', courseId: record.courseId });
  if (record.destinationKind !== 'question-bank') return null;
  if (record.questionBankId !== null && record.questionBankName === null) {
    return parseCanvasPublishDestination({
      _tag: 'QuestionBank',
      courseId: record.courseId,
      bank: { _tag: 'Existing', questionBankId: record.questionBankId },
    });
  }
  if (record.questionBankName !== null && record.questionBankId === null) {
    return parseCanvasPublishDestination({
      _tag: 'QuestionBank',
      courseId: record.courseId,
      bank: { _tag: 'New', questionBankName: record.questionBankName },
    });
  }
  return null;
}

/** Projects one canonical Canvas destination into explicit persistence columns. */
export function canvasPublishDestinationColumns(destination: CanvasPublishDestination): {
  readonly destinationKind: 'course' | 'question-bank';
  readonly questionBankId: string | null;
  readonly questionBankName: string | null;
} {
  if (destination._tag === 'Course') {
    return { destinationKind: 'course', questionBankId: null, questionBankName: null };
  }
  return destination.bank._tag === 'Existing'
    ? {
      destinationKind: 'question-bank',
      questionBankId: destination.bank.questionBankId,
      questionBankName: null,
    }
    : {
      destinationKind: 'question-bank',
      questionBankId: null,
      questionBankName: destination.bank.questionBankName,
    };
}
