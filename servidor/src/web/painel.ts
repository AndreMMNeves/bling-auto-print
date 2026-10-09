import type { FastifyInstance } from "fastify";
import type { Expedicao, Repositorio } from "../banco/repositorio.ts";
import { escaparHtml } from "../../../compartilhado/html-util.ts";
import { COLUNAS_RELATORIO } from "../relatorio.ts";
import { AGENTE_OFFLINE_MS, statusBling, type Indicador } from "../status.ts";
import { diaLocal, formatarDataHora, formatarHora } from "../../../compartilhado/tempo.ts";
import { listaAlertas } from "./alertas.ts";
import { escopoFila, exigirLogin, type UsuarioSessao } from "./auth.ts";
import { buscaPedido, celulasRelatorio, pagina } from "./layout.ts";

// O painel mostra até a coluna Impressora; reimpresso por e motivo ficam no relatório.
const COLUNAS_PAINEL = 8;

const ind = (i: Indicador) => `<span><span class="bolinha ${i.ok ? "ok" : "ruim"}"></span>${escaparHtml(i.texto)}</span>`;

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
  // A chave já é o botão: um clique liga ou desliga. Quem não pode mexer só vê o estado.
  const chave = `<button class="chave" role="switch" aria-checked="${ligada}"${mexe ? "" : " disabled"}>
      <span class="trilho"></span>Impressão automática: <b>${ligada ? "Ligada" : "Desligada"}</b></button>`;
  return `<div class="cartao expedicao">
  <h2>${escaparHtml(e.nome)}</h2>
  <div class="cabeca">${mexe ? `<form class="inline" method="post" action="/expedicoes/${e.usuario_id}/impressao/${ligada ? "desligar" : "ligar"}">${chave}</form>` : chave}
  </div>
  ${ligada ? "" : `<p class="aviso-desligada">Desligada: as folhas são só salvas no PC, nada sai na impressora.</p>`}
  <div class="consultores">Consultores: ${consultores.length ? escaparHtml(consultores.join(", ")) : "nenhum (veja Consultores)"}</div>
  <div class="status">
    ${ind(pc)}
    ${erros ? ind({ ok: false, texto: `${erros} impressão(ões) com erro` }) : ""}
  </div>
  ${mexe && erros ? `<div class="acoes"><form class="inline" method="post" action="/expedicoes/${e.usuario_id}/imprimir-pendentes"><button class="secundario">Imprimir pendentes</button></form></div>` : ""}
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

    const alertas = await d.repo.alertasPendentes(fila);
    const html = `
<div class="cartao faixa">
  <div><span class="numero">${c.impressos}</span>impressos hoje</div>
  <div><span class="numero">${c.naFila}</span>na fila</div>
  <div><span class="numero ${c.alertas ? "atencao" : ""}">${c.alertas}</span>alertas pendentes</div>
</div>
<div class="colunas">
  <section>
    <h2>Últimas impressões de hoje</h2>
    <div class="cartao tabela"><table><thead><tr>${COLUNAS_RELATORIO.slice(0, COLUNAS_PAINEL).map((col) => `<th>${col}</th>`).join("")}</tr></thead>
    <tbody>${recentes.map((l) => `<tr>${celulasRelatorio(l, COLUNAS_PAINEL)}</tr>`).join("") || `<tr><td class="vazio" colspan="${COLUNAS_PAINEL}">Nenhuma impressão hoje ainda. As folhas aparecem aqui assim que os pedidos ficam Atendido no Bling.</td></tr>`}</tbody></table></div>
    ${recentes.length ? `<a class="botao secundario" href="/relatorio">Ver relatório completo</a>` : ""}
  </section>
  <aside>
    <section class="secao"><h2>Expedições</h2>${cartoes}${semExpedicao}</section>
    <section class="secao"><h2>Alertas</h2>${listaAlertas(alertas.slice(0, 5), u)}${alertas.length > 5 ? `<a class="botao secundario" href="/alertas">Ver todos os ${alertas.length} alertas</a>` : ""}</section>
  </aside>
</div>`;
    const topo = `${buscaPedido()}<span class="pilula">${ind(await statusBling(d.repo))}</span>`;
    return reply.type("text/html").send(pagina(u, "Painel", html, { atualizarSegundos: 30, mensagem, topo }));
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
