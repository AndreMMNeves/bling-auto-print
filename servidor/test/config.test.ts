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
  porta: 3010, urlPublica: "http://localhost:3010", segredoSessao: "s", arquivoBanco: "dados/x.db",
  chromePath: "C:/chrome.exe", filial: { codigo: "ES", nome: "Espírito Santo" },
  bling: { clientId: "a", clientSecret: "b", intervaloSegundos: 30, margemMinutos: 5, situacaoAtendido: 9, situacaoCancelado: 12, campoCodigoBarras: "numero" },
  agentes: [{ nome: "expedicao-es", token: "t", impressora: "HP" }],
  google: null,
};

test("carrega config válida e resolve caminho do banco", () => {
  const c = carregarConfig(gravar(valida));
  assert.equal(c.porta, 3010);
  assert.ok(isAbsolute(c.arquivoBanco));
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
