import { blackboardAdapter } from '../../lib/import/adapters/blackboard.ts';
import { analyzeImport } from './lms_import.ts';
/** Original legacy POOL-shaped inputs with explicit question and answer flags. */
export function blackboardPool(
  input: { klass?: string; body?: string; html?: boolean; key?: string | null; answers?: string } =
    {},
): string {
  const klass = input.klass ?? 'QUESTION_MULTIPLECHOICE';
  const key = input.key === undefined ? 'a' : input.key;
  return `<POOL><TITLE value="Pool"/><QUESTIONLIST><QUESTION id="q1" class="${klass}"/></QUESTIONLIST><${klass} id="q1"><BODY><TEXT><![CDATA[${
    input.body ?? 'Source prompt.'
  }]]></TEXT><FLAGS><ISHTML value="${input.html ?? false}"/></FLAGS></BODY>${
    input.answers ??
      '<ANSWER id="a" position="1"><TEXT>Yes</TEXT></ANSWER><ANSWER id="b" position="2"><TEXT>No</TEXT></ANSWER>'
  }${key ? `<GRADABLE><CORRECTANSWER answer_id="${key}"/></GRADABLE>` : ''}</${klass}></POOL>`;
}
export async function importBlackboardPool(xml: string) {
  const source = { filename: 'pool.dat', bytes: new TextEncoder().encode(xml) };
  const imported = await blackboardAdapter.parse(source);
  return { imported, analysis: await analyzeImport(blackboardAdapter, imported, source) };
}
