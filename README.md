# AI Interviewer

AI Interviewer is a web application that builds a candidate profile from a resume and public developer profiles, then runs a personalized technical interview using generated questions, realtime audio, speech transcription, and an automated evaluation report.

## What The Repository Contains

This repository is a Bun-powered monorepo with two applications:

- `apps/frontend`: React client for onboarding, the live interview room, speech capture, transcript display, and evaluation rendering.
- `apps/backend`: Express server for onboarding APIs, candidate and interview persistence, the interview WebSocket, LLM calls, GitHub enrichment, Deepgram credential setup, and ElevenLabs audio generation.
- `packages/`: Shared configuration packages for TypeScript and linting.
- `ui/`: Additional reusable UI package components.

The frontend currently communicates with the backend at `http://localhost:8000`, configured in `apps/frontend/src/lib/config.ts`.

## System Architecture

```text
Browser
	|
	| HTTP: onboarding and Deepgram token requests
	v
Express backend ---------------------- PostgreSQL
	|                                      |
	| WebSocket: /ws/interview             | candidates
	|                                      | socials
	v                                      | GitHub profiles
LLM + ElevenLabs                         | interview sessions
																				 | interview questions

Browser microphone -------------------> Deepgram streaming WebSocket
Browser receives audio <--------------- Backend includes ElevenLabs audio
```

There are three separate realtime or request paths during an interview:

1. The application WebSocket at `/ws/interview` carries interview control messages, questions, answers, generated audio, errors, and completion results.
2. The frontend opens a second WebSocket directly to Deepgram for streaming microphone transcription.
3. The backend calls the LLM and ElevenLabs while processing application WebSocket messages. The frontend waits for the next question message before continuing the interview cycle.

## Runtime Entry Points

### Frontend

The frontend server starts from `apps/frontend/src/index.ts`. It serves `apps/frontend/src/index.html`, which loads `apps/frontend/src/frontend.tsx`. The React tree is mounted by `frontend.tsx`, and `App.tsx` chooses the current screen.

### Backend

The backend starts from `apps/backend/index.ts` and listens on port `8000`.

The server:

- Enables JSON request parsing.
- Enables CORS for the frontend.
- Mounts onboarding routes at `/api/v1/onboarding`.
- Mounts the Deepgram token route at `/api/v1/interview`.
- Upgrades only `/ws/interview` to the interview WebSocket.

The backend reads environment variables directly through `process.env`. Bun loads the local environment file when the backend is started from `apps/backend`.

## User Journey

The application has three conceptual screens in `App.tsx`:

```text
form -> interview
```

`App.tsx` also declares a `result` page state, but no current flow transitions to it. The completed evaluation is rendered directly by `Interview.tsx`.

### 1. Onboarding Form

The onboarding page is implemented in `apps/frontend/src/components/Form.tsx`.

The user supplies a PDF resume, LinkedIn URL, GitHub URL, target role, and difficulty selection: `easy`, `medium`, or `hard`.

The form requires all inputs before sending requests. Submission is sequential because each step depends on the identifier returned by the previous step.

### 2. Resume Extraction

The first request is:

```http
POST /api/v1/onboarding/extract-resume
Content-Type: multipart/form-data
```

The uploaded field is named `resume`.

Backend flow:

1. Multer stores the upload in memory.
2. The upload middleware limits the file to 5 MB and accepts PDF files.
3. `pdf-parse` extracts the text from the PDF.
4. The extracted text is sent to OpenRouter with a resume-parsing prompt.
5. The LLM is asked for JSON containing the candidate name, education, experience, projects, and skills.
6. The candidate record is inserted into the `candidates` table.
7. The raw extracted resume text is retained in `candidates.resumeText`.

The response contains the structured data and the new `candidateId`.

### 3. Social Profile Enrichment

The form then sends:

```http
POST /api/v1/onboarding/socials
Content-Type: application/json
```

Example body:

```json
{
  "github": "https://github.com/example-user",
  "linkedIn": "https://linkedin.com/in/example-user",
  "candidateId": 123
}
```

The request is validated with the schema in `apps/backend/zod/socials.ts`.

The controller extracts the GitHub username, calls the public GitHub profile and repository APIs, stores the social URLs, and saves GitHub profile metadata and up to 100 repository summaries in `github_profiles`.

If either URL already matches an existing social record, the controller reuses that candidate, copies the newly parsed resume fields onto it, and updates the social and GitHub profile records. This prevents duplicate candidate records for a known GitHub or LinkedIn identity.

### 4. Interview Session Creation

The final onboarding request is:

```http
POST /api/v1/onboarding/session
Content-Type: application/json
```

Example body:

```json
{
  "candidateId": 123,
  "role": "Frontend Engineer",
  "difficulty": "medium"
}
```

