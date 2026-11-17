import {
  type PrecomputedQuestionCompatibility,
  projectQuestionBankRevision,
  projectQuestionBankRevisionFromPrecomputedCompatibility,
  type QuestionBankRevisionProjection,
} from './question_bank.ts';

const PREPARED_QUESTION_REVISION = Symbol('prepared-question-revision');
const PREPARED_VALUES = new WeakMap<
  object,
  PreparedQuestionRevisionValue<QuestionRevisionProjectionInput>
>();

/** Minimum immutable revision content required to derive bank projections. */
export type QuestionRevisionProjectionInput = {
  readonly title: string;
  readonly body: Record<string, unknown>;
  readonly qtiXml: string;
};

/** Revision input whose expensive deterministic projections were completed before persistence. */
export type PreparedQuestionRevision<
  Input extends QuestionRevisionProjectionInput = QuestionRevisionProjectionInput,
> = {
  readonly [PREPARED_QUESTION_REVISION]: true;
  /** Invariant type only; prepared source data is held in the module-private capability store. */
  readonly _input?: Input;
};

type PreparedQuestionRevisionValue<Input extends QuestionRevisionProjectionInput> = {
  readonly input: Input;
  readonly bankProjection: QuestionBankRevisionProjection;
};

/** Computes the immutable revision projections outside the persistence transaction. */
export async function prepareQuestionRevision<Input extends QuestionRevisionProjectionInput>(
  input: Input,
): Promise<PreparedQuestionRevision<Input>> {
  const snapshot = snapshotQuestionRevision(input);
  return createPreparedCapability({
    input: snapshot,
    bankProjection: await projectQuestionBankRevision(
      snapshot.title,
      snapshot.body,
      snapshot.qtiXml,
    ),
  });
}

/**
 * Prepares immutable content from generated compatibility metadata after verifying its semantic
 * content identity and current export-target contracts.
 */
export async function prepareQuestionRevisionFromPrecomputedCompatibility<
  Input extends QuestionRevisionProjectionInput,
>(
  input: Input,
  precomputed: PrecomputedQuestionCompatibility,
): Promise<PreparedQuestionRevision<Input>> {
  const snapshot = snapshotQuestionRevision(input);
  return createPreparedCapability({
    input: snapshot,
    bankProjection: await projectQuestionBankRevisionFromPrecomputedCompatibility(
      snapshot.title,
      snapshot.body,
      snapshot.qtiXml,
      precomputed,
    ),
  });
}

/** Adds transaction-time context without permitting changes to the precomputed revision content. */
export function attachPreparedQuestionRevisionContext<
  Input extends QuestionRevisionProjectionInput,
  Context extends object,
>(
  prepared: PreparedQuestionRevision<Input>,
  context: Context & {
    readonly title?: never;
    readonly body?: never;
    readonly qtiXml?: never;
    readonly bankProjection?: never;
  },
): PreparedQuestionRevision<Input & Context> {
  const value = PREPARED_VALUES.get(prepared);
  if (!value) throw new Error('Question revision was not prepared before adding context.');
  for (const forbidden of ['title', 'body', 'qtiXml', 'bankProjection']) {
    if (forbidden in context) {
      throw new Error('Prepared question revision content cannot be replaced.');
    }
  }
  return createPreparedCapability({
    input: deepFreeze({ ...value.input as Input, ...structuredClone(context) }),
    bankProjection: value.bankProjection,
  });
}

/** Opens an opaque prepared revision and rejects structurally forged transaction inputs. */
export function openPreparedQuestionRevision<Input extends QuestionRevisionProjectionInput>(
  input: PreparedQuestionRevision<Input>,
): Input & { readonly bankProjection: QuestionBankRevisionProjection } {
  const prepared = PREPARED_VALUES.get(input);
  if (!prepared) {
    throw new Error('Question revision was not prepared before persistence.');
  }
  return { ...prepared.input as Input, bankProjection: prepared.bankProjection };
}

function createPreparedCapability<Input extends QuestionRevisionProjectionInput>(
  value: PreparedQuestionRevisionValue<Input>,
): PreparedQuestionRevision<Input> {
  const capability: PreparedQuestionRevision<Input> = Object.freeze({
    [PREPARED_QUESTION_REVISION]: true,
  });
  PREPARED_VALUES.set(capability, value);
  return capability;
}

function snapshotQuestionRevision<Input extends QuestionRevisionProjectionInput>(
  input: Input,
): Input {
  if (!input.title.trim() || input.body.title !== input.title) {
    throw new Error('Question title must match its immutable revision body.');
  }
  return deepFreeze(structuredClone(input));
}

function deepFreeze<Value>(value: Value, seen = new WeakSet<object>()): Value {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}
