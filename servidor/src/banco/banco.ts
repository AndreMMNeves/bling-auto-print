import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "./schema.ts";

export function abrirBanco(arquivo: string): DatabaseSync {
  const db = new DatabaseSync(arquivo);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  return db;
}

// Não aninhe: chamar transacao() dentro de outra transacao() dá erro de BEGIN.
export function transacao<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