The backend validates the body and inserts a row in `interview_sessions` with a default `pending` status. It returns the generated `sessionId`.

The frontend stores that ID in `App.tsx` and renders `InterviewPage`.

## Live Interview Flow

### Application WebSocket Connection

When `InterviewPage` mounts, it opens:

```text
ws://localhost:8000/ws/interview
```

The client immediately sends:

```json
{
  "type": "start",
  "sessionId": 456
}
```

The backend serializes incoming operations with a promise chain. This prevents two answer messages from changing the same session concurrently.

For a start message, the backend loads the session, candidate, GitHub profile, and prior questions; decides whether the session is complete; builds a personalized prompt; calls OpenRouter; stores the generated question; calls ElevenLabs; and sends the question with optional Base64 audio back to the browser.

### Question Message

The server sends a message shaped like:

```json
{
  "type": "question",
  "question": {
    "id": 789,
    "sessionId": 456,
    "question": "Can you describe your most recent project?",
    "questionNumber": 1
  },
  "questionNumber": 1,
  "audioBase64": "..."
}
```

The frontend stores the question ID, question text, and question number. If audio is present, it decodes and plays it before starting candidate listening. If TTS fails, the question still arrives with `audioBase64: null`, and the frontend begins listening without audio playback.

### Answer Message

After speech detection completes, the frontend sends:

```json
{
  "type": "answer",
  "questionId": 789,
  "answer": "The candidate's normalized transcript"
}
```

The backend updates `interview_questions.userResponse`, finds the session through the question ID, loads the updated history, and generates the next question or completes the session.

The same WebSocket remains open between questions. It closes only after the backend sends a `completed` message.

### Error Messages

Invalid JSON, invalid message shapes, and processing failures are returned as:

```json
{
  "type": "error",
  "message": "..."
}
```

The frontend displays these errors through toast notifications.

## Interview State Machine

The frontend uses one `phase` state in `Interview.tsx`:

```text
connecting
		|
		v
ai-speaking
		|
		v
user-listening <-----------------------------+
		|                                         |
		| transcript activity                     |
		v                                         |
user-speaking                               |
		|                                         |
		| 4 seconds without transcript activity   |
		v                                         |
processing                                   |
		|                                         |
		| next question received                  |
		+------------------------> ai-speaking   |

Any completed message -> completed
```

`connecting` covers application WebSocket setup and the first question. `ai-speaking` means generated audio is playing. `user-listening` means the microphone pipeline is ready without recognized speech. `user-speaking` means Deepgram is returning speech. `processing` means an answer has been sent and the next question is being generated. `completed` renders the evaluation.

There is no manual microphone or answer button in the normal interview flow. The microphone starts after AI playback ends, and the answer is submitted automatically after four seconds without transcript activity.

## Speech-To-Text Pipeline

### Browser Credential Setup

The frontend requests:

```http
GET /api/v1/interview/stt-token
```

The backend first attempts to mint a short-lived Deepgram token. If the configured key lacks permission to create temporary tokens but is valid for streaming, the route returns the project key as a compatibility fallback. The response includes whether the returned credential is temporary.

For production use, configure a Deepgram key that can create temporary browser tokens. This avoids exposing the project key to the browser.

### Deepgram Connection

The browser opens a direct connection to `wss://api.deepgram.com/v1/listen` using English transcription, the `nova-3` model, interim results, punctuation, four-second endpointing, four-second utterance-end detection, and voice activity events.

The microphone is captured with `getUserMedia({ audio: true })`. `MediaRecorder` prefers WebM with Opus and sends audio chunks to Deepgram every 250 milliseconds.

### Transcript Assembly

The frontend maintains interim and final transcript buffers. On each non-empty result it changes to `user-speaking`, clears and restarts the four-second silence timer, updates interim text, and appends final segments to the answer buffer.

Deepgram `speech_final` and `UtteranceEnd` events also schedule the same silence submission path. An in-flight guard prevents duplicate answer submissions. Empty or extremely short responses are not sent.

When the timer expires, the frontend stops the recorder and Deepgram connection, validates the assembled answer, and sends the application WebSocket `answer` message.

## Text-To-Speech Pipeline

The backend TTS integration is in `apps/backend/services/tts.service.ts`.

For every generated question, the backend sends the text to ElevenLabs, collects the returned audio stream into a `Buffer`, converts it to Base64, and includes it in the WebSocket question message.

The frontend decodes the Base64 audio into an `AudioBuffer`. Playback completion is detected with `AudioBufferSourceNode.onended`. Only then does the frontend enter `user-listening` and open the Deepgram stream. This sequencing prevents the AI's own question audio from being accepted as a candidate answer.

## LLM Flow

All LLM requests are centralized in `apps/backend/services/llm.service.ts` and use OpenRouter’s chat completion endpoint.

