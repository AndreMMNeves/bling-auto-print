import { GoogleAuth } from "google-auth-library";
import type { Repositorio } from "../banco/repositorio.ts";
import { linhaParaColunas } from "../relatorio.ts";

export type EnviarLinhas = (linhas: string[][]) => Promise<void>;

// Nunca lança erro: a planilha não pode atrapalhar a impressão.
export async function processarFilaPlanilha(repo: Repositorio, enviar: EnviarLinhas, agora: Date): Promise<number> {
  const ids = await repo.pendentesPlanilha(50);
  if (!ids.length) return 0;
  const linhas = (await Promise.all(ids.map((id) => repo.linhaRelatorio(id)))).filter((l) => l !== null).map(linhaParaColunas);
  try {
    await enviar(linhas);
  } catch (e) {
    await repo.registrarFalhaPlanilha(ids);
    console.error(`[planilha] falha ao enviar ${ids.length} linha(s): ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
  await repo.marcarPlanilhaEnviada(ids, agora);
  return ids.length;
}

// credenciais: conteúdo do JSON da conta de serviço (na Vercel vem de variável de ambiente).
export function criarEnviadorSheets(cfg: { credenciais: Record<string, unknown>; planilhaId: string; aba: string }): EnviarLinhas {
  const auth = new GoogleAuth({ credentials: cfg.credenciais, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const intervalo = encodeURIComponent(`${cfg.aba}!A1`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.planilhaId}/values/${intervalo}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  return async (linhas) => {
    const client = await auth.getClient();
    await client.request({ url, method: "POST", data: { values: linhas } });
  };
}
