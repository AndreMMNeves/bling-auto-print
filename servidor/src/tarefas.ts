import type { Repositorio } from "./banco/repositorio.ts";
import type { ClienteBling } from "./bling/cliente.ts";
import type { MontarFolha } from "./bling/montar-folha.ts";
import type { Config } from "./config.ts";
import { recuperarTravadas } from "./fila/fila.ts";
import { cicloMonitorado } from "./monitor/monitor.ts";
import { processarFilaPlanilha, type EnviarLinhas } from "./planilha/planilha.ts";

type BlingTarefas = Pick<ClienteBling, "listarPedidosAlterados" | "paginaPorSituacao" | "estaConectado">;

// Tudo o que precisa rodar de tempos em tempos. No PC local roda num laço;
// na Vercel é disparado pelo agente via POST /api/agente/ciclo.
export function criarTarefasPeriodicas(d: {
  repo: Repositorio; bling: BlingTarefas; montarFolha: MontarFolha; config: Config;
  filialId: number; agora: () => Date; enviarPlanilha: EnviarLinhas | null; orcamentoMs?: number;
}): () => Promise<{ monitor: string; travadas: number; planilha: number }> {
  return async () => {
    let monitor = "Bling não conectado";
    if (await d.bling.estaConectado()) {
      const r = await cicloMonitorado({
        repo: d.repo, bling: d.bling, montarFolha: d.montarFolha, filialId: d.filialId,
        situacaoAtendido: d.config.bling.situacaoAtendido, situacaoCancelado: d.config.bling.situacaoCancelado,
        margemMinutos: d.config.bling.margemMinutos, agora: d.agora, orcamentoMs: d.orcamentoMs,
      });
      monitor = r === null ? "erro" : r.tipo === "baseline" ? `primeira ativação +${r.registrados}${r.concluida ? " (concluída)" : ""}` : `${r.novos} novo(s)`;
    }
    const travadas = await recuperarTravadas(d.repo, d.agora());
    const planilha = d.enviarPlanilha ? await processarFilaPlanilha(d.repo, d.enviarPlanilha, d.agora()) : 0;
    return { monitor, travadas, planilha };
  };
}
