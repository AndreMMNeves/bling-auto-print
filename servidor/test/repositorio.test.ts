import { test } from "node:test";
import assert from "node:assert/strict";
import { AGORA, bancoDeTeste, dadosFolhaExemplo, uma } from "./ajudantes.ts";

test("estado: grava, lê e apaga", async () => {
  const { repo } = await bancoDeTeste();
  assert.equal(await repo.obterEstado("x"), null);
  await repo.definirEstado("x", "1");
  await repo.definirEstado("x", "2");
  assert.equal(await repo.obterEstado("x"), "2");
  await repo.definirEstado("x", null);
  assert.equal(await repo.obterEstado("x"), null);
});

test("garantirAgente é idempotente e o token identifica agente e impressora", async () => {
  const { repo, filialId, agenteId, impressoraId } = await bancoDeTeste();
  const deNovo = await repo.garantirAgente(filialId, { nome: "expedicao-es", token: "token-teste", impressora: "HP A4" });
  assert.deepEqual(deNovo, { agenteId, impressoraId });
  const ag = await repo.buscarAgentePorToken("token-teste");
  assert.equal(ag?.impressora_id, impressoraId);
  assert.equal(ag?.impressora_nome, "HP A4");
  assert.equal(await repo.buscarAgentePorToken("errado"), null);
});

test("pedido: número é único por filial", async () => {
  const { repo, filialId } = await bancoDeTeste();
  await repo.inserirPedido({ filialId, numero: "1", idBling: 10, situacao: 9, origem: "monitor", agora: AGORA });
  await assert.rejects(repo.inserirPedido({ filialId, numero: "1", idBling: 10, situacao: 9, origem: "monitor", agora: AGORA }));
  assert.equal((await repo.buscarPedido(filialId, "1"))?.id_bling, 10);
});

test("impressão: a mesma via de um pedido não pode ser criada duas vezes", async () => {
  const { repo, filialId, impressoraId } = await bancoDeTeste();
  const pedidoId = await repo.inserirPedido({ filialId, numero: "1", idBling: 10, situacao: 9, origem: "monitor", agora: AGORA });
  const base = { pedidoId, impressoraId, dados: dadosFolhaExemplo(), motivo: null, usuarioId: null, agora: AGORA };
  await repo.criarImpressao({ ...base, via: 1 });
  await assert.rejects(repo.criarImpressao({ ...base, via: 1 }));
  assert.equal(await repo.proximaVia(pedidoId), 2);
});

test("fila: entrega a mais antiga primeiro e marca como imprimindo", async () => {
  const { repo, filialId, impressoraId } = await bancoDeTeste();
  const ids: number[] = [];
  for (const numero of ["1", "2"]) {
    const pedidoId = await repo.inserirPedido({ filialId, numero, idBling: Number(numero), situacao: 9, origem: "monitor", agora: AGORA });
    ids.push(await repo.criarImpressao({ pedidoId, impressoraId, via: 1, dados: dadosFolhaExemplo(1, numero), motivo: null, usuarioId: null, agora: AGORA }));
  }
  const primeira = await repo.pegarProximaDaFila(impressoraId, AGORA);
  assert.equal(primeira?.id, ids[0]);
  assert.equal(primeira?.status, "imprimindo");
  assert.equal((await repo.pegarProximaDaFila(impressoraId, AGORA))?.id, ids[1]);
  assert.equal(await repo.pegarProximaDaFila(impressoraId, AGORA), null);
});

test("falha e reenfileiramento", async () => {
  const { repo, filialId, impressoraId } = await bancoDeTeste();
  const pedidoId = await repo.inserirPedido({ filialId, numero: "1", idBling: 1, situacao: 9, origem: "monitor", agora: AGORA });
  const id = await repo.criarImpressao({ pedidoId, impressoraId, via: 1, dados: dadosFolhaExemplo(), motivo: null, usuarioId: null, agora: AGORA });
  await repo.pegarProximaDaFila(impressoraId, AGORA);
  await repo.marcarFalha(id, "sem papel", "erro");
  const imp = (await repo.buscarImpressao(id))!;
  assert.equal(imp.status, "erro");
  assert.equal(imp.tentativas, 1);
  assert.equal(imp.ultimo_erro, "sem papel");
  assert.equal(await repo.reenfileirarErros(impressoraId), 1);
  assert.equal((await repo.buscarImpressao(id))!.status, "fila");
  assert.equal((await repo.buscarImpressao(id))!.tentativas, 0);
});

test("travadas: imprimindo há mais tempo que o limite", async () => {
  const { repo, filialId, impressoraId } = await bancoDeTeste();
  const pedidoId = await repo.inserirPedido({ filialId, numero: "1", idBling: 1, situacao: 9, origem: "monitor", agora: AGORA });
  const id = await repo.criarImpressao({ pedidoId, impressoraId, via: 1, dados: dadosFolhaExemplo(), motivo: null, usuarioId: null, agora: AGORA });
  await repo.pegarProximaDaFila(impressoraId, AGORA);
  assert.deepEqual((await repo.listarTravadas(new Date(AGORA.getTime() - 1))).map((i) => i.id), []);
  assert.deepEqual((await repo.listarTravadas(new Date(AGORA.getTime() + 1))).map((i) => i.id), [id]);
});

test("alertas: cria e informa se há pendente do tipo", async () => {
  const { repo } = await bancoDeTeste();
  assert.equal(await repo.alertaPendenteDoTipo("bling_desconectado"), false);
  await repo.criarAlerta({ tipo: "bling_desconectado", pedidoId: null, mensagem: "x", agora: AGORA });
  assert.equal(await repo.alertaPendenteDoTipo("bling_desconectado"), true);
});

test("planilha: enfileirar duas vezes não duplica", async () => {
  const { repo, filialId, impressoraId } = await bancoDeTeste();
  const pedidoId = await repo.inserirPedido({ filialId, numero: "1", idBling: 1, situacao: 9, origem: "monitor", agora: AGORA });
  const id = await repo.criarImpressao({ pedidoId, impressoraId, via: 1, dados: dadosFolhaExemplo(), motivo: null, usuarioId: null, agora: AGORA });
  await repo.enfileirarPlanilha(id);
  await repo.enfileirarPlanilha(id);
  const n = await uma<{ n: number }>(repo, "SELECT COUNT(*)::int AS n FROM fila_planilha");
  assert.equal(n.n, 1);
});
