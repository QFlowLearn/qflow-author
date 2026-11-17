import {
  type QuestionCompletion,
  questionCompletionKey,
  type QuestionComposition,
} from '../../lib/authoring/question_composition.ts';

type CompletionRequest = (
  question: QuestionComposition,
  options: { readonly signal: AbortSignal },
) => Promise<QuestionCompletion | null>;

type Entry = {
  readonly key: string;
  readonly controller: AbortController;
  readonly result: Promise<QuestionCompletion | null>;
};

/**
 * One editor owns one completion, including while it is still running. Source interpretation may
 * continue without restarting identical generation. A different question, manual editing, or editor
 * disposal cancels this lifetime; failed requests are released so explicit retries can run.
 */
export class QuestionCompletionSession {
  private entry: Entry | null = null;

  constructor(private readonly request: CompletionRequest) {}

  complete(question: QuestionComposition): Promise<QuestionCompletion | null> {
    const key = questionCompletionKey(question);
    if (this.entry?.key === key) return this.entry.result;
    this.cancel();
    const controller = new AbortController();
    const result = this.run(question, { signal: controller.signal }).then((value) => {
      if (!value && this.entry?.controller === controller) this.entry = null;
      return value;
    });
    this.entry = { key, controller, result };
    return result;
  }

  cancel(): void {
    this.entry?.controller.abort();
    this.entry = null;
  }

  private async run(
    question: QuestionComposition,
    options: { readonly signal: AbortSignal },
  ): Promise<QuestionCompletion | null> {
    try {
      const result = await this.request(question, options);
      return options.signal.aborted ? null : result;
    } catch {
      return null;
    }
  }
}
