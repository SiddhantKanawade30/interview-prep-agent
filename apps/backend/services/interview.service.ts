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

export async function evaluateInterviewSession(
    candidate: any,
    session: any,
    previousQuestions: { question: string; questionNumber: number; userResponse: string | null }[]
): Promise<EvaluationResult> {
    const prompt = `
Evaluate the candidate's performance during this interview session based on their answers to the questions.

Candidate Information:
- Name: ${candidate.name}
- Role: ${session.role}
- Difficulty: ${session.difficulty}
- Skills: ${JSON.stringify(candidate.skills)}

Questions and Candidate Responses:
${JSON.stringify(previousQuestions, null, 2)}

Instructions:
1. Calculate an overall score from 0 to 100 based on technical accuracy, depth, and clarity.
2. Assign a rating: "Excellent" for 85-100, "Strong" for 70-84, "Developing" for 50-69, or "Needs Improvement" for 0-49.
3. Score technicalAccuracy, problemSolving, communication, and depth independently from 0 to 100.
4. List 3 specific key strengths.
5. List 3 specific areas for improvement, pointing out mistakes or missing concepts from the answers.
6. Provide an in-depth constructive critique ("detailedFeedback") explaining where the candidate struggled, what errors they made, and how to improve.
7. Provide a question-by-question breakdown ("questionBreakdown") evaluating every question and candidate response pair.

Return ONLY a valid JSON object matching this exact format:
{
  "score": 85,
    "rating": "Strong",
    "categoryScores": {
        "technicalAccuracy": 88,
        "problemSolving": 82,
        "communication": 85,
        "depth": 80
    },
    "answeredCount": 5,
    "totalQuestions": 5,
  "strengths": [
    "Key strength 1",
    "Key strength 2",
    "Key strength 3"
  ],
  "improvements": [
    "Specific mistake/weakness 1",
    "Specific mistake/weakness 2",
    "Specific mistake/weakness 3"
  ],
  "detailedFeedback": "Comprehensive constructive feedback highlighting exact mistakes made during the interview, missed technical concepts, and actionable guidance for improvement.",
  "questionBreakdown": [
    {
      "questionNumber": 1,
      "question": "Question text",
      "userResponse": "Candidate answer text",
      "feedback": "Specific feedback on this response: what was correct, what was incorrect/missing, and how to answer it better."
    }
  ],
  "summary": "Executive summary and overall recommendation."
}
`;

    try {
        const parsed = await generateLLMJSON<EvaluationResult>(
            prompt,
            "You are an expert AI technical interviewer and evaluator. Output valid JSON only."
        );

        const score = clampScore(parsed.score);
        return {
            score,
            rating: getRating(score),
            categoryScores: {
                technicalAccuracy: normalizeCategoryScore(parsed.categoryScores?.technicalAccuracy, score),
                problemSolving: normalizeCategoryScore(parsed.categoryScores?.problemSolving, score),
                communication: normalizeCategoryScore(parsed.categoryScores?.communication, score),
                depth: normalizeCategoryScore(parsed.categoryScores?.depth, score),
            },
            answeredCount: previousQuestions.filter(q => q.userResponse?.trim()).length,
            totalQuestions: previousQuestions.length,
            strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
            improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
            detailedFeedback: typeof parsed.detailedFeedback === "string" ? parsed.detailedFeedback : "Identify key technical trade-offs and edge cases in future answers.",
            questionBreakdown: Array.isArray(parsed.questionBreakdown) ? parsed.questionBreakdown : [],
            summary: typeof parsed.summary === "string" ? parsed.summary : "Candidate completed the technical interview session.",
        };
    } catch (error) {
        console.error("Failed to evaluate interview via LLM, using fallback evaluation:", error);
        return calculateFallbackEvaluation(previousQuestions);
    }
}

function calculateFallbackEvaluation(
    previousQuestions: { question: string; questionNumber: number; userResponse: string | null }[]
): EvaluationResult {
    const answeredCount = previousQuestions.filter(q => q.userResponse && q.userResponse.trim().length > 0).length;
    const total = previousQuestions.length || 1;
    const fallbackScore = Math.min(100, Math.max(0, Math.round((answeredCount / total) * 85)));

    return {
        score: fallbackScore,
        rating: getRating(fallbackScore),
        categoryScores: {
            technicalAccuracy: fallbackScore,
            problemSolving: fallbackScore,
            communication: fallbackScore,
            depth: fallbackScore,
        },
        answeredCount,
        totalQuestions: previousQuestions.length,
        strengths: [
            "Demonstrated active participation throughout the technical interview.",
            "Structured response approach across the questions."
        ],
        improvements: [
            "Elaborate more on edge-case scenarios and production trade-offs.",
            "Provide quantitative data or code examples when answering technical questions."
        ],
        detailedFeedback: "Your responses demonstrated good baseline understanding, but lacked specific implementation details and production edge-case handling. To improve, structure your technical answers with concrete examples and discuss trade-offs explicitly.",
        questionBreakdown: previousQuestions.map((q, idx) => ({
            questionNumber: q.questionNumber || idx + 1,
            question: q.question,
            userResponse: q.userResponse || "No answer provided.",
            feedback: q.userResponse && q.userResponse.trim().length > 0
                ? "Response was received. Could be improved by adding specific technical implementation steps and error handling."
                : "No response was provided for this question."
        })),
        summary: `The candidate completed ${answeredCount} out of ${total} questions during the session.`
    };
}

function clampScore(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value)
        ? Math.min(100, Math.max(0, Math.round(value)))
        : 0;
}

function normalizeCategoryScore(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value)
        ? clampScore(value)
        : fallback;
}

function getRating(score: number): EvaluationResult["rating"] {
    if (score >= 85) return "Excellent";
    if (score >= 70) return "Strong";
    if (score >= 50) return "Developing";
    return "Needs Improvement";
}
