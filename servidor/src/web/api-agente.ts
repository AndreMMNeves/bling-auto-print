import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { DadosFolha, Via } from "../../../compartilhado/tipos.ts";
import type { AgenteRow, Repositorio } from "../banco/repositorio.ts";
import { entregarProximo, registrarResultado } from "../fila/fila.ts";

export type GerarPdf = (dados: DadosFolha, via: Via) => Promise<Buffer>;
export type DepsApiAgente = { repo: Repositorio; gerarPdf: GerarPdf; agora: () => Date };

export function registrarApiAgente(app: FastifyInstance, d: DepsApiAgente): void {
  function autenticar(req: FastifyRequest, reply: FastifyReply): AgenteRow | null {
    const h = req.headers.authorization ?? "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    const agente = token ? d.repo.buscarAgentePorToken(token) : null;
    if (!agente) {
      reply.code(401).send({ erro: "token inválido" });
      return null;
    }
    d.repo.registrarComunicacaoAgente(agente.id, d.agora());
    return agente;
  }

  app.get("/api/agente/proximo", async (req, reply) => {
    const agente = autenticar(req, reply);
    if (!agente) return reply;
    const t = entregarProximo(d.repo, agente.impressora_id, d.agora());
    if (!t) return reply.code(204).send();
    try {
      const pdf = await d.gerarPdf(t.dados, t.via);
      return { id: t.impressaoId, impressora: agente.impressora_nome, pdfBase64: pdf.toString("base64") };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      registrarResultado(d.repo, t.impressaoId, { ok: false, erro: `Falha ao gerar PDF: ${msg}` }, d.agora());
      return reply.code(500).send({ erro: "falha ao gerar PDF" });
    }
  });

  app.post<{ Params: { id: string }; Body: { ok?: boolean; erro?: string } }>(
    "/api/agente/impressoes/:id/resultado",
    async (req, reply) => {
      const agente = autenticar(req, reply);
      if (!agente) return reply;
      const imp = d.repo.buscarImpressao(Number(req.params.id));
      if (!imp || imp.impressora_id !== agente.impressora_id) return reply.code(404).send({ erro: "impressão não encontrada" });
      const b = req.body ?? {};
      registrarResultado(d.repo, imp.id, b.ok ? { ok: true } : { ok: false, erro: String(b.erro ?? "erro desconhecido") }, d.agora());
      return { ok: true };
    },
  );
}
