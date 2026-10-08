import { test } from "node:test";
import assert from "node:assert/strict";
import { processarFilaPlanilha } from "../src/planilha/planilha.ts";
import { registrarResultado } from "../src/fila/fila.ts";
import { AGORA, bancoDeTeste, dadosFolhaExemplo } from "./ajudantes.ts";

function comImpressas(n: number) {
  const b = bancoDeTeste();
  for (let i = 1; i <= n; i++) {
    const pedidoId = b.repo.inserirPedido({ filialId: b.filialId, numero: String(i), idBling: i, situacao: 9, origem: "monitor", agora: AGORA });
    const id = b.repo.criarImpressao({ pedidoId, impressoraId: b.impressoraId, via: 1, dados: dadosFolhaExemplo(2, String(i)), motivo: null, usuarioId: null, agora: AGORA });
    b.repo.pegarProximaDaFila(b.impressoraId, AGORA);
    registrarResultado(b.repo, id, { ok: true }, AGORA);
  }
  return b;
}

test("envia as linhas pendentes no formato do relatório e marca como enviadas", async () => {
  const b = comImpressas(2);
  const enviados: string[][][] = [];
  assert.equal(await processarFilaPlanilha(b.repo, async (l) => { enviados.push(l); }, AGORA), 2);
  assert.equal(enviados.length, 1);
  assert.deepEqual(enviados[0].map((l) => l[1]), ["1", "2"]);
  assert.equal(enviados[0][0][0], "08/10/2026 14:32");
  assert.deepEqual(b.repo.pendentesPlanilha(10), []);
});

test("sem pendentes não chama o Google", async () => {
  const b = bancoDeTeste();
  let chamou = false;
  assert.equal(await processarFilaPlanilha(b.repo, async () => { chamou = true; }, AGORA), 0);
  assert.equal(chamou, false);
});

test("falha do Google mantém pendente e conta tentativa, sem lançar erro", async () => {
  const b = comImpressas(1);
  const erro = console.error;
  console.error = () => {};
  try {
    assert.equal(await processarFilaPlanilha(b.repo, async () => { throw new Error("503"); }, AGORA), 0);
  } finally {
    console.error = erro;
  }
  assert.equal(b.repo.pendentesPlanilha(10).length, 1);
  const t = b.repo.db.prepare("SELECT tentativas FROM fila_planilha").get() as { tentativas: number };
  assert.equal(t.tentativas, 1);
});
