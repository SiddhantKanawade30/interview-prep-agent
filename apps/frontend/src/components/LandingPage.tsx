import { ArrowRight, FileText, Mic, Sparkles, UserRound } from "lucide-react";
import { Button } from "./ui/button";

type LandingPageProps = {
  onStart: () => void;
};

export default function LandingPage({ onStart }: LandingPageProps) {
  return (
    <main className="landing-page min-h-screen overflow-hidden bg-background text-foreground">
      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5 lg:px-8" aria-label="Main navigation">
        <button className="group flex items-center gap-2.5" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Sparkles className="size-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight">Interview Prep Agent</span>
        </button>

        <div className="flex items-center gap-2">
          <a
            className="inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            href="https://github.com/SiddhantKanawade30/interview-prep-agent"
            target="_blank"
            rel="noreferrer"
          >
            <img className="size-4" src="https://cdn.simpleicons.org/github" alt="" aria-hidden="true" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
          <Button variant="outline" size="sm" onClick={onStart}>
            Start interview
            <ArrowRight />
          </Button>
        </div>
      </nav>

      <section className="relative mx-auto grid max-w-6xl items-center gap-14 px-6 pb-20 pt-14 lg:grid-cols-[1.02fr_0.98fr] lg:px-8 lg:pb-28 lg:pt-24">
        <div className="relative z-10 max-w-xl">
          <h1 className="landing-reveal landing-reveal-delay-1 text-balance text-5xl font-semibold tracking-[-0.045em] sm:text-6xl lg:text-7xl">
            Meet your interview prep agent.
          </h1>
          <p className="landing-reveal landing-reveal-delay-2 mt-6 max-w-lg text-lg leading-8 text-muted-foreground">
            A focused, voice-first interview practice room that uses your experience to help you show up sharper and more confident.
          </p>
          <div className="landing-reveal landing-reveal-delay-3 mt-8 flex flex-col gap-3 sm:flex-row">
            <Button size="lg" onClick={onStart}>
              Begin your interview
              <ArrowRight />
            </Button>
          </div>
          <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
            <div className="flex -space-x-2">
              <span className="flex size-7 items-center justify-center rounded-full border-2 border-background bg-sky-100 text-sky-700"><FileText className="size-3.5" /></span>
              <span className="flex size-7 items-center justify-center rounded-full border-2 border-background bg-blue-100 text-blue-700"><UserRound className="size-3.5" /></span>
              <span className="flex size-7 items-center justify-center rounded-full border-2 border-background bg-amber-100 text-amber-700"><Mic className="size-3.5" /></span>
            </div>
            Bring your resume, role, and real experience.
          </div>
        </div>

        <div className="landing-reveal landing-reveal-delay-2 relative mx-auto w-full max-w-lg lg:ml-auto">
          <div className="absolute -inset-10 -z-10 bg-[radial-gradient(circle_at_center,var(--color-blue-100),transparent_65%)] opacity-70" />
          <div className="rounded-xl border bg-card p-2 shadow-2xl shadow-slate-200/70">
            <div className="rounded-lg border bg-muted/30 p-5 sm:p-6">
              <div className="mb-8 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden="true">
                      <path d="M2 10v3" />
                      <path d="M6 6v11" />
                      <path d="M10 3v18" />
                      <path d="M14 8v7" />
                      <path d="M18 5v13" />
                      <path d="M22 10v3" />
                    </svg>
                  </span>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Live interview</p>
                    <p className="text-sm font-semibold">Frontend Engineer</p>
                  </div>
                </div>
                <span className="flex items-center gap-1.5 text-xs text-emerald-600"><span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />Ready</span>
              </div>
              <div className="rounded-lg border bg-background p-5 shadow-sm">
                <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Question 01</p>
                <p className="text-lg font-medium leading-7 tracking-tight">Tell me about a frontend decision that made a meaningful difference for your users.</p>
                <div className="mt-8 flex items-center justify-between border-t pt-4">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">Listening</span>
                    <div className="voice-visualizer" role="img" aria-label="Voice activity">
                      {[20, 34, 48, 30, 56, 38, 24].map((height, index) => (
                        <span key={index} style={{ height: `${height}%`, animationDelay: `${index * 90}ms` }} />
                      ))}
                    </div>
                  </div>
                  <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground"><Mic className="size-4" /></span>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><span className="h-1.5 flex-1 rounded-full bg-primary" /><span className="h-1.5 flex-1 rounded-full bg-primary/20" /><span className="h-1.5 flex-1 rounded-full bg-primary/20" /><span>1 of 8</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16 text-center lg:px-8 lg:py-20">
        <p className="text-sm font-medium text-muted-foreground">No accounts. No noise. Just practice.</p>
        <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">Make the next conversation feel familiar.</h2>
        <Button className="mt-7" onClick={onStart}>Set up an interview <ArrowRight /></Button>
      </section>
    </main>
  );
}