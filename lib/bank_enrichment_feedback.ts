/** Unknown stored/transport codes cannot become raw diagnostics in the instructor interface. */
export function enrichmentFailureKey(code: string): string {
  switch (code) {
    case 'forbidden':
      return 'items.organize.errorForbidden';
    case 'empty_scope':
      return 'items.organize.errorEmpty';
    case 'active_run':
      return 'items.organize.errorActive';
    case 'conflict':
    case 'operation_conflict':
    case 'version_conflict':
      return 'items.organize.errorConflict';
    case 'invalid_input':
    case 'invalid_selection':
      return 'items.organize.errorInput';
    case 'empty_affected_scope':
      return 'items.organize.errorEmptyAffected';
    case 'affected_scope_changed':
      return 'items.organize.refreshAffected';
    case 'scope_changed':
      return 'items.organize.errorScopeChanged';
    case 'configuration':
      return 'items.organize.errorConfiguration';
    case 'budget_exceeded':
      return 'items.organize.errorBudget';
    case 'unsupported_content':
      return 'items.organize.errorUnsupported';
    case 'input_too_large':
      return 'items.organize.errorLarge';
    default:
      return 'items.organize.errorFailed';
  }
}

/** Each durable operation has a distinct user-facing purpose. */
export function enrichmentTaskTitle(kind: 'preview' | 'classify' | 'correct' | 'undo'): string {
  return {
    preview: 'items.organize.previewTask',
    classify: 'items.organize.tagTask',
    correct: 'items.organize.correctTask',
    undo: 'items.organize.undoTask',
  }[kind];
}
