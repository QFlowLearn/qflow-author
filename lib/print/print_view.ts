import type { PrintConfiguration } from './print_contract.ts';
import type { PrintPack } from './print_pack.ts';
import type { PrintConfirmation } from './print_confirmation.ts';

/** Public authoring status deliberately excludes source XML, object keys and staff content. */
export type PrintPackView = {
  readonly configuration: PrintConfiguration;
  readonly operationId: string;
  readonly id: string;
  readonly form: string;
  readonly state: PrintPack['state'];
  readonly createdAt: string;
  readonly failureCode: string | null;
  readonly confirmation: PrintConfirmation | null;
  readonly studentPages: number | null;
  readonly markingPages: number | null;
};
export function printPackView(pack: PrintPack): PrintPackView {
  const candidate = pack.state === 'preview-ready' || pack.state === 'confirmed'
    ? pack.candidate
    : null;
  return {
    configuration: pack.snapshot.configuration,
    operationId: pack.operationId,
    id: pack.id,
    form: pack.snapshot.form,
    state: pack.state,
    createdAt: pack.snapshot.createdAt,
    failureCode: pack.state === 'failed' ? pack.failureCode : null,
    confirmation: candidate
      ? {
        candidateDigest: candidate.digest,
        sourceDigest: candidate.sourceDigest,
        studentSha256: candidate.student.sha256,
        markingSha256: candidate.marking.sha256,
      }
      : null,
    studentPages: candidate?.student.pages ?? null,
    markingPages: candidate?.marking.pages ?? null,
  };
}
