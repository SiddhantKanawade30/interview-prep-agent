import { useState } from "react"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { toast } from "sonner"
import axios from "axios"
import { BACKEND_URL } from "../lib/config"

export default function Form({ onStart }: { onStart?: (sessionId: number) => void }) {
    const [github, setGithub] = useState("")
    const [linkedIn, setLinkedIn] = useState("")
    const [resume, setResume] = useState<File | null>(null)
    const [role, setRole] = useState("")
    const [difficulty, setDifficulty] = useState("medium")
    const [isLoading, setIsLoading] = useState(false)

    async function Submit() {
        if (!github || !linkedIn || !resume || !role) {
            toast.warning("Please provide your LinkedIn, GitHub, Resume, and Role", { position: "top-center" })
            return;
        }
        
        setIsLoading(true)
        try {

            const formData = new FormData();
            formData.append("resume", resume);

            const resumeRes = await axios.post(`${BACKEND_URL}/api/v1/onboarding/extract-resume`, formData, {
                headers: {
                    "Content-Type": "multipart/form-data"
                }
            })
            
            console.log(resumeRes.data);
            const candidateId = resumeRes.data.candidateId;

            const socialsRes = await axios.post(`${BACKEND_URL}/api/v1/onboarding/socials`, {
                github,
                linkedIn,
                candidateId
            })
            const activeCandidateId = socialsRes.data.candidateId ?? candidateId;

            const sessionRes = await axios.post(`${BACKEND_URL}/api/v1/onboarding/session`, {
                candidateId: activeCandidateId,
                role,
                difficulty
            })

            toast.success("Profile saved and resume parsed successfully!", { position: "top-center" })

            if (onStart && sessionRes.data.sessionId) {
                onStart(sessionRes.data.sessionId);
            }

        } catch (err) {
            console.log(err)
            toast.error("An error occurred during submission", { position: "top-center" })
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="h-screen w-screen flex items-center justify-center">
            <div className="flex flex-col items-center space-y-4 w-full max-w-sm px-4">
                <h2 className="scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight first:mt-0">
                    AI Interviewer
                </h2>
                <div className="w-full space-y-2 text-left pb-4">
                    <Label htmlFor="resume">Upload Resume (PDF)</Label>
                    <Input id="resume" type="file" accept=".pdf" className="w-full" onChange={(e) => setResume(e.target.files?.[0] || null)} />
                </div>
                
                <div className="w-full space-y-4 pt-3">
                    <Input placeholder="Linkedin URL" className="w-full" onChange={(e) => setLinkedIn(e.target.value)} />
                    <Input placeholder="GitHub URL" className="w-full" onChange={(e) => setGithub(e.target.value)} />
                    <Input placeholder="Role (e.g. Frontend Engineer)" className="w-full" onChange={(e) => setRole(e.target.value)} />
                    <div className="w-full space-y-2 text-left">
                        <Label htmlFor="difficulty">Difficulty</Label>
                        <select 
                            id="difficulty" 
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            value={difficulty} 
                            onChange={(e) => setDifficulty(e.target.value)}
                        >
                            <option value="easy">Easy</option>
                            <option value="medium">Medium</option>
                            <option value="hard">Hard</option>
                        </select>
                    </div>
                </div>

                <Button className="w-full mt-4" onClick={Submit} disabled={isLoading}>
                    {isLoading ? "Processing..." : "Start Interview"}
                </Button>
            </div>
        </div>
    )
}