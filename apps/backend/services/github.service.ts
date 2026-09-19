type GithubFetchResponse = {
    ok: boolean;
    json: () => Promise<unknown>;
};

export async function getGithubProfile(githubUrl: string) {
    const username = githubUrl.split("/").filter(Boolean).pop();

    if (!username) {
        throw new Error("Invalid GitHub URL");
    }

    const [profileResponse, reposResponse] = await Promise.all([
        fetch(`https://api.github.com/users/${username}`),
        fetch(
            `https://api.github.com/users/${username}/repos?sort=updated&per_page=100`
        )
    ]) as [GithubFetchResponse, GithubFetchResponse];

    if (!profileResponse.ok || !reposResponse.ok) {
        throw new Error("Failed to fetch GitHub data");
    }

    const profile = await profileResponse.json() as any;
    const repositories = await reposResponse.json() as any;

    return {
        username: profile.login,
        name: profile.name,
        bio: profile.bio,
        followers: profile.followers,

        repositories: repositories.map((repo: any) => ({
            name: repo.name,
            description: repo.description,
            language: repo.language,
            stars: repo.stargazers_count,
            forks: repo.forks_count,
            url: repo.html_url
        }))
    };
}