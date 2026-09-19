/**
 * Generic LLM Service for OpenRouter API integrations
 */

type LLMFetchResponse = {
    ok: boolean;
    status: number;
    text: () => Promise<string>;
    json: () => Promise<unknown>;
};

export async function generateLLMCompletion(
    prompt: string,
    systemPrompt?: string,
    model: string = "openrouter/free"
): Promise<string> {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
        throw new Error("OPENROUTER_API_KEY is not set in environment variables");
    }

    const messages = [];
    if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model,
            messages,
        }),
    }) as unknown as LLMFetchResponse;

    if (!response.ok) {
        const errorBody = await response.text();
        console.error("OpenRouter API error:", response.status, errorBody);
        throw new Error(`OpenRouter API error: ${response.status} - ${errorBody}`);
    }

    const data = (await response.json()) as {
        choices: { message: { content: string } }[];
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error("No content returned from LLM service");
    }

    return content.trim();
}

/**
 * Generic JSON generator with robust JSON extraction and parsing
 */
export async function generateLLMJSON<T>(
    prompt: string,
    systemPrompt?: string,
    model: string = "openrouter/free"
): Promise<T> {
    const rawContent = await generateLLMCompletion(prompt, systemPrompt, model);

    // Extract raw JSON matching curly braces or brackets to ignore extra LLM conversational text
    const jsonMatch = rawContent.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    const cleanedJSON = jsonMatch ? jsonMatch[0] : rawContent.replace(/```json/g, "").replace(/```/g, "").trim();

    try {
        return JSON.parse(cleanedJSON) as T;
    } catch (error) {
        console.error("Failed to parse JSON from LLM response:", rawContent);
        throw new Error(`LLM returned invalid JSON format: ${(error as Error).message}`);
    }
}
