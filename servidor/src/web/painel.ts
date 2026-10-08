import type { FastifyInstance } from "fastify";
import type { Repositorio } from "../banco/repositorio.ts";
import { imprimirPendentes } from "../fila/fila.ts";
import { escaparHtml } from "../html-util.ts";
import { linhaParaColunas, COLUNAS_RELATORIO } from "../relatorio.ts";
import { statusSistema, type Indicador } from "../status.ts";
import { diaLocal } from "../tempo.ts";
import { listaAlertas } from "./alertas.ts";
import { exigirLogin, exigirSupervisor } from "./auth.ts";
import { pagina } from "./layout.ts";

const ind = (i: Indicador) => `<div><span class="bolinha ${i.ok ? "ok" : "ruim"}"></span>${escaparHtml(i.texto)}</div>`;

export function registrarPainel(app: FastifyInstance, d: { repo: Repositorio; impressoraId: number; agora: () => Date }): void {
  app.get<{ Querystring: { reenfileirados?: string } }>("/", { preHandler: exigirLogin }, async (req, reply) => {
    const agora = d.agora();
    const hoje = diaLocal(agora);
    const s = statusSistema(d.repo, d.impressoraId, agora);
    const c = d.repo.contadoresDoDia(hoje);
    const supervisor = req.usuario!.papel === "supervisor";
    const recentes = d.repo.relatorio({ de: hoje, ate: hoje }).slice(0, 20);
    const mensagem = req.query.reenfileirados !== undefined ? `${Number(req.query.reenfileirados)} impressão(ões) devolvida(s) para a fila.` : undefined;

    const html = `
<div class="cartao status">${ind(s.bling)}${ind(s.agente)}${ind(s.impressora)}
  ${supervisor && !s.impressora.ok ? `<form class="inline" method="post" action="/fila/imprimir-pendentes"><button>Imprimir pendentes</button></form>` : ""}
</div>
<div class="grade">
  <div class="cartao"><div class="numero">${c.impressos}</div>impressos hoje</div>
  <div class="cartao"><div class="numero">${c.naFila}</div>na fila</div>
  <div class="cartao"><div class="numero ${c.alertas ? "atencao" : ""}">${c.alertas}</div>alertas pendentes</div>
</div>
<h2>Alertas</h2>
${listaAlertas(d.repo.alertasPendentes().slice(0, 5), req.usuario!)}
<h2>Últimas impressões de hoje</h2>
<div class="cartao tabela"><table><thead><tr>${COLUNAS_RELATORIO.map((col) => `<th>${col}</th>`).join("")}</tr></thead>
<tbody>${recentes.map((l) => `<tr>${linhaParaColunas(l).map((col) => `<td>${escaparHtml(col)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    return reply.type("text/html").send(pagina(req.usuario, "Painel", html, { atualizarSegundos: 30, mensagem }));
  });

  app.post("/fila/imprimir-pendentes", { preHandler: exigirSupervisor }, async (req, reply) => {
    const n = imprimirPendentes(d.repo, d.impressoraId);
    d.repo.resolverAlertasDoTipo("falha_impressao", req.usuario!.id, d.agora());
    return reply.redirect(`/?reenfileirados=${n}`);
  });
}
