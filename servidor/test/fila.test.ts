import { test } from "node:test";
import assert from "node:assert/strict";
import { entregarProximo, imprimirPendentes, recuperarTravadas, registrarResultado, reimprimir } from "../src/fila/fila.ts";
import { AGORA, bancoDeTeste, dadosFolhaExemplo, executar, todas, uma } from "./ajudantes.ts";

async function comImpressao() {
  const b = await bancoDeTeste();
  const pedidoId = await b.repo.inserirPedido({ filialId: b.filialId, numero: "10", idBling: 1010, situacao: 9, origem: "monitor", agora: AGORA });
  const impressaoId = await b.repo.criarImpressao({ pedidoId, impressoraId: b.impressoraId, via: 1, dados: dadosFolhaExemplo(1, "10"), motivo: null, usuarioId: null, agora: AGORA });
  return { ...b, pedidoId, impressaoId };
}
const alertas = (repo: Awaited<ReturnType<typeof bancoDeTeste>>["repo"]) =>
  todas<{ tipo: string; mensagem: string }>(repo, "SELECT tipo, mensagem FROM alertas");

test("entregarProximo devolve dados e via 1", async () => {
  const c = await comImpressao();
  const t = (await entregarProximo(c.repo, c.impressoraId, AGORA))!;
  assert.equal(t.impressaoId, c.impressaoId);
  assert.equal(t.dados.pedido.numero, "10");
  assert.deepEqual(t.via, { numero: 1, motivo: null, usuario: null, em: AGORA.toISOString() });
  assert.equal(await entregarProximo(c.repo, c.impressoraId, AGORA), null);
});

test("ok marca impresso e enfileira para a planilha", async () => {
  const c = await comImpressao();
  await entregarProximo(c.repo, c.impressoraId, AGORA);
  await registrarResultado(c.repo, c.impressaoId, { ok: true }, AGORA);
  assert.equal((await c.repo.buscarImpressao(c.impressaoId))!.status, "impresso");
  const n = await uma<{ n: number }>(c.repo, "SELECT COUNT(*)::int AS n FROM fila_planilha");
  assert.equal(n.n, 1);
});

test("3 falhas voltam para a fila; a 4ª vira erro com alerta", async () => {
  const c = await comImpressao();
  for (let i = 1; i <= 3; i++) {
    await entregarProximo(c.repo, c.impressoraId, AGORA);
    await registrarResultado(c.repo, c.impressaoId, { ok: false, erro: "sem papel" }, AGORA);
    assert.equal((await c.repo.buscarImpressao(c.impressaoId))!.status, "fila");
  }
  await entregarProximo(c.repo, c.impressoraId, AGORA);
  await registrarResultado(c.repo, c.impressaoId, { ok: false, erro: "sem papel" }, AGORA);
  assert.equal((await c.repo.buscarImpressao(c.impressaoId))!.status, "erro");
  assert.deepEqual((await alertas(c.repo)).map((a) => a.tipo), ["falha_impressao"]);
  assert.match((await alertas(c.repo))[0].mensagem, /Pedido 10.*4 vezes.*sem papel/);
});

test("ok atrasado depois de travada vira impresso", async () => {
  const c = await comImpressao();
  await entregarProximo(c.repo, c.impressoraId, AGORA);
  const depois = new Date(AGORA.getTime() + 6 * 60_000);
  assert.equal(await recuperarTravadas(c.repo, depois), 1);
  assert.equal((await c.repo.buscarImpressao(c.impressaoId))!.status, "erro");
  await registrarResultado(c.repo, c.impressaoId, { ok: true }, depois);
  assert.equal((await c.repo.buscarImpressao(c.impressaoId))!.status, "impresso");
  assert.equal(await imprimirPendentes(c.repo, c.impressoraId), 0);
});

test("travada há menos de 5 min não é mexida", async () => {
  const c = await comImpressao();
  await entregarProximo(c.repo, c.impressoraId, AGORA);
  assert.equal(await recuperarTravadas(c.repo, new Date(AGORA.getTime() + 4 * 60_000)), 0);
});

test("imprimirPendentes devolve erros para a fila", async () => {
  const c = await comImpressao();
  await entregarProximo(c.repo, c.impressoraId, AGORA);
  await c.repo.marcarFalha(c.impressaoId, "x", "erro");
  assert.equal(await imprimirPendentes(c.repo, c.impressoraId), 1);
  assert.equal((await c.repo.buscarImpressao(c.impressaoId))!.status, "fila");
});

test("reimprimir cria a próxima via com motivo, usuário e dados novos do Bling", async () => {
  const c = await comImpressao();
  const usuarioId = await executar(c.repo, "INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES ('Maria', 'm@x', 'h', 'supervisor')");
  let chamada: [number, string] | null = null;
  const montar = async (idBling: number, atendidoEm: Date) => {
    chamada = [idBling, atendidoEm.toISOString()];
    return dadosFolhaExemplo(3, "10");
  };
  const id = await reimprimir(c.repo, montar, { pedidoId: c.pedidoId, impressoraId: c.impressoraId, motivo: "Folha perdida", usuarioId, agora: AGORA });
  assert.deepEqual(chamada, [1010, AGORA.toISOString()]);
  const imp = (await c.repo.buscarImpressao(id))!;
  assert.equal(imp.via, 2);
  assert.equal(imp.motivo, "Folha perdida");
  assert.equal(JSON.parse(imp.dados_json).itens.length, 3);
  await c.repo.marcarImpressa(c.impressaoId, AGORA);
  const t = (await entregarProximo(c.repo, c.impressoraId, AGORA))!;
  assert.deepEqual(t.via, { numero: 2, motivo: "Folha perdida", usuario: "Maria", em: AGORA.toISOString() });
});
