import { Router } from "express";

const router = Router();

/**
 * GET /api/v1/interview/stt-token
 * Returns the Deepgram API key so the browser can open a Deepgram WebSocket
 * without baking the secret into the frontend bundle.
 */
router.get("/stt-token", (_req, res) => {
    const key = process.env.DEEPGRAM_API_KEY;
    if (!key) {
        res.status(503).json({ error: "STT service is not configured" });
        return;
    }
    res.json({ key });
});

export default router;
