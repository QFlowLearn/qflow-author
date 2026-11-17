import { getDb } from '../db.ts';
import { randomQuestionIndex } from '../bank_question_sampling.ts';
import { AssessmentAdaptivePlans } from '../services/assessment_adaptive_plans.ts';
import { AssessmentAdaptiveRead } from '../services/assessment_adaptive_read.ts';
import type { HttpRequest } from './route.ts';

/** Compose adaptive authoring services with the request database and production sampler. */
export function adaptiveAssessmentServices(ctx: HttpRequest) {
  const database = getDb(ctx);
  return {
    plans: new AssessmentAdaptivePlans(database, randomQuestionIndex),
    read: new AssessmentAdaptiveRead(database),
  };
}
