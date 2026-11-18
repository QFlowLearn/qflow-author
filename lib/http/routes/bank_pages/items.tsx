import ItemsPage from '../../../../components/item_bank/ItemsPage.tsx';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { enrichmentPageServices } from '../../bank_enrichment.ts';
import { requestErrorResponse } from '../../request_error_response.ts';
import { getTenantSettings } from '../../../services/tenants.ts';
import { listBankCollections } from '../../../services/bank_collections.ts';
import {
  parseQuestionBankFilterForm,
  parseQuestionBankQuery,
  QuestionBankInputError,
  type QuestionBankQueryErrorCode,
} from '../../../services/question_bank_query.ts';
import {
  applyQuestionBankBulkCommand,
  type QuestionBankBulkResult,
} from '../../../services/question_bank_bulk.ts';
import {
  parseQuestionBankBulkForm,
  QuestionBankBulkFormError,
  type QuestionBankBulkFormErrorCode,
} from '../../../services/question_bank_actions.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { hasCapability } from '../../../roles.ts';
import { createI18nPayload } from '../../../i18n/payload.ts';
import type { I18n } from '../../../i18n/messages.ts';

type QuestionBankBulkFailureCode = Extract<QuestionBankBulkResult, { readonly ok: false }>['code'];
type FeedbackToken =
  | `query:${QuestionBankQueryErrorCode}`
  | `form:${QuestionBankBulkFormErrorCode}`
  | `bulk:${QuestionBankBulkFailureCode}`
  | 'unexpected';

const QUERY_ERROR_MESSAGES: Readonly<Record<QuestionBankQueryErrorCode, string>> = {
  invalid_filter: 'items.query.invalid_filter',
  target_required: 'items.query.target_required',
  unsupported_filter: 'items.query.unsupported_filter',
  repeated_filter: 'items.query.repeated_filter',
  invalid_pagination: 'items.query.invalid_pagination',
  invalid_owner: 'items.query.invalid_owner',
  invalid_tags: 'items.query.invalid_tags',
};
const FORM_ERROR_MESSAGES: Readonly<Record<QuestionBankBulkFormErrorCode, string>> = {
  invalid_selection: 'items.bulkForm.invalidSelection',
  invalid_tags: 'items.bulkForm.invalidTags',
  tags_action_mismatch: 'items.bulkForm.tagsActionMismatch',
  owner_action_mismatch: 'items.bulkForm.ownerActionMismatch',
  invalid_owner: 'items.bulkForm.invalidOwner',
  invalid_field_shape: 'items.bulkForm.invalidFieldShape',
  invalid_action: 'items.bulkForm.invalidAction',
  unsupported_fields: 'items.bulkForm.unsupportedFields',
  missing_field: 'items.bulkForm.missingField',
};
const BULK_ERROR_MESSAGES: Readonly<Record<QuestionBankBulkFailureCode, string>> = {
  forbidden: 'items.bulk.forbidden',
  invalid_selection: 'items.bulk.invalid_selection',
  invalid_state: 'items.bulk.invalid_state',
  owner_not_member: 'items.bulk.owner_not_member',
  collection_rejected: 'items.collections.rejected',
};
const QUERY_CODES = Object.keys(QUERY_ERROR_MESSAGES) as readonly QuestionBankQueryErrorCode[];
const FORM_CODES = Object.keys(FORM_ERROR_MESSAGES) as readonly QuestionBankBulkFormErrorCode[];
const BULK_CODES = Object.keys(BULK_ERROR_MESSAGES) as readonly QuestionBankBulkFailureCode[];

/** Translate one allowlisted item-bank feedback token without reflecting arbitrary input. */
export function formatError(i18n: I18n, value: string | null): string | null {
  if (!value) return null;
  if (value === 'unexpected') return i18n.t('items.bulk.unexpected');
  const separator = value.indexOf(':');
  if (separator < 1) return i18n.t('items.bulk.unexpected');
  const source = value.slice(0, separator);
  const code = value.slice(separator + 1);
  if (source === 'query' && isCode(QUERY_CODES, code)) return i18n.t(QUERY_ERROR_MESSAGES[code]);
  if (source === 'form' && isCode(FORM_CODES, code)) return i18n.t(FORM_ERROR_MESSAGES[code]);
  if (source === 'bulk' && isCode(BULK_CODES, code)) return i18n.t(BULK_ERROR_MESSAGES[code]);
  return i18n.t('items.bulk.unexpected');
}

