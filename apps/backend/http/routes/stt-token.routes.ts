import { Router } from "express";
import { DeepgramClient } from "@deepgram/sdk";

const router = Router();

/**
 * GET /api/v1/interview/stt-token
 * Returns a browser credential for the Deepgram WebSocket.
 * Prefer a short-lived token; older/project keys may not have grant permission.
 */
router.get("/stt-token", (_req, res) => {
    const key = process.env.DEEPGRAM_API_KEY;
    if (!key) {
        res.status(503).json({ error: "STT service is not configured" });
        return;
    }

    const deepgram = new DeepgramClient({ apiKey: key });
    deepgram.auth.v1.tokens
        .grant()
        .then((tokenResponse) => {
            res.json({
                token: tokenResponse.access_token,
                expiresIn: tokenResponse.expires_in,
                isTemporary: true,
            });
        })
        .catch((error) => {
            console.error("Deepgram token error:", error?.body ?? error);

            // Deepgram only permits JWT grants for keys with Member-level auth.
            // A valid project key still works with the WebSocket token protocol.
            if (error?.statusCode === 401 || error?.statusCode === 403) {
                res.json({ token: key, isTemporary: false });
                return;
            }

            res.status(503).json({ error: "Deepgram credentials are invalid or expired" });
        });
});

export default router;
