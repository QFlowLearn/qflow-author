import { defineHttpRoute } from '../../route.ts';
import {
  printConfirmHttp,
  printCreateHttp,
  printDownloadHttp,
  printListHttp,
  printPreflightHttp,
  printStatusHttp,
} from '../../assessment_print.ts';

export const printPackRoutes = [
  defineHttpRoute('/api/assessments/:id/print-packs/preflight', { POST: printPreflightHttp }),
  defineHttpRoute('/api/assessments/:id/print-packs', {
    GET: printListHttp,
    POST: printCreateHttp,
  }),
  defineHttpRoute('/api/assessments/:id/print-packs/:packId', { GET: printStatusHttp }),
  defineHttpRoute('/api/assessments/:id/print-packs/:packId/confirm', { POST: printConfirmHttp }),
  defineHttpRoute('/api/assessments/:id/print-packs/:packId/preview/student', {
    GET: printDownloadHttp('student', true),
  }),
  defineHttpRoute('/api/assessments/:id/print-packs/:packId/preview/marking', {
    GET: printDownloadHttp('marking', true),
  }),
  defineHttpRoute('/api/assessments/:id/print-packs/:packId/student', {
    GET: printDownloadHttp('student', false),
  }),
  defineHttpRoute('/api/assessments/:id/print-packs/:packId/marking', {
    GET: printDownloadHttp('marking', false),
  }),
  defineHttpRoute('/api/assessments/:id/print-packs/:packId/manifest', {
    GET: printDownloadHttp('manifest', false),
  }),
];
