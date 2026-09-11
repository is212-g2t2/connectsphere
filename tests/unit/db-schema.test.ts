import { describe, expect, it } from "vitest";
import {
  extractTablesRelationalConfig,
  createTableRelationsHelpers,
  getTableColumns,
} from "drizzle-orm";
import * as schema from "#/db/schema";
import {
  user,
  session,
  account,
  verification,
  userRelations,
  sessionRelations,
  accountRelations,
} from "#/db/schema";

describe("Database Schema Definitions", () => {
  it("defines auth schema tables and column names", () => {
    expect(getTableColumns(user).email.name).toBe("email");
    expect(getTableColumns(user).role.name).toBe("role");
    expect(getTableColumns(session).token.name).toBe("token");
    expect(getTableColumns(account).providerId.name).toBe("provider_id");
    expect(getTableColumns(verification).identifier.name).toBe("identifier");
  });

  it("defines relations between user, session, and account", () => {
    expect(userRelations.table).toBe(user);
    expect(sessionRelations.table).toBe(session);
    expect(accountRelations.table).toBe(account);
  });

  it("extracts and validates full relational schema config", () => {
    const { tables } = extractTablesRelationalConfig(schema, createTableRelationsHelpers);

    expect(tables.user).toBeDefined();
    expect(tables.session).toBeDefined();
    expect(tables.account).toBeDefined();

    expect(tables.user.relations.sessions).toBeDefined();
    expect(tables.user.relations.accounts).toBeDefined();
    expect(tables.session.relations.user).toBeDefined();
    expect(tables.account.relations.user).toBeDefined();
  });
});
