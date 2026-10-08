import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registrarApiAgente, type GerarPdf } from "../src/web/api-agente.ts";
import { AGORA, bancoDeTeste, dadosFolhaExemplo } from "./ajudantes.ts";

function app(gerarPdf: GerarPdf = async () => Buffer.from("%PDF-falso")) {
  const b = bancoDeTeste();
  const pedidoId = b.repo.inserirPedido({ filialId: b.filialId, numero: "10", idBling: 1010, situacao: 9, origem: "monitor", agora: AGORA });
  const impressaoId = b.repo.criarImpressao({ pedidoId, impressoraId: b.impressoraId, via: 1, dados: dadosFolhaExemplo(1, "10"), motivo: null, usuarioId: null, agora: AGORA });
  const f = Fastify();
  registrarApiAgente(f, { repo: b.repo, gerarPdf, agora: () => AGORA });
  return { ...b, f, impressaoId };
}
const auth = { authorization: "Bearer token-teste" };

test("sem token ou token errado = 401", async () => {
  const { f } = app();
  assert.equal((await f.inject({ url: "/api/agente/proximo" })).statusCode, 401);
  assert.equal((await f.inject({ url: "/api/agente/proximo", headers: { authorization: "Bearer x" } })).statusCode, 401);
});

test("entrega o PDF e registra a comunicação do agente", async () => {
  const c = app();
  const r = await c.f.inject({ url: "/api/agente/proximo", headers: auth });
  assert.equal(r.statusCode, 200);
  const j = r.json() as { id: number; impressora: string; pdfBase64: string };
  assert.equal(j.id, c.impressaoId);
  assert.equal(j.impressora, "HP A4");
  assert.equal(Buffer.from(j.pdfBase64, "base64").toString(), "%PDF-falso");
  assert.equal(c.repo.buscarImpressao(c.impressaoId)!.status, "imprimindo");
  assert.equal(c.repo.buscarAgentePorToken("token-teste")!.ultima_comunicacao, AGORA.toISOString());
  assert.equal((await c.f.inject({ url: "/api/agente/proximo", headers: auth })).statusCode, 204);
});

test("resultado ok marca impresso", async () => {
  const c = app();
  await c.f.inject({ url: "/api/agente/proximo", headers: auth });
  const r = await c.f.inject({ method: "POST", url: `/api/agente/impressoes/${c.impressaoId}/resultado`, headers: auth, payload: { ok: true } });
  assert.equal(r.statusCode, 200);
  assert.equal(c.repo.buscarImpressao(c.impressaoId)!.status, "impresso");
});

test("resultado com erro conta tentativa", async () => {
  const c = app();
  await c.f.inject({ url: "/api/agente/proximo", headers: auth });
  await c.f.inject({ method: "POST", url: `/api/agente/impressoes/${c.impressaoId}/resultado`, headers: auth, payload: { ok: false, erro: "offline" } });
  const imp = c.repo.buscarImpressao(c.impressaoId)!;
  assert.equal(imp.status, "fila");
  assert.equal(imp.ultimo_erro, "offline");
});

test("impressão de outra impressora = 404", async () => {
  const c = app();
  c.repo.garantirAgente(c.filialId, { nome: "outro", token: "token-outro", impressora: "Outra" });
  const r = await c.f.inject({ method: "POST", url: `/api/agente/impressoes/${c.impressaoId}/resultado`, headers: { authorization: "Bearer token-outro" }, payload: { ok: true } });
  assert.equal(r.statusCode, 404);
});

test("falha ao gerar PDF = 500 e conta tentativa", async () => {
  const c = app(async () => { throw new Error("chrome caiu"); });
  const r = await c.f.inject({ url: "/api/agente/proximo", headers: auth });
  assert.equal(r.statusCode, 500);
  const imp = c.repo.buscarImpressao(c.impressaoId)!;
  assert.equal(imp.tentativas, 1);
  assert.match(imp.ultimo_erro ?? "", /chrome caiu/);
});
