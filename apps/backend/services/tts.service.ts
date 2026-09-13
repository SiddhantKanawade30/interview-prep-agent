import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js/wrapper";

const VOICE_ID = "hpp4J3VqNfWAUOO0d1Us";
const MODEL_ID = "eleven_flash_v2_5";

let _client: ElevenLabsClient | null = null;

function getClient(): ElevenLabsClient {
    if (!_client) {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
        _client = new ElevenLabsClient({ apiKey });
    }
    return _client;
}

/**
 * Convert text to speech using ElevenLabs and return raw MP3 bytes.
 */
export async function textToSpeech(text: string): Promise<Buffer> {
    const client = getClient();

    const audioStream = await client.textToSpeech.convert(VOICE_ID, {
        text,
        modelId: MODEL_ID,
        outputFormat: "mp3_44100_128",
    });

    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) {
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}