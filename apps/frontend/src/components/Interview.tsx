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
  const [userTranscript, setUserTranscript] = useState(""); // live interim
  const [finalTranscript, setFinalTranscript] = useState(""); // confirmed final
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

    socket.onerror = () => toast.error("Interview connection failed");
    socket.onclose = () => {
      if (!intentionalCloseRef.current) {
        toast.error("Interview connection closed unexpectedly");
      }
    };

    return () => {
      intentionalCloseRef.current = true;
      socket.close();
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
    <div className="voice-room">
      {/* Ambient background orbs */}
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />

      {/* Top bar */}
      <header className="voice-header">
        <div className="voice-header-left">
          <span className={`status-dot ${phase === "completed" ? "dot-blue" : "dot-green"}`} />
          <span className="status-label">AI Technical Interviewer</span>
        </div>
        <div className="voice-header-center">
          <span className="question-badge">
            {isFinished ? "Completed" : `Question ${questionNumber} / 5`}
          </span>
        </div>
        <div className="voice-header-right">
          <button
            className="icon-btn"
            onClick={toggleMute}
            title={isMuted ? "Unmute AI" : "Mute AI"}
          >
            {isMuted ? <VolumeX className="icon-sm" /> : <Volume2 className="icon-sm" />}
          </button>
        </div>
      </header>

      {/* Central avatar */}
      <main className="voice-center">
        {/* Ripple rings — only animate when AI is speaking */}
        <div
          className={`avatar-ring ring-3 ${phase === "ai-speaking" ? "ring-active" : ""}`}
          style={{ transform: `scale(${phase === "ai-speaking" ? ringScale * 1.15 : 1})` }}
        />
        <div
          className={`avatar-ring ring-2 ${phase === "ai-speaking" ? "ring-active" : ""}`}
          style={{ transform: `scale(${phase === "ai-speaking" ? ringScale * 1.07 : 1})` }}
        />
        <div
          className={`avatar-ring ring-1 ${phase === "ai-speaking" ? "ring-active" : ""}`}
          style={{ transform: `scale(${phase === "ai-speaking" ? ringScale : 1})` }}
        />

        {/* Avatar core */}
        <div className={`avatar-core ${phase === "ai-speaking" ? "core-speaking" : ""}`}>
          <svg viewBox="0 0 64 64" fill="none" className="avatar-icon">
            <circle cx="32" cy="20" r="12" fill="currentColor" opacity="0.9" />
            <path
              d="M8 56c0-13.255 10.745-24 24-24s24 10.745 24 24"
              stroke="currentColor"
              strokeWidth="5"
              strokeLinecap="round"
              opacity="0.9"
            />
          </svg>
        </div>
      </main>

      {/* AI transcript */}
      <div className={`subtitle-ai ${aiText ? "subtitle-visible" : ""}`}>
        <div className="subtitle-badge">AI Interviewer</div>
        <p className="subtitle-text">{aiText}</p>
      </div>

      {/* User transcript */}
      <div
        className={`subtitle-user ${userTranscript || finalTranscript ? "subtitle-visible" : ""}`}
      >
        <div className="subtitle-badge">You</div>
        <p className="subtitle-text">
          {finalTranscript}
          {userTranscript && (
            <span className="interim-text"> {userTranscript}</span>
          )}
        </p>
      </div>

      {/* Bottom controls */}
      <footer className="voice-footer">
        <p className="phase-label">{phaseLabel}</p>
      </footer>
    </div>
  );
}

// ─── Evaluation Screen ─────────────────────────────────────────────────────────

