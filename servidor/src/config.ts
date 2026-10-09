import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const RAIZ = fileURLToPath(new URL("../../", import.meta.url));

export type CampoCodigoBarras = "numero" | "numeroLoja" | "id";

export type Config = {
  porta: number;
  urlPublica: string;
  segredoSessao: string;
  // "pglite:dados/expedicao" no PC; "postgresql://..." (Supabase, Transaction pooler) na Vercel.
  banco: { url: string };
  filial: { codigo: string; nome: string };
  bling: {
    clientId: string;
    clientSecret: string;
    intervaloSegundos: number;
    margemMinutos: number;
    situacaoAtendido: number;
    situacaoCancelado: number;
    campoCodigoBarras: CampoCodigoBarras;
  };
  agentes: Array<{ nome: string; token: string; impressora: string }>;
  google: null | { credenciais: Record<string, unknown>; planilhaId: string; aba: string };
};

export function segredoFraco(s: string): boolean {
  return s.length < 32 || /TROQUE/i.test(s);
}

function validar(c: Config, origem: string): Config {
  const faltando: string[] = [];
  for (const k of ["urlPublica", "segredoSessao"] as const) if (!c[k]) faltando.push(k);
  if (!c.banco?.url) faltando.push("banco.url");
  if (!c.filial?.codigo) faltando.push("filial.codigo");
  if (!c.bling?.clientId) faltando.push("bling.clientId");
  if (!c.bling?.clientSecret) faltando.push("bling.clientSecret");
  if (!Array.isArray(c.agentes) || c.agentes.length === 0) faltando.push("agentes");
  if (faltando.length) throw new Error(`${origem} incompleto: ${faltando.join(", ")}`);
  // O servidor fica exposto (rede local ou internet): segredos de exemplo permitiriam forjar login ou roubar trabalhos.
  if (segredoFraco(c.segredoSessao)) {
    throw new Error(`${origem}: segredoSessao precisa ser um texto aleatório próprio, com 32+ caracteres (não use o do exemplo)`);
  }
  for (const a of c.agentes) {
    if (segredoFraco(a.token)) throw new Error(`${origem}: o token do agente "${a.nome}" precisa ser aleatório, com 32+ caracteres (não use o do exemplo)`);
  }
  if (!["numero", "numeroLoja", "id"].includes(c.bling.campoCodigoBarras)) {
    throw new Error(`${origem}: bling.campoCodigoBarras deve ser "numero", "numeroLoja" ou "id"`);
  }
  return c;
}

// PC local: servidor/config.json.
export function carregarConfig(arquivo: string): Config {
  const bruto = JSON.parse(readFileSync(arquivo, "utf8")) as Config & { google: null | { arquivoCredenciais?: string; planilhaId: string; aba: string } };
  const c = { ...bruto } as Config;
  if (c.banco?.url?.startsWith("pglite:")) c.banco = { url: `pglite:${resolve(RAIZ, c.banco.url.slice("pglite:".length))}` };
  if (bruto.google?.arquivoCredenciais) {
    c.google = {
      credenciais: JSON.parse(readFileSync(resolve(RAIZ, bruto.google.arquivoCredenciais), "utf8")),
      planilhaId: bruto.google.planilhaId, aba: bruto.google.aba,
    };
  }
  return validar(c, "config.json");
}

// Vercel: variáveis de ambiente (Settings → Environment Variables).
export function carregarConfigDoAmbiente(env: Record<string, string | undefined>): Config {
  const n = (k: string, padrao: number) => (env[k] ? Number(env[k]) : padrao);
  const c: Config = {
    porta: n("PORTA", 3010),
    urlPublica: env.URL_PUBLICA ?? "",
    segredoSessao: env.SEGREDO_SESSAO ?? "",
    banco: { url: env.DATABASE_URL ?? "" },
    filial: { codigo: env.FILIAL_CODIGO ?? "", nome: env.FILIAL_NOME ?? env.FILIAL_CODIGO ?? "" },
    bling: {
      clientId: env.BLING_CLIENT_ID ?? "",
      clientSecret: env.BLING_CLIENT_SECRET ?? "",
      intervaloSegundos: n("BLING_INTERVALO_SEGUNDOS", 30),
      margemMinutos: n("BLING_MARGEM_MINUTOS", 5),
      situacaoAtendido: n("BLING_SITUACAO_ATENDIDO", 9),
      situacaoCancelado: n("BLING_SITUACAO_CANCELADO", 12),
      campoCodigoBarras: (env.BLING_CAMPO_CODIGO_BARRAS ?? "numero") as CampoCodigoBarras,
    },
    agentes: env.AGENTE_TOKEN
      ? [{ nome: env.AGENTE_NOME ?? "expedicao", token: env.AGENTE_TOKEN, impressora: env.AGENTE_IMPRESSORA ?? "Impressora" }]
      : [],
    google: env.GOOGLE_CREDENCIAIS
      ? { credenciais: JSON.parse(env.GOOGLE_CREDENCIAIS), planilhaId: env.GOOGLE_PLANILHA_ID ?? "", aba: env.GOOGLE_ABA ?? "Impressões" }
      : null,
  };
  return validar(c, "Variáveis de ambiente");
}
