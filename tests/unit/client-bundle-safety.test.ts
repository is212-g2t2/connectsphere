import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Every module under the client-reachable shared directories — `src/features`, `src/hooks`,
 * `src/lib`, `src/components` — whether or not it declares a server function or imports a server
 * module today. Selecting on `createServerFn(` left a hole: a pure module a route imports reaches
 * the client bundle just the same. `src/db` stays out (server-only by construction) and so does
 * `src/routes` (its server routes import `.server` modules on purpose).
 *
 * `*.server.ts` modules are exempt and held from the other side instead:
 * `@tanstack/start-plugin-core` denies them in the client environment at build time.
 */
function getModules(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getModules(fullPath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * `#/db` alone used to be the whole list, which let `#/db/schema` through — a value import of
 * the table definitions, which drizzle builds by calling `pgTable()` at module scope. A bundler
 * cannot prove that side-effect free, so the module is retained whole and the entire schema,
 * Better Auth tables included, is served to the browser. It never fails `bun run build`, so the
 * only thing standing between that and production is this test.
 *
 * `drizzle-orm`, its adapters, the raw `postgres`/`pg` drivers, the `better-auth` server runtime,
 * the `resend` client and every `node:*` built-in are the same kind of runtime server dependency.
 * `better-auth`'s browser entrypoints (`better-auth/react`, `better-auth/client/*`) and the
 * shared `better-auth/plugins/access` definitions are client-safe and stay allowed.
 */
const SERVER_ONLY_IMPORT =
  /^(?:#\/db(?:\/[^"']*)?|bun(?::[^"']*)?|drizzle-orm(?:\/[^"']*)?|postgres|pg|better-auth(?:\/(?!client|react|plugins\/access)[^"']*)?|resend|nodemailer(?:\/[^"']*)?|node:[^"']*|[^"']*\.server)$/;

/**
 * A static `import`/`export … from` statement, with its module specifier captured. Matched over
 * the whole file rather than line by line, so a wrapped import reads the same as a single-line
 * one — and a side-effect `import "#/db/schema";` is captured too. `import type` is excluded
 * (it is erased before the bundler sees it), and a dynamic `import(` has no space after the
 * keyword, so it never matches.
 */
const STATIC_IMPORT_SOURCE = /^[ \t]*(?:import|export)\s+(?!type\b)[^;]*?["']([^"']+)["']/gm;

/**
 * A default parameter anchored on the shared `db` handle. Matches both function declarations and
 * arrow/function-expression exports (`export const list = (database = db) => …`), since the rule
 * in AGENTS.md covers any exported function, not just `function` declarations.
 */
const ANCHORED_DATABASE_DEFAULT =
  /export\s+(?:(?:async\s+)?function\s+\w+\s*\([^)]*=\s*db\b|const\s+\w+(?::[^=]+)?\s*=\s*(?:async\s+)?(?:function\s*)?\([^)]*=\s*db\b)/;

/** The server-only specifiers a module statically imports at top level. */
function serverOnlyImports(content: string): string[] {
  return Array.from(content.matchAll(STATIC_IMPORT_SOURCE))
    .map(match => match[1])
    .filter(specifier => SERVER_ONLY_IMPORT.test(specifier));
}

/** Whether an exported function anchors `database = db` instead of taking it injected. */
function anchorsDatabaseDefault(content: string): boolean {
  return ANCHORED_DATABASE_DEFAULT.test(content);
}

const GUARDED_DIRS = ["src/features", "src/hooks", "src/lib", "src/components"];

describe("Client-Reachable Module Client Safety", () => {
  const guardedModules = GUARDED_DIRS.flatMap(dir =>
    getModules(path.resolve(process.cwd(), dir))
  ).filter(filePath => !/\.server\.tsx?$/.test(filePath));

  it("finds client-reachable modules to guard", () => {
    expect(guardedModules.length).toBeGreaterThan(0);
  });

  guardedModules.forEach(filePath => {
    const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");

    it(`${relPath} does not statically import server-only modules at top level`, () => {
      const content = fs.readFileSync(filePath, "utf-8");
      expect(serverOnlyImports(content)).toEqual([]);
    });

    it(`${relPath} does not anchor database default parameter on exported functions`, () => {
      const content = fs.readFileSync(filePath, "utf-8");
      expect(anchorsDatabaseDefault(content)).toBe(false);
    });
  });
});

describe("Client-safety scan (self-test)", () => {
  it.each([
    `import { db } from "#/db";`,
    `import "#/db/schema";`,
    `import { SQL } from "bun";`,
    `import { sql } from "drizzle-orm";`,
    `import { pgTable } from "drizzle-orm/pg-core";`,
    `import postgres from "postgres";`,
    `import { Pool } from "pg";`,
    `import { betterAuth } from "better-auth";`,
    `import { drizzleAdapter } from "better-auth/adapters/drizzle";`,
    `import { Resend } from "resend";`,
    `import { createTransport } from "nodemailer";`,
    `import fs from "node:fs";`,
    `import { records } from "./records.server";`,
  ])("flags server-only import: %s", source => {
    expect(serverOnlyImports(source)).toHaveLength(1);
  });

  it("does not flag client-safe, type-only, or dynamic imports", () => {
    expect(serverOnlyImports(`import { z } from "zod";`)).toEqual([]);
    expect(serverOnlyImports(`import type { Database } from "#/db";`)).toEqual([]);
    expect(serverOnlyImports(`const { db } = await import("#/db");`)).toEqual([]);
    expect(serverOnlyImports(`import { createAuthClient } from "better-auth/react";`)).toEqual([]);
    expect(serverOnlyImports(`import { access } from "better-auth/plugins/access";`)).toEqual([]);
    expect(serverOnlyImports(`import { adminClient } from "better-auth/client/plugins";`)).toEqual(
      []
    );
  });

  it.each([
    `export function listRows(database = db) {}`,
    `export async function listRows(database = db) {}`,
    `export const listRows = (database = db) => {};`,
    `export const listRows = async (id: string, database = db) => {};`,
    `export const listRows = function (database = db) {};`,
  ])("flags anchored database default: %s", source => {
    expect(anchorsDatabaseDefault(source)).toBe(true);
  });

  it("does not flag injected or non-exported parameters", () => {
    expect(anchorsDatabaseDefault(`export function listRows(database: Database) {}`)).toBe(false);
    expect(anchorsDatabaseDefault(`function listRows(database = db) {}`)).toBe(false);
    expect(anchorsDatabaseDefault(`export const listRows = (database = db2) => {};`)).toBe(false);
  });
});
