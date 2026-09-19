import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import multer from "multer";

import onboardingRouter from "./http/routes/onboarding.routes";
import sttTokenRouter from "./http/routes/stt-token.routes";
import { handleInterviewSocket } from "./ws/interview";

const app = express();

const allowedOrigins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "https://interview-agent-01.vercel.app",
    process.env.CORS_ORIGIN,
].filter((origin): origin is string => Boolean(origin));

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.use("/api/v1/onboarding", onboardingRouter);
app.use("/api/v1/interview", sttTokenRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) {
        return
    }

    if (error instanceof multer.MulterError) {
        const message = error.code === "LIMIT_FILE_SIZE"
            ? "Resume must be 5 MB or smaller"
            : error.message
        res.status(400).json({ message })
        return
    }

    if (error instanceof Error) {
        res.status(500).json({ message: "Unexpected server error. Please try again." })
        return
    }

    res.status(500).json({ message: "Unexpected server error. Please try again." })
})

const server = createServer(app);
const webSocketServer = new WebSocketServer({ noServer: true });

webSocketServer.on("connection", handleInterviewSocket);

server.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (requestUrl.pathname !== "/ws/interview") {
        socket.destroy();
        return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        webSocketServer.emit("connection", webSocket, request);
    });
});

server.listen(8000, () => {
    console.log("backend server is running on port 8000");
})
