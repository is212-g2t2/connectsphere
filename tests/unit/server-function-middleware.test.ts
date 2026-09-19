import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * PTR-69: a server function is a directly addressable HTTP route, so "the route guard hid the
 * control" is not enforcement. Every `createServerFn` under `src/features` therefore declares the
 * middleware that verifies the session and the required permission before its handler can run —
 * `withSession`/`requireSession`/`requirePermission` in `src/features/auth/session.ts`, or a
 * `requirePermission(...)` alias such as `requireVenueRead`.
 *
 * The behavioural half (401 and 403, with no handler execution) is
 * `tests/integration/server-function-authorization.test.ts`; this scan is what keeps the next
 * server function from being the one that omits the pipeline.
 */
const featuresDir = path.resolve(process.cwd(), "src/features");

function featureModules(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map(entry => path.join(dir, entry))
    .filter(filePath => filePath.endsWith(".ts") || filePath.endsWith(".tsx"));
}

/**
 * Blank out comments so a commented-out `.middleware([...])` is not read as a real call. Quotes
 * are tracked so a `//` inside a string literal survives. Regex literals are left alone.
 */
function stripComments(source: string): string {
  let out = "";
  let quote: string | null = null;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];

    if (quote) {
      out += char;
      if (char === "\\") {
        out += next ?? "";
        i++;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      out += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      out += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i++;
      continue;
    }

    out += char;
  }

  return out;
}

/** Enforcing middleware names: the canonical trio plus every alias declared from one of them. */
function enforcementNames(sources: readonly string[]): Set<string> {
  const names = new Set(["withSession", "requireSession", "requirePermission"]);
  const alias =
    /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:requirePermission|requireSession|withSession)\b/g;

  for (const source of sources) {
    for (const match of stripComments(source).matchAll(alias)) names.add(match[1]);
  }

  return names;
}

/**
 * Slice each `createServerFn` chain at the next one. A non-greedy match over the whole file lets a
 * middleware-less chain swallow a later compliant chain's `.middleware(...)`, so the units have to
 * be independent.
 */
function serverFnChains(source: string): string[] {
  const clean = stripComments(source);
  const starts = Array.from(clean.matchAll(/createServerFn\s*\(/g), match => match.index ?? 0);

  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : clean.length;
    return clean.slice(start, end);
  });
}

/** Chains whose pre-handler middleware is absent, empty, or does not name enforcing middleware. */
function middlewareViolations(source: string, enforcing: ReadonlySet<string>): string[] {
  const violations: string[] = [];

  for (const chain of serverFnChains(source)) {
    const handlerIndex = chain.indexOf(".handler(");
    const head = handlerIndex === -1 ? chain : chain.slice(0, handlerIndex);
    const match = head.match(/\.middleware\s*\(\s*\[([^\]]*)\]\s*\)/);

    if (!match) {
      violations.push(chain.trim().slice(0, 60));
      continue;
    }

    const entries = match[1]
      .split(",")
      .map(entry => entry.trim())
      .filter(Boolean);

    if (entries.length === 0) {
      violations.push(chain.trim().slice(0, 60));
      continue;
    }

    const allEnforcing = entries.every(entry => {
      const name = entry.match(/^[A-Za-z_$][\w$]*/)?.[0];
      return name !== undefined && enforcing.has(name);
    });

    if (!allEnforcing) violations.push(chain.trim().slice(0, 60));
  }

  return violations;
}

describe("Server-function authorization pipeline (PTR-69)", () => {
  const modules = featureModules(featuresDir);
  const sources = modules.map(filePath => fs.readFileSync(filePath, "utf-8"));
  const enforcing = enforcementNames(sources);

  it("finds feature modules to guard", () => {
    expect(modules.length).toBeGreaterThan(0);
  });

  it("runs every createServerFn behind enforcing middleware", () => {
    const offenders: string[] = [];

    modules.forEach((filePath, index) => {
      const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
      for (const violation of middlewareViolations(sources[index], enforcing)) {
        offenders.push(`${relPath}: ${violation}`);
      }
    });

    expect(offenders).toEqual([]);
  });
});

describe("Component middleware scan (self-test)", () => {
  const enforcing = new Set([
    "withSession",
    "requireSession",
    "requirePermission",
    "requireVenueRead",
  ]);

  it("accepts a chain guarded by an enforcing middleware", () => {
    const source = `createServerFn().middleware([requireSession]).handler(() => {})`;
    expect(middlewareViolations(source, enforcing)).toEqual([]);
  });

  it("rejects an empty middleware array", () => {
    const source = `createServerFn().middleware([]).handler(() => {})`;
    expect(middlewareViolations(source, enforcing)).toHaveLength(1);
  });

  it("rejects a chain with no middleware", () => {
    const source = `createServerFn().handler(() => {})`;
    expect(middlewareViolations(source, enforcing)).toHaveLength(1);
  });

  it("rejects a logging-only middleware", () => {
    const source = `createServerFn().middleware([logRequest]).handler(() => {})`;
    expect(middlewareViolations(source, enforcing)).toHaveLength(1);
  });

  it("rejects a commented-out middleware call", () => {
    const source = `createServerFn()\n  // .middleware([requireSession])\n  .handler(() => {})`;
    expect(middlewareViolations(source, enforcing)).toHaveLength(1);
  });

  it("evaluates each createServerFn independently", () => {
    const source = [
      `createServerFn().handler(() => {})`,
      `createServerFn().middleware([requireSession]).handler(() => {})`,
    ].join("\n");

    expect(middlewareViolations(source, enforcing)).toHaveLength(1);
  });

  it("resolves requirePermission aliases across the sources", () => {
    const source = [
      `export const requireThing = requirePermission({ thing: ["read"] });`,
      `createServerFn().middleware([requireThing]).handler(() => {})`,
    ].join("\n");

    expect(middlewareViolations(source, enforcementNames([source]))).toEqual([]);
  });
});