function EvaluationScreen({ evaluation }: { evaluation: EvaluationReport }) {
  return (
    <div className="eval-screen">
      <div className="eval-container">
        {/* Header */}
        <div className="eval-header">
          <div className="eval-trophy">
            <Trophy className="trophy-icon" />
          </div>
          <div>
            <h1 className="eval-title">Candidate Evaluation Report</h1>
            <p className="eval-subtitle">Comprehensive performance &amp; mistake assessment</p>
          </div>
          <div className="eval-score-card">
            <div>
              <p className="score-label">Overall Score</p>
              <p className="score-value">
                {evaluation.score}
                <span className="score-denom">/100</span>
              </p>
            </div>
            <div className="eval-divider" />
            <div>
              <p className="score-label">Rating</p>
              <p className="rating-value">{evaluation.rating ?? "Developing"}</p>
            </div>
          </div>
        </div>

        {/* Category scores */}
        <div className="category-grid">
          {[
            { label: "Technical Accuracy", value: evaluation.categoryScores?.technicalAccuracy ?? evaluation.score, Icon: Target, color: "blue" },
            { label: "Problem Solving", value: evaluation.categoryScores?.problemSolving ?? evaluation.score, Icon: BrainCircuit, color: "violet" },
            { label: "Communication", value: evaluation.categoryScores?.communication ?? evaluation.score, Icon: MessagesSquare, color: "emerald" },
            { label: "Depth", value: evaluation.categoryScores?.depth ?? evaluation.score, Icon: Layers3, color: "amber" },
          ].map(({ label, value, Icon, color }) => (
            <div key={label} className="category-card">
              <div className="category-header">
                <span className={`category-name cat-${color}`}>
                  <Icon className="cat-icon" /> {label}
                </span>
                <span className="category-value">{value}</span>
              </div>
              <div className="progress-track">
                <div
                  className={`progress-fill fill-${color}`}
                  style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Stats row */}
        <div className="stats-row">
          <span><strong>{evaluation.answeredCount ?? 5}</strong> answers submitted</span>
          <span><strong>{evaluation.totalQuestions ?? 5}</strong> questions assessed</span>
          <span>Rating based on accuracy, reasoning, communication &amp; depth</span>
        </div>

        {/* Strengths & Improvements */}
        <div className="feedback-grid">
          <div className="feedback-card feedback-green">
            <div className="feedback-heading text-emerald">
              <CheckCircle2 className="feedback-icon" /> Key Strengths
            </div>
            <ul className="feedback-list">
              {(evaluation.strengths ?? []).map((s, i) => (
                <li key={i} className="feedback-item">
                  <span className="bullet bullet-green" /> {s}
                </li>
              ))}
            </ul>
          </div>
          <div className="feedback-card feedback-amber">
            <div className="feedback-heading text-amber">
              <AlertTriangle className="feedback-icon" /> Areas to Improve
            </div>
            <ul className="feedback-list">
              {(evaluation.improvements ?? []).map((s, i) => (
                <li key={i} className="feedback-item">
                  <span className="bullet bullet-amber" /> {s}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Detailed feedback */}
        {evaluation.detailedFeedback && (
          <div className="feedback-card feedback-rose">
            <div className="feedback-heading text-rose">
              <AlertCircle className="feedback-icon" /> Mistakes &amp; Critique
            </div>
            <p className="feedback-body">{evaluation.detailedFeedback}</p>
          </div>
        )}

        {/* Q&A breakdown */}
        {evaluation.questionBreakdown && evaluation.questionBreakdown.length > 0 && (
          <div className="breakdown-section">
            <div className="breakdown-title">
              <MessageSquareCode className="breakdown-icon" /> Question-by-Question Analysis
            </div>
            <div className="breakdown-list">
              {evaluation.questionBreakdown.map((item, idx) => (
                <div key={idx} className="breakdown-card">
                  <span className="q-badge">Question #{item.questionNumber ?? idx + 1}</span>
                  <p className="q-text">{item.question}</p>
                  <div className="q-answer">
                    <span className="q-answer-label">Your Response</span>
                    "{item.userResponse || "No answer provided."}"
                  </div>
                  <div className="q-feedback">
                    <div className="q-feedback-title">
                      <AlertCircle className="q-feedback-icon" /> AI Feedback
                    </div>
                    <p className="q-feedback-body">{item.feedback}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="summary-card">
          <div className="summary-title">
            <Sparkles className="summary-icon" /> Executive Summary
          </div>
          <p className="summary-body">{evaluation.summary}</p>
        </div>

        <div className="eval-actions">
          <Button onClick={() => window.location.reload()} className="restart-btn">
            <RefreshCw className="btn-icon" /> Start New Interview
          </Button>
        </div>
      </div>
    </div>
  );
}