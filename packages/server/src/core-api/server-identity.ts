import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../storage/sqlite.js";

/** Public profile identity is independent of relay registration credentials. */
export function readServerIdentity(database: SqliteDatabase): string {
  return database.transaction(() => {
    const insert = database.prepare(
      "INSERT OR IGNORE INTO public_server_identity (singleton, server_id) VALUES (1, ?)",
    );
    const select = database.prepare(
      "SELECT server_id FROM public_server_identity WHERE singleton = 1",
    );
    try {
      insert.run(randomUUID());
      const id = select.get()?.server_id;
      if (
        typeof id !== "string" ||
        !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)
      ) {
        throw new Error(
          "Invalid public YA server identity; restore the profile database",
        );
      }
      return id;
    } finally {
      insert.finalize();
      select.finalize();
    }
  });
}
