import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { carregarConfig } from "../src/config.ts";

function gravar(obj: unknown): string {
  const arq = join(mkdtempSync(join(tmpdir(), "cfg-")), "config.json");
  writeFileSync(arq, JSON.stringify(obj));
  return arq;
}

const valida = {
  porta: 3010, urlPublica: "http://localhost:3010", segredoSessao: "s".repeat(40), banco: { url: "file:dados/x.db" },
  chromePath: "C:/chrome.exe", filial: { codigo: "ES", nome: "Espírito Santo" },
  bling: { clientId: "a", clientSecret: "b", intervaloSegundos: 30, margemMinutos: 5, situacaoAtendido: 9, situacaoCancelado: 12, campoCodigoBarras: "numero" },
  agentes: [{ nome: "expedicao-es", token: "t".repeat(32), impressora: "HP" }],
  google: null,
};

test("carrega config válida e resolve caminho do banco", () => {
  const c = carregarConfig(gravar(valida));
  assert.equal(c.porta, 3010);
  assert.ok(isAbsolute(c.banco.url.slice("file:".length)));
});

test("aponta os campos que faltam", () => {
  assert.throws(
    () => carregarConfig(gravar({ ...valida, segredoSessao: "", bling: { ...valida.bling, clientId: "" } })),
    /segredoSessao.*bling\.clientId/,
  );
});

test("campoCodigoBarras inválido é recusado", () => {
  assert.throws(() => carregarConfig(gravar({ ...valida, bling: { ...valida.bling, campoCodigoBarras: "x" } })), /campoCodigoBarras/);
});

test("recusa segredo de sessão ou token de agente de exemplo/curtos", () => {
  const forte = "x".repeat(40);
  assert.throws(() => carregarConfig(gravar({ ...valida, segredoSessao: "TROQUE-por-um-texto-aleatorio-com-40-caracteres-ou-mais" })), /segredoSessao/);
  assert.throws(() => carregarConfig(gravar({ ...valida, segredoSessao: "curto" })), /segredoSessao/);
  assert.throws(() => carregarConfig(gravar({ ...valida, segredoSessao: forte, agentes: [{ nome: "a", token: "TROQUE-por-um-token-aleatorio", impressora: "HP" }] })), /token/);
  assert.doesNotThrow(() => carregarConfig(gravar({ ...valida, segredoSessao: forte, agentes: [{ nome: "a", token: "y".repeat(32), impressora: "HP" }] })));
});
