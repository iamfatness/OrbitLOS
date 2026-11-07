import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { executeCommand } from "./commands";
import { borrowerCommandResult } from "./applications";
import { reserveAddressLookup } from "./places";
import type { StaffIdentity } from "./staff-store";
import { initializeStore, workspace, type SqlValue, type Store } from "./store";

let connection: Store | undefined;

function database(): Store {
  if (connection) return connection;
  const path = resolve(/* turbopackIgnore: true */ process.env.ORBIT_DB_PATH || ".orbit/orbit.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new DatabaseSync(path);
  const store: Store = {
    exec(sql) {
      sqlite.exec(sql);
    },
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        get: (...args) => statement.get(...args) as Record<string, SqlValue> | undefined,
        all: (...args) => statement.all(...args) as Record<string, SqlValue>[],
        run: (...args) => { statement.run(...args); },
      };
    },
    transaction(run) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = run();
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  try {
    sqlite.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    initializeStore(store);
  } catch (error) {
    sqlite.close();
    throw error;
  }
  connection = store;
  return store;
}

export function loadWorkspace() {
  return workspace(database());
}

export async function updateWorkspace(input: unknown, staff: StaffIdentity | null) {
  return executeCommand(database(), input, staff);
}

export async function updateBorrowerApplication(input: unknown) {
  return borrowerCommandResult(database(), input);
}

export function reserveBorrowerAddressLookup(token: string) {
  return reserveAddressLookup(database(), token);
}
