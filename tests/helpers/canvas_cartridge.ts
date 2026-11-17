import { writeZip, type ZipEntry } from '../../lib/zip.ts';

/** Synthetic final Canvas CC wrapper, following Canvas's outgoing quiz resource generators. */
export async function canvasCartridge(input: {
  readonly ccXml: string;
  readonly nativeXml: string | null;
  readonly nativeExtension?: '.xml' | '.xml.qti';
  readonly omitNativeFile?: boolean;
  readonly extraResources?: string;
  readonly extraFiles?: readonly ZipEntry[];
}): Promise<Uint8Array> {
  const nativePath = `non_cc_assessments/QUIZ${input.nativeExtension ?? '.xml.qti'}`;
  const manifest =
    `<manifest xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1" identifier="CANVAS">
    <resources>
      <resource identifier="QUIZ" type="imsqti_xmlv1p2/imscc_xmlv1p1/assessment"><file href="QUIZ/assessment_qti.xml"/><dependency identifierref="CANVAS_META"/></resource>
      <resource identifier="CANVAS_META" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="QUIZ/assessment_meta.xml">
        <file href="QUIZ/assessment_meta.xml"/>${
      input.nativeXml === null ? '' : `<file href="${nativePath}"/>`
    }
      </resource>${input.extraResources ?? ''}
    </resources></manifest>`;
  const encode = (value: string) => new TextEncoder().encode(value);
  return await writeZip([
    { name: 'imsmanifest.xml', data: encode(manifest) },
    { name: 'QUIZ/assessment_qti.xml', data: encode(input.ccXml) },
    { name: 'QUIZ/assessment_meta.xml', data: encode('<quiz><title>Canvas quiz</title></quiz>') },
    ...(input.nativeXml !== null && !input.omitNativeFile
      ? [{ name: nativePath, data: encode(input.nativeXml) }]
      : []),
    ...(input.extraFiles ?? []),
  ]);
}
