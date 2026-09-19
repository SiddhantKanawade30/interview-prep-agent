import type { Request, Response } from "express";
import { preInterviewSchema } from "../../zod/socials";
import { db } from "../../db/index";
import { candidates, github_profiles, socials } from "../../db/schema";
import { getGithubProfile } from "../../services/github.service";
import { eq, or } from "drizzle-orm";

export async function onBoardingController(
    req: Request,
    res: Response
) {
    try {
        const { github, linkedIn, candidateId } = req.body;

        const result = preInterviewSchema.safeParse({
            github,
            linkedIn,
            candidateId,
        });

        if (!result.success) {
            return res.status(400).json({
                message: "Invalid social profile details",
                errors: result.error.issues,
            });
        }

        const profileData = await getGithubProfile(result.data.github);
        const existingSocial = await db.query.socials.findFirst({
            where: or(
                eq(socials.github, result.data.github),
                eq(socials.linkedIn, result.data.linkedIn),
            ),
        });

        if (existingSocial) {
            const [resumeCandidate, existingCandidate] = await Promise.all([
                db.query.candidates.findFirst({
                    where: eq(candidates.id, result.data.candidateId),
                }),
                db.query.candidates.findFirst({
                    where: eq(candidates.id, existingSocial.candidateId),
                }),
            ]);

            if (!resumeCandidate || !existingCandidate) {
                throw new Error("Candidate not found");
            }

            await db
                .update(candidates)
                .set({
                    name: resumeCandidate.name,
                    experience: resumeCandidate.experience,
                    skills: resumeCandidate.skills,
                    education: resumeCandidate.education,
                    projects: resumeCandidate.projects,
                    resumeText: resumeCandidate.resumeText,
                })
                .where(eq(candidates.id, existingCandidate.id));

            await db
                .update(socials)
                .set({
                    github: result.data.github,
                    linkedIn: result.data.linkedIn,
                })
                .where(eq(socials.id, existingSocial.id));

            const profileUpdate = {
                username: profileData.username,
                name: profileData.name,
                bio: profileData.bio,
                followers: profileData.followers,
                repositories: profileData.repositories,
                updatedAt: new Date(),
            };
            const existingProfile = await db.query.github_profiles.findFirst({
                where: eq(github_profiles.candidateId, existingCandidate.id),
            });

            if (existingProfile) {
                await db
                    .update(github_profiles)
                    .set(profileUpdate)
                    .where(eq(github_profiles.id, existingProfile.id));
            } else {
                await db.insert(github_profiles).values({
                    candidateId: existingCandidate.id,
                    ...profileUpdate,
                });
            }

            return res.status(200).json({
                message: "User updated and GitHub profile scraped successfully",
                candidateId: existingCandidate.id,
            });
        }

        await db.insert(socials).values(result.data);

        await db.insert(github_profiles).values({
            candidateId: result.data.candidateId,
            username: profileData.username,
            name: profileData.name,
            bio: profileData.bio,
            followers: profileData.followers,
            repositories: profileData.repositories,
        });

        return res.status(201).json({
            message: "User added and GitHub profile scraped successfully",
            candidateId: result.data.candidateId,
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            message: "Failed to save social profiles. Please check the URLs and try again.",
        });
    }
}