import type { Request, Response } from "express";
import { answerQuestionSchema } from "../../zod/socials";
import { submitInterviewAnswer } from "../../services/interview-chat.service";

export async function submitAnswer(req: Request, res: Response) {
    try {
        const result = answerQuestionSchema.safeParse(req.body);

        if (!result.success) {
            return res.status(400).json({
                message: "Incorrect Body",
                errors: result.error,
            });
        }

        const { questionId, answer } = result.data;

        const updatedQuestion = await submitInterviewAnswer(questionId, answer);

        return res.status(200).json({
            message: "Answer submitted successfully",
            question: updatedQuestion,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            message: "Failed to submit answer",
        });
    }
}
