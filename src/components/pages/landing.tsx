import { useState } from "react";
import { Check, Copy } from "lucide-react";

const REPO_URL = "https://github.com/zek01svg/tanstack-start-template";
const DOCS_URL = "https://tanstack.com/start/latest/docs/framework/react/overview";

const QUICKSTART = `git clone https://github.com/zek01svg/tanstack-start-template.git
cd tanstack-start-template
bun install && bun dev`;

interface TreeEntry {
  glyph: string;
  path: string;
  note?: string;
}

const TREE: TreeEntry[][] = [
  [
    { glyph: "", path: "src/" },
    { glyph: "├─", path: "routes/", note: "File-based routing, auth-guarded loaders" },
    { glyph: "├─", path: "features/auth/", note: "Better Auth: email OTP, passkeys, Google" },
    { glyph: "├─", path: "db/", note: "Drizzle ORM schema and migrations" },
    { glyph: "├─", path: "lib/", note: "Mailer (Resend), storage (S3 presign), Redis" },
    { glyph: "└─", path: "components/ui/", note: "shadcn primitives, themed once here" },
  ],
  [
    { glyph: "", path: "tests/" },
    { glyph: "├─", path: "unit/", note: "Vitest, pure logic" },
    { glyph: "├─", path: "integration/", note: "Testcontainers against real Postgres" },
    { glyph: "└─", path: "e2e/", note: "Playwright against the built app" },
  ],
];

const ALSO_INCLUDED = [
  { term: "Observability", detail: "Sentry and OpenTelemetry wired into server startup" },
  { term: "Infrastructure", detail: "Dockerfile and compose file with Postgres and MinIO" },
  { term: "Guardrails", detail: "Pre-commit hooks run format, lint, and typecheck" },
];

export function LandingPage() {
  return (
    <main className="mx-auto max-w-4xl px-6">
      <HeroSection />
      <ContentsSection />
      <footer className="mt-24 flex flex-col gap-4 border-t border-border py-8 font-mono text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>MIT license</span>
        <nav className="flex gap-6">
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground"
          >
            TanStack Start docs
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground"
          >
            GitHub
          </a>
        </nav>
      </footer>
    </main>
  );
}

function HeroSection() {
  return (
    <section className="animate-in fade-in text-foreground duration-700">
      <div className="py-20 md:py-28">
        <p className="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
          TanStack Start template
        </p>

        <h1 className="font-heading mt-6 max-w-2xl text-5xl font-semibold tracking-tight text-balance text-foreground md:text-7xl md:leading-[1.02]">
          Start from done.
        </h1>

        <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
          Auth with OTP and passkeys, Postgres through Drizzle, transactional email, presigned
          uploads, production-mirrored tests, tracing on day one. Clone it, delete the demo notes,
          build your product.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Get started
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
          >
            View on GitHub
          </a>
        </div>

        <QuickstartBlock />
      </div>
    </section>
  );
}

function QuickstartBlock() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(QUICKSTART);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <figure className="mt-14 max-w-xl">
      <figcaption className="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
        Quickstart
      </figcaption>
      <div className="relative mt-3 rounded-md border border-border bg-card p-4">
        <pre className="overflow-x-auto pr-10 font-mono text-xs leading-relaxed sm:text-sm">
          {QUICKSTART.split("\n").map(line => (
            <div key={line} className="whitespace-pre">
              <span className="mr-3 text-muted-foreground select-none">$</span>
              {line}
            </div>
          ))}
        </pre>
        <button
          type="button"
          onClick={() => void handleCopy()}
          aria-label={copied ? "Copied" : "Copy commands"}
          className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-md bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </button>
      </div>
    </figure>
  );
}

function ContentsSection() {
  return (
    <section className="border-t border-border pt-16" aria-labelledby="contents-heading">
      <h2 id="contents-heading" className="font-heading text-2xl font-semibold tracking-tight">
        What&rsquo;s inside
      </h2>

      <ul className="mt-8 space-y-8">
        {TREE.map(group => (
          <li key={group[0].path}>
            <ul>
              {group.map(entry =>
                entry.note ? (
                  <li
                    key={`${entry.glyph}${entry.path}`}
                    className="flex flex-col py-1.5 sm:flex-row sm:items-baseline sm:gap-4"
                  >
                    <span className="w-64 shrink-0 font-mono text-sm whitespace-pre">
                      <span className="mr-1 text-muted-foreground">{entry.glyph}</span>
                      {entry.path}
                    </span>
                    <span className="text-sm text-muted-foreground">{entry.note}</span>
                  </li>
                ) : (
                  <li
                    key={entry.path}
                    className="pt-4 pb-1 font-mono text-sm font-medium first:pt-0"
                  >
                    {entry.path}
                  </li>
                )
              )}
            </ul>
          </li>
        ))}
      </ul>

      <dl className="mt-12 space-y-4 border-t border-border pt-8">
        {ALSO_INCLUDED.map(item => (
          <div key={item.term} className="flex flex-col gap-1 sm:flex-row sm:gap-4">
            <dt className="w-64 shrink-0 text-sm font-medium">{item.term}</dt>
            <dd className="text-sm text-muted-foreground">{item.detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
