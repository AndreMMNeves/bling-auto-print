import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registrarApiAgente } from "../src/web/api-agente.ts";
import { AGORA, bancoDeTeste, dadosFolhaExemplo } from "./ajudantes.ts";
import { hashSenha } from "../src/web/auth.ts";

async function app(opts: { agora?: () => Date } = {}) {
  const b = await bancoDeTeste();
  const pedidoId = await b.repo.inserirPedido({ filialId: b.filialId, numero: "10", idBling: 1010, situacao: 9, origem: "monitor", agora: AGORA });
  const impressaoId = await b.repo.criarImpressao({ pedidoId, impressoraId: b.impressoraId, via: 1, dados: dadosFolhaExemplo(1, "10"), motivo: null, usuarioId: null, agora: AGORA });
  let ciclos = 0;
  const f = Fastify();
  registrarApiAgente(f, { repo: b.repo, filialId: b.filialId, agora: opts.agora ?? (() => AGORA), tarefasPeriodicas: async () => ({ ciclo: ++ciclos }) });
  return { ...b, f, impressaoId, ciclos: () => ciclos };
}
const auth = { authorization: "Bearer token-teste" };

test("sem token ou token errado = 401", async () => {
  const { f } = await app();
  assert.equal((await f.inject({ url: "/api/agente/proximo" })).statusCode, 401);
  assert.equal((await f.inject({ url: "/api/agente/proximo", headers: { authorization: "Bearer x" } })).statusCode, 401);
  assert.equal((await f.inject({ method: "POST", url: "/api/agente/ciclo" })).statusCode, 401);
});

test("entrega os dados da folha (o PDF é gerado no agente) e registra a comunicação", async () => {
  const c = await app();
  const r = await c.f.inject({ url: "/api/agente/proximo", headers: auth });
  assert.equal(r.statusCode, 200);
  const j = r.json() as { id: number; impressora: string; dados: { pedido: { numero: string } }; via: { numero: number } };
  assert.equal(j.id, c.impressaoId);
  assert.equal(j.impressora, "HP A4");
  assert.equal(j.dados.pedido.numero, "10");
  assert.equal(j.via.numero, 1);
  assert.equal((await c.repo.buscarImpressao(c.impressaoId))!.status, "imprimindo");
  assert.equal((await c.repo.buscarAgentePorToken("token-teste"))!.ultima_comunicacao, AGORA.toISOString());
  assert.equal((await c.f.inject({ url: "/api/agente/proximo", headers: auth })).statusCode, 204);
});

test("resultado ok marca impresso", async () => {
  const c = await app();
  await c.f.inject({ url: "/api/agente/proximo", headers: auth });
  const r = await c.f.inject({ method: "POST", url: `/api/agente/impressoes/${c.impressaoId}/resultado`, headers: auth, payload: { ok: true } });
  assert.equal(r.statusCode, 200);
  assert.equal((await c.repo.buscarImpressao(c.impressaoId))!.status, "impresso");
});

test("resultado com erro conta tentativa", async () => {
  const c = await app();
  await c.f.inject({ url: "/api/agente/proximo", headers: auth });
  await c.f.inject({ method: "POST", url: `/api/agente/impressoes/${c.impressaoId}/resultado`, headers: auth, payload: { ok: false, erro: "offline" } });
  const imp = (await c.repo.buscarImpressao(c.impressaoId))!;
  assert.equal(imp.status, "fila");
  assert.equal(imp.ultimo_erro, "offline");
});

test("impressão de outra impressora = 404", async () => {
  const c = await app();
  await c.repo.garantirAgente(c.filialId, { nome: "outro", token: "token-outro", impressora: "Outra" });
  const r = await c.f.inject({ method: "POST", url: `/api/agente/impressoes/${c.impressaoId}/resultado`, headers: { authorization: "Bearer token-outro" }, payload: { ok: true } });
  assert.equal(r.statusCode, 404);
});

