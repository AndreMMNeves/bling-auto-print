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

test("usuário de expedição ganha uma fila própria (agente + impressora) com chave", async () => {
  const { repo, filialId } = await bancoDeTeste();
  const usuarioId = await repo.criarUsuario({ nome: "Expedição PR", email: "pr@onix.com", senhaHash: "h", papel: "expedicao" });
  const fila = await repo.garantirFilaDoUsuario(usuarioId, filialId);
  assert.ok(fila.token.length >= 32);
  assert.deepEqual(await repo.garantirFilaDoUsuario(usuarioId, filialId), fila); // idempotente
  assert.equal((await repo.buscarAgentePorToken(fila.token))!.impressora_id, fila.impressoraId);
  assert.equal(await repo.impressoraDoUsuario(usuarioId), fila.impressoraId);
  assert.equal(await repo.impressaoLigada(fila.impressoraId), false);
  await repo.definirImpressaoLigada(fila.impressoraId, true);
  assert.equal(await repo.impressaoLigada(fila.impressoraId), true);
  await repo.registrarImpressoraLocal(fila.agenteId, "Brother HL");
  const [exp] = await repo.listarExpedicoes();
  assert.equal(exp.usuario_id, usuarioId);
  assert.equal(exp.nome, "Expedição PR");
  assert.equal(exp.impressora_id, fila.impressoraId);
  assert.equal(exp.ligada, 1);
  assert.equal(exp.impressora_local, "Brother HL");
});

test("consultores: cada vendedor aponta para uma expedição (ou nenhuma)", async () => {
  const { repo, filialId } = await bancoDeTeste();
  const es = await repo.criarUsuario({ nome: "Expedição ES", email: "es@onix.com", senhaHash: "h", papel: "expedicao" });
  const pr = await repo.criarUsuario({ nome: "Expedição PR", email: "pr@onix.com", senhaHash: "h", papel: "expedicao" });
  const filaEs = await repo.garantirFilaDoUsuario(es, filialId);
  const filaPr = await repo.garantirFilaDoUsuario(pr, filialId);
  await repo.definirConsultor(15596870677, "Larissa", es);
  await repo.definirConsultor(15596471757, "Luana Cardoso", es);
  await repo.definirConsultor(15596471757, "Luana Cardoso", pr); // troca
  await repo.definirConsultor(111, "Fulano", null); // não imprime
  const regras = (await repo.regrasConsultores()).sort((a, b) => a.vendedor_id - b.vendedor_id);
  assert.deepEqual(regras, [
    { vendedor_id: 15596471757, nome: "Luana Cardoso", usuario_id: pr, impressora_id: filaPr.impressoraId },
    { vendedor_id: 15596870677, nome: "Larissa", usuario_id: es, impressora_id: filaEs.impressoraId },
  ]);
  assert.deepEqual((await repo.consultoresDoUsuario(es)).map((c) => c.nome), ["Larissa"]);
});

test("visão da expedição: relatório, contadores, alertas e pedidos só da fila dela", async () => {
  const { repo, filialId } = await bancoDeTeste();
  const es = await repo.garantirFilaDoUsuario(await repo.criarUsuario({ nome: "ES", email: "es@x", senhaHash: "h", papel: "expedicao" }), filialId);
  const pr = await repo.garantirFilaDoUsuario(await repo.criarUsuario({ nome: "PR", email: "pr@x", senhaHash: "h", papel: "expedicao" }), filialId);
  const criar = async (numero: string, impressoraId: number) => {
    const pedidoId = await repo.inserirPedido({ filialId, numero, idBling: Number(numero), situacao: 9, origem: "monitor", agora: AGORA });
    const id = await repo.criarImpressao({ pedidoId, impressoraId, via: 1, dados: dadosFolhaExemplo(1, numero), motivo: null, usuarioId: null, agora: AGORA });
    await repo.marcarImpressa(id, AGORA);
    await repo.criarAlerta({ tipo: "cancelado", pedidoId, mensagem: `alerta ${numero}`, agora: AGORA });
    return pedidoId;
  };
  const pES = await criar("1", es.impressoraId);
  const pPR = await criar("2", pr.impressoraId);
  await repo.criarAlerta({ tipo: "bling_desconectado", pedidoId: null, mensagem: "geral", agora: AGORA });

  const dia = { de: "2026-10-08", ate: "2026-10-08" };
  assert.deepEqual((await repo.relatorio({ ...dia, impressoraId: es.impressoraId })).map((l) => l.numero), ["1"]);
  assert.equal((await repo.relatorio(dia)).length, 2); // supervisor vê tudo
  assert.equal((await repo.contadoresDoDia("2026-10-08", pr.impressoraId)).impressos, 1);
  assert.equal((await repo.contadoresDoDia("2026-10-08")).impressos, 2);
  assert.deepEqual((await repo.alertasPendentes(es.impressoraId)).map((a) => a.mensagem), ["alerta 1"]);
  assert.equal((await repo.alertasPendentes()).length, 3);
  assert.equal(await repo.pedidoDaFila(pES, es.impressoraId), true);
  assert.equal(await repo.pedidoDaFila(pPR, es.impressoraId), false);
});
