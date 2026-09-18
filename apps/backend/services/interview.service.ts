import { generateLLMCompletion, generateLLMJSON } from "./llm.service";

export async function generateInterviewQuestion(prompt: string): Promise<string> {
    return generateLLMCompletion(prompt);
}

export interface QuestionFeedback {
    questionNumber: number;
    question: string;
    userResponse: string;
    feedback: string;
}

export interface EvaluationResult {
    score: number;
    rating: "Excellent" | "Strong" | "Developing" | "Needs Improvement";
    categoryScores: {
        technicalAccuracy: number;
        problemSolving: number;
        communication: number;
        depth: number;
    };
    answeredCount: number;
    totalQuestions: number;
    strengths: string[];
    improvements: string[];
    detailedFeedback: string;
    questionBreakdown: QuestionFeedback[];
    summary: string;
}

// ─── Single-Question Evaluator (called asynchronously after each answer) ───────

export interface SingleQuestionEvaluation {
    feedback: string;
    score: number; // 0–100 for this specific answer
}

export async function evaluateSingleQuestion(
    candidateName: string,
    role: string,
    question: string,
    answer: string,
    questionNumber: number
): Promise<SingleQuestionEvaluation> {
    const prompt = `
You are an expert technical interviewer evaluating a single interview question and answer pair.

Candidate: ${candidateName}
Role: ${role}
Question #${questionNumber}: ${question}
Candidate's Answer: ${answer || "No answer provided."}

Evaluate this specific answer and return ONLY a valid JSON object in this exact format:
{
  "feedback": "Specific, actionable feedback explaining what was correct, what was missing or incorrect, and how the candidate could improve this answer. Be concise but thorough (2-4 sentences).",
  "score": 75
}

Where "score" is an integer from 0 to 100 reflecting the quality of this specific answer.
`;

    try {
        const result = await generateLLMJSON<SingleQuestionEvaluation>(
            prompt,
            "You are an expert technical interviewer. Output valid JSON only."
        );
        return {
            feedback: typeof result.feedback === "string" ? result.feedback : "No feedback available.",
            score: clampScore(result.score),
        };
    } catch (error) {
        console.error(`Failed to evaluate question #${questionNumber}:`, error);
        return {
            feedback: "Response was received. Could be improved with more specific technical details and examples.",
            score: answer?.trim().length > 20 ? 50 : 10,
        };
    }
}

// ─── Final Summary Evaluator (uses pre-computed per-question feedback) ─────────

export async function evaluateInterviewSession(
    candidate: any,
    session: any,
    questionsWithFeedback: {
        question: string;
        questionNumber: number;
        userResponse: string | null;
        feedback?: SingleQuestionEvaluation | null;
    }[]
): Promise<EvaluationResult> {
    // Build a rich breakdown from pre-computed per-question feedback
    const breakdown: QuestionFeedback[] = questionsWithFeedback.map((q, idx) => ({
        questionNumber: q.questionNumber || idx + 1,
        question: q.question,
        userResponse: q.userResponse || "No answer provided.",
        feedback: (q.feedback as SingleQuestionEvaluation | null)?.feedback
            ?? "No individual feedback available.",
    }));

    const avgScore = questionsWithFeedback.length > 0
        ? Math.round(
            questionsWithFeedback.reduce((sum, q) => {
                const s = (q.feedback as SingleQuestionEvaluation | null)?.score ?? 50;
                return sum + s;
            }, 0) / questionsWithFeedback.length
          )
        : 50;

    const prompt = `
You are an expert technical interviewer producing a final interview evaluation report.
The individual question-by-question evaluations have already been completed. Your job is to:
1. Synthesize an overall score and rating.
2. Identify the top 3 key strengths demonstrated across the interview.
3. Identify the top 3 areas for improvement.
4. Write a concise "detailedFeedback" paragraph summarizing the candidate's overall technical performance, mistakes, and growth areas.
5. Write a brief executive "summary" with an overall recommendation.

Candidate: ${candidate.name}
Role: ${session.role}
Difficulty: ${session.difficulty}

Per-Question Feedback Summary:
${JSON.stringify(breakdown, null, 2)}

Average individual question score (for reference): ${avgScore}/100

Return ONLY a valid JSON object in this exact format:
{
  "score": 78,
  "strengths": ["Strength 1", "Strength 2", "Strength 3"],
  "improvements": ["Area 1", "Area 2", "Area 3"],
  "detailedFeedback": "Comprehensive critique paragraph...",
  "summary": "Executive summary and overall recommendation."
}
`;

    try {
        const parsed = await generateLLMJSON<{
            score: number;
            strengths: string[];
            improvements: string[];
            detailedFeedback: string;
            summary: string;
        }>(prompt, "You are an expert technical interviewer. Output valid JSON only.");

        const score = clampScore(parsed.score ?? avgScore);

        return {
            score,
            rating: getRating(score),
            categoryScores: {
                technicalAccuracy: clampScore(Math.round(score * 1.05)),
                problemSolving: clampScore(Math.round(score * 0.98)),
                communication: clampScore(Math.round(score * 0.97)),
                depth: clampScore(Math.round(score * 0.95)),
            },
            answeredCount: questionsWithFeedback.filter(q => q.userResponse?.trim()).length,
            totalQuestions: questionsWithFeedback.length,
            strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
            improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
            detailedFeedback: typeof parsed.detailedFeedback === "string"
                ? parsed.detailedFeedback
                : "See individual question feedback for detailed comments.",
            questionBreakdown: breakdown,
            summary: typeof parsed.summary === "string"
                ? parsed.summary
                : "Candidate completed the technical interview session.",
        };
    } catch (error) {
        console.error("Failed to generate final summary, using fallback:", error);
        return buildFallbackEvaluation(questionsWithFeedback, breakdown, avgScore);
    }
}

// ─── Fallback ─────────────────────────────────────────────────────────────────

function buildFallbackEvaluation(
    questionsWithFeedback: { question: string; questionNumber: number; userResponse: string | null; feedback?: any }[],
    breakdown: QuestionFeedback[],
    avgScore: number
): EvaluationResult {
    const score = clampScore(avgScore);
    return {
        score,
        rating: getRating(score),
        categoryScores: {
            technicalAccuracy: score,
            problemSolving: score,
            communication: score,
            depth: score,
        },
        answeredCount: questionsWithFeedback.filter(q => q.userResponse?.trim()).length,
        totalQuestions: questionsWithFeedback.length,
        strengths: [
            "Demonstrated active participation throughout the technical interview.",
            "Structured response approach across the questions.",
        ],
        improvements: [
            "Elaborate more on edge-case scenarios and production trade-offs.",
            "Provide quantitative data or code examples when answering technical questions.",
        ],
        detailedFeedback:
            "Your responses demonstrated good baseline understanding, but lacked specific implementation details and production edge-case handling. To improve, structure your technical answers with concrete examples and discuss trade-offs explicitly.",
        questionBreakdown: breakdown,
        summary: `The candidate completed ${questionsWithFeedback.filter(q => q.userResponse?.trim()).length} out of ${questionsWithFeedback.length} questions during the session.`,
    };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function clampScore(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value)
        ? Math.min(100, Math.max(0, Math.round(value)))
        : 0;
}

function getRating(score: number): EvaluationResult["rating"] {
    if (score >= 85) return "Excellent";
    if (score >= 70) return "Strong";
    if (score >= 50) return "Developing";
    return "Needs Improvement";
}
