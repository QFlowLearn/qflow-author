/** Builds the real assessment island fixture used by authoring interaction tests. */
export function browserEntrySource(payload: string, playerCatalog: string): string {
  return `
import { render } from "preact";
import AssessmentBuilder from "../islands/AssessmentBuilder.tsx";
import { ASSESSMENT_TOOL_IDS } from "../lib/assessment_authoring_tool.ts";
import { collectQuestionReviewSuggestions } from "../lib/question_review.ts";

const params = new URLSearchParams(location.search);
const requestedTool = params.get("tool");
const populated = params.get("fixture") === "populated";
const activeTool = requestedTool === ASSESSMENT_TOOL_IDS.plan
  ? ASSESSMENT_TOOL_IDS.plan
  : requestedTool === ASSESSMENT_TOOL_IDS.export
  ? ASSESSMENT_TOOL_IDS.export
  : null;
const assessment = {
  id: "assessment-1",
  title: "Deferred authoring test",
  parts: [{
    id: "77777777-7777-4777-8777-777777777777",
    title: "Questions",
    placements: populated
      ? [{ id: "22222222-2222-4222-8222-222222222222", itemId: "11111111-1111-4111-8111-111111111111", snapshotRev: 1 }]
      : [],
  }],
  blueprint: { _tag: "Unspecified", version: 1 },
};
if (params.has("multipart")) {
  assessment.parts.push({ id: "88888888-8888-4888-8888-888888888888", title: "Second part", placements: [] });
}
const items = populated
  ? {
    "22222222-2222-4222-8222-222222222222": {
      id: "22222222-2222-4222-8222-222222222222",
      itemId: "11111111-1111-4111-8111-111111111111",
      title: "Capital of France",
      latestRev: 1,
      questionTypeId: "single_select",
      questionType: "Single Select",
      preview: {
        bodyHtml: "<p>What is the capital of France?</p>",
        choices: [{ id: "A", text: "Paris" }, { id: "B", text: "Paris" }],
      },
      reviewSuggestions: collectQuestionReviewSuggestions({
        type: "single_select", itemLanguage: "en-US",
        bodyHtml: "<p>What is the capital of France?</p>",
        choices: [{ id: "A", text: "Paris" }, { id: "B", text: "Paris" }],
        correctId: "A",
      }),
    },
  }
  : {};
if (params.has("many")) {
  const original = assessment.parts[0].placements[0];
  for (let index = 2; index <= 7; index++) {
    const id = "finding-placement-" + index;
    assessment.parts[0].placements.push({ ...original, id });
    items[id] = { ...items[original.id], id };
  }
}
if (params.has("duplicate")) {
  const original = assessment.parts[0].placements[0];
  const last = "55555555-5555-4555-8555-555555555555";
  assessment.parts[0].placements.push({ ...original, id: last });
  items[last] = { ...items[original.id], id: last };
  if (params.has("multipart")) {
    const other = "66666666-6666-4666-8666-666666666666";
    assessment.parts[1].placements.push({ ...original, id: other });
    items[other] = { ...items[original.id], id: other };
  }
}
const props = activeTool === ASSESSMENT_TOOL_IDS.export
  ? {
    activeTool,
    deliveryCapability: {
      enabled: params.has("delivery"),
      status: params.has("delivery") ? "configured" : "not_configured",
      message: "Delivery is not configured for this test.",
    },
  }
  : { activeTool };

render(
  <AssessmentBuilder
    authoringPreferences={[]}
    instructorDefaults={null}
    assessmentQuestionPointDefault={null}
    placementRemovalHistory={{ ok: true, value: [] }}
    a={assessment}
    items={items}
    choiceRichText={false}
    payload={${payload}}
    playerCatalog={${playerCatalog}}
    {...props}
  />,
  document.getElementById("root"),
);
`;
}
