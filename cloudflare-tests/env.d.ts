export {};
/** Bindings supplied by the explicitly selected local Wrangler test projects. */
declare global {
  namespace Cloudflare {
    interface Env extends Record<string, unknown> {
      DATABASE_URL: string;
      QFLOW_UPLOADS: R2Bucket;
      QFLOW_SOURCE_MIGRATION_WORKFLOW: Workflow<unknown>;
      QFLOW_AI_GENERATION_WORKFLOW: Workflow<unknown>;
      QFLOW_MIGRATION_COMMIT_WORKFLOW: Workflow<unknown>;
      QFLOW_BANK_ENRICHMENT_WORKFLOW: Workflow<unknown>;
      QFLOW_RELEASE_BUILD_WORKFLOW: Workflow<unknown>;
      QFLOW_ASSESSMENT_PRINT_WORKFLOW: Workflow<unknown>;
      QFLOW_QUESTION_ORGANIZATION_WORKFLOW: Workflow<unknown>;
    }
  }
}
