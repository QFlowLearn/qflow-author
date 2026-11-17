import { defineHttpRoute } from '../../route.ts';

import { attachmentContentDisposition } from '../../attachment_content_disposition.ts';
import {
  parseAssessmentExportFinalReceiptId,
  unexpectedAssessmentExportResponse,
} from '../../../export/assessment_export_http.ts';
import { findAssessmentExportReceipt } from '../../../export/assessment_export_receipt_store.ts';
import { requireAuthContext } from '../../../tenants.ts';

export const receiptApiRoute = defineHttpRoute(
  '/api/assessments/:id/receipts/:receiptId',
  {
    '*': async (ctx) => {
      const parsedReceiptId = parseAssessmentExportFinalReceiptId(ctx.params.receiptId ?? null);
      if (!parsedReceiptId.ok) {
        return Response.json(parsedReceiptId.body, { status: 400 });
      }
      const result = await findAssessmentExportReceipt(
        requireAuthContext(ctx.state),
        ctx.params.id,
        parsedReceiptId.receiptId,
      );
      if (!result.ok) {
        if (result.error._tag === 'ReceiptNotFound') {
          return Response.json(
            { error: 'ReceiptNotFound', message: 'Export receipt not found.' },
            { status: 404 },
          );
        }
        return unexpectedAssessmentExportResponse(result.error.cause, {
          assessmentId: ctx.params.id,
          operation: 'receipt',
        });
      }
      return new Response(result.document, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': attachmentContentDisposition(
            `assessment-${ctx.params.id}-export-receipt.json`,
          ),
          'cache-control': 'private, immutable',
        },
      });
    },
  },
);
