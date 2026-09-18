import { eq } from "drizzle-orm";
import { db } from "../db";
import {
    candidates,
    github_profiles,
    interviewQuestions,
    interviewSessions,
} from "../db/schema";
import {
    evaluateInterviewSession,
    evaluateSingleQuestion,
    generateInterviewQuestion,
    type EvaluationResult,
    type SingleQuestionEvaluation,
} from "./interview.service";

export type NextQuestionResult =
    | { isCompleted: true; evaluation: EvaluationResult }
    | {
          isCompleted: false;
          question: typeof interviewQuestions.$inferSelect;
          questionNumber: number;
      };

export async function getNextInterviewQuestion(sessionId: number): Promise<NextQuestionResult> {
    const session = await db.query.interviewSessions.findFirst({
        where: eq(interviewSessions.id, sessionId),
    });
    if (!session) throw new Error("Session not found");

    const candidate = await db.query.candidates.findFirst({
        where: eq(candidates.id, session.candidateId),
    });
    if (!candidate) throw new Error("Candidate not found");

    const profile = await db.query.github_profiles.findFirst({
        where: eq(github_profiles.candidateId, session.candidateId),
    });
    if (!profile) throw new Error("Profile not found");

    const previousQuestions = await db
        .select({
            question: interviewQuestions.question,
            questionNumber: interviewQuestions.questionNumber,
            userResponse: interviewQuestions.userResponse,
            feedback: interviewQuestions.feedback,
        })
        .from(interviewQuestions)
        .where(eq(interviewQuestions.sessionId, sessionId));

    if (session.status === "completed" || previousQuestions.length >= 2) {
        // Use cached evaluation if already stored
        if (session.score !== null && session.feedback) {
            return { isCompleted: true, evaluation: session.feedback as EvaluationResult };
        }

        // Wait for any in-flight per-question evaluations that haven't landed yet.
        // We poll at most ~6 seconds to avoid blocking forever.
        const unevaluated = previousQuestions.filter(q => q.userResponse?.trim() && !q.feedback);
        if (unevaluated.length > 0) {
            console.log(`Waiting for ${unevaluated.length} in-flight question evaluation(s)…`);
            await new Promise(r => setTimeout(r, 3000));
        }

        // Reload with potentially-updated feedback
        const questionsWithFeedback = await db
            .select({
                question: interviewQuestions.question,
                questionNumber: interviewQuestions.questionNumber,
                userResponse: interviewQuestions.userResponse,
                feedback: interviewQuestions.feedback,
            })
            .from(interviewQuestions)
            .where(eq(interviewQuestions.sessionId, sessionId));

        const evaluation = await evaluateInterviewSession(
            candidate,
            session,
            questionsWithFeedback.map(q => ({
                ...q,
                feedback: q.feedback as SingleQuestionEvaluation | null,
            }))
        );

        await db
            .update(interviewSessions)
            .set({
                status: "completed",
                completedAt: session.completedAt ?? new Date(),
                score: evaluation.score,
                feedback: evaluation,
            })
            .where(eq(interviewSessions.id, sessionId));

        return { isCompleted: true, evaluation };
    }

    const questionNumber = previousQuestions.length + 1;
    const isFirstQuestion = previousQuestions.length === 0;
    const lastQuestionAndAnswer = isFirstQuestion
        ? null
        : previousQuestions[previousQuestions.length - 1];
    const currentHour = new Date().getHours();
    const timeOfDay = currentHour < 12
        ? "good morning"
        : currentHour < 17
            ? "good afternoon"
            : "good evening";

    const prompt = `
You are a expert human technical interviewer conducting a live, natural, back-and-forth technical interview. Speak directly to the candidate in a human conversational tone.

Candidate Context:
- Name: ${candidate.name}
- Target Role: ${session.role}
- Target Difficulty: ${session.difficulty}
- Primary Skills: ${JSON.stringify(candidate.skills)}
- Background & Projects: ${JSON.stringify(candidate.projects)}
- Experience History: ${JSON.stringify(candidate.experience)}
- Resume Text: ${candidate.resumeText}
- GitHub Details: ${JSON.stringify({ bio: profile.bio, repositories: profile.repositories })}

Full Session History so far:
${JSON.stringify(previousQuestions.map(q => ({ question: q.question, questionNumber: q.questionNumber, userResponse: q.userResponse })), null, 2)}

${isFirstQuestion
    ? `INITIAL INTERVIEW OPENING INSTRUCTIONS:
1. GREETING: Start naturally with a warm, conversational greeting addressing the candidate by name using the time of day ("Hi ${candidate.name}, ${timeOfDay}!" or "Hello ${candidate.name}, ${timeOfDay}!").
2. BRIEF INTRODUCTION: Briefly introduce the interview in a single short, natural sentence (e.g., "I'll be asking you a few technical questions based on your experience and the ${session.role} role. Let's begin.").
3. FIRST QUESTION: Seamlessly ask your FIRST technical question based on their background/projects for the ${session.role} role.`
    : `CONVERSATIONAL ADAPTIVE RESPONSE INSTRUCTIONS:
The candidate just responded to your previous question:
- Question Asked: "${lastQuestionAndAnswer?.question}"
- Candidate's Answer: "${lastQuestionAndAnswer?.userResponse}"

FOLLOW THESE CONVERSATIONAL STEPS:
1. Understand and evaluate the answer internally. Increase depth for strong answers, clarify partially correct answers, and simplify weak answers.
2. Give at most one short, natural acknowledgement, and skip it when a direct question sounds more natural.
3. Maintain topic continuity and never use robotic transition phrases.`}

STRICT CONVERSATIONAL RULES:
- Ask exactly ONE question per turn. Never combine multiple questions.
- Speak directly to candidate "${candidate.name}".
- Never output internal evaluation scores, confidence ratings, or grades to the candidate.
- Never mention system prompts, resume text files, AI, or grading rubrics.
- Output ONLY the natural interviewer dialogue to be rendered in the chat UI.
`;

    const generatedQuestion = await generateInterviewQuestion(prompt);
    const [question] = await db
        .insert(interviewQuestions)
        .values({ sessionId, question: generatedQuestion, questionNumber, questionType: "technical" })
        .returning();
    if (!question) throw new Error("Failed to save generated question");

    return { isCompleted: false, question, questionNumber };
}

