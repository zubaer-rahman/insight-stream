import Link from "next/link";
import { Logo } from "@/components/ui/logo";

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path
        fill="currentColor"
        d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.88c-2.78.6-3.37-1.19-3.37-1.19-.46-1.15-1.12-1.45-1.12-1.45-.91-.63.07-.62.07-.62 1 .07 1.54 1.03 1.54 1.03.9 1.53 2.35 1.09 2.92.83.09-.64.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.93 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.9-1.29 2.74-1.02 2.74-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.83-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .26.18.57.69.48A10 10 0 0 0 12 2Z"
      />
    </svg>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/70 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-4">
        <Link href="/" className="inline-flex items-center gap-2">
          <Logo className="h-8 w-8" />
          <span className="text-sm font-semibold tracking-wide text-zinc-100">
            Insight Stream
          </span>
        </Link>

        <nav className="flex items-center gap-2">
          <Link
            href="/demo"
            className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
          >
            Demo
          </Link>
          <a
            href="https://github.com/zubaer-rahman/insight-stream"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
          >
            <GitHubIcon />
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
