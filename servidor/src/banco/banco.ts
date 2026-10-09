import { SCHEMA } from "./schema.ts";

export type Param = string | number | null;
export type Linha = Record<string, unknown>;
export type Consultar = (sql: string, params?: Param[]) => Promise<{ linhas: Linha[]; afetadas: number }>;

// Banco Postgres: Supabase na Vercel (postgres.js) ou PGlite (Postgres embutido) no PC e nos testes.
export interface Banco {
  consultar: Consultar;
  transacao<T>(fn: (consultar: Consultar) => Promise<T>): Promise<T>;
  fechar(): Promise<void>;
}

// O código escreve "?" (mais legível); o Postgres espera $1, $2...
export function paraPostgres(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// url: ":memory:" (testes), "pglite:dados/expedicao" (PC) ou "postgresql://..." (Supabase).
export async function abrirBanco(url: string): Promise<Banco> {
  const banco = url.startsWith("postgres") ? await abrirPostgres(url) : await abrirPglite(url);
  await banco.transacao(async (consultar) => {
    for (const comando of SCHEMA.split(";").map((c) => c.trim()).filter(Boolean)) await consultar(comando);
  });
  return banco;
}

async function abrirPostgres(url: string): Promise<Banco> {
  const { default: postgres } = await import("postgres");
  // prepare: false é obrigatório no "Transaction pooler" do Supabase (porta 6543).
  const sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 15, onnotice: () => {} });
  const executar = (cliente: typeof sql): Consultar => async (texto, params = []) => {
    const r = await cliente.unsafe(paraPostgres(texto), params as never[]);
    return { linhas: [...r] as Linha[], afetadas: r.count ?? 0 };
  };
  return {
    consultar: executar(sql),
    transacao: (fn) => sql.begin((tx) => fn(executar(tx as unknown as typeof sql))) as Promise<never>,
    fechar: () => sql.end(),
  };
}

async function abrirPglite(url: string): Promise<Banco> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = url === ":memory:" ? new PGlite() : new PGlite(url.replace(/^pglite:/, ""));
  const executar = (cliente: { query: typeof db.query }): Consultar => async (texto, params = []) => {
    const r = await cliente.query<Linha>(paraPostgres(texto), params);
    return { linhas: r.rows, afetadas: r.affectedRows ?? 0 };
  };
  return {
    consultar: executar(db),
    transacao: (fn) => db.transaction((tx) => fn(executar(tx))),
    fechar: () => db.close(),
  };
}
