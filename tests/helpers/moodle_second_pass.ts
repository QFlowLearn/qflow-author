import { moodleXmlAdapter } from '../../lib/import/adapters/moodle_xml.ts';
import { analyzeImport } from './lms_import.ts';
/** Exercise producer-shaped Moodle XML through parsing and review classification. */
export async function importMoodleQuestion(
  type: string,
  body: string,
  extra = '',
  format = 'html',
  files = '',
) {
  const source = {
    filename: 'moodle.xml',
    bytes: new TextEncoder().encode(
      `<quiz><question type="${type}"><name><text>Question</text></name><questiontext format="${format}"><text><![CDATA[${body}]]></text>${files}</questiontext>${extra}</question></quiz>`,
    ),
  };
  const imported = await moodleXmlAdapter.parse(source);
  return { source, imported, analysis: await analyzeImport(moodleXmlAdapter, imported, source) };
}
export const twoChoices =
  '<single>true</single><answer fraction="100"><text>Paris</text></answer><answer fraction="0"><text>Berlin</text></answer>';
export function matchingSubquestion(stem: string, answer: string): string {
  return `<subquestion format="html"><text><![CDATA[${stem}]]></text><answer><text><![CDATA[${answer}]]></text></answer></subquestion>`;
}
