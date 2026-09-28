import { useEffect, useState } from "react";
import "./index.css";
import Form from "./components/Form";
import Result from "./components/Result";
import InterviewPage from "./components/Interview";
import LandingPage from "./components/LandingPage";
import { Toaster } from "sonner";

type Page = "landing" | "form" | "interview" | "result";

function pageFromPath(pathname: string): Page {
  if (pathname === "/onboarding") return "form";
  if (pathname.startsWith("/interview/")) return "interview";
  if (pathname.startsWith("/result/")) return "result";
  return "landing";
}

function sessionFromPath(pathname: string): number | null {
  const match = pathname.match(/^\/(?:interview|result)\/(\d+)/);
  return match ? Number(match[1]) : null;
}

function navigate(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function hasStoredEvaluation(sessionId: number | null): boolean {
  if (!sessionId) return false;
  try {
    return Boolean(sessionStorage.getItem(`interview-evaluation-${sessionId}`));
  } catch {
    return false;
  }
}

export function App() {
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname));
  const [sessionId, setSessionId] = useState<number | null>(() => sessionFromPath(window.location.pathname));

  useEffect(() => {
    const handlePopState = () => {
      const nextPath = window.location.pathname;
      setPage(pageFromPath(nextPath));
      setSessionId(sessionFromPath(nextPath));
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const handleStart = (id?: number) => {
    if (typeof id === "number") {
      setSessionId(id);
      navigate(`/interview/${id}`);
      setPage("interview");
      return;
    }

    navigate("/onboarding");
    setPage("form");
  };

  const shouldShowStoredResult = page === "interview" && hasStoredEvaluation(sessionId);

  return (
    <>
      {page == "landing" && <LandingPage onStart={() => navigate("/onboarding")} />}
      {page == "form" && <Form onStart={handleStart} />}
      {(page == "interview" && sessionId && !shouldShowStoredResult) && (
        <InterviewPage sessionId={sessionId} onComplete={() => navigate(`/result/${sessionId}`)} />
      )}
      {(page == "interview" && sessionId && shouldShowStoredResult) && (
        <Result sessionId={sessionId} onStartNew={() => navigate("/onboarding")} />
      )}
      {page == "result" && sessionId && <Result sessionId={sessionId} onStartNew={() => navigate("/onboarding")} />}
      <Toaster />
    </>
  );
}

export default App;
