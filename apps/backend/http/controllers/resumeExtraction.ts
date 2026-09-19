import type { Request, Response as ExpressResponse } from "express";
import { PDFParse } from "pdf-parse";
import { db } from "../../db/index";
import { candidates } from "../../db/schema";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

type OpenRouterResponse = {
    error?: unknown;
    choices?: Array<{
        message?: {
            content?: string | null;
        };
    }>;
};

export const extractDetails = async (req: Request, res: ExpressResponse) => {
    try {
        const file = req.file

        if (!file) {
            return res.status(400).json({
                message: "File is required",
            })
        }

        if (file.mimetype !== "application/pdf") {
            return res.status(400).json({
                message: "Only PDF files are allowed",
            })
        }

        const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
        const result = await parser.getText();
        const text = result.text;

        //now save the candidate profile 
        const structuredData = await getStructuredData(text);

        if (!structuredData) {
            return res.status(500).json({
                message: "Failed to extract structured data from resume",
            });
        }

        const [newCandidate] = await db.insert(candidates).values({
            name: structuredData.name || "Unknown",
            experience: structuredData.experience || [],
            skills: structuredData.skills || [],
            education: structuredData.education || [],
            projects: structuredData.projects || [],
            resumeText: text
        }).returning({ id: candidates.id });

        if (!newCandidate) {
            return res.status(500).json({
                message: "Failed to save extracted candidate",
            });
        }

        return res.status(200).json({
            message: "Details extracted and saved successfully",
            data: structuredData,
            candidateId: newCandidate.id
        })
    } catch (error) {
        console.log(error)
        res.status(500).json({
            message: error,
        })
    }
}

export const getStructuredData = async (text: string) => {
    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "google/gemini-2.5-flash",
                response_format: { type: "json_object" },
                max_tokens: 2000,
                messages: [
                    {
                        role: "system",
                        content: `You are an expert resume parser. Extract the following information from the provided resume text and return ONLY a valid JSON object matching this structure:
{
  "name": "Full Name",
  "education": [
    {
      "degree": "Degree Name",
      "field": "Field of Study",
      "college": "College Name"
    }
  ],
  "experience": [
    {
      "company": "Company Name",
      "role": "Job Role",
      "duration": "Duration",
      "skills": ["Skill1", "Skill2"]
    }
  ],
  "projects": [
    {
      "name": "Project Name",
      "technologies": ["Tech1", "Tech2"]
    }
  ],
  "skills": ["Skill1", "Skill2"]
}
Do not include any markdown formatting, backticks, or extra text.`
                    },
                    {
                        role: "user",
                        content: text
                    }
                ]
            })
        });

        const responseBody = response as unknown as { json: () => Promise<OpenRouterResponse> };
        const data = await responseBody.json();

        if (data.error) {
            console.error("OpenRouter API Error:", data.error);
            return null;
        }

        const content = data.choices?.[0]?.message?.content;
        if (!content) {
            console.error("OpenRouter API returned no resume content");
            return null;
        }

        let parsedContent = content;

        // Sometimes LLMs still wrap with markdown blocks even with json_object enabled
        if (parsedContent.startsWith("\`\`\`json")) {
            parsedContent = parsedContent.replace(/^\`\`\`json\n/, "").replace(/\n\`\`\`$/, "");
        } else if (parsedContent.startsWith("\`\`\`")) {
            parsedContent = parsedContent.replace(/^\`\`\`\n/, "").replace(/\n\`\`\`$/, "");
        }

        return JSON.parse(parsedContent);
    } catch (error) {
        console.error("Error extracting structured data:", error);
        return null;
    }
}