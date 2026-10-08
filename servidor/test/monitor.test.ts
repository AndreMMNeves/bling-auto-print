import { test } from "node:test";
import assert from "node:assert/strict";
import { executarCiclo, cicloMonitorado, type DepsMonitor } from "../src/monitor/monitor.ts";
import { ErroBlingDesconectado, type ResumoPedido } from "../src/bling/cliente.ts";
import { AGORA, bancoDeTeste, dadosFolhaExemplo } from "./ajudantes.ts";

const ATENDIDO = 9, CANCELADO = 12, ABERTO = 6;
const resumo = (numero: string, situacaoId: number): ResumoPedido => ({ id: Number(numero) + 1000, numero, numeroLoja: null, situacaoId });

function cenario() {
  const base = bancoDeTeste();
  let lista: ResumoPedido[] = [];
  let agora = AGORA;
  const consultas: Array<{ desde: Date; ate: Date }> = [];
  const deps: DepsMonitor = {
    repo: base.repo,
    bling: { listarPedidosAlterados: async (desde, ate) => { consultas.push({ desde, ate }); return lista; } },
    montarFolha: async (idBling) => dadosFolhaExemplo(1, String(idBling - 1000)),
    filialId: base.filialId, impressoraId: base.impressoraId,
    situacaoAtendido: ATENDIDO, situacaoCancelado: CANCELADO, margemMinutos: 5,
    agora: () => agora,
  };
  return {
    ...base, deps, consultas,
    definirLista: (l: ResumoPedido[]) => { lista = l; },
    avancar: (ms: number) => { agora = new Date(agora.getTime() + ms); },
    impressoes: () => base.repo.db.prepare("SELECT * FROM impressoes ORDER BY id").all() as Array<{ id: number; via: number; dados_json: string }>,
    alertas: () => base.repo.db.prepare("SELECT tipo, mensagem FROM alertas ORDER BY id").all() as Array<{ tipo: string; mensagem: string }>,
  };
}

test("primeira ativação registra os Atendido existentes sem imprimir", async () => {
  const c = cenario();
  c.definirLista([resumo("1", ATENDIDO), resumo("2", ABERTO)]);
  const r = await executarCiclo(c.deps);
  assert.deepEqual(r, { tipo: "baseline", registrados: 1 });
  assert.equal(c.impressoes().length, 0);
  assert.equal(c.repo.buscarPedido(c.filialId, "1")?.origem, "baseline");
  assert.equal(c.repo.buscarPedido(c.filialId, "2"), null);
  assert.equal(c.consultas[0].desde.getTime(), AGORA.getTime() - 30 * 86_400_000);
});

test("pedido novo Atendido vira 1ª via na fila, em ordem de número", async () => {
  const c = cenario();
  await executarCiclo(c.deps);
  c.avancar(30_000);
  c.definirLista([resumo("11", ATENDIDO), resumo("10", ATENDIDO), resumo("12", ABERTO)]);
  const r = await executarCiclo(c.deps);
  assert.deepEqual(r, { tipo: "ciclo", novos: 2, alertas: 0 });
  const imps = c.impressoes();
  assert.deepEqual(imps.map((i) => JSON.parse(i.dados_json).pedido.numero), ["10", "11"]);
  assert.ok(imps.every((i) => i.via === 1));
});

test("consulta usa o cursor menos a margem", async () => {
  const c = cenario();
  await executarCiclo(c.deps);
  c.avancar(30_000);
  await executarCiclo(c.deps);
  assert.equal(c.consultas[1].desde.getTime(), AGORA.getTime() - 5 * 60_000);
});

test("pedido que aparece de novo como Atendido sem mudar não faz nada", async () => {
  const c = cenario();
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", ATENDIDO)]);
  await executarCiclo(c.deps);
  await executarCiclo(c.deps);
  assert.equal(c.impressoes().length, 1);
  assert.equal(c.alertas().length, 0);
});

test("pedido que sai e volta para Atendido gera alerta e não imprime", async () => {
  const c = cenario();
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", ATENDIDO)]);
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", ABERTO)]);
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", ATENDIDO)]);
  await executarCiclo(c.deps);
  assert.equal(c.impressoes().length, 1);
  assert.deepEqual(c.alertas().map((a) => a.tipo), ["repetido"]);
  assert.match(c.alertas()[0].mensagem, /Pedido 10 voltou para Atendido\. Já foi impresso em 08\/10\/2026 14:32/);
});

test("pedido cancelado depois de impresso gera alerta", async () => {
  const c = cenario();
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", ATENDIDO)]);
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", CANCELADO)]);
  await executarCiclo(c.deps);
  assert.deepEqual(c.alertas().map((a) => a.tipo), ["cancelado"]);
  assert.match(c.alertas()[0].mensagem, /CANCELADO/);
});

test("pedido desconhecido que não está Atendido é ignorado", async () => {
  const c = cenario();
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", CANCELADO)]);
  await executarCiclo(c.deps);
  assert.equal(c.repo.buscarPedido(c.filialId, "10"), null);
});

test("retomada depois de mais de 5 min parado gera aviso com a quantidade", async () => {
  const c = cenario();
  await executarCiclo(c.deps);
  c.avancar(13 * 3600_000);
  c.definirLista([resumo("10", ATENDIDO), resumo("11", ATENDIDO)]);
  await executarCiclo(c.deps);
  assert.deepEqual(c.alertas().map((a) => a.tipo), ["retomada"]);
  assert.match(c.alertas()[0].mensagem, /2 pedido\(s\) impresso\(s\) na retomada/);
});

test("dois ciclos ao mesmo tempo não duplicam a 1ª via", async () => {
  const c = cenario();
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", ATENDIDO)]);
  await Promise.all([executarCiclo(c.deps), executarCiclo(c.deps)]);
  assert.equal(c.impressoes().length, 1);
});

test("erro ao montar a folha não avança o cursor e o próximo ciclo tenta de novo", async () => {
  const c = cenario();
  await executarCiclo(c.deps);
  const cursorAntes = c.repo.obterEstado(`monitor:cursor:${c.filialId}`);
  c.definirLista([resumo("10", ATENDIDO)]);
  const montarOk = c.deps.montarFolha;
  c.deps.montarFolha = async () => { throw new Error("Bling 500"); };
  c.avancar(30_000);
  await assert.rejects(executarCiclo(c.deps), /Bling 500/);
  assert.equal(c.repo.obterEstado(`monitor:cursor:${c.filialId}`), cursorAntes);
  c.deps.montarFolha = montarOk;
  await executarCiclo(c.deps);
  assert.equal(c.impressoes().length, 1);
});

test("cicloMonitorado registra erro do Bling e cria alerta de desconexão uma vez só", async () => {
  const c = cenario();
  const log = { info: () => {}, error: () => {} };
  c.deps.bling = { listarPedidosAlterados: async () => { throw new ErroBlingDesconectado("revogado"); } };
  await cicloMonitorado(c.deps, log);
  await cicloMonitorado(c.deps, log);
  assert.equal(c.repo.obterEstado("bling:erro_desde"), AGORA.toISOString());
  assert.equal(c.repo.obterEstado("bling:erro_msg"), "revogado");
  assert.deepEqual(c.alertas().map((a) => a.tipo), ["bling_desconectado"]);
  c.deps.bling = { listarPedidosAlterados: async () => [] };
  await cicloMonitorado(c.deps, log);
  assert.equal(c.repo.obterEstado("bling:erro_desde"), null);
  assert.equal(c.repo.obterEstado("bling:ultima_consulta"), AGORA.toISOString());
});
