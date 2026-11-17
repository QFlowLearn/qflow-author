import { projectCanonicalQtiSemantics } from './question_qti_semantics.ts';
import {
  canonicalJsonStringify,
  type CanonicalJsonValue,
  projectJsonPersistenceObject,
} from './canonical_json.ts';
import {
  type QuestionVersionFieldCategory,
  REVISION_DOCUMENT_SCHEMA,
  type RevisionFieldSchema,
} from './question_version_fields.ts';

/** Full evidence for one semantic revision difference, with stable member identity where available. */
export type QuestionVersionChange = {
  readonly category: QuestionVersionFieldCategory;
  readonly label?: string;
  readonly field: string;
  readonly kind: 'changed' | 'reordered' | 'added' | 'removed';
  readonly before: string;
  readonly after: string;
};

/** Compare one canonical QTI document plus the explicitly authoring-only revision fields. */
export function compareQuestionRevisionSnapshots(
  before: { readonly body: Record<string, unknown>; readonly qtiXml: string },
  after: { readonly body: Record<string, unknown>; readonly qtiXml: string },
): readonly QuestionVersionChange[] {
  return compare('', document(before), document(after), 'content', REVISION_DOCUMENT_SCHEMA);
}

function document(
  snapshot: { readonly body: Record<string, unknown>; readonly qtiXml: string },
): CanonicalJsonValue {
  const body = projectJsonPersistenceObject(snapshot.body);
  const result: Record<string, CanonicalJsonValue> = {
    qti: projectCanonicalQtiSemantics(snapshot.qtiXml),
  };
  for (
    const field of ['title', 'tags', 'note', 'standards', 'standardAlignments', 'importWarnings']
  ) {
    const value = body[field];
    if (value !== undefined) result[field] = value;
  }
  for (const field of ['tags', 'standards', 'standardAlignments']) {
    const value = result[field];
    if (Array.isArray(value)) {
      if (value.length === 0) delete result[field];
      else {
        result[field] = [...value].sort((a, b) =>
          canonicalJsonStringify(a).localeCompare(canonicalJsonStringify(b))
        );
      }
    }
  }
  return result;
}

function compare(
  field: string,
  before: CanonicalJsonValue | undefined,
  after: CanonicalJsonValue | undefined,
  category: QuestionVersionFieldCategory,
  schema: RevisionFieldSchema,
): QuestionVersionChange[] {
  const left = canonicalJsonStringify(before ?? null),
    right = canonicalJsonStringify(after ?? null);
  const oldMembers = schema.identity && before !== undefined
    ? identifiedMembers(before, schema.identity)
    : undefined;
  const newMembers = schema.identity && after !== undefined
    ? identifiedMembers(after, schema.identity)
    : undefined;
  if (
    left === right && before !== undefined && after !== undefined && !schema.fields &&
    !schema.identity
  ) return [];
  const change = (
    kind: QuestionVersionChange['kind'],
    path = field,
    oldValue = left,
    newValue = right,
  ): QuestionVersionChange => ({
    category,
    ...(schema.label ? { label: schema.label } : {}),
    field: path,
    kind,
    before: oldValue,
    after: newValue,
  });
  if (before === undefined) return [change('added')];
  if (after === undefined) return [change('removed')];
  if (Array.isArray(before) && Array.isArray(after)) {
    if (oldMembers !== undefined && newMembers !== undefined) {
      const changes: QuestionVersionChange[] = [];
      const oldIds = [...oldMembers.keys()], newIds = [...newMembers.keys()];
      const retainedOld = oldIds.filter((id) => newMembers.has(id));
      const retainedNew = newIds.filter((id) => oldMembers.has(id));
      if (canonicalJsonStringify(retainedOld) !== canonicalJsonStringify(retainedNew)) {
        changes.push(
          change(
            'reordered',
            `${field}.order`,
            canonicalJsonStringify(oldIds),
            canonicalJsonStringify(newIds),
          ),
        );
      }
      for (const id of [...new Set([...oldIds, ...newIds])].sort()) {
        changes.push(
          ...compare(
            `${field}[${JSON.stringify(id)}]`,
            oldMembers.get(id),
            newMembers.get(id),
            category,
            { ...schema, identity: undefined },
          ),
        );
      }
      return changes;
    }
  }
  if (record(before) && record(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) =>
      !schema.derivedFields?.includes(key)
    ).sort().flatMap((key) =>
      compare(
        field ? `${field}.${key}` : key,
        before[key],
        after[key],
        schema.fields?.[key]?.category ?? category,
        schema.fields?.[key] ?? { label: schema.label },
      )
    );
  }
  return left === right ? [] : [change('changed')];
}

function record(value: CanonicalJsonValue): value is Record<string, CanonicalJsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function identifiedMembers(
  values: CanonicalJsonValue,
  identity: NonNullable<RevisionFieldSchema['identity']>,
): Map<string, CanonicalJsonValue> {
  if (!Array.isArray(values)) throw new Error('Identified revision field must be an array.');
  const members = new Map<string, CanonicalJsonValue>();
  for (const value of values) {
    if (!record(value)) throw new Error('Identified revision member must be an object.');
    const id = value[identity];
    if (typeof id !== 'string' || !id || members.has(id)) {
      throw new Error('Revision member identity is missing or duplicated.');
    }
    members.set(id, value);
  }
  return members;
}
