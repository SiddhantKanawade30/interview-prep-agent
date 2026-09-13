import { z } from "zod";
import type { WebSocket } from "ws";
import { getNextInterviewQuestion, submitInterviewAnswer } from "../services/interview-chat.service";
import { textToSpeech } from "../services/tts.service";

const interviewMessageSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("start"), sessionId: z.number().int().positive() }),
    z.object({
        type: z.literal("answer"),
        questionId: z.number().int().positive(),
        answer: z.string().min(1),
    }),
]);

function send(socket: WebSocket, message: object, onSent?: () => void) {
    if (socket.readyState !== socket.OPEN) return;

    socket.send(JSON.stringify(message), (error) => {
        if (error) {
            console.error("Interview WebSocket send error:", error);
            return;
        }
        onSent?.();
    });
}

export function handleInterviewSocket(socket: WebSocket) {
    let operation = Promise.resolve();

    socket.on("message", (rawMessage) => {
        operation = operation
            .then(async () => {
                let parsedMessage: unknown;
                try {
                    parsedMessage = JSON.parse(rawMessage.toString());
                } catch {
                    send(socket, { type: "error", message: "Message must be valid JSON" });
                    return;
                }

                const message = interviewMessageSchema.safeParse(parsedMessage);
                if (!message.success) {
                    send(socket, { type: "error", message: "Invalid interview message" });
                    return;
                }

                try {
                    if (message.data.type === "answer") {
                        await submitInterviewAnswer(message.data.questionId, message.data.answer);
                    }

                    const sessionId =
                        message.data.type === "start"
                            ? message.data.sessionId
                            : await getSessionIdForQuestion(message.data.questionId);

                    const result = await getNextInterviewQuestion(sessionId);

                    if (result.isCompleted) {
                        send(
                            socket,
                            { type: "completed", evaluation: result.evaluation },
                            () => socket.close(1000, "Interview completed"),
                        );
                    } else {
                        // Generate TTS audio in parallel with building the response payload
                        let audioBase64: string | null = null;
                        try {
                            const audioBuffer = await textToSpeech(result.question.question);
                            audioBase64 = audioBuffer.toString("base64");
                        } catch (ttsError) {
                            // TTS failure is non-fatal — interview continues without audio
                            console.error("TTS error (non-fatal):", ttsError);
                        }

                        send(socket, {
                            type: "question",
                            question: result.question,
                            questionNumber: result.questionNumber,
                            audioBase64,
                        });
                    }
                } catch (error) {
                    console.error("Interview WebSocket error:", error);
                    send(socket, { type: "error", message: "Failed to process interview message" });
                }
            });
    });
}

async function getSessionIdForQuestion(questionId: number): Promise<number> {
    const { db } = await import("../db");
    const { eq } = await import("drizzle-orm");
    const { interviewQuestions } = await import("../db/schema");
    const question = await db.query.interviewQuestions.findFirst({
        where: eq(interviewQuestions.id, questionId),
        columns: { sessionId: true },
    });

    if (!question) throw new Error("Question not found");
    return question.sessionId;
}