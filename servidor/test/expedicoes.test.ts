import { test } from "node:test";
import assert from "node:assert/strict";
import { hashSenha } from "../src/web/auth.ts";
import { AGORA, appDeTeste, dadosFolhaExemplo, entrar } from "./ajudantes.ts";

// Duas expedições (ES e PR), cada uma com um pedido impresso na sua fila.
async function cenario() {
  const c = await appDeTeste({
    bling: {
      urlAutorizacao: (s) => `https://bling.test/auth?state=${s}`, trocarCodigo: async () => {}, estaConectado: async () => true,
      listarVendedores: async () => [{ id: 15596471757, nome: "Luana Cardoso" }, { id: 15596870677, nome: "Larissa" }, { id: 999, nome: "Outro" }],
    },
  });
  const criarExp = async (nome: string, email: string) => {
    const id = await c.repo.criarUsuario({ nome, email, senhaHash: hashSenha("senha-exp-123"), papel: "expedicao" });
    return { id, fila: await c.repo.garantirFilaDoUsuario(id, c.filialId) };
  };
  const es = await criarExp("Expedição ES", "es@onix.com");
  const pr = await criarExp("Expedição PR", "pr@onix.com");
  const pedido = async (numero: string, impressoraId: number) => {
    const pedidoId = await c.repo.inserirPedido({ filialId: c.filialId, numero, idBling: 1000 + Number(numero), situacao: 9, origem: "monitor", agora: AGORA });
    const id = await c.repo.criarImpressao({ pedidoId, impressoraId, via: 1, dados: dadosFolhaExemplo(1, numero), motivo: null, usuarioId: null, agora: AGORA });
    await c.repo.marcarImpressa(id, AGORA);
    return pedidoId;
  };
  const pedidoES = await pedido("101", es.fila.impressoraId);
  const pedidoPR = await pedido("202", pr.fila.impressoraId);
  return { ...c, es, pr, pedidoES, pedidoPR };
}

test("supervisor cria login de expedição e ele ganha fila própria", async () => {
  const c = await appDeTeste();
  const sup = await entrar(c.app, "sup@x.com", "senha-sup");
  const r = await c.app.inject({ method: "POST", url: "/usuarios", headers: { cookie: sup }, payload: { nome: "Expedição ES", email: "es@onix.com", senha: "12345678", papel: "expedicao" } });
  assert.equal(r.statusCode, 302);
  const u = (await c.repo.buscarUsuarioPorEmail("es@onix.com"))!;
  assert.equal(u.papel, "expedicao");
  assert.ok(await c.repo.impressoraDoUsuario(u.id));
});

test("página Consultores: supervisor liga cada vendedor a uma expedição", async () => {
  const c = await cenario();
  const op = await entrar(c.app, "op@x.com", "senha-op");
  assert.equal((await c.app.inject({ url: "/consultores", headers: { cookie: op } })).statusCode, 403);

  const sup = await entrar(c.app, "sup@x.com", "senha-sup");
  const pagina = await c.app.inject({ url: "/consultores", headers: { cookie: sup } });
  assert.equal(pagina.statusCode, 200);
  assert.match(pagina.body, /Larissa/);
  assert.match(pagina.body, /<option value="">Não imprime<\/option>/);
  assert.match(pagina.body, new RegExp(`<option value="${c.es.id}"[^>]*>Expedição ES</option>`));

  const salvar = await c.app.inject({
    method: "POST", url: "/consultores", headers: { cookie: sup },
    payload: { "v_15596870677": String(c.es.id), "n_15596870677": "Larissa", "v_15596471757": String(c.pr.id), "n_15596471757": "Luana Cardoso", "v_999": "", "n_999": "Outro" },
  });
  assert.equal(salvar.statusCode, 302);
  const regras = (await c.repo.regrasConsultores()).map((r) => [r.nome, r.usuario_id]).sort();
  assert.deepEqual(regras, [["Larissa", c.es.id], ["Luana Cardoso", c.pr.id]]);
  const depois = await c.app.inject({ url: "/consultores", headers: { cookie: sup } });
  assert.match(depois.body, new RegExp(`<option value="${c.es.id}" selected>Expedição ES</option>`));
});

test("login da expedição só vê os pedidos da própria fila", async () => {
  const c = await cenario();
  const es = await entrar(c.app, "es@onix.com", "senha-exp-123");
  const rel = await c.app.inject({ url: "/relatorio?de=2026-10-08&ate=2026-10-08", headers: { cookie: es } });
  assert.match(rel.body, /101/);
  assert.doesNotMatch(rel.body, />202</);
  assert.equal((await c.app.inject({ url: `/pedidos/${c.pedidoES}`, headers: { cookie: es } })).statusCode, 200);
  assert.equal((await c.app.inject({ url: `/pedidos/${c.pedidoPR}`, headers: { cookie: es } })).statusCode, 404);
  const busca = await c.app.inject({ url: "/pedidos?numero=202", headers: { cookie: es } });
  assert.match(busca.body, /não encontrado/);
  const nav = (await c.app.inject({ url: "/", headers: { cookie: es } })).body;
  assert.doesNotMatch(nav, /href="\/usuarios"|href="\/consultores"|href="\/config"/);
});

test("cada expedição liga/desliga a própria impressão; não mexe na dos outros", async () => {
  const c = await cenario();
  const es = await entrar(c.app, "es@onix.com", "senha-exp-123");
  const painel = await c.app.inject({ url: "/", headers: { cookie: es } });
  assert.match(painel.body, /Impressão automática: <b>Desligada<\/b>/);
  assert.equal((await c.app.inject({ method: "POST", url: `/expedicoes/${c.es.id}/impressao/ligar`, headers: { cookie: es } })).statusCode, 302);
  assert.equal(await c.repo.impressaoLigada(c.es.fila.impressoraId), true);
  assert.equal((await c.app.inject({ method: "POST", url: `/expedicoes/${c.pr.id}/impressao/ligar`, headers: { cookie: es } })).statusCode, 403);
  assert.equal(await c.repo.impressaoLigada(c.pr.fila.impressoraId), false);
});

test("supervisor vê todas as expedições no painel, com status e botão", async () => {
  const c = await cenario();
  await c.repo.definirConsultor(15596870677, "Larissa", c.es.id);
  const sup = await entrar(c.app, "sup@x.com", "senha-sup");
  const painel = (await c.app.inject({ url: "/", headers: { cookie: sup } })).body;
  assert.match(painel, /Expedição ES/);
  assert.match(painel, /Expedição PR/);
  assert.match(painel, /Larissa/);
  assert.match(painel, /PC da expedição nunca se conectou/);
  assert.match(painel, new RegExp(`action="/expedicoes/${c.pr.id}/impressao/ligar"`));
});

test("reimpressão sai na fila da expedição do pedido", async () => {
  const c = await cenario();
  const sup = await entrar(c.app, "sup@x.com", "senha-sup");
  const r = await c.app.inject({ method: "POST", url: `/pedidos/${c.pedidoPR}/reimprimir`, headers: { cookie: sup }, payload: { motivo: "Folha perdida" } });
  assert.equal(r.statusCode, 302);
  assert.equal((await c.repo.ultimaImpressao(c.pedidoPR))!.impressora_id, c.pr.fila.impressoraId);
});
