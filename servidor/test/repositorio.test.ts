import { test } from "node:test";
import assert from "node:assert/strict";
import { AGORA, bancoDeTeste, dadosFolhaExemplo } from "./ajudantes.ts";

test("estado: grava, lê e apaga", () => {
  const { repo } = bancoDeTeste();
  assert.equal(repo.obterEstado("x"), null);
  repo.definirEstado("x", "1");
  repo.definirEstado("x", "2");
  assert.equal(repo.obterEstado("x"), "2");
  repo.definirEstado("x", null);
  assert.equal(repo.obterEstado("x"), null);
});

test("garantirAgente é idempotente e o token identifica agente e impressora", () => {
  const { repo, filialId, agenteId, impressoraId } = bancoDeTeste();
  const deNovo = repo.garantirAgente(filialId, { nome: "expedicao-es", token: "token-teste", impressora: "HP A4" });
  assert.deepEqual(deNovo, { agenteId, impressoraId });
  const ag = repo.buscarAgentePorToken("token-teste");
  assert.equal(ag?.impressora_id, impressoraId);
  assert.equal(ag?.impressora_nome, "HP A4");
  assert.equal(repo.buscarAgentePorToken("errado"), null);
});

test("pedido: número é único por filial", () => {
  const { repo, filialId } = bancoDeTeste();
  repo.inserirPedido({ filialId, numero: "1", idBling: 10, situacao: 9, origem: "monitor", agora: AGORA });
  assert.throws(() => repo.inserirPedido({ filialId, numero: "1", idBling: 10, situacao: 9, origem: "monitor", agora: AGORA }));
  assert.equal(repo.buscarPedido(filialId, "1")?.id_bling, 10);
});

test("impressão: a mesma via de um pedido não pode ser criada duas vezes", () => {
  const { repo, filialId, impressoraId } = bancoDeTeste();
  const pedidoId = repo.inserirPedido({ filialId, numero: "1", idBling: 10, situacao: 9, origem: "monitor", agora: AGORA });
  const base = { pedidoId, impressoraId, dados: dadosFolhaExemplo(), motivo: null, usuarioId: null, agora: AGORA };
  repo.criarImpressao({ ...base, via: 1 });
  assert.throws(() => repo.criarImpressao({ ...base, via: 1 }));
  assert.equal(repo.proximaVia(pedidoId), 2);
});

test("fila: entrega a mais antiga primeiro e marca como imprimindo", () => {
  const { repo, filialId, impressoraId } = bancoDeTeste();
  const ids = ["1", "2"].map((numero) => {
    const pedidoId = repo.inserirPedido({ filialId, numero, idBling: Number(numero), situacao: 9, origem: "monitor", agora: AGORA });
    return repo.criarImpressao({ pedidoId, impressoraId, via: 1, dados: dadosFolhaExemplo(1, numero), motivo: null, usuarioId: null, agora: AGORA });
  });
  const primeira = repo.pegarProximaDaFila(impressoraId, AGORA);
  assert.equal(primeira?.id, ids[0]);
  assert.equal(primeira?.status, "imprimindo");
  assert.equal(repo.pegarProximaDaFila(impressoraId, AGORA)?.id, ids[1]);
  assert.equal(repo.pegarProximaDaFila(impressoraId, AGORA), null);
});

test("falha e reenfileiramento", () => {
  const { repo, filialId, impressoraId } = bancoDeTeste();
  const pedidoId = repo.inserirPedido({ filialId, numero: "1", idBling: 1, situacao: 9, origem: "monitor", agora: AGORA });
  const id = repo.criarImpressao({ pedidoId, impressoraId, via: 1, dados: dadosFolhaExemplo(), motivo: null, usuarioId: null, agora: AGORA });
  repo.pegarProximaDaFila(impressoraId, AGORA);
  repo.marcarFalha(id, "sem papel", "erro");
  const imp = repo.buscarImpressao(id)!;
  assert.equal(imp.status, "erro");
  assert.equal(imp.tentativas, 1);
  assert.equal(imp.ultimo_erro, "sem papel");
  assert.equal(repo.reenfileirarErros(impressoraId), 1);
  assert.equal(repo.buscarImpressao(id)!.status, "fila");
  assert.equal(repo.buscarImpressao(id)!.tentativas, 0);
});

test("travadas: imprimindo há mais tempo que o limite", () => {
  const { repo, filialId, impressoraId } = bancoDeTeste();
  const pedidoId = repo.inserirPedido({ filialId, numero: "1", idBling: 1, situacao: 9, origem: "monitor", agora: AGORA });
  const id = repo.criarImpressao({ pedidoId, impressoraId, via: 1, dados: dadosFolhaExemplo(), motivo: null, usuarioId: null, agora: AGORA });
  repo.pegarProximaDaFila(impressoraId, AGORA);
  assert.deepEqual(repo.listarTravadas(new Date(AGORA.getTime() - 1)).map((i) => i.id), []);
  assert.deepEqual(repo.listarTravadas(new Date(AGORA.getTime() + 1)).map((i) => i.id), [id]);
});

test("alertas: cria e informa se há pendente do tipo", () => {
  const { repo } = bancoDeTeste();
  assert.equal(repo.alertaPendenteDoTipo("bling_desconectado"), false);
  repo.criarAlerta({ tipo: "bling_desconectado", pedidoId: null, mensagem: "x", agora: AGORA });
  assert.equal(repo.alertaPendenteDoTipo("bling_desconectado"), true);
});

test("planilha: enfileirar duas vezes não duplica", () => {
  const { repo, filialId, impressoraId } = bancoDeTeste();
  const pedidoId = repo.inserirPedido({ filialId, numero: "1", idBling: 1, situacao: 9, origem: "monitor", agora: AGORA });
  const id = repo.criarImpressao({ pedidoId, impressoraId, via: 1, dados: dadosFolhaExemplo(), motivo: null, usuarioId: null, agora: AGORA });
  repo.enfileirarPlanilha(id);
  repo.enfileirarPlanilha(id);
  const n = repo.db.prepare("SELECT COUNT(*) AS n FROM fila_planilha").get() as { n: number };
  assert.equal(n.n, 1);
});
