import type { Client } from "@libsql/client";
import { SCHEMA } from "./schema.ts";

// url: ":memory:" (testes), "file:dados/expedicao.db" (PC local) ou "libsql://...turso.io" (Vercel).
// Na nuvem usa o cliente web (só HTTP, sem binário nativo), que roda na Vercel.
export async function abrirBanco(url: string, authToken?: string): Promise<Client> {
  const local = url === ":memory:" || url.startsWith("file:");
  const { createClient } = local ? await import("@libsql/client") : await import("@libsql/client/web");
  const db = createClient(authToken ? { url, authToken } : { url });
  await db.executeMultiple(SCHEMA);
  return db;
}
