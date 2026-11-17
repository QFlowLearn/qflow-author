import { publicationStatusHandlers } from '../../assessment_status.ts';
import { defineHttpRoute } from '../../route.ts';
export const publicationStatusApiRoute = defineHttpRoute(
  '/api/assessments/:id/publication-status',
  { ...publicationStatusHandlers, HEAD: publicationStatusHandlers.GET },
);
