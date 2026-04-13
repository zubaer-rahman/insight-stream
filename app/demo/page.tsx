import { ResearchTerminal } from "@/app/_components/research-terminal";

const DEMO_COMPANY = "Tesla";
const DEMO_CLAIM =
  "Evaluate Tesla AI Infrastructure strategy, compute capacity trajectory, and near-term execution risk.";

export default function RecruiterDemoPage() {
  return (
    <ResearchTerminal
      initialCompanyName={DEMO_COMPANY}
      initialClaim={DEMO_CLAIM}
      isRecruiterDemo
    />
  );
}