test("ciclo: o agente dispara as tarefas periódicas, no máximo a cada 20 s", async () => {
  let agora = AGORA;
  const c = await app({ agora: () => agora });
  const r1 = await c.f.inject({ method: "POST", url: "/api/agente/ciclo", headers: auth });
  assert.equal(r1.statusCode, 200);
  assert.deepEqual(r1.json(), { executado: true, resultado: { ciclo: 1 } });

  agora = new Date(AGORA.getTime() + 10_000);
  assert.deepEqual((await c.f.inject({ method: "POST", url: "/api/agente/ciclo", headers: auth })).json(), { executado: false });
  assert.equal(c.ciclos(), 1);

  agora = new Date(AGORA.getTime() + 21_000);
  assert.equal(((await c.f.inject({ method: "POST", url: "/api/agente/ciclo", headers: auth })).json() as { executado: boolean }).executado, true);
  assert.equal(c.ciclos(), 2);
});

test("cada trabalho diz se é para imprimir ou só salvar (botão do painel)", async () => {
  const c = await app();
  const r1 = (await c.f.inject({ url: "/api/agente/proximo", headers: auth })).json() as { imprimir: boolean };
  assert.equal(r1.imprimir, false); // começa desligada
  await c.repo.definirImpressaoLigada(c.impressoraId, true);
  const pedidoId = await c.repo.inserirPedido({ filialId: c.filialId, numero: "11", idBling: 1011, situacao: 9, origem: "monitor", agora: AGORA });
  await c.repo.criarImpressao({ pedidoId, impressoraId: c.impressoraId, via: 1, dados: dadosFolhaExemplo(1, "11"), motivo: null, usuarioId: null, agora: AGORA });
  const r2 = (await c.f.inject({ url: "/api/agente/proximo", headers: auth })).json() as { imprimir: boolean };
  assert.equal(r2.imprimir, true);
});

test("resultado 'salvo' (impressão desligada) fica como salvo, não como impresso", async () => {
  const c = await app();
  await c.f.inject({ url: "/api/agente/proximo", headers: auth });
  await c.f.inject({ method: "POST", url: `/api/agente/impressoes/${c.impressaoId}/resultado`, headers: auth, payload: { ok: true, salvo: true } });
  assert.equal((await c.repo.buscarImpressao(c.impressaoId))!.status, "salvo");
});

test("PC entra com e-mail e senha da expedição e recebe a chave da fila dela", async () => {
  const c = await app();
  const id = await c.repo.criarUsuario({ nome: "Expedição PR", email: "pr@onix.com", senhaHash: hashSenha("senha-pr-123"), papel: "expedicao" });
  await c.repo.criarUsuario({ nome: "Sup", email: "sup@onix.com", senhaHash: hashSenha("senha-sup-123"), papel: "supervisor" });

  const ok = await c.f.inject({ method: "POST", url: "/api/agente/entrar", payload: { email: "PR@onix.com", senha: "senha-pr-123" } });
  assert.equal(ok.statusCode, 200);
  const { token, nome } = ok.json() as { token: string; nome: string };
  assert.equal(nome, "Expedição PR");
  assert.equal((await c.repo.buscarAgentePorToken(token))!.impressora_id, await c.repo.impressoraDoUsuario(id));

  // Entrar de novo (reinstalação) devolve a mesma chave.
  const de_novo = await c.f.inject({ method: "POST", url: "/api/agente/entrar", payload: { email: "pr@onix.com", senha: "senha-pr-123" } });
  assert.equal((de_novo.json() as { token: string }).token, token);

  assert.equal((await c.f.inject({ method: "POST", url: "/api/agente/entrar", payload: { email: "pr@onix.com", senha: "errada" } })).statusCode, 401);
  assert.equal((await c.f.inject({ method: "POST", url: "/api/agente/entrar", payload: { email: "sup@onix.com", senha: "senha-sup-123" } })).statusCode, 403);
});

test("o agente informa a impressora do PC e o painel guarda", async () => {
  const c = await app();
  await c.f.inject({ url: "/api/agente/proximo", headers: { ...auth, "x-impressora": encodeURIComponent("EPSON L3250 (balcão)") } });
  const ag = await c.repo.buscarAgentePorToken("token-teste");
  const lista = await c.repo.db.consultar("SELECT impressora_local FROM agentes WHERE id = ?", [ag!.id]);
  assert.equal(lista.linhas[0].impressora_local, "EPSON L3250 (balcão)");
});
