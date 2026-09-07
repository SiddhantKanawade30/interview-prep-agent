import type { Request, Response } from "express";
import { createQuestionSchema } from "../../zod/socials";
import { getNextInterviewQuestion } from "../../services/interview-chat.service";

export async function createQuestions(req: Request, res: Response) {
    try {
        const result = createQuestionSchema.safeParse(req.body);

        if (!result.success) {
            return res.status(400).json({
                message: "Incorrect Body",
                errors: result.error
            });
        }

        const { sessionId } = result.data;

        const questionResult = await getNextInterviewQuestion(sessionId);

        return res.status(questionResult.isCompleted ? 200 : 201).json({
            message: questionResult.isCompleted ? "Interview session is completed" : "Question generated successfully",
            ...questionResult,
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({
            message: error,
        });
    }
}