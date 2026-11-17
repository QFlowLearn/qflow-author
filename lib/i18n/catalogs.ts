import svSESettings from './messages/sv-SE/settings.json' with { type: 'json' };
import svSEDelivery from './messages/sv-SE/delivery.json' with { type: 'json' };
import svSEItems from './messages/sv-SE/items.json' with { type: 'json' };
import svSEAuthoring from './messages/sv-SE/authoring.json' with { type: 'json' };
import svSECore from './messages/sv-SE/core.json' with { type: 'json' };
import svSEReleases from './messages/sv-SE/releases.json' with { type: 'json' };
import svSEAssessments from './messages/sv-SE/assessments.json' with { type: 'json' };
import svSEAuth from './messages/sv-SE/auth.json' with { type: 'json' };
import svSEEmail from './messages/sv-SE/email.json' with { type: 'json' };
import svSEImports from './messages/sv-SE/imports.json' with { type: 'json' };
import svSEHelp from './messages/sv-SE/help.json' with { type: 'json' };
import es419Releases from './messages/es-419/releases.json' with { type: 'json' };
import esESReleases from './messages/es-ES/releases.json' with { type: 'json' };
import enGBReleases from './messages/en-GB/releases.json' with { type: 'json' };
import enUSReleases from './messages/en-US/releases.json' with { type: 'json' };
import type { InterfaceLocale } from './locale.ts';
import type { MessageCatalog } from './messages.ts';
import enUSAuth from './messages/en-US/auth.json' with { type: 'json' };
import enUSCore from './messages/en-US/core.json' with { type: 'json' };
import enUSSettings from './messages/en-US/settings.json' with { type: 'json' };
import enGBAuth from './messages/en-GB/auth.json' with { type: 'json' };
import enGBCore from './messages/en-GB/core.json' with { type: 'json' };
import enGBSettings from './messages/en-GB/settings.json' with { type: 'json' };
import esESAuth from './messages/es-ES/auth.json' with { type: 'json' };
import esESCore from './messages/es-ES/core.json' with { type: 'json' };
import esESSettings from './messages/es-ES/settings.json' with { type: 'json' };
import es419Auth from './messages/es-419/auth.json' with { type: 'json' };
import es419Core from './messages/es-419/core.json' with { type: 'json' };
import es419Settings from './messages/es-419/settings.json' with { type: 'json' };
import enUSAssessments from './messages/en-US/assessments.json' with { type: 'json' };
import enGBAssessments from './messages/en-GB/assessments.json' with { type: 'json' };
import esESAssessments from './messages/es-ES/assessments.json' with { type: 'json' };
import es419Assessments from './messages/es-419/assessments.json' with { type: 'json' };
import enUSAuthoring from './messages/en-US/authoring.json' with { type: 'json' };
import enGBAuthoring from './messages/en-GB/authoring.json' with { type: 'json' };
import esESAuthoring from './messages/es-ES/authoring.json' with { type: 'json' };
import es419Authoring from './messages/es-419/authoring.json' with { type: 'json' };
import enUSItems from './messages/en-US/items.json' with { type: 'json' };
import enGBItems from './messages/en-GB/items.json' with { type: 'json' };
import esESItems from './messages/es-ES/items.json' with { type: 'json' };
import es419Items from './messages/es-419/items.json' with { type: 'json' };
import enUSEmail from './messages/en-US/email.json' with { type: 'json' };
import enUSDelivery from './messages/en-US/delivery.json' with { type: 'json' };
import enGBEmail from './messages/en-GB/email.json' with { type: 'json' };
import enGBDelivery from './messages/en-GB/delivery.json' with { type: 'json' };
import esESEmail from './messages/es-ES/email.json' with { type: 'json' };
import esESDelivery from './messages/es-ES/delivery.json' with { type: 'json' };
import es419Email from './messages/es-419/email.json' with { type: 'json' };
import es419Delivery from './messages/es-419/delivery.json' with { type: 'json' };
import enUSImports from './messages/en-US/imports.json' with { type: 'json' };
import enGBImports from './messages/en-GB/imports.json' with { type: 'json' };
import esESImports from './messages/es-ES/imports.json' with { type: 'json' };
import es419Imports from './messages/es-419/imports.json' with { type: 'json' };
import enUSHelp from './messages/en-US/help.json' with { type: 'json' };
import enGBHelp from './messages/en-GB/help.json' with { type: 'json' };
import esESHelp from './messages/es-ES/help.json' with { type: 'json' };
import es419Help from './messages/es-419/help.json' with { type: 'json' };

/** Complete message registry for all supported interface locales. */
export const CATALOGS: Readonly<Record<InterfaceLocale, MessageCatalog>> = {
  'sv-SE': {
    settings: svSESettings,
    delivery: svSEDelivery,
    items: svSEItems,
    authoring: svSEAuthoring,
    core: svSECore,
    releases: svSEReleases,
    assessments: svSEAssessments,
    auth: svSEAuth,
    email: svSEEmail,
    imports: svSEImports,
    help: svSEHelp,
  },
  'en-US': {
    auth: enUSAuth,
    core: enUSCore,
    settings: enUSSettings,
    assessments: enUSAssessments,
    authoring: enUSAuthoring,
    items: enUSItems,
    releases: enUSReleases,
    email: enUSEmail,
    delivery: enUSDelivery,
    imports: enUSImports,
    help: enUSHelp,
  },
  'en-GB': {
    auth: enGBAuth,
    core: enGBCore,
    settings: enGBSettings,
    assessments: enGBAssessments,
    authoring: enGBAuthoring,
    items: enGBItems,
    releases: enGBReleases,
    email: enGBEmail,
    delivery: enGBDelivery,
    imports: enGBImports,
    help: enGBHelp,
  },
  'es-ES': {
    auth: esESAuth,
    core: esESCore,
    settings: esESSettings,
    assessments: esESAssessments,
    authoring: esESAuthoring,
    items: esESItems,
    releases: esESReleases,
    email: esESEmail,
    delivery: esESDelivery,
    imports: esESImports,
    help: esESHelp,
  },
  'es-419': {
    auth: es419Auth,
    core: es419Core,
    settings: es419Settings,
    assessments: es419Assessments,
    authoring: es419Authoring,
    items: es419Items,
    releases: es419Releases,
    email: es419Email,
    delivery: es419Delivery,
    imports: es419Imports,
    help: es419Help,
  },
};

/** Return the validated catalog for one supported locale. */
export function catalogForLocale(locale: InterfaceLocale): MessageCatalog {
  return CATALOGS[locale];
}