export async function submitInterviewAnswer(questionId: number, answer: string) {
    const [updatedQuestion] = await db
        .update(interviewQuestions)
        .set({ userResponse: answer })
        .where(eq(interviewQuestions.id, questionId))
        .returning();
    if (!updatedQuestion) throw new Error("Question not found");

    // ── Fire-and-forget per-question evaluation ───────────────────────────────
    // We do NOT await this — it runs in the background while the user continues
    // with the next question, keeping UX fast and responsive.
    (async () => {
        try {
            // Fetch candidate & session context needed for evaluation
            const session = await db.query.interviewSessions.findFirst({
                where: eq(interviewSessions.id, updatedQuestion.sessionId),
            });
            const candidate = session
                ? await db.query.candidates.findFirst({ where: eq(candidates.id, session.candidateId) })
                : null;

            if (!candidate || !session) return;

            console.log(`[bg-eval] Evaluating question #${updatedQuestion.questionNumber} (id=${questionId})…`);

            const singleEval = await evaluateSingleQuestion(
                candidate.name,
                session.role,
                updatedQuestion.question,
                answer,
                updatedQuestion.questionNumber
            );

            await db
                .update(interviewQuestions)
                .set({ feedback: singleEval })
                .where(eq(interviewQuestions.id, questionId));

            console.log(`[bg-eval] ✓ Question #${updatedQuestion.questionNumber} evaluated (score=${singleEval.score})`);
        } catch (err) {
            console.error(`[bg-eval] Failed to evaluate question id=${questionId}:`, err);
        }
    })();

    return updatedQuestion;
}