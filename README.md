# AI Interviewer

AI Interviewer creates personalized technical interviews from a candidate's resume, GitHub profile, LinkedIn URL, and target role. It generates questions, speaks them aloud, transcribes answers, and produces an evaluation report.

high level flow - 
<img width="685" height="429" alt="image" src="https://github.com/user-attachments/assets/6ec4d2de-cb5c-4202-9a97-b804fcd750e1" />


detailed flow - 
<img width="1536" height="1024" alt="image" src="https://github.com/user-attachments/assets/d0d1e86e-cef1-4cc8-bcce-613dcb97b29d" />


## Flow

1. The user uploads a PDF resume and provides GitHub, LinkedIn, role, and difficulty.
2. The backend extracts resume text and uses OpenRouter to create structured candidate data.
3. GitHub profile and repository data are fetched and stored.
4. An interview session is created in PostgreSQL.
5. The frontend opens `/ws/interview` and sends the session ID.
6. The backend generates a question, stores it, creates ElevenLabs audio, and sends both text and Base64 audio through the WebSocket.
7. After the audio finishes, the frontend opens a Deepgram streaming connection and starts listening automatically.
8. Interim and final transcripts are displayed in the interview UI.
9. Four seconds without transcript activity submits the answer automatically through the same WebSocket.
10. The backend stores the answer, generates the next question, and repeats the cycle.
11. After five questions, the backend evaluates the session and sends the result to the frontend.

## Realtime Communication

The interview uses two WebSocket connections:

- Application WebSocket: `ws://localhost:8000/ws/interview`
  - Client sends `start` and `answer` messages.
  - Server sends `question`, `error`, and `completed` messages.
  - The connection remains open between questions.
- Deepgram WebSocket: `wss://api.deepgram.com/v1/listen`
  - Receives microphone audio in small MediaRecorder chunks.
  - Returns interim and final transcripts.
  - Uses endpointing and utterance detection with a four-second silence threshold.

The microphone is opened only after AI audio playback finishes, preventing the AI's own voice from becoming a candidate answer. There is no manual microphone or answer button in the normal flow.

## Main API Routes

```text
POST /api/v1/onboarding/extract-resume
POST /api/v1/onboarding/socials
POST /api/v1/onboarding/session
GET  /api/v1/interview/stt-token
WS   /ws/interview
```

The standalone question and answer HTTP routes remain registered, but the active frontend interview uses the WebSocket flow.
