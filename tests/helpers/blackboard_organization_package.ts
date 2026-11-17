import { writeZip } from '../../lib/zip.ts';
import { xmlEscape } from '../../lib/xml.ts';

/** Independent pools reuse source IDs; cartridge resources also collide on recovered item paths. */
export function blackboardOrganizationPackage(
  titles = ['Biology/Cells', 'Physics/Energy'],
  container: 'blackboard' | 'imscc' = 'blackboard',
) {
  const encoder = new TextEncoder();
  return writeZip([
    {
      name: 'imsmanifest.xml',
      data: encoder.encode(
        `<manifest ${
          container === 'imscc' ? 'xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1"' : ''
        }><resources>${
          titles.map((_, i) =>
            `<resource identifier="pool-${i}" type="assessment/x-bb-pool" file="pool-${i}.dat"/>`
          ).join('')
        }</resources></manifest>`,
      ),
    },
    ...titles.map((title, i) => ({
      name: `pool-${i}.dat`,
      data: encoder.encode(`<POOL><TITLE value="${xmlEscape(title)}"/>
        <QUESTIONLIST><QUESTION id="q1" class="QUESTION_MULTIPLECHOICE"/></QUESTIONLIST>
        <QUESTION_MULTIPLECHOICE id="q1">
          <BODY><TEXT>${
        container === 'imscc' ? 'Shared question' : i === 0 ? 'Cell nucleus' : 'Energy explanation'
      }</TEXT></BODY>
          <ANSWER id="a" position="1"><TEXT>Correct answer</TEXT></ANSWER>
          <ANSWER id="b" position="2"><TEXT>Other answer</TEXT></ANSWER>
          <GRADABLE><CORRECTANSWER answer_id="a"/></GRADABLE>
        </QUESTION_MULTIPLECHOICE>
      </POOL>`),
    })),
  ]);
}
