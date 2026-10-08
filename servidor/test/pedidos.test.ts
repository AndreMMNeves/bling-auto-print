import { test } from "node:test";
import assert from "node:assert/strict";
import { AGORA, appDeTeste, dadosFolhaExemplo, entrar } from "./ajudantes.ts";

async function comPedido(extra = {}) {
  const c = await appDeTeste(extra);
  const pedidoId = c.repo.inserirPedido({ filialId: c.filialId, numero: "10", idBling: 1010, situacao: 9, origem: "monitor", agora: AGORA });
  const imp = c.repo.criarImpressao({ pedidoId, impressoraId: c.impressoraId, via: 1, dados: dadosFolhaExemplo(1, "10"), motivo: null, usuarioId: null, agora: AGORA });
  c.repo.marcarImpressa(imp, AGORA);
  c.repo.criarAlerta({ tipo: "repetido", pedidoId, mensagem: "Pedido 10 voltou para Atendido", agora: AGORA });
  return { ...c, pedidoId };
}

test("busca por número redireciona para o pedido", async () => {
  const c = await comPedido();
  const op = await entrar(c.app, "op@x.com", "senha-op");
  const r = await c.app.inject({ url: "/pedidos?numero=10", headers: { cookie: op } });
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, `/pedidos/${c.pedidoId}`);
  const nao = await c.app.inject({ url: "/pedidos?numero=999", headers: { cookie: op } });
  assert.match(nao.body, /Pedido 999 não encontrado/);
});

test("operador vê histórico mas não o formulário de reimpressão", async () => {
  const c = await comPedido();
  const op = await entrar(c.app, "op@x.com", "senha-op");
  const r = await c.app.inject({ url: `/pedidos/${c.pedidoId}`, headers: { cookie: op } });
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /1ª via/);
  assert.doesNotMatch(r.body, /action="\/pedidos\/\d+\/reimprimir"/);
  const post = await c.app.inject({ method: "POST", url: `/pedidos/${c.pedidoId}/reimprimir`, headers: { cookie: op }, payload: { motivo: "Folha perdida" } });
  assert.equal(post.statusCode, 403);
});

test("supervisor reimprime: cria 2ª via e resolve alerta de repetido", async () => {
  const c = await comPedido();
  const sup = await entrar(c.app, "sup@x.com", "senha-sup");
  const r = await c.app.inject({ method: "POST", url: `/pedidos/${c.pedidoId}/reimprimir`, headers: { cookie: sup }, payload: { motivo: "Folha perdida" } });
  assert.equal(r.statusCode, 302);
  const ult = c.repo.ultimaImpressao(c.pedidoId)!;
  assert.equal(ult.via, 2);
  assert.equal(ult.motivo, "Folha perdida");
  assert.equal(ult.usuario_id, c.supervisorId);
  assert.equal(ult.status, "fila");
  assert.equal(c.repo.alertasDoPedido(c.pedidoId).length, 0);
});

test("motivo Outro exige texto; motivo inválido é recusado", async () => {
  const c = await comPedido();
  const sup = await entrar(c.app, "sup@x.com", "senha-sup");
  const semTexto = await c.app.inject({ method: "POST", url: `/pedidos/${c.pedidoId}/reimprimir`, headers: { cookie: sup }, payload: { motivo: "Outro", outro: "  " } });
  assert.equal(semTexto.statusCode, 400);
  const invalido = await c.app.inject({ method: "POST", url: `/pedidos/${c.pedidoId}/reimprimir`, headers: { cookie: sup }, payload: { motivo: "Porque sim" } });
  assert.equal(invalido.statusCode, 400);
  const comTexto = await c.app.inject({ method: "POST", url: `/pedidos/${c.pedidoId}/reimprimir`, headers: { cookie: sup }, payload: { motivo: "Outro", outro: "Cliente pediu cópia" } });
  assert.equal(comTexto.statusCode, 302);
  assert.equal(c.repo.ultimaImpressao(c.pedidoId)!.motivo, "Outro: Cliente pediu cópia");
});

test("Bling fora do ar na reimpressão mostra erro e não cria via", async () => {
  const c = await comPedido({ montarFolha: async () => { throw new Error("Bling 503"); } });
  const sup = await entrar(c.app, "sup@x.com", "senha-sup");
  const r = await c.app.inject({ method: "POST", url: `/pedidos/${c.pedidoId}/reimprimir`, headers: { cookie: sup }, payload: { motivo: "Folha perdida" } });
  assert.equal(r.statusCode, 502);
  assert.match(r.body, /Bling 503/);
  assert.equal(c.repo.ultimaImpressao(c.pedidoId)!.via, 1);
});