/** Translate one bounded item-bank update token, rejecting malformed counts. */
export function formatNotice(i18n: I18n, value: string | null): string | null {
  if (value === 'collection:updated') return i18n.t('items.collections.updated');
  if (!value || !value.startsWith('updated:')) return null;
  const raw = value.slice('updated:'.length);
  if (!/^[1-9]\d{0,1}$|^100$/.test(raw)) return null;
  const count = Number(raw);
  return i18n.t('items.bulk.updated', { count });
}

function isCode<T extends string>(codes: readonly T[], value: string): value is T {
  return (codes as readonly string[]).includes(value);
}

const methods = {
  async GET(ctx: HttpRequest) {
    try {
      const auth = requireAuthContext(ctx.state);
      const submitted = parseQuestionBankFilterForm(ctx.url.searchParams);
      const query = parseQuestionBankQuery(submitted ?? ctx.url.searchParams);
      if (submitted) {
        return new Response(null, {
          status: 303,
          headers: { location: new URL(`/items?${submitted}`, ctx.url).toString() },
        });
      }
      const i18n = ctx.state.i18n;
      const [collections, page, tenant] = await Promise.all([
        listBankCollections(auth, true),
        enrichmentPageServices(ctx).browse.page(auth, query, {
          locale: ctx.state.interfaceLocale,
          typeLabel: (type) => i18n.t('assessments.builder.questionTypeLabel', { type }),
        }),
        getTenantSettings(auth),
      ]);
      if (!collections.ok) return requestErrorResponse(i18n, 'forbidden', 403);
      if (!tenant) return requestErrorResponse(i18n, 'not_found', 404);
      if (!page.ok) {
        if (page.code === 'invalid_input') {
          throw new QuestionBankInputError('Invalid classification filter.', 'invalid_filter');
        }
        return requestErrorResponse(
          i18n,
          page.code === 'storage_failed' ? 'internal_server_error' : page.code,
          page.code === 'forbidden' ? 403 : page.code === 'not_found' ? 404 : 500,
        );
      }
      return await ctx.render(
        <ItemsPage
          {...page.value}
          bankDisplayName={tenant.bankDisplayName}
          collectionWorkspace={{
            collections: collections.collections,
            operationId: crypto.randomUUID(),
            createId: crypto.randomUUID(),
          }}
          query={query}
          notice={formatNotice(i18n, ctx.url.searchParams.get('notice'))}
          error={formatError(i18n, ctx.url.searchParams.get('error'))}
          canManageContent={hasCapability(auth.role, 'manage_content')}
          i18n={i18n}
          payload={createI18nPayload(ctx.state.interfaceLocale, ctx.state.catalog, ['items'])}
        />,
      );
    } catch (cause: unknown) {
      if (cause instanceof QuestionBankInputError) {
        const url = new URL(ctx.url);
        url.search = '';
        const token: FeedbackToken = `query:${cause.code}`;
        url.searchParams.set('error', token);
        return new Response(null, { status: 303, headers: { location: url.toString() } });
      }
      throw cause;
    }
  },
  async POST(ctx: HttpRequest) {
    const auth = requireAuthContext(ctx.state);
    try {
      const form = await ctx.req.formData();
      const command = parseQuestionBankBulkForm(form);
      const result = await applyQuestionBankBulkCommand(auth, command);
      const url = bankReturnUrl(ctx.url);
      if (result.ok) {
        if (Number.isSafeInteger(result.changed) && result.changed >= 1 && result.changed <= 100) {
          url.searchParams.set(
            'notice',
            command._tag === 'AddToCollection' || command._tag === 'RemoveFromCollection'
              ? 'collection:updated'
              : `updated:${result.changed}`,
          );
        } else {
          url.searchParams.set('error', 'unexpected');
        }
      } else {
        const token: FeedbackToken = `bulk:${result.code}`;
        url.searchParams.set('error', token);
      }
      return new Response(null, { status: 303, headers: { location: url.toString() } });
    } catch (cause: unknown) {
      const url = bankReturnUrl(ctx.url);
      url.searchParams.set(
        'error',
        cause instanceof QuestionBankBulkFormError
          ? (`form:${cause.code}` as FeedbackToken)
          : 'unexpected',
      );
      return new Response(null, { status: 303, headers: { location: url.toString() } });
    }
  },
};

export const itemsRoute = defineHttpRoute('/items', {
  GET: methods.GET,
  HEAD: methods.GET,
  POST: methods.POST,
});

function bankReturnUrl(input: URL): URL {
  const url = new URL('/items', input);
  url.search = input.search;
  url.searchParams.delete('notice');
  url.searchParams.delete('error');
  return url;
}
