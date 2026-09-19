import { useState, useEffect, useRef, useCallback } from "react";
import { BACKEND_URL } from "../lib/config";
import { toast } from "sonner";
import {
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
  Layers3,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import LatticeLoader from "./ui/LatticeLoader";

// ─── Types ────────────────────────────────────────────────────────────────────

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

export interface ChatMessage {
  id: string;
  role: "ai" | "user";
  text: string;
}

type InterviewPhase =
  | "connecting"      // setting up WS + fetching Deepgram key
  | "ai-speaking"     // AI audio is playing
  | "user-listening"  // microphone is ready for the candidate
  | "user-speaking"   // candidate speech is streaming to Deepgram
  | "processing"      // answer sent, waiting for next question
  | "completed";      // interview done

const SILENCE_TIMEOUT_MS = 4000;
const MIN_ANSWER_CHARS = 2;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function base64ToAudioBuffer(
  base64: string,
  ctx: AudioContext
): Promise<AudioBuffer> {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return ctx.decodeAudioData(bytes.buffer);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function InterviewPage({ sessionId }: { sessionId: number }) {
  // ── State ──
  const [phase, setPhase] = useState<InterviewPhase>("connecting");
  const [aiText, setAiText] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [userTranscript, setUserTranscript] = useState(""); // live interim
  const [finalTranscript, setFinalTranscript] = useState(""); // confirmed final
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, userTranscript, finalTranscript]);
  const [questionNumber, setQuestionNumber] = useState(1);
  const [isFinished, setIsFinished] = useState(false);
  const [evaluation, setEvaluation] = useState<EvaluationReport | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [aiAmplitude, setAiAmplitude] = useState(0); // 0–1 for ring animation

  // ── Refs ──
  const socketRef = useRef<WebSocket | null>(null);
  const deepgramRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const currentQuestionIdRef = useRef<number | null>(null);
  const intentionalCloseRef = useRef(false);
  const finalTranscriptRef = useRef(""); // keep in sync for callbacks
  const userTranscriptRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSubmittingAnswerRef = useRef(false);
  const interviewConnectionErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interviewConnectedRef = useRef(false);

  // ── Audio context (lazy) ──
  function getAudioContext(): AudioContext {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }

  // ── Amplitude animation loop ──
  const startAmplitudeLoop = useCallback((analyser: AnalyserNode) => {
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += Math.abs(v - 128);
      setAiAmplitude(Math.min(1, (sum / data.length) * 0.08));
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
  }, []);

  const stopAmplitudeLoop = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    setAiAmplitude(0);
  }, []);

  // ── Play AI audio ──
  const playAudio = useCallback(
    async (base64: string) => {
      const ctx = getAudioContext();
      if (ctx.state === "suspended") await ctx.resume();

      // Stop any existing playback
      sourceNodeRef.current?.stop();
      sourceNodeRef.current?.disconnect();

      try {
        const audioBuffer = await base64ToAudioBuffer(base64, ctx);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;

        source.connect(analyser);
        analyser.connect(ctx.destination);

        sourceNodeRef.current = source;
        source.start();
        startAmplitudeLoop(analyser);

        source.onended = () => {
          stopAmplitudeLoop();
          setPhase("user-listening");
          startDeepgram().catch((error: Error) => toast.error(error.message));
        };
      } catch (e) {
        console.error("Audio playback error:", e);
        stopAmplitudeLoop();
        setPhase("user-listening");
        startDeepgram().catch((error: Error) => toast.error(error.message));
      }
    },
    [startAmplitudeLoop, stopAmplitudeLoop]
  );

  // ── Deepgram STT ──
  const startDeepgram = useCallback(async () => {
    if (deepgramRef.current || mediaRecorderRef.current) return;

    const tokenResponse = await fetch(`${BACKEND_URL}/api/v1/interview/stt-token`);
    if (!tokenResponse.ok) {
      const errorData = (await tokenResponse.json().catch(() => ({}))) as { error?: string };
      throw new Error(errorData.error ?? "Could not get speech recognition token");
    }
    const tokenData = (await tokenResponse.json()) as { token?: string };
    if (!tokenData.token) throw new Error("Speech recognition token is missing");

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;

    const dgSocket = new WebSocket(
      `wss://api.deepgram.com/v1/listen?model=nova-3&language=en&interim_results=true&punctuate=true&endpointing=${SILENCE_TIMEOUT_MS}&utterance_end_ms=${SILENCE_TIMEOUT_MS}&vad_events=true`,
      ["token", tokenData.token]
    );
    deepgramRef.current = dgSocket;

    dgSocket.onopen = () => {
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (dgSocket.readyState === WebSocket.OPEN && e.data.size > 0) {
          dgSocket.send(e.data);
        }
      };
      recorder.start(250);
    };

    dgSocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as {
          type: string;
          is_final: boolean;
          speech_final?: boolean;
          channel?: { alternatives?: { transcript: string }[] };
        };
        if (data.type === "Results") {
          const transcript = data.channel?.alternatives?.[0]?.transcript ?? "";
          if (transcript.trim()) {
            setPhase("user-speaking");
            scheduleSilenceSubmit();
          }
          if (data.is_final && transcript.trim()) {
            finalTranscriptRef.current = (finalTranscriptRef.current + " " + transcript).trim();
            setFinalTranscript(finalTranscriptRef.current);
            userTranscriptRef.current = "";
            setUserTranscript("");
          } else if (transcript.trim()) {
            userTranscriptRef.current = transcript;
            setUserTranscript(transcript);
          }
        } else if (data.type === "UtteranceEnd") {
          scheduleSilenceSubmit();
        }
      } catch {}
    };

    dgSocket.onerror = () => toast.error("Speech recognition connection failed");
    dgSocket.onclose = () => {
      deepgramRef.current = null;
      mediaRecorderRef.current = null;
    };
  }, []);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
  }, []);

  const scheduleSilenceSubmit = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      sendAnswer();
    }, SILENCE_TIMEOUT_MS);
  }, [clearSilenceTimer]);

  const stopDeepgram = useCallback(() => {
    clearSilenceTimer();
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    deepgramRef.current?.close();
    deepgramRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  }, [clearSilenceTimer]);

  // ── Send answer ──
  const sendAnswer = useCallback(() => {
    if (isSubmittingAnswerRef.current) return;
    const answer = (finalTranscriptRef.current || userTranscriptRef.current).trim();

    // Always stop the microphone first, even if transcription is still interim.
    stopDeepgram();

    if (answer.length < MIN_ANSWER_CHARS || !currentQuestionIdRef.current) {
      setPhase("user-listening");
      return;
    }
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      toast.error("Connection lost");
      return;
    }

    isSubmittingAnswerRef.current = true;
    
    setChatMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), role: "user", text: answer },
    ]);

    setUserTranscript("");
    setFinalTranscript("");
    finalTranscriptRef.current = "";
    userTranscriptRef.current = "";
    setPhase("processing");
    setAiText("");

    socketRef.current.send(
      JSON.stringify({
        type: "answer",
        questionId: currentQuestionIdRef.current,
        answer,
      })
    );
    currentQuestionIdRef.current = null;
    isSubmittingAnswerRef.current = false;
  }, [stopDeepgram]);

  // ── Interview WebSocket ──
  useEffect(() => {
    if (!sessionId) return;

    const socketUrl = `${BACKEND_URL.replace(/^http/, "ws")}/ws/interview`;
    const socket = new WebSocket(socketUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      interviewConnectedRef.current = true;
      if (interviewConnectionErrorTimerRef.current) {
        clearTimeout(interviewConnectionErrorTimerRef.current);
        interviewConnectionErrorTimerRef.current = null;
      }
      socket.send(JSON.stringify({ type: "start", sessionId }));
    };

    socket.onmessage = async (event) => {
      const message = JSON.parse(event.data as string) as {
        type: "question" | "completed" | "error";
        question?: { id: number; question: string; questionNumber: number };
        questionNumber?: number;
        audioBase64?: string | null;
        evaluation?: EvaluationReport;
        message?: string;
      };

      if (message.type === "question" && message.question) {
        isSubmittingAnswerRef.current = false;
        currentQuestionIdRef.current = message.question.id;
        setQuestionNumber(message.question.questionNumber ?? message.questionNumber ?? 1);
        setAiText(message.question.question);
        
        setChatMessages((prev) => [
          ...prev,
          { id: message.question!.id.toString() + "-" + Date.now(), role: "ai", text: message.question!.question },
        ]);

        setPhase("ai-speaking");

        if (message.audioBase64 && !isMuted) {
          await playAudio(message.audioBase64);
        } else {
          // No audio — skip straight to listening
          setPhase("user-listening");
          startDeepgram().catch(() => {
            setPhase("user-listening");
            toast.error("Could not access microphone");
          });
        }
      } else if (message.type === "completed") {
        setIsFinished(true);
        setEvaluation(message.evaluation ?? null);
        setPhase("completed");
        intentionalCloseRef.current = true;
        socket.close();
      } else if (message.type === "error") {
        toast.error(message.message ?? "Interview connection failed");
      }
    };

    socket.onerror = () => {
      if (interviewConnectedRef.current || interviewConnectionErrorTimerRef.current) return;

      interviewConnectionErrorTimerRef.current = setTimeout(() => {
        interviewConnectionErrorTimerRef.current = null;
        if (!interviewConnectedRef.current && !intentionalCloseRef.current) {
          toast.error("Interview connection failed");
        }
      }, 3000);
    };
    socket.onclose = () => {
      if (!intentionalCloseRef.current && interviewConnectedRef.current) {
        toast.error("Interview connection closed unexpectedly");
      }
    };

    return () => {
      intentionalCloseRef.current = true;
      socket.close();
      if (interviewConnectionErrorTimerRef.current) {
        clearTimeout(interviewConnectionErrorTimerRef.current);
        interviewConnectionErrorTimerRef.current = null;
      }
      stopDeepgram();
      sourceNodeRef.current?.stop();
      stopAmplitudeLoop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ─── Mute toggle stops current playback ──
  const toggleMute = () => {
    setIsMuted((m) => {
      if (!m) {
        // muting — stop playback
        sourceNodeRef.current?.stop();
        stopAmplitudeLoop();
        if (phase === "ai-speaking") setPhase("user-listening");
      }
      return !m;
    });
  };

  // ─── Ring scale derived from amplitude ──
  const ringScale = 1 + aiAmplitude * 0.6;

  // ─── Render: Completed ─────────────────────────────────────────────────────
  if (isFinished && evaluation) {
    return <EvaluationScreen evaluation={evaluation} />;
  }

  // ─── Render: Voice Room ────────────────────────────────────────────────────
  const phaseLabel = {
    connecting: "Connecting…",
    "ai-speaking": "AI Interviewer is speaking",
    "user-listening": "Listening for your answer…",
    "user-speaking": "Listening… pause for 4 seconds to submit",
    processing: "Processing your answer…",
    completed: "Interview complete",
  }[phase];

  return (
    <div className="fixed inset-0 w-full h-screen flex flex-col bg-background font-sans overflow-hidden">
      {/* Top bar */}
      <header className="flex-none flex items-center justify-between p-4 bg-background/90 backdrop-blur-md border-b z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${phase === "completed" ? "bg-blue-500" : "bg-green-500 animate-pulse"}`} />
          <span className="text-sm font-semibold text-foreground tracking-wide">AI Technical Interviewer</span>
        </div>
        <div className="absolute left-1/2 -translate-x-1/2">
          <Badge variant="secondary" className="px-4 py-1.5 text-xs font-bold tracking-wide">
            {isFinished ? "Completed" : `Question ${questionNumber} / 5`}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full bg-muted hover:bg-muted/80 text-muted-foreground"
            onClick={toggleMute}
            title={isMuted ? "Unmute AI" : "Mute AI"}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </Button>
        </div>
      </header>

      {/* Chat area */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-8 flex flex-col gap-6">
        <div className="max-w-3xl w-full mx-auto flex flex-col gap-6 pb-32">
          {chatMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex w-full ${msg.role === "ai" ? "justify-start" : "justify-end"}`}
            >
              <div
                className={`max-w-[85%] px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed shadow-sm ${
                  msg.role === "ai"
                    ? "bg-muted/80 text-foreground rounded-tl-sm border"
                    : "bg-blue-500 text-white rounded-tr-sm"
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}

          {/* Live interim user transcript bubble */}
          {(userTranscript || finalTranscript) && (
            <div className="flex w-full justify-end">
              <div className="max-w-[85%] px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed shadow-sm bg-blue-500/80 text-white rounded-tr-sm">
                {finalTranscript}
                {userTranscript && (
                  <span className="italic opacity-80"> {userTranscript}</span>
                )}
                <span className="ml-2 w-1.5 h-1.5 bg-white/70 rounded-full inline-block animate-pulse" />
              </div>
            </div>
          )}
          
          <div ref={chatEndRef} />
        </div>
      </main>

      {/* Bottom status bar */}
      <footer className="absolute bottom-0 left-0 right-0 flex justify-center p-6 bg-gradient-to-t from-background via-background/90 to-transparent pointer-events-none">
        <div className="bg-background/80 backdrop-blur-md border px-4 py-2 rounded-full shadow-sm flex items-center gap-3">
          {phase === "ai-speaking" && <Volume2 className="w-4 h-4 text-primary animate-pulse" />}
          {(phase === "connecting" || phase === "processing") && <LatticeLoader label={phase === "connecting" ? "Connecting" : "Processing"} showTimer={false} fontSize={12} color="hsl(var(--muted-foreground))" />}
          {phase === "user-speaking" && <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
          {phase === "user-listening" && <div className="w-2 h-2 rounded-full bg-green-500" />}
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{phaseLabel}</p>
        </div>
      </footer>
    </div>
  );
}

// ─── Evaluation Screen ─────────────────────────────────────────────────────────

function EvaluationScreen({ evaluation }: { evaluation: EvaluationReport }) {
  return (
    <div className="min-h-screen bg-background p-6 pb-20 overflow-y-auto font-sans">
      <div className="max-w-4xl mx-auto flex flex-col gap-6">
        
        {/* Header Card */}
        <Card className="bg-gradient-to-br from-card to-muted border-primary/20 shadow-sm">
          <CardContent className="flex flex-wrap items-center gap-6 p-6">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-gradient-to-br from-primary to-blue-500 shrink-0">
              <Trophy className="w-7 h-7 text-white" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-extrabold text-foreground m-0">Candidate Evaluation Report</h1>
              <p className="text-sm text-muted-foreground mt-1">Comprehensive performance &amp; mistake assessment</p>
            </div>
            <div className="flex items-center gap-4 p-4 rounded-xl bg-background border">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground m-0">Overall Score</p>
                <p className="text-3xl font-black text-green-600 m-0">
                  {evaluation.score}
                  <span className="text-base font-bold text-muted-foreground">/100</span>
                </p>
              </div>
              <div className="w-px h-10 bg-border" />
              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground m-0">Rating</p>
                <p className="text-sm font-bold text-primary m-0">{evaluation.rating ?? "Developing"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Category scores */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Technical Accuracy", value: evaluation.categoryScores?.technicalAccuracy ?? evaluation.score, Icon: Target, color: "text-blue-500" },
            { label: "Problem Solving", value: evaluation.categoryScores?.problemSolving ?? evaluation.score, Icon: BrainCircuit, color: "text-purple-500" },
            { label: "Communication", value: evaluation.categoryScores?.communication ?? evaluation.score, Icon: MessagesSquare, color: "text-green-500" },
            { label: "Depth", value: evaluation.categoryScores?.depth ?? evaluation.score, Icon: Layers3, color: "text-amber-500" },
          ].map(({ label, value, Icon, color }) => (
            <Card key={label} className="shadow-sm">
              <CardContent className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className={`flex items-center gap-1.5 text-xs font-bold ${color}`}>
                    <Icon className="w-4 h-4" /> {label}
                  </span>
                  <span className="text-sm font-extrabold text-foreground">{value}</span>
                </div>
                <Progress value={Math.min(100, Math.max(0, value))} className="h-1.5" />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Stats row */}
        <Card className="shadow-sm bg-muted/30">
          <CardContent className="flex flex-wrap gap-x-6 gap-y-3 p-4 text-sm text-muted-foreground">
            <span><strong className="text-foreground">{evaluation.answeredCount ?? 5}</strong> answers submitted</span>
            <span><strong className="text-foreground">{evaluation.totalQuestions ?? 5}</strong> questions assessed</span>
            <span>Rating based on accuracy, reasoning, communication &amp; depth</span>
          </CardContent>
        </Card>

        {/* Strengths & Improvements */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="border-green-500/20 bg-green-500/5 shadow-sm">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-green-600">
                <CheckCircle2 className="w-4 h-4" /> Key Strengths
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <ul className="flex flex-col gap-2 m-0 p-0 list-none">
                {(evaluation.strengths ?? []).map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground leading-relaxed">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5 shrink-0" /> {s}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card className="border-amber-500/20 bg-amber-500/5 shadow-sm">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-amber-600">
                <AlertTriangle className="w-4 h-4" /> Areas to Improve
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <ul className="flex flex-col gap-2 m-0 p-0 list-none">
                {(evaluation.improvements ?? []).map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground leading-relaxed">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" /> {s}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* Detailed feedback */}
        {evaluation.detailedFeedback && (
          <Card className="border-rose-500/20 bg-rose-500/5 shadow-sm">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-rose-600">
                <AlertCircle className="w-4 h-4" /> Mistakes &amp; Critique
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <p className="text-sm text-foreground leading-relaxed m-0">{evaluation.detailedFeedback}</p>
            </CardContent>
          </Card>
        )}

        {/* Q&A breakdown */}
        {evaluation.questionBreakdown && evaluation.questionBreakdown.length > 0 && (
          <div className="flex flex-col gap-4 mt-2">
            <div className="flex items-center gap-2 text-base font-extrabold text-foreground">
              <MessageSquareCode className="w-5 h-5 text-primary" /> Question-by-Question Analysis
            </div>
            <div className="flex flex-col gap-4">
              {evaluation.questionBreakdown.map((item, idx) => (
                <Card key={idx} className="shadow-sm">
                  <CardContent className="flex flex-col gap-3 p-5">
                    <div>
                      <Badge variant="outline" className="text-primary bg-primary/5 border-primary/20 mb-2">
                        Question #{item.questionNumber ?? idx + 1}
                      </Badge>
                      <p className="text-sm font-semibold text-foreground m-0">{item.question}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted text-sm text-muted-foreground italic border">
                      <span className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1 not-italic">Your Response</span>
                      "{item.userResponse || "No answer provided."}"
                    </div>
                    <div className="p-3 rounded-lg bg-rose-500/5 border border-rose-500/20">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-rose-600 mb-2">
                        <AlertCircle className="w-3.5 h-3.5" /> AI Feedback
                      </div>
                      <p className="text-sm text-foreground leading-relaxed m-0">{item.feedback}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        <Card className="shadow-sm">
          <CardHeader className="p-5 pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
              <Sparkles className="w-4 h-4 text-primary" /> Executive Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            <p className="text-sm text-muted-foreground leading-relaxed m-0">{evaluation.summary}</p>
          </CardContent>
        </Card>

        <div className="flex justify-end mt-4">
          <Button onClick={() => window.location.reload()} size="lg" className="flex items-center gap-2 font-semibold">
            <RefreshCw className="w-4 h-4" /> Start New Interview
          </Button>
        </div>
      </div>
    </div>
  );
}