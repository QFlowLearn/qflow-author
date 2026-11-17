import { printPackRoutes } from './routes/assessment_api/print_packs.ts';
import { adaptivePlanApiRoute } from './routes/assessment_api/adaptive_plan.ts';
import { adaptivePreviewApiRoute } from './routes/assessment_api/adaptive_preview.ts';
import { canvasPublishesApiRoute } from './routes/assessment_api/canvas_publishes.ts';
import { canvasPublishPackageApiRoute } from './routes/assessment_api/canvas_publish_package.ts';
import { canvasPublishReceiptApiRoute } from './routes/assessment_api/canvas_publish_receipt.ts';
import { canvasPublishResolveIdentityApiRoute } from './routes/assessment_api/canvas_publish_resolve_identity.ts';
import { canvasPublishResumeApiRoute } from './routes/assessment_api/canvas_publish_resume.ts';
import { canvasPublishApiRoute } from './routes/assessment_api/canvas_publish.ts';
import { deliveryStatusApiRoute } from './routes/assessment_api/delivery_status.ts';
import { duplicateApiRoute } from './routes/assessment_api/duplicate.ts';
import { launchDeliveryApiRoute } from './routes/assessment_api/launch_delivery.ts';
import { packageApiRoute } from './routes/assessment_api/package.ts';
import { publicationStatusApiRoute } from './routes/assessment_api/publication_status.ts';
import { publishCanvasApiRoute } from './routes/assessment_api/publish_canvas.ts';
import { publishDeliveryApiRoute } from './routes/assessment_api/publish_delivery.ts';
import { questionAssistanceApiRoute } from './routes/assessment_api/question_assistance.ts';
import { questionCompletionApiRoute } from './routes/assessment_api/question_completion.ts';
import { questionOrderPreviewApiRoute } from './routes/assessment_api/question_order_preview.ts';
import { receiptApiRoute } from './routes/assessment_api/receipt.ts';
import { validateApiRoute } from './routes/assessment_api/validate.ts';
import { bankSearchApiRoute } from './routes/assessment_api/bank_search.ts';
import { itemPreviewApiRoute } from './routes/assessment_api/item_preview.ts';
import { itemRevisionApiRoute } from './routes/assessment_api/item_revision.ts';
import { blueprintApiRoute } from './routes/assessment_api/blueprint.ts';
import { proposalsApiRoute } from './routes/assessment_api/proposals.ts';
import { restoreApiRoute } from './routes/assessment_api/restore.ts';
import { removalsApiRoute } from './routes/assessment_api/removals.ts';
import { arrangeApiRoute } from './routes/assessment_api/arrange.ts';
import { placementApiRoute } from './routes/assessment_api/placement.ts';
import { placementsApiRoute } from './routes/assessment_api/placements.ts';
import { preferencesApiRoute } from './routes/assessment_api/preferences.ts';
import { questionDefaultsApiRoute } from './routes/assessment_api/question_defaults.ts';
import { questionsApiRoute } from './routes/assessment_api/questions.ts';
import { recordApiRoute } from './routes/assessment_api/record.ts';
import { listApiRoute } from './routes/assessment_api/list.ts';
import { assessmentListPageRoute } from './routes/assessment_pages/list.tsx';
import { assessmentNewPageRoute } from './routes/assessment_pages/new.tsx';
import { assessmentArrangePageRoute } from './routes/assessment_pages/arrange.tsx';
import { assessmentBuilderRoute } from './routes/assessment_pages/assessment_builder.tsx';
import { canvasCallbackAuthRoute } from './routes/auth_api/canvas_callback.ts';
import { canvasStartAuthRoute } from './routes/auth_api/canvas_start.ts';
import { oidcCallbackAuthRoute } from './routes/auth_api/oidc_callback.ts';
import { oidcStartAuthRoute } from './routes/auth_api/oidc_start.ts';
import { domainVerificationAuthRoute } from './routes/auth_api/domain_verification.ts';
import { ssoPolicyAuthRoute } from './routes/auth_api/sso_policy.ts';
import { oidcSettingsAuthRoute } from './routes/auth_api/oidc_settings.ts';
import { resetConfirmAuthRoute } from './routes/auth_api/reset_confirm.ts';
import { resetRequestAuthRoute } from './routes/auth_api/reset_request.ts';
import { passwordChangeAuthRoute } from './routes/auth_api/password_change.ts';
import { signupAuthRoute } from './routes/auth_api/signup.ts';
import { loginAuthRoute } from './routes/auth_api/login.ts';
import { logoutRoute } from './routes/auth_api/logout.ts';
import { meRoute } from './routes/auth_api/me.ts';
import { signupPageRoute } from './routes/auth_pages/signup.tsx';
import { loginRoute } from './routes/auth_pages/login.tsx';
import { forgotPasswordRoute } from './routes/auth_pages/forgot_password.tsx';
import { resetPasswordRoute } from './routes/auth_pages/reset_password.tsx';
import { executeSourceBankRoute } from './routes/bank_api/execute_source.ts';
import { inspectSourceBankRoute } from './routes/bank_api/inspect_source.ts';
import { uploadContentBankRoute } from './routes/bank_api/upload_content.ts';
import { uploadBankRoute } from './routes/bank_api/upload.ts';
import { validateBankRoute } from './routes/bank_api/validate.ts';
import { metaBankRoute } from './routes/bank_api/meta.ts';
import { latestBankRoute } from './routes/bank_api/latest.ts';
import { publishRevisionBankRoute } from './routes/bank_api/publish_revision.ts';
import { createQuestionBankRoute } from './routes/bank_api/create_question.ts';
import { draftBankRoute } from './routes/bank_api/draft.ts';
import { bankFacetsRoute } from './routes/bank_api/bank_facets.ts';
import { organizationNoticesRoute } from './routes/bank_api/organization_notices.ts';
import { itemBankRoute } from './routes/bank_api/item.ts';
import { bankCollectionsPageRoute } from './routes/bank_pages/collections.tsx';
import { bankCollectionArrangePageRoute } from './routes/bank_pages/collection_arrange.tsx';
import { bankDraftsPageRoute } from './routes/bank_pages/drafts.tsx';
import { bankDraftPageRoute } from './routes/bank_pages/draft.tsx';
import { bankNewPageRoute } from './routes/bank_pages/new.tsx';
import { bankOrganizePageRoute } from './routes/bank_pages/organize.tsx';
import { bankOrganizationCorrectPageRoute } from './routes/bank_pages/organization_correct.tsx';
import { bankOrganizationPageRoute } from './routes/bank_pages/organization.tsx';
import { bankOrganizationStatusPageRoute } from './routes/bank_pages/organization_status.ts';
import { bankReviewsPageRoute } from './routes/bank_pages/reviews.tsx';
import { bankEditPageRoute } from './routes/bank_pages/edit.tsx';
import { bankDetailPageRoute } from './routes/bank_pages/detail.tsx';
import { questionSnapshotRoute } from './routes/bank_pages/question_snapshot.tsx';
import { itemsRoute } from './routes/bank_pages/items.tsx';
import { canvasConnectionsApiRoute } from './routes/canvas_api/connections.ts';
import { artifactImportRoute } from './routes/import_api/artifact.ts';
import { generationStatusImportRoute } from './routes/import_api/generation_status.ts';
import { generationImportRoute } from './routes/import_api/generation.ts';
import { blueprintImportRoute } from './routes/import_api/blueprint.ts';
import { importListPageRoute } from './routes/import_pages/list.tsx';
import { importBatchPageRoute } from './routes/import_pages/batch.tsx';
import { importNewPageRoute } from './routes/import_pages/new.tsx';
import { importReportRoute } from './routes/import_pages/import_report.tsx';
import { releaseListPageRoute } from './routes/release_pages/list.tsx';
import { releaseComparePageRoute } from './routes/release_pages/compare.tsx';
import { releaseNewPageRoute } from './routes/release_pages/new.tsx';
import { releasePackagesPageRoute } from './routes/release_pages/packages.ts';
import { releasePreparePageRoute } from './routes/release_pages/prepare.ts';
import { releaseSourcePageRoute } from './routes/release_pages/source.ts';
import { releaseDetailPageRoute } from './routes/release_pages/detail.tsx';
import { memberSearchRoute } from './routes/settings_api/member_search.ts';
import { settingsRoute } from './routes/settings_api/settings.ts';
import { settingsAuditPageRoute } from './routes/settings_pages/audit.tsx';
import { settingsCanvasPageRoute } from './routes/settings_pages/canvas.tsx';
import { settingsEditorPageRoute } from './routes/settings_pages/editor.tsx';
import { settingsMembersPageRoute } from './routes/settings_pages/members.tsx';
import { settingsMigrationsPageRoute } from './routes/settings_pages/migrations.tsx';
import { settingsPasswordPageRoute } from './routes/settings_pages/password.tsx';
import { settingsPublicationGrantsPageRoute } from './routes/settings_pages/publication_grants.tsx';
import { settingsSessionsPageRoute } from './routes/settings_pages/sessions.tsx';
import { settingsSsoPageRoute } from './routes/settings_pages/sso.tsx';
import { settingsBankNamePageRoute } from './routes/settings_pages/bank_name.tsx';
import { settingsTenantPageRoute } from './routes/settings_pages/tenant.tsx';
import { accountSettingsRoute } from './routes/settings_pages/account_settings.tsx';
import { localeRoute } from './routes/public_pages/locale.ts';
import { qtiSampleReportPageRoute } from './routes/public_pages/qti_sample_report.tsx';
import { qti3ImportPageRoute } from './routes/public_pages/qti3_import.tsx';
import { qtiFidelityPageRoute } from './routes/public_pages/qti_fidelity.tsx';
import { portabilityPageRoute } from './routes/public_pages/portability.tsx';
import { onboardingPageRoute } from './routes/public_pages/onboarding.tsx';
import { demoPresidentsPageRoute } from './routes/public_pages/demo_presidents.tsx';
import { authorPageRoute } from './routes/public_pages/author.tsx';
import { homePageRoute } from './routes/public_pages/home.tsx';
import { healthRoute } from './routes/public_pages/health.ts';

