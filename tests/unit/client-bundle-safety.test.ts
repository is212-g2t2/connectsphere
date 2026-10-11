import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/** Scan every module in the client-reachable shared directories (`src/features`, `src/hooks`,
 * `src/lib`, `src/components`). A pure module enters the client bundle when a route imports it,
 * even with no server function. Exclude `src/db` (server-only) and `src/routes` (server routes
 * can import `.server` modules). The Start plugin blocks `*.server.ts` in the client build.
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

/** A value import of `#/db/schema` calls `pgTable()` at module scope. The bundler cannot prove
 * that this call has no side effects, so it keeps the whole module and sends every table, including
 * Better Auth tables, to the browser. `bun run build` does not catch this import, so this test
 * does.
 *
 * Also block `drizzle-orm`, its adapters, `postgres` and `pg`, the Better Auth server runtime,
 * Resend, and every `node:*` built-in. Allow Better Auth browser entrypoints and the shared
 * `better-auth/plugins/access` definitions.
 */
const SERVER_ONLY_IMPORT =
  /^(?:#\/db(?:\/[^"']*)?|bun(?::[^"']*)?|drizzle-orm(?:\/[^"']*)?|postgres|pg|better-auth(?:\/(?!client|react|plugins\/access)[^"']*)?|resend|nodemailer(?:\/[^"']*)?|node:[^"']*|[^"']*\.server)$/;

/** Capture the module specifier in a static `import` or `export … from` statement. Match the whole
 * file so wrapped imports and side-effect imports also match. Exclude `import type` (the bundler
 * removes it) and dynamic `import(` calls.
 */
const STATIC_IMPORT_SOURCE = /^[ \t]*(?:import|export)\s+(?!type\b)[^;]*?["']([^"']+)["']/gm;

/** Match an exported function that uses the shared `db` handle as a default parameter. This
 * includes declarations and arrow or function expressions, as required by `AGENTS.md`.
 */
const ANCHORED_DATABASE_DEFAULT =
  /export\s+(?:(?:async\s+)?function\s+\w+\s*\([^)]*=\s*db\b|const\s+\w+(?::[^=]+)?\s*=\s*(?:async\s+)?(?:function\s*)?\([^)]*=\s*db\b)/;

/** The server-only specifiers a module statically imports at top level. */
function serverOnlyImports(content: string): string[] {
  return Array.from(content.matchAll(STATIC_IMPORT_SOURCE))
    .map(match => match[1])
    .filter(specifier => SERVER_ONLY_IMPORT.test(specifier));
}

/** Report exported functions with an anchored `database = db` default. */
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
