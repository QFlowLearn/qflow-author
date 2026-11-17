import { questionOrderPreviewHandlers } from '../../assessment_question_order_preview.ts';
import { defineHttpRoute } from '../../route.ts';
export const questionOrderPreviewApiRoute = defineHttpRoute(
  '/api/assessments/:id/question-order-preview',
  { ...questionOrderPreviewHandlers, HEAD: questionOrderPreviewHandlers.GET },
);