/** Endpoint owners grouped by feature; specific paths precede matching parameters. */
export const httpRoutes = [
  // Assessment api.
  adaptivePlanApiRoute,
  adaptivePreviewApiRoute,
  canvasPublishesApiRoute,
  canvasPublishPackageApiRoute,
  canvasPublishReceiptApiRoute,
  canvasPublishResolveIdentityApiRoute,
  canvasPublishResumeApiRoute,
  canvasPublishApiRoute,
  deliveryStatusApiRoute,
  duplicateApiRoute,
  launchDeliveryApiRoute,
  ...printPackRoutes,
  packageApiRoute,
  publicationStatusApiRoute,
  publishCanvasApiRoute,
  publishDeliveryApiRoute,
  questionAssistanceApiRoute,
  questionCompletionApiRoute,
  questionOrderPreviewApiRoute,
  receiptApiRoute,
  validateApiRoute,
  bankSearchApiRoute,
  itemPreviewApiRoute,
  itemRevisionApiRoute,
  blueprintApiRoute,
  proposalsApiRoute,
  restoreApiRoute,
  removalsApiRoute,
  arrangeApiRoute,
  placementApiRoute,
  placementsApiRoute,
  preferencesApiRoute,
  questionDefaultsApiRoute,
  questionsApiRoute,
  recordApiRoute,
  listApiRoute,
  // Assessment pages.
  assessmentListPageRoute,
  assessmentNewPageRoute,
  assessmentArrangePageRoute,
  assessmentBuilderRoute,
  // Auth api.
  canvasCallbackAuthRoute,
  canvasStartAuthRoute,
  oidcCallbackAuthRoute,
  oidcStartAuthRoute,
  domainVerificationAuthRoute,
  ssoPolicyAuthRoute,
  oidcSettingsAuthRoute,
  resetConfirmAuthRoute,
  resetRequestAuthRoute,
  passwordChangeAuthRoute,
  signupAuthRoute,
  loginAuthRoute,
  logoutRoute,
  meRoute,
  // Auth pages.
  signupPageRoute,
  loginRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  // Bank api.
  executeSourceBankRoute,
  inspectSourceBankRoute,
  uploadContentBankRoute,
  uploadBankRoute,
  validateBankRoute,
  metaBankRoute,
  latestBankRoute,
  publishRevisionBankRoute,
  createQuestionBankRoute,
  draftBankRoute,
  bankFacetsRoute,
  organizationNoticesRoute,
  itemBankRoute,
  // Bank pages.
  bankCollectionsPageRoute,
  bankCollectionArrangePageRoute,
  bankDraftsPageRoute,
  bankDraftPageRoute,
  bankNewPageRoute,
  bankOrganizePageRoute,
  bankOrganizationCorrectPageRoute,
  bankOrganizationPageRoute,
  bankOrganizationStatusPageRoute,
  bankReviewsPageRoute,
  bankEditPageRoute,
  bankDetailPageRoute,
  questionSnapshotRoute,
  itemsRoute,
  // Canvas api.
  canvasConnectionsApiRoute,
  // Import api.
  artifactImportRoute,
  generationStatusImportRoute,
  generationImportRoute,
  blueprintImportRoute,
  // Import pages.
  importListPageRoute,
  importBatchPageRoute,
  importNewPageRoute,
  importReportRoute,
  // Release pages.
  releaseListPageRoute,
  releaseComparePageRoute,
  releaseNewPageRoute,
  releasePackagesPageRoute,
  releasePreparePageRoute,
  releaseSourcePageRoute,
  releaseDetailPageRoute,
  // Settings api.
  memberSearchRoute,
  settingsRoute,
  // Settings pages.
  settingsAuditPageRoute,
  settingsCanvasPageRoute,
  settingsEditorPageRoute,
  settingsMembersPageRoute,
  settingsMigrationsPageRoute,
  settingsPasswordPageRoute,
  settingsPublicationGrantsPageRoute,
  settingsSessionsPageRoute,
  settingsSsoPageRoute,
  settingsBankNamePageRoute,
  settingsTenantPageRoute,
  accountSettingsRoute,
  // Public pages.
  localeRoute,
  qtiSampleReportPageRoute,
  qti3ImportPageRoute,
  qtiFidelityPageRoute,
  portabilityPageRoute,
  onboardingPageRoute,
  demoPresidentsPageRoute,
  authorPageRoute,
  homePageRoute,
  healthRoute,
] as const;
