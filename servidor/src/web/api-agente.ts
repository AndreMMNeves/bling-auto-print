import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AgenteRow, Repositorio } from "../banco/repositorio.ts";
import { entregarProximo, registrarResultado } from "../fila/fila.ts";

// tarefasPeriodicas: consulta ao Bling, travadas e planilha. Na Vercel não existe processo
// sempre ligado, então quem dispara isso é o agente (que fica ligado no PC da expedição).
export type DepsApiAgente = { repo: Repositorio; agora: () => Date; tarefasPeriodicas: () => Promise<unknown> };

export const INTERVALO_MINIMO_CICLO_MS = 20_000;

export function registrarApiAgente(app: FastifyInstance, d: DepsApiAgente): void {
  async function autenticar(req: FastifyRequest, reply: FastifyReply): Promise<AgenteRow | null> {
    const h = req.headers.authorization ?? "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    const agente = token ? await d.repo.buscarAgentePorToken(token) : null;
    if (!agente) {
      reply.code(401).send({ erro: "token inválido" });
      return null;
    }
    await d.repo.registrarComunicacaoAgente(agente.id, d.agora());
    return agente;
  }

  app.get("/api/agente/proximo", async (req, reply) => {
    const agente = await autenticar(req, reply);
    if (!agente) return reply;
    const t = await entregarProximo(d.repo, agente.impressora_id, d.agora());
    if (!t) return reply.code(204).send();
    // Botão "Impressão automática" do painel: desligada = o agente só salva o PDF.
    const imprimir = (await d.repo.obterEstado("impressao:ligada")) === "1";
    return { id: t.impressaoId, impressora: agente.impressora_nome, dados: t.dados, via: t.via, imprimir };
  });

  app.post<{ Params: { id: string }; Body: { ok?: boolean; salvo?: boolean; erro?: string } }>(
    "/api/agente/impressoes/:id/resultado",
    async (req, reply) => {
      const agente = await autenticar(req, reply);
      if (!agente) return reply;
      const imp = await d.repo.buscarImpressao(Number(req.params.id));
      if (!imp || imp.impressora_id !== agente.impressora_id) return reply.code(404).send({ erro: "impressão não encontrada" });
      const b = req.body ?? {};
      await registrarResultado(d.repo, imp.id, b.ok ? { ok: true, salvo: b.salvo === true } : { ok: false, erro: String(b.erro ?? "erro desconhecido") }, d.agora());
      return { ok: true };
    },
  );

  app.post("/api/agente/ciclo", async (req, reply) => {
    const agente = await autenticar(req, reply);
    if (!agente) return reply;
    const ultima = await d.repo.obterEstado("tarefas:ultima");
    const agora = d.agora();
    if (ultima && agora.getTime() - new Date(ultima).getTime() < INTERVALO_MINIMO_CICLO_MS) return { executado: false };
    await d.repo.definirEstado("tarefas:ultima", agora.toISOString());
    return { executado: true, resultado: await d.tarefasPeriodicas() };
  });
}
