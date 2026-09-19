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
  const match = pathname.match(/^\/interview\/(\d+)/);
  return match ? Number(match[1]) : null;
}

function navigate(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function App() {
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname));
  const [sessionId, setSessionId] = useState<number | null>(() => sessionFromPath(window.location.pathname));

  useEffect(() => {
    const handlePopState = () => setPage(pageFromPath(window.location.pathname));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const handleStart = (id: number) => {
    setSessionId(id);
    navigate(`/interview/${id}`);
    setPage("interview");
  };

  return (
    <>
      {page == "landing" && <LandingPage onStart={() => navigate("/onboarding")} />}
      {page == "form" && <Form onStart={handleStart} />}
      {page == "interview" && sessionId && <InterviewPage sessionId={sessionId} onComplete={() => window.history.pushState({}, "", `/result/${sessionId}`)} />}
      {page == "result" && <Result />}
      <Toaster />
    </>
  );
}

export default App;
