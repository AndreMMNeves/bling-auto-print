import type { Repositorio } from "./banco/repositorio.ts";
import { formatarDataHora, formatarHora } from "./tempo.ts";

export type Indicador = { ok: boolean; texto: string };
export const AGENTE_OFFLINE_MS = 2 * 60_000;

export function statusSistema(repo: Repositorio, impressoraId: number, agora: Date): { bling: Indicador; agente: Indicador; impressora: Indicador } {
  const erroDesde = repo.obterEstado("bling:erro_desde");
  const ultima = repo.obterEstado("bling:ultima_consulta");
  const bling: Indicador = erroDesde
    ? { ok: false, texto: `Sem conexão com o Bling desde ${formatarDataHora(erroDesde)}: ${repo.obterEstado("bling:erro_msg") ?? ""}` }
    : ultima
      ? { ok: true, texto: `Bling OK (última consulta ${formatarHora(ultima)})` }
      : { ok: false, texto: "Ainda não consultou o Bling" };

  const com = repo.ultimaComunicacaoAgente(impressoraId);
  const agente: Indicador = !com
    ? { ok: false, texto: "Agente de impressão nunca se conectou" }
    : agora.getTime() - new Date(com).getTime() > AGENTE_OFFLINE_MS
      ? { ok: false, texto: `Agente de impressão sem resposta desde ${formatarDataHora(com)}` }
      : { ok: true, texto: `Agente OK (${formatarHora(com)})` };

  const erros = repo.contarErros(impressoraId);
  const impressora: Indicador = erros
    ? { ok: false, texto: `${erros} impressão(ões) com erro` }
    : { ok: true, texto: "Impressora OK" };

  return { bling, agente, impressora };
}
