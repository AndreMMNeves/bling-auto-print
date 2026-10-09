import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registrarApiAgente } from "../src/web/api-agente.ts";
import { AGORA, bancoDeTeste, dadosFolhaExemplo } from "./ajudantes.ts";

async function app(opts: { agora?: () => Date } = {}) {
  const b = await bancoDeTeste();
  const pedidoId = await b.repo.inserirPedido({ filialId: b.filialId, numero: "10", idBling: 1010, situacao: 9, origem: "monitor", agora: AGORA });
  const impressaoId = await b.repo.criarImpressao({ pedidoId, impressoraId: b.impressoraId, via: 1, dados: dadosFolhaExemplo(1, "10"), motivo: null, usuarioId: null, agora: AGORA });
  let ciclos = 0;
  const f = Fastify();
  registrarApiAgente(f, { repo: b.repo, agora: opts.agora ?? (() => AGORA), tarefasPeriodicas: async () => ({ ciclo: ++ciclos }) });
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
