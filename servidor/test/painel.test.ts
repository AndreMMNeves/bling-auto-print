import { test } from "node:test";
import assert from "node:assert/strict";
import { statusSistema } from "../src/status.ts";
import { AGORA, appDeTeste, bancoDeTeste, dadosFolhaExemplo, entrar, uma } from "./ajudantes.ts";

test("status: Bling com erro, agente offline, impressora com erro", async () => {
  const b = await bancoDeTeste();
  let s = await statusSistema(b.repo, b.impressoraId, AGORA);
  assert.equal(s.bling.ok, false);
  assert.match(s.bling.texto, /Ainda não consultou/);
  assert.equal(s.agente.ok, false);
  assert.equal(s.impressora.ok, true);

  await b.repo.definirEstado("bling:ultima_consulta", AGORA.toISOString());
  await b.repo.registrarComunicacaoAgente(b.agenteId, new Date(AGORA.getTime() - 60_000));
  s = await statusSistema(b.repo, b.impressoraId, AGORA);
  assert.equal(s.bling.ok, true);
  assert.equal(s.agente.ok, true);

  await b.repo.definirEstado("bling:erro_desde", AGORA.toISOString());
  await b.repo.definirEstado("bling:erro_msg", "timeout");
  await b.repo.registrarComunicacaoAgente(b.agenteId, new Date(AGORA.getTime() - 3 * 60_000));
  const pedidoId = await b.repo.inserirPedido({ filialId: b.filialId, numero: "1", idBling: 1, situacao: 9, origem: "monitor", agora: AGORA });
  const id = await b.repo.criarImpressao({ pedidoId, impressoraId: b.impressoraId, via: 1, dados: dadosFolhaExemplo(), motivo: null, usuarioId: null, agora: AGORA });
  await b.repo.marcarFalha(id, "x", "erro");
  s = await statusSistema(b.repo, b.impressoraId, AGORA);
  assert.match(s.bling.texto, /Sem conexão com o Bling desde 08\/10\/2026 14:32: timeout/);
  assert.match(s.agente.texto, /sem resposta desde 08\/10\/2026 14:29/);
  assert.equal(s.impressora.ok, false);
  assert.match(s.impressora.texto, /1 impressão\(ões\) com erro/);
});

async function comAlertaEErro() {
  const c = await appDeTeste();
  const pedidoId = await c.repo.inserirPedido({ filialId: c.filialId, numero: "10", idBling: 1010, situacao: 9, origem: "monitor", agora: AGORA });
  const imp = await c.repo.criarImpressao({ pedidoId, impressoraId: c.impressoraId, via: 1, dados: dadosFolhaExemplo(1, "10"), motivo: null, usuarioId: null, agora: AGORA });
  await c.repo.marcarFalha(imp, "sem papel", "erro");
  const alertaId = await c.repo.criarAlerta({ tipo: "falha_impressao", pedidoId, mensagem: "Pedido 10: falhou", agora: AGORA });
  return { ...c, pedidoId, imp, alertaId };
}

test("painel mostra contadores e alertas", async () => {
  const c = await comAlertaEErro();
  const op = await entrar(c.app, "op@x.com", "senha-op");
  const r = await c.app.inject({ url: "/", headers: { cookie: op } });
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /Pedido 10: falhou/);
  assert.match(r.body, /http-equiv="refresh"/);
  assert.doesNotMatch(r.body, /Imprimir pendentes/); // operador não vê o botão
});

test("operador não resolve alerta nem reenfileira; supervisor sim", async () => {
  const c = await comAlertaEErro();
  const op = await entrar(c.app, "op@x.com", "senha-op");
  assert.equal((await c.app.inject({ method: "POST", url: `/alertas/${c.alertaId}/resolver`, headers: { cookie: op } })).statusCode, 403);
  assert.equal((await c.app.inject({ method: "POST", url: "/fila/imprimir-pendentes", headers: { cookie: op } })).statusCode, 403);

  const sup = await entrar(c.app, "sup@x.com", "senha-sup");
  const r = await c.app.inject({ method: "POST", url: "/fila/imprimir-pendentes", headers: { cookie: sup } });
  assert.equal(r.statusCode, 302);
  assert.equal((await c.repo.buscarImpressao(c.imp))!.status, "fila");
  assert.equal((await c.repo.alertasPendentes()).length, 0); // alertas de falha resolvidos junto
});

test("resolver alerta registra quem resolveu", async () => {
  const c = await comAlertaEErro();
  const sup = await entrar(c.app, "sup@x.com", "senha-sup");
  await c.app.inject({ method: "POST", url: `/alertas/${c.alertaId}/resolver`, headers: { cookie: sup } });
  const a = await uma<{ resolvido_por: number; resolvido_em: string }>(c.repo, "SELECT resolvido_por, resolvido_em FROM alertas WHERE id = ?", c.alertaId);
  assert.equal(a.resolvido_por, c.supervisorId);
  assert.equal(a.resolvido_em, AGORA.toISOString());
});

test("contadores do dia usam o dia local", async () => {
  const b = await bancoDeTeste();
  const pedidoId = await b.repo.inserirPedido({ filialId: b.filialId, numero: "1", idBling: 1, situacao: 9, origem: "monitor", agora: AGORA });
  const id = await b.repo.criarImpressao({ pedidoId, impressoraId: b.impressoraId, via: 1, dados: dadosFolhaExemplo(), motivo: null, usuarioId: null, agora: AGORA });
  await b.repo.marcarImpressa(id, new Date("2026-10-09T02:50:00.000Z"));
  assert.equal((await b.repo.contadoresDoDia("2026-10-08")).impressos, 1);
  assert.equal((await b.repo.contadoresDoDia("2026-10-09")).impressos, 0);
});
