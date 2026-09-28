import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { EvaluationScreen, type EvaluationReport } from "./Interview";

export default function Result({
  sessionId,
  onStartNew,
}: {
  sessionId?: number | null;
  onStartNew?: () => void;
}) {
  const [evaluation, setEvaluation] = useState<EvaluationReport | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setEvaluation(null);
      return;
    }

    try {
      const raw = sessionStorage.getItem(`interview-evaluation-${sessionId}`);
      if (!raw) {
        setEvaluation(null);
        return;
      }

      const parsed = JSON.parse(raw) as EvaluationReport;
      setEvaluation(parsed);
    } catch {
      setEvaluation(null);
    }
  }, [sessionId]);

  if (!evaluation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-foreground">No evaluation found</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            This interview result was not saved in this browser session. Start a new interview to generate one.
          </p>
          <Button className="mt-6 w-full" onClick={onStartNew ?? (() => window.location.href = "/onboarding")}>
            Start interview
          </Button>
        </div>
      </div>
    );
  }

  return <EvaluationScreen evaluation={evaluation} />;
}