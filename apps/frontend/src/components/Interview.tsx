import { useState, useEffect, useRef } from "react";
import { BACKEND_URL } from "../lib/config";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { 
  Send, 
  Bot, 
  User, 
  Trophy, 
  CheckCircle2, 
  AlertTriangle, 
  Sparkles, 
  RefreshCw,
  AlertCircle,
  MessageSquareCode,
  Target,
  BrainCircuit,
  MessagesSquare,
  Layers3
} from "lucide-react";

interface Message {
  id: string;
  role: "system" | "user";
  content: string;
}

interface QuestionFeedback {
  questionNumber: number;
  question: string;
  userResponse: string;
  feedback: string;
}

interface EvaluationReport {
  score: number;
  rating?: "Excellent" | "Strong" | "Developing" | "Needs Improvement";
  categoryScores?: {
    technicalAccuracy: number;
    problemSolving: number;
    communication: number;
    depth: number;
  };
  answeredCount?: number;
  totalQuestions?: number;
  strengths: string[];
  improvements: string[];
  detailedFeedback?: string;
  questionBreakdown?: QuestionFeedback[];
  summary: string;
}

export default function InterviewPage({ sessionId }: { sessionId: number }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentQuestionId, setCurrentQuestionId] = useState<number | null>(null);
  const [questionNumber, setQuestionNumber] = useState<number>(1);
  const [isFinished, setIsFinished] = useState<boolean>(false);
  const [evaluation, setEvaluation] = useState<EvaluationReport | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const socketCleanupTimerRef = useRef<number | null>(null);
  const intentionalCloseRef = useRef(false);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isFinished]);

  useEffect(() => {
    if (sessionId) {
      if (socketCleanupTimerRef.current !== null) {
        window.clearTimeout(socketCleanupTimerRef.current);
        socketCleanupTimerRef.current = null;
      }

      if (socketRef.current) {
        return () => {
          socketCleanupTimerRef.current = window.setTimeout(() => {
            socketRef.current?.close();
            socketRef.current = null;
            socketCleanupTimerRef.current = null;
          }, 0);
        };
      }

      setIsLoading(true);
      const socketUrl = `${BACKEND_URL.replace(/^http/, "ws")}/ws/interview`;
      const socket = new WebSocket(socketUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        socket.send(JSON.stringify({ type: "start", sessionId }));
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as {
          type: "question" | "completed" | "error";
          question?: { id: number; question: string; questionNumber: number };
          questionNumber?: number;
          evaluation?: EvaluationReport;
          message?: string;
        };

        if (message.type === "question" && message.question) {
          setCurrentQuestionId(message.question.id);
          setQuestionNumber(message.question.questionNumber || message.questionNumber || 1);
          setMessages((previousMessages) => {
            if (previousMessages.some((item) => item.id === message.question!.id.toString())) {
              return previousMessages;
            }
            return [...previousMessages, {
              id: message.question!.id.toString(),
              role: "system",
              content: message.question!.question,
            }];
          });
          setIsLoading(false);
        } else if (message.type === "completed") {
          setIsFinished(true);
          setEvaluation(message.evaluation ?? null);
          setIsLoading(false);
          intentionalCloseRef.current = true;
          socket.close();
        } else if (message.type === "error") {
          toast.error(message.message || "Interview connection failed");
          setIsLoading(false);
        }
      };

      socket.onerror = () => {
        toast.error("Interview connection failed");
        setIsLoading(false);
      };

      socket.onclose = () => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        if (!intentionalCloseRef.current && !isFinished) {
          toast.error("Interview connection closed unexpectedly");
        }
      };

      return () => {
        socketCleanupTimerRef.current = window.setTimeout(() => {
          if (socketRef.current === socket) {
            socket.close();
            socketRef.current = null;
          }
          socketCleanupTimerRef.current = null;
        }, 0);
      };
    }
  }, [sessionId]);

  const handleSend = async () => {
    if (!inputValue.trim() || !currentQuestionId || isFinished || isLoading) return;

    const answerText = inputValue.trim();
    setInputValue("");
    
    // Add user message to UI immediately
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: "user",
        content: answerText,
      },
    ]);

    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      toast.error("Interview connection is not ready");
      return;
    }

    setCurrentQuestionId(null);
    setIsLoading(true);
    socketRef.current.send(JSON.stringify({
      type: "answer",
      questionId: currentQuestionId,
      answer: answerText,
    }));
  };

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto p-4 md:p-8">
      <div className="flex-1 bg-card rounded-2xl shadow-sm border overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-muted/50 p-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Bot className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">AI Technical Interviewer</h2>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${isFinished ? "bg-blue-500" : "bg-green-500 animate-pulse"}`}></span>
                {isFinished ? "Completed" : "Active Session"}
              </p>
            </div>
          </div>

          {/* Progress Counter */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              {isFinished ? "Completed" : `Question ${questionNumber} of 5`}
            </span>
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {messages.length === 0 && isLoading && (
            <div className="flex justify-center items-center h-full text-muted-foreground">
              Preparing your interview...
            </div>
          )}
          
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 max-w-[85%] ${
                msg.role === "user" ? "ml-auto flex-row-reverse" : ""
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                {msg.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>
              <div
                className={`p-3 rounded-2xl ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-tr-none"
                    : "bg-muted text-foreground rounded-tl-none"
                }`}
              >
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
              </div>
            </div>
          ))}

          {isLoading && currentQuestionId === null && !isFinished && messages.length > 0 && (
            <div className="flex gap-3 max-w-[85%]">
              <div className="w-8 h-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="p-4 rounded-2xl bg-muted text-foreground rounded-tl-none flex items-center gap-1.5">
                <div className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce"></div>
              </div>
            </div>
          )}

          {/* Evaluation Report Card when interview isFinished */}
          {isFinished && (
            <div className="mt-6 p-6 rounded-2xl bg-card border border-border shadow-lg space-y-6">
              {/* Overall Score Badge Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border border-primary/20">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-primary text-primary-foreground shadow-md">
                    <Trophy className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-foreground">Candidate Evaluation Report</h3>
                    <p className="text-xs text-muted-foreground">Comprehensive performance & mistake assessment</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 self-start sm:self-auto bg-background px-4 py-3 rounded-xl border shadow-sm">
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Overall score</p>
                    <p className="text-2xl font-extrabold text-emerald-600">{evaluation?.score ?? 0}<span className="text-sm font-semibold text-muted-foreground">/100</span></p>
                  </div>
                  <div className="h-10 w-px bg-border" />
                  <div>
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Rating</p>
                    <p className="text-sm font-bold text-primary">{evaluation?.rating ?? "Developing"}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: "Technical accuracy", value: evaluation?.categoryScores?.technicalAccuracy ?? evaluation?.score ?? 0, icon: Target, color: "text-blue-600", bar: "bg-blue-500" },
                  { label: "Problem solving", value: evaluation?.categoryScores?.problemSolving ?? evaluation?.score ?? 0, icon: BrainCircuit, color: "text-violet-600", bar: "bg-violet-500" },
                  { label: "Communication", value: evaluation?.categoryScores?.communication ?? evaluation?.score ?? 0, icon: MessagesSquare, color: "text-emerald-600", bar: "bg-emerald-500" },
                  { label: "Depth", value: evaluation?.categoryScores?.depth ?? evaluation?.score ?? 0, icon: Layers3, color: "text-amber-600", bar: "bg-amber-500" },
                ].map((category) => {
                  const Icon = category.icon;
                  return (
                    <div key={category.label} className="rounded-xl border bg-background p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`flex items-center gap-1.5 text-[11px] font-semibold ${category.color}`}>
                          <Icon className="w-3.5 h-3.5" />
                          {category.label}
                        </span>
                        <span className="text-xs font-bold text-foreground">{category.value}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full ${category.bar}`} style={{ width: `${Math.min(100, Math.max(0, category.value))}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                <span><strong className="text-foreground">{evaluation?.answeredCount ?? messages.filter((message) => message.role === "user").length}</strong> answers submitted</span>
                <span><strong className="text-foreground">{evaluation?.totalQuestions ?? 5}</strong> questions assessed</span>
                <span>Rating is based on accuracy, reasoning, communication, and depth</span>
              </div>

              {/* Strengths & Improvements */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Key Strengths */}
                <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 space-y-3">
                  <div className="flex items-center gap-2 text-emerald-600 font-semibold text-sm">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Key Strengths</span>
                  </div>
                  <ul className="space-y-2">
                    {(evaluation?.strengths ?? [
                      "Demonstrated good baseline technical knowledge.",
                      "Communicated key architectural ideas."
                    ]).map((strength, index) => (
                      <li key={index} className="text-xs text-foreground/90 flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                        <span>{strength}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Areas for Improvement */}
                <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-3">
                  <div className="flex items-center gap-2 text-amber-600 font-semibold text-sm">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Areas to Fix & Improve</span>
                  </div>
                  <ul className="space-y-2">
                    {(evaluation?.improvements ?? [
                      "Provide more explicit detail on edge-case handling and error boundaries.",
                      "Include concrete code examples and quantitative metrics."
                    ]).map((item, index) => (
                      <li key={index} className="text-xs text-foreground/90 flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Detailed Constructive Critique & Mistakes */}
              {evaluation?.detailedFeedback && (
                <div className="p-4 rounded-xl bg-rose-500/5 border border-rose-500/20 space-y-2">
                  <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-semibold text-sm">
                    <AlertCircle className="w-4 h-4" />
                    <span>Mistakes & Detailed Candidate Critique</span>
                  </div>
                  <p className="text-xs leading-relaxed text-foreground/90">
                    {evaluation.detailedFeedback}
                  </p>
                </div>
              )}

              {/* Question-by-Question Detailed Feedback */}
              {evaluation?.questionBreakdown && evaluation.questionBreakdown.length > 0 && (
                <div className="space-y-4 border-t pt-6">
                  <div className="flex items-center gap-2 text-foreground font-bold text-base">
                    <MessageSquareCode className="w-5 h-5 text-primary" />
                    <span>Question-by-Question Analysis & Critique</span>
                  </div>
                  <div className="space-y-4">
                    {evaluation.questionBreakdown.map((item, idx) => (
                      <div key={idx} className="p-4 rounded-xl bg-muted/30 border space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-primary/10 text-primary">
                            Question #{item.questionNumber || idx + 1}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-foreground">
                          {item.question}
                        </p>
                        <div className="p-3 rounded-lg bg-background border text-xs text-muted-foreground italic">
                          <span className="font-semibold not-italic block text-[11px] text-muted-foreground/70 mb-1">Your Response:</span>
                          "{item.userResponse || "No answer provided."}"
                        </div>
                        <div className="p-3 rounded-lg bg-rose-500/5 border border-rose-500/20 space-y-1">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>AI Feedback & What to Improve</span>
                          </div>
                          <p className="text-xs text-foreground/90 leading-relaxed">
                            {item.feedback}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Executive Summary */}
              <div className="p-4 rounded-xl bg-muted/50 border space-y-2">
                <div className="flex items-center gap-2 text-foreground font-semibold text-sm">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <span>Executive Summary & Recommendation</span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {evaluation?.summary ?? "The candidate completed the technical interview session."}
                </p>
              </div>

              <div className="flex justify-end">
                <Button onClick={() => window.location.reload()} className="gap-2">
                  <RefreshCw className="w-4 h-4" />
                  Restart Interview
                </Button>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        {!isFinished ? (
          <div className="p-4 bg-background border-t">
            <div className="flex items-end gap-2 max-w-3xl mx-auto relative">
              <textarea
                className="flex min-h-[60px] max-h-[200px] w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none pr-14"
                placeholder="Type your answer..."
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  // Auto-resize
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                disabled={isLoading || currentQuestionId === null}
                rows={1}
              />
              <Button 
                size="icon" 
                className="absolute right-2 bottom-2 rounded-xl h-10 w-10 transition-transform active:scale-95" 
                onClick={handleSend}
                disabled={isLoading || !inputValue.trim() || currentQuestionId === null}
              >
                <Send className="w-4 h-4 ml-0.5" />
              </Button>
            </div>
            <p className="text-center text-[10px] text-muted-foreground mt-2">
              Press Enter to send, Shift + Enter for new line. AI can make mistakes.
            </p>
          </div>
        ) : (
          <div className="p-4 bg-muted/40 border-t text-center">
            <p className="text-xs font-medium text-muted-foreground">
              Interview Completed • Chat Input Disabled
            </p>
          </div>
        )}
      </div>
    </div>
  );
}