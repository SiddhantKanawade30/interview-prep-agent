import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

import onboardingRouter from "./http/routes/onboarding.routes";
import sttTokenRouter from "./http/routes/stt-token.routes";
import { handleInterviewSocket } from "./ws/interview";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/v1/onboarding", onboardingRouter);
app.use("/api/v1/interview", sttTokenRouter);

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