Question prompts include the candidate name, target role, difficulty, skills, projects, experience, full extracted resume text, GitHub bio and repositories, and previous questions and answers.

The first turn asks the model to greet the candidate, briefly introduce the interview, and ask one technical question. Later turns ask it to acknowledge the answer naturally when appropriate and ask exactly one adaptive question. Generated output is stored as a question before its audio is generated.

When five questions exist, or when a session is already marked completed, the backend evaluates the complete history. The evaluation includes an overall score, rating, four category scores, answered count, strengths, improvements, detailed feedback, per-question feedback, and a summary.

Scores are clamped to `0..100` and rated as follows:

```text
85-100: Excellent
70-84:  Strong
50-69:  Developing
0-49:   Needs Improvement
```

If evaluation JSON cannot be generated or parsed, the backend creates a fallback evaluation based mainly on the number of answered questions.

## Database Model

The schema is defined in `apps/backend/db/schema.ts`.

### `candidates`

Stores the parsed candidate name, optional email, structured experience, skills, education, projects, raw resume text, and creation timestamp.

### `socials`

Stores one GitHub URL and one LinkedIn URL for a candidate. The candidate relationship is unique.

### `github_profiles`

Stores the enriched GitHub username, display name, bio, follower count, repository summaries, and update timestamps. Each candidate has at most one profile record.

### `interview_sessions`

Stores the candidate, role, difficulty, status, optional recording URL, evaluation feedback, score, and lifecycle timestamps.

### `interview_questions`

Stores the session question text, question number, question type, candidate response, optional feedback, and creation timestamp.

The current completion rule is five questions per session. A session can also complete earlier if its status is already `completed`.

## HTTP API Summary

| Method | Path                                | Purpose                                             |
| ------ | ----------------------------------- | --------------------------------------------------- |
| `POST` | `/api/v1/onboarding/extract-resume` | Parse a PDF resume and create a candidate record.   |
| `POST` | `/api/v1/onboarding/socials`        | Validate social URLs and enrich GitHub information. |
| `POST` | `/api/v1/onboarding/session`        | Create an interview session.                        |
| `POST` | `/api/v1/onboarding/question`       | Legacy or standalone question controller route.     |
| `POST` | `/api/v1/onboarding/answer`         | Legacy or standalone answer controller route.       |
| `GET`  | `/api/v1/interview/stt-token`       | Return a Deepgram browser credential.               |

The active frontend interview flow uses the WebSocket for questions and answers rather than the standalone question and answer routes.

## Environment Variables

Create `apps/backend/.env` with values for the services used by the backend:

```env
DATABASE_URL=postgresql://...
OPENROUTER_API_KEY=...
DEEPGRAM_API_KEY=...
ELEVENLABS_API_KEY=...
```

The frontend backend URL is currently configured in source code as `http://localhost:8000`.

Never commit provider keys or database credentials. The Deepgram key should have permission to create temporary browser tokens when the application is deployed.

## Local Development

Install workspace dependencies from the repository root:

```powershell
bun install
```

Start the backend:

```powershell
cd apps/backend
bun run dev
```

Start the frontend in a second terminal:

```powershell
cd apps/frontend
bun run dev
```

Workspace-wide operations are available from the root:

```powershell
bun run dev
bun run build
bun run lint
bun run check-types
```

The local database can be started with PostgreSQL and inspected with the repository’s Drizzle tooling. The actual `DATABASE_URL` must match the database that is running.

## Verification Checklist

When testing a complete interview locally, verify:

1. The backend starts on port `8000` without database or provider configuration errors.
2. The onboarding form accepts a PDF and valid social URLs.
3. Resume extraction returns a candidate ID.
4. GitHub enrichment returns or updates the candidate profile.
5. Session creation returns a session ID.
6. The application WebSocket receives `start` and returns a question.
7. ElevenLabs audio plays when TTS is configured.
8. The Deepgram credential endpoint returns a usable credential.
9. The browser receives interim and final transcript updates.
10. Four seconds without transcript activity sends exactly one `answer` message.
11. The backend returns the next question without closing the socket.
12. The final question produces a `completed` message and evaluation screen.

## Current Implementation Notes

- The frontend `result` route state is declared but is not currently used for completion navigation.
- The active interview flow uses the WebSocket; the REST question and answer routes remain registered but are not used by the current `InterviewPage`.
- CORS is enabled globally without an origin restriction, which is convenient for local development but should be restricted for deployment.
- GitHub requests use the public API without an authentication token, so public API limits apply.
- The Deepgram compatibility fallback can return a project key to the browser when temporary token creation is unavailable. Use a properly permissioned key for production.
- The backend waits for LLM and TTS work while processing an interview WebSocket message. The connection stays open, but the next question is not sent until those operations finish.
