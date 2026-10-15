import { createFileRoute } from "@tanstack/react-router";
import { AssessmentApp } from "@/components/neuro/AssessmentApp";

export const Route = createFileRoute("/assess")({
  head: () => ({
    meta: [
      { title: "Assessment — NeuroGait AI" },
      { name: "description", content: "Run motor, voice and eye-movement screening tasks with on-device analysis." },
      { property: "og:title", content: "Assessment — NeuroGait AI" },
      { property: "og:description", content: "Structured multimodal screening tasks with live quality control." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AssessmentApp,
});
