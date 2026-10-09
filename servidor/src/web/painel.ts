import type { FastifyInstance } from "fastify";
import type { Repositorio } from "../banco/repositorio.ts";
import { imprimirPendentes } from "../fila/fila.ts";
import { escaparHtml } from "../../../compartilhado/html-util.ts";
import { linhaParaColunas, COLUNAS_RELATORIO } from "../relatorio.ts";
import { statusSistema, type Indicador } from "../status.ts";
import { diaLocal } from "../../../compartilhado/tempo.ts";
import { listaAlertas } from "./alertas.ts";
import { exigirLogin, exigirSupervisor } from "./auth.ts";
import { pagina } from "./layout.ts";

const ind = (i: Indicador) => `<div><span class="bolinha ${i.ok ? "ok" : "ruim"}"></span>${escaparHtml(i.texto)}</div>`;

export function registrarPainel(app: FastifyInstance, d: { repo: Repositorio; impressoraId: number; agora: () => Date }): void {
  app.get<{ Querystring: { reenfileirados?: string } }>("/", { preHandler: exigirLogin }, async (req, reply) => {
    const agora = d.agora();
    const hoje = diaLocal(agora);
    const s = await statusSistema(d.repo, d.impressoraId, agora);
    const c = await d.repo.contadoresDoDia(hoje);
    const supervisor = req.usuario!.papel === "supervisor";
    const recentes = (await d.repo.relatorio({ de: hoje, ate: hoje })).slice(0, 20);
    const mensagem = req.query.reenfileirados !== undefined ? `${Number(req.query.reenfileirados)} impressão(ões) devolvida(s) para a fila.` : undefined;

    const ligada = (await d.repo.obterEstado("impressao:ligada")) === "1";
    const html = `
<div class="cartao status">
  <div><span class="bolinha ${ligada ? "ok" : "ruim"}"></span>Impressão automática: <b>${ligada ? "Ligada" : "Desligada"}</b>${ligada ? "" : " (as folhas são só salvas no PC)"}</div>
  ${supervisor ? `<form class="inline" method="post" action="/impressao/${ligada ? "desligar" : "ligar"}"><button class="${ligada ? "perigo" : ""}">${ligada ? "Desligar impressão" : "Ligar impressão"}</button></form>` : ""}
</div>
<div class="cartao status">${ind(s.bling)}${ind(s.agente)}${ind(s.impressora)}
  ${supervisor && !s.impressora.ok ? `<form class="inline" method="post" action="/fila/imprimir-pendentes"><button>Imprimir pendentes</button></form>` : ""}
</div>
<div class="grade">
  <div class="cartao"><div class="numero">${c.impressos}</div>impressos hoje</div>
  <div class="cartao"><div class="numero">${c.naFila}</div>na fila</div>
  <div class="cartao"><div class="numero ${c.alertas ? "atencao" : ""}">${c.alertas}</div>alertas pendentes</div>
</div>
<h2>Alertas</h2>
${listaAlertas((await d.repo.alertasPendentes()).slice(0, 5), req.usuario!)}
<h2>Últimas impressões de hoje</h2>
<div class="cartao tabela"><table><thead><tr>${COLUNAS_RELATORIO.map((col) => `<th>${col}</th>`).join("")}</tr></thead>
<tbody>${recentes.map((l) => `<tr>${linhaParaColunas(l).map((col) => `<td>${escaparHtml(col)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    return reply.type("text/html").send(pagina(req.usuario, "Painel", html, { atualizarSegundos: 30, mensagem }));
  });

  app.post<{ Params: { acao: string } }>("/impressao/:acao", { preHandler: exigirSupervisor }, async (req, reply) => {
    if (req.params.acao !== "ligar" && req.params.acao !== "desligar") return reply.code(404).send();
    await d.repo.definirEstado("impressao:ligada", req.params.acao === "ligar" ? "1" : null);
    return reply.redirect("/");
  });

  app.post("/fila/imprimir-pendentes", { preHandler: exigirSupervisor }, async (req, reply) => {
    const n = await imprimirPendentes(d.repo, d.impressoraId);
    await d.repo.resolverAlertasDoTipo("falha_impressao", req.usuario!.id, d.agora());
    return reply.redirect(`/?reenfileirados=${n}`);
  });
}
