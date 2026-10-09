import { test } from "node:test";
import assert from "node:assert/strict";
import { AGORA, appDeTeste, entrar } from "./ajudantes.ts";

test("operador não acessa configuração", async () => {
  const c = await appDeTeste();
  const op = await entrar(c.app, "op@x.com", "senha-op");
  assert.equal((await c.app.inject({ url: "/config", headers: { cookie: op } })).statusCode, 403);
  assert.equal((await c.app.inject({ url: "/bling/conectar", headers: { cookie: op } })).statusCode, 403);
});

test("configuração mostra filial, impressora e estado da conexão", async () => {
  const c = await appDeTeste();
  const sup = await entrar(c.app, "sup@x.com", "senha-sup");
  const r = await c.app.inject({ url: "/config", headers: { cookie: sup } });
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /Espírito Santo/);
  assert.match(r.body, /HP A4/);
  assert.match(r.body, /Reconectar ao Bling/);
});

test("fluxo OAuth: conectar guarda state, callback troca código e resolve alerta", async () => {
  let codigoRecebido = "";
  const c = await appDeTeste({ bling: { urlAutorizacao: (s) => `https://bling.test/auth?state=${s}`, trocarCodigo: async (code) => { codigoRecebido = code; }, estaConectado: async () => true, listarVendedores: async () => [] } });
  await c.repo.criarAlerta({ tipo: "bling_desconectado", pedidoId: null, mensagem: "x", agora: AGORA });
  await c.repo.definirEstado("bling:erro_desde", AGORA.toISOString());
  const sup = await entrar(c.app, "sup@x.com", "senha-sup");

  const ir = await c.app.inject({ url: "/bling/conectar", headers: { cookie: sup } });
  assert.equal(ir.statusCode, 302);
  const state = new URL(String(ir.headers.location)).searchParams.get("state")!;
  assert.ok(state.length >= 32);

  const errado = await c.app.inject({ url: `/bling/callback?code=C&state=outro` });
  assert.equal(errado.statusCode, 400);

  const volta = await c.app.inject({ url: `/bling/callback?code=COD123&state=${state}` });
  assert.equal(volta.statusCode, 302);
  assert.equal(codigoRecebido, "COD123");
  assert.equal(await c.repo.alertaPendenteDoTipo("bling_desconectado"), false);
  assert.equal(await c.repo.obterEstado("bling:erro_desde"), null);
  assert.equal(await c.repo.obterEstado("bling:oauth_state"), null);

  const reuso = await c.app.inject({ url: `/bling/callback?code=COD123&state=${state}` });
  assert.equal(reuso.statusCode, 400);
});

test("falha ao trocar o código mostra o erro", async () => {
  const c = await appDeTeste({ bling: { urlAutorizacao: (s) => `https://bling.test/auth?state=${s}`, trocarCodigo: async () => { throw new Error("invalid_client"); }, estaConectado: async () => false, listarVendedores: async () => [] } });
  const sup = await entrar(c.app, "sup@x.com", "senha-sup");
  const ir = await c.app.inject({ url: "/bling/conectar", headers: { cookie: sup } });
  const state = new URL(String(ir.headers.location)).searchParams.get("state")!;
  const r = await c.app.inject({ url: `/bling/callback?code=X&state=${state}` });
  assert.equal(r.statusCode, 502);
  assert.match(r.body, /invalid_client/);
});
