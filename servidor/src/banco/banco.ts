import { createClient, type Client } from "@libsql/client";
import { SCHEMA } from "./schema.ts";

// url: ":memory:" (testes), "file:dados/expedicao.db" (PC local) ou "libsql://...turso.io" (Vercel).
export async function abrirBanco(url: string, authToken?: string): Promise<Client> {
  const db = createClient(authToken ? { url, authToken } : { url });
  await db.executeMultiple(SCHEMA);
  return db;
}
