import type { DbReadConnection } from '../db.ts';
import type { RequestContext } from '../tenants.ts';
import type { ObjectReader } from '../storage_contract.ts';
import type { AssessmentPublicationStatus } from '../assessment_publication_status.ts';
import type { AssessmentPublicationReview } from '../assessment_publication_review.ts';
import type { DeliveryAssessmentStatus } from '../delivery_status.ts';
import { readDeliverySummary } from '../delivery_metadata.ts';
import { type AssessmentRecord, getAssessment } from './assessment_records.ts';
import { hasWorkspaceCapability } from './workspace_authorization.ts';
import {
  readAssessmentPublicationReview,
  readAssessmentPublicationStatus,
} from './assessment_publication_status.ts';

type QueryResult<T, E extends string = 'forbidden' | 'not_found'> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: E };

type DeliveryStatusReader = (input: {
  readonly qflowTenantId: string;
  readonly qflowAssessmentId: string;
  readonly assessmentVersionId: string;
}) => Promise<QueryResult<DeliveryAssessmentStatus, 'delivery_unavailable'>>;

/** Authorized status queries share current membership and tenant-scoped assessment lookup. */
export class AssessmentStatusQueries {
  constructor(
    private readonly database: DbReadConnection,
    private readonly storage: () => ObjectReader,
    private readonly readDelivery: DeliveryStatusReader,
  ) {}

  /** Read publication state or its review; storage is resolved only after access is granted. */
  async publication(
    auth: RequestContext,
    assessmentId: string,
    mode: 'status' | 'review',
  ): Promise<
    QueryResult<AssessmentPublicationReview | { readonly status: AssessmentPublicationStatus }>
  > {
    const assessment = await this.accessibleAssessment(auth, assessmentId);
    if (!assessment.ok) return assessment;
    if (mode === 'review') {
      return {
        ok: true,
        value: await readAssessmentPublicationReview(
          this.database,
          auth,
          assessment.value,
          this.storage(),
        ),
      };
    }
    const status = await readAssessmentPublicationStatus(this.database, auth, assessment.value);
    return { ok: true, value: { status } };
  }

  /** Query delivery only for the authorized assessment's exact stored published version. */
  async delivery(
    auth: RequestContext,
    assessmentId: string,
  ): Promise<
    QueryResult<
      DeliveryAssessmentStatus,
      'forbidden' | 'not_found' | 'not_published' | 'delivery_unavailable'
    >
  > {
    const assessment = await this.accessibleAssessment(auth, assessmentId);
    if (!assessment.ok) return assessment;
    const delivery = readDeliverySummary(assessment.value.metadata);
    if (!delivery) return { ok: false, code: 'not_published' };
    return await this.readDelivery({
      qflowTenantId: auth.tenantId,
      qflowAssessmentId: assessment.value.id,
      assessmentVersionId: delivery.assessmentVersionId,
    });
  }

  private async accessibleAssessment(
    auth: RequestContext,
    id: string,
  ): Promise<QueryResult<AssessmentRecord>> {
    if (!await hasWorkspaceCapability(auth, 'view_content', this.database)) {
      return { ok: false, code: 'forbidden' };
    }
    const assessment = await getAssessment(auth, id, this.database);
    return assessment ? { ok: true, value: assessment } : { ok: false, code: 'not_found' };
  }
}
