import type { ImportedAsset, ImportResult } from '../types.ts';
import { parseXml, serializer } from '../xml_dom.ts';
import { qti12Adapter } from './qti12.ts';

/** Keep independent QTI resources' group, part and item identities in separate namespaces. */
export async function parseManifestQti12Documents(
  documents: Array<{ path: string; xml: string }>,
  assets: ImportedAsset[],
): Promise<ImportResult> {
  const results = await Promise.all(documents.map(async ({ path, xml }, index) => {
    const result = await qti12Adapter.parse({
      filename: path,
      bytes: new TextEncoder().encode(xml),
      mime: 'application/xml',
    });
    const prefix = `BB_${index + 1}_`;
    return {
      ...result,
      items: result.items.map((item) => {
        const identifier = prefix + item.identifier;
        const doc = parseXml(item.xml, 'Blackboard migrated question identity');
        doc.documentElement.setAttribute('identifier', identifier);
        return { ...item, identifier, xml: serializer.serializeToString(doc) };
      }),
      parts: result.parts.map((part) => ({ ...part, id: prefix + part.id })),
      organizationGroups: result.organizationGroups.map((group) => ({
        ...group,
        id: prefix + group.id,
      })),
    };
  }));
  const items = results.flatMap((result) => result.items);
  if (!items.length) {
    throw new Error('Blackboard QTI 1.2 resources did not contain any importable questions.');
  }
  const warnings = results.flatMap((result) => result.warnings ?? []);
  return {
    title: results.length === 1 ? results[0].title : 'Imported Blackboard Assessment',
    parts: results.flatMap((result) => result.parts),
    organizationGroups: results.flatMap((result) => result.organizationGroups),
    items,
    assets,
    warnings: warnings.length ? warnings : undefined,
  };
}
