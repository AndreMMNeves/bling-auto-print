import type { FastifyInstance } from "fastify";
import type { Expedicao, Repositorio } from "../banco/repositorio.ts";
import { escaparHtml } from "../../../compartilhado/html-util.ts";
import { linhaParaColunas, COLUNAS_RELATORIO } from "../relatorio.ts";
import { AGENTE_OFFLINE_MS, statusBling, type Indicador } from "../status.ts";
import { diaLocal, formatarDataHora, formatarHora } from "../../../compartilhado/tempo.ts";
import { listaAlertas } from "./alertas.ts";
import { escopoFila, exigirLogin, type UsuarioSessao } from "./auth.ts";
import { pagina } from "./layout.ts";

const ind = (i: Indicador) => `<div><span class="bolinha ${i.ok ? "ok" : "ruim"}"></span>${escaparHtml(i.texto)}</div>`;

// Supervisor mexe em todas; o login de expedição só na própria.
const podeMexer = (u: UsuarioSessao, usuarioId: number) => u.papel === "supervisor" || (u.papel === "expedicao" && u.id === usuarioId);

async function cartaoExpedicao(repo: Repositorio, e: Expedicao, u: UsuarioSessao, agora: Date): Promise<string> {
  const consultores = (await repo.consultoresDoUsuario(e.usuario_id)).map((c) => c.nome);
  const ligada = e.ligada === 1;
  const pc: Indicador = !e.ultima_comunicacao
    ? { ok: false, texto: "PC da expedição nunca se conectou" }
    : agora.getTime() - new Date(e.ultima_comunicacao).getTime() > AGENTE_OFFLINE_MS
      ? { ok: false, texto: `PC da expedição sem resposta desde ${formatarDataHora(e.ultima_comunicacao)}` }
      : { ok: true, texto: `PC conectado (${formatarHora(e.ultima_comunicacao)})${e.impressora_local ? ` · ${e.impressora_local}` : ""}` };
  const erros = e.impressora_id ? await repo.contarErros(e.impressora_id) : 0;
  const mexe = podeMexer(u, e.usuario_id);
  return `<div class="cartao expedicao">
  <h2>${escaparHtml(e.nome)}</h2>
  <div class="contagem">Consultores: ${consultores.length ? escaparHtml(consultores.join(", ")) : "nenhum (veja Consultores)"}</div>
  <div class="status">
    ${ind(pc)}
    <div><span class="bolinha ${ligada ? "ok" : "ruim"}"></span>Impressão automática: <b>${ligada ? "Ligada" : "Desligada"}</b>${ligada ? "" : " (as folhas são só salvas no PC)"}</div>
    ${erros ? ind({ ok: false, texto: `${erros} impressão(ões) com erro` }) : ""}
  </div>
  ${mexe ? `<div class="acoes">
    <form class="inline" method="post" action="/expedicoes/${e.usuario_id}/impressao/${ligada ? "desligar" : "ligar"}"><button class="${ligada ? "perigo" : ""}">${ligada ? "Desligar impressão" : "Ligar impressão"}</button></form>
    ${erros ? `<form class="inline" method="post" action="/expedicoes/${e.usuario_id}/imprimir-pendentes"><button class="secundario">Imprimir pendentes</button></form>` : ""}
  </div>` : ""}
</div>`;
}

export function registrarPainel(app: FastifyInstance, d: { repo: Repositorio; agora: () => Date }): void {
  app.get<{ Querystring: { reenfileirados?: string } }>("/", { preHandler: exigirLogin }, async (req, reply) => {
    const u = req.usuario!;
    const agora = d.agora();
    const hoje = diaLocal(agora);
    const fila = escopoFila(u);
    const expedicoes = (await d.repo.listarExpedicoes()).filter((e) => e.ativo && (fila === undefined || e.usuario_id === u.id));
    const cartoes = (await Promise.all(expedicoes.map((e) => cartaoExpedicao(d.repo, e, u, agora)))).join("");
    const c = await d.repo.contadoresDoDia(hoje, fila);
    const recentes = (await d.repo.relatorio({ de: hoje, ate: hoje, impressoraId: fila })).slice(0, 20);
    const mensagem = req.query.reenfileirados !== undefined ? `${Number(req.query.reenfileirados)} impressão(ões) devolvida(s) para a fila.` : undefined;
    const semExpedicao = expedicoes.length ? "" : `<div class="cartao"><p>Nenhuma expedição cadastrada ainda.${u.papel === "supervisor" ? ` Crie um usuário com papel "Expedição" em <a href="/usuarios">Usuários</a> e escolha os consultores em <a href="/consultores">Consultores</a>.` : ""}</p></div>`;

    const html = `
<div class="cartao status">${ind(await statusBling(d.repo))}</div>
<div class="grade">${cartoes}</div>${semExpedicao}
<div class="grade">
  <div class="cartao"><div class="numero">${c.impressos}</div>impressos hoje</div>
  <div class="cartao"><div class="numero">${c.naFila}</div>na fila</div>
  <div class="cartao"><div class="numero ${c.alertas ? "atencao" : ""}">${c.alertas}</div>alertas pendentes</div>
</div>
<h2>Alertas</h2>
${listaAlertas((await d.repo.alertasPendentes(fila)).slice(0, 5), u)}
<h2>Últimas impressões de hoje</h2>
<div class="cartao tabela"><table><thead><tr>${COLUNAS_RELATORIO.map((col) => `<th>${col}</th>`).join("")}</tr></thead>
<tbody>${recentes.map((l) => `<tr>${linhaParaColunas(l).map((col) => `<td>${escaparHtml(col)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    return reply.type("text/html").send(pagina(u, "Painel", html, { atualizarSegundos: 30, mensagem }));
  });

  app.post<{ Params: { usuarioId: string; acao: string } }>("/expedicoes/:usuarioId/impressao/:acao", { preHandler: exigirLogin }, async (req, reply) => {
    const usuarioId = Number(req.params.usuarioId);
    if (!podeMexer(req.usuario!, usuarioId)) return reply.code(403).type("text/html").send(pagina(req.usuario, "Sem permissão", "<p>Você só pode ligar ou desligar a impressão da sua expedição.</p>"));
    if (req.params.acao !== "ligar" && req.params.acao !== "desligar") return reply.code(404).send();
    const impressoraId = await d.repo.impressoraDoUsuario(usuarioId);
    if (!impressoraId) return reply.code(404).send();
    await d.repo.definirImpressaoLigada(impressoraId, req.params.acao === "ligar");
    return reply.redirect("/");
  });

  app.post<{ Params: { usuarioId: string } }>("/expedicoes/:usuarioId/imprimir-pendentes", { preHandler: exigirLogin }, async (req, reply) => {
    const usuarioId = Number(req.params.usuarioId);
    if (!podeMexer(req.usuario!, usuarioId)) return reply.code(403).send();
    const impressoraId = await d.repo.impressoraDoUsuario(usuarioId);
    if (!impressoraId) return reply.code(404).send();
    const n = await d.repo.reenfileirarErros(impressoraId);
    return reply.redirect(`/?reenfileirados=${n}`);
  });
}
