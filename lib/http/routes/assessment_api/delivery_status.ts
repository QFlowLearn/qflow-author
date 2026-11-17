import { deliveryStatusHandlers } from '../../assessment_status.ts';
import { defineHttpRoute } from '../../route.ts';
export const deliveryStatusApiRoute = defineHttpRoute(
  '/api/assessments/:id/delivery-status',
  { ...deliveryStatusHandlers, HEAD: deliveryStatusHandlers.GET },
);
