import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const RAIZ = fileURLToPath(new URL("../../", import.meta.url));

export type CampoCodigoBarras = "numero" | "numeroLoja" | "id";

export type Config = {
  porta: number;
  urlPublica: string;
  segredoSessao: string;
  arquivoBanco: string;
  chromePath: string;
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
  google: null | { arquivoCredenciais: string; planilhaId: string; aba: string };
};

export function carregarConfig(arquivo: string): Config {
  const c = JSON.parse(readFileSync(arquivo, "utf8")) as Config;
  const faltando: string[] = [];
  for (const k of ["porta", "urlPublica", "segredoSessao", "arquivoBanco", "chromePath"] as const) {
    if (c[k] === undefined || c[k] === "") faltando.push(k);
  }
  if (!c.filial?.codigo) faltando.push("filial.codigo");
  if (!c.bling?.clientId) faltando.push("bling.clientId");
  if (!c.bling?.clientSecret) faltando.push("bling.clientSecret");
  if (!Array.isArray(c.agentes) || c.agentes.length === 0) faltando.push("agentes");
  if (faltando.length) throw new Error(`config.json incompleto: ${faltando.join(", ")}`);
  if (!["numero", "numeroLoja", "id"].includes(c.bling.campoCodigoBarras)) {
    throw new Error(`config.json: bling.campoCodigoBarras deve ser "numero", "numeroLoja" ou "id"`);
  }
  c.arquivoBanco = c.arquivoBanco === ":memory:" ? c.arquivoBanco : resolve(RAIZ, c.arquivoBanco);
  if (c.google) c.google.arquivoCredenciais = resolve(RAIZ, c.google.arquivoCredenciais);
  return c;
}
