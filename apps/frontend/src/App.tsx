import { useState } from "react";
import "./index.css";
import Form from "./components/Form";
import Result from "./components/Result";
import InterviewPage from "./components/Interview";
import { Toaster } from "sonner";

export function App() {
  const [page, setPage] = useState<"form" | "interview" | "result">("form");
  const [sessionId, setSessionId] = useState<number | null>(null);

  const handleStart = (id: number) => {
    setSessionId(id);
    setPage("interview");
  };

  return (
    <>
      {page == "form" && <Form onStart={handleStart} />}
      {page == "interview" && sessionId && <InterviewPage sessionId={sessionId} />}
      {page == "result" && <Result />}
      <Toaster />
    </>
  );
}

export default App;
