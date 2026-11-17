import { mountIsland } from '../../../rendering/mount_island.ts';
import BringFilesIntakeView from '../../../../islands/BringFilesIntake.tsx';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { requestErrorResponse } from '../../request_error_response.ts';
import { createI18nPayload } from '../../../i18n/payload.ts';
import { canStartBankIntake } from '../../../services/bank_intake_access.ts';
import { parseSourceIntakeEntryContext } from '../../../source_intake/entry_context.ts';
import { requireAuthContext } from '../../../tenants.ts';

/** Use the shared intake workflow with a fixed, authorized bank destination. */
const methods = {
  async GET(ctx) {
    const auth = requireAuthContext(ctx.state);
    if (ctx.url.searchParams.getAll('collection').length > 1) {
      return new Response(null, { status: 400 });
    }
    const collectionId = ctx.url.searchParams.get('collection');
    const parsed = parseSourceIntakeEntryContext(ctx.url.searchParams, {
      _tag: 'WorkspaceBank',
      collectionId,
    });
    if (!parsed.ok) {
      return new Response(ctx.state.i18n.t('imports.intake.invalidEntry'), { status: 400 });
    }
    if (!await canStartBankIntake(auth, collectionId)) {
      return requestErrorResponse(ctx.state.i18n, 'not_found', 404);
    }
    const payload = createI18nPayload(ctx.state.interfaceLocale, ctx.state.catalog, [
      'imports',
      'assessments',
    ]);
    return ctx.render(
      <section class='space-y-6'>
        <h1 class='text-3xl font-medium'>{ctx.state.i18n.t('imports.intake.bankTitle')}</h1>
        <p>{ctx.state.i18n.t('imports.intake.bankDescription')}</p>
        <BringFilesIntake {...parsed.context} payload={payload} />
      </section>,
    );
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const importNewPageRoute = defineHttpRoute('/imports/new', {
  ...methods,
  HEAD: methods.GET,
});

const BringFilesIntake = mountIsland({ component: 'BringFilesIntake', View: BringFilesIntakeView });
