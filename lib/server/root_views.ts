import { OwnedIsland } from '../rendering/island_context.tsx';
import BankEnrichmentJobControls from '../../islands/BankEnrichmentJobControls.tsx';
import MemberPicker from '../../islands/MemberPicker.tsx';
import QuestionOrganizationProgress from '../../islands/QuestionOrganizationProgress.tsx';
import SsoSettingsForm from '../../islands/SsoSettingsForm.tsx';
import QuestionOrganizationSetup from '../../islands/QuestionOrganizationSetup.tsx';
import BankEnrichmentCorrection from '../../islands/BankEnrichmentCorrection.tsx';
import BankEnrichmentSetup from '../../islands/BankEnrichmentSetup.tsx';
import BankCollectionOrder from '../../islands/BankCollectionOrder.tsx';
import ItemEditor from '../../islands/ItemEditor.tsx';
import BringFilesIntake from '../../islands/BringFilesIntake.tsx';
import AssessmentActionsMenu from '../../islands/AssessmentActionsMenu.tsx';
import ArrangeBoard from '../../islands/ArrangeBoard.tsx';
import ImportProgress from '../../islands/ImportProgress.tsx';
import ConversionGeneration from '../../islands/ConversionGeneration.tsx';
import BlueprintPanel from '../../islands/BlueprintPanel.tsx';
import { type ComponentType, createElement } from 'preact';
import type { RootPayload } from '../client/root_registry.ts';
import AccountMenu from '../../islands/AccountMenu.tsx';
import LocalizedTimestamp from '../../islands/LocalizedTimestamp.tsx';
import OrganizationNotices from '../../islands/OrganizationNotices.tsx';
import BankOverview from '../../islands/BankOverview.tsx';
import BankCategoryFilters from '../../islands/BankCategoryFilters.tsx';
import BankQuestionTable from '../../islands/BankQuestionTable.tsx';
import BankBulkControls from '../../islands/BankBulkControls.tsx';
import QtiItemPreview from '../../islands/QtiItemPreview.tsx';
import AssessmentBuilder from '../../islands/AssessmentBuilder.tsx';

type ServerRoots = {
  readonly [K in RootPayload['component']]: ComponentType<
    Extract<RootPayload, { component: K }>['props']
  >;
};

/** Server registration uses static imports; it never awaits the browser's lazy module graph. */
const components = {
  BankEnrichmentJobControls,
  MemberPicker,
  QuestionOrganizationProgress,
  SsoSettingsForm,
  QuestionOrganizationSetup,
  BankEnrichmentCorrection,
  BankEnrichmentSetup,
  BankCollectionOrder,
  ItemEditor,
  BringFilesIntake,
  AssessmentActionsMenu,
  ArrangeBoard,
  ImportProgress,
  ConversionGeneration,
  BlueprintPanel,
  AccountMenu,
  LocalizedTimestamp,
  OrganizationNotices,
  BankOverview,
  BankCategoryFilters,
  BankQuestionTable,
  BankBulkControls,
  QtiItemPreview,
  AssessmentBuilder,
} satisfies ServerRoots;

/** Keep component/prop correlation at this one typed SSR dispatch boundary. */
export function renderSsrRoot(payload: RootPayload) {
  // SAFETY: component and props share the readonly discriminant; ServerRoots checks every registration.
  const View = components[payload.component] as ComponentType<RootPayload['props']>;
  return createElement(OwnedIsland, { id: payload.id }, createElement(View, payload.props));
}
