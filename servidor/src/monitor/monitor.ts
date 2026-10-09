import type { PedidoRow, Repositorio } from "../banco/repositorio.ts";
import { ErroBlingDesconectado, type ResumoPedido } from "../bling/cliente.ts";
import type { MontarFolha } from "../bling/montar-folha.ts";
import { formatarDataHora } from "../../../compartilhado/tempo.ts";

export type DepsMonitor = {
  repo: Repositorio;
  bling: {
    listarPedidosAlterados(desde: Date, ate: Date): Promise<ResumoPedido[]>;
    paginaPorSituacao(situacaoId: number, pagina: number): Promise<ResumoPedido[]>;
  };
  montarFolha: MontarFolha;
  filialId: number;
  impressoraId: number;
  situacaoAtendido: number;
  situacaoCancelado: number;
  margemMinutos: number;
  agora: () => Date;
  // Tempo máximo de uma chamada (a Vercel corta em 60 s). Sem valor = sem limite.
  orcamentoMs?: number;
  relogio?: () => number;
};

export type ResultadoCiclo =
  | { tipo: "baseline"; registrados: number; concluida: boolean }
  | { tipo: "ciclo"; novos: number; alertas: number };

const LIMIAR_RETOMADA_MS = 5 * 60_000;
const POR_PAGINA = 100;
const MAX_PAGINAS_BASELINE = 2000;

export async function executarCiclo(d: DepsMonitor): Promise<ResultadoCiclo> {
  const agora = d.agora();
  const chave = `monitor:cursor:${d.filialId}`;
  const cursor = await d.repo.obterEstado(chave);
  if (cursor === null) return primeiraAtivacao(d, chave);

  const ultimo = new Date(cursor);
  const lista = await d.bling.listarPedidosAlterados(new Date(ultimo.getTime() - d.margemMinutos * 60_000), agora);

  // Pedidos que falharam antes continuam sendo tentados mesmo fora da janela do Bling.
  const chavePendentes = `monitor:pendentes:${d.filialId}`;
  const pendentes = JSON.parse((await d.repo.obterEstado(chavePendentes)) ?? "[]") as ResumoPedido[];
  for (const p of pendentes) if (!lista.some((r) => r.id === p.id)) lista.push(p);
  const aindaPendentes: ResumoPedido[] = [];

  lista.sort((a, b) => Number(a.numero) - Number(b.numero) || a.numero.localeCompare(b.numero));

  let novos = 0;
  let alertas = 0;
  for (const r of lista) {
    const existente = await d.repo.buscarPedido(d.filialId, r.numero);

    if (!existente) {
      if (r.situacaoId !== d.situacaoAtendido) continue;
      let dados: Awaited<ReturnType<MontarFolha>>;
      try {
        dados = await d.montarFolha(r.id, agora);
      } catch (e) {
        if (e instanceof ErroBlingDesconectado) throw e;
        // Um pedido com problema não pode travar os outros.
        aindaPendentes.push({ id: r.id, numero: r.numero, numeroLoja: r.numeroLoja, situacaoId: r.situacaoId });
        if (!pendentes.some((p) => p.id === r.id)) {
          await d.repo.criarAlerta({
            tipo: "falha_impressao", pedidoId: null, agora,
            mensagem: `Pedido ${r.numero}: não foi possível buscar os dados no Bling (${e instanceof Error ? e.message : String(e)}). O sistema tenta de novo a cada consulta.`,
          });
          alertas++;
        }
        continue;
      }
      // Pedido + 1ª via numa transação; se outro ciclo chegou antes, não grava nada.
      const criado = await d.repo.inserirPedidoComPrimeiraVia(
        { filialId: d.filialId, numero: r.numero, idBling: r.id, situacao: r.situacaoId, origem: "monitor", agora },
        d.impressoraId, dados,
      );
      if (criado) novos++;
      continue;
    }

    if (existente.situacao === r.situacaoId) continue;
    await d.repo.atualizarSituacao(existente.id, r.situacaoId);

    if (r.situacaoId === d.situacaoAtendido) {
      await d.repo.criarAlerta({ tipo: "repetido", pedidoId: existente.id, mensagem: await mensagemRepetido(d.repo, existente), agora });
      alertas++;
    } else if (r.situacaoId === d.situacaoCancelado && (await d.repo.ultimaImpressao(existente.id))) {
      await d.repo.criarAlerta({
        tipo: "cancelado", pedidoId: existente.id, agora,
        mensagem: `Pedido ${existente.numero} foi CANCELADO, mas já foi impresso: retire da separação.`,
      });
      alertas++;
    }
  }

  if (novos > 0 && agora.getTime() - ultimo.getTime() > LIMIAR_RETOMADA_MS) {
    await d.repo.criarAlerta({
      tipo: "retomada", pedidoId: null, agora,
      mensagem: `O sistema ficou sem consultar o Bling de ${formatarDataHora(cursor)} a ${formatarDataHora(agora.toISOString())}. ` +
        `${novos} pedido(s) impresso(s) na retomada.`,
    });
    alertas++;
  }

  await d.repo.definirEstado(chavePendentes, JSON.stringify(aindaPendentes));
  await d.repo.definirEstado(chave, agora.toISOString());
  return { tipo: "ciclo", novos, alertas };
}

// Primeira ativação: tudo o que já está Atendido (de qualquer data) é registrado, nunca impresso.
// Assim um pedido antigo que ganhar nota fiscal ou rastreio depois não sai como 1ª via.
// É feita em partes (página por página) e continua de onde parou na chamada seguinte.
async function primeiraAtivacao(d: DepsMonitor, chaveCursor: string): Promise<ResultadoCiclo> {
  const relogio = d.relogio ?? Date.now;
  const inicioChamada = relogio();
  const chaveInicio = `monitor:baseline_inicio:${d.filialId}`;
  const chavePagina = `monitor:baseline_pagina:${d.filialId}`;
  let inicio = await d.repo.obterEstado(chaveInicio);
  if (!inicio) {
    inicio = d.agora().toISOString();
    await d.repo.definirEstado(chaveInicio, inicio);
  }
  let pagina = Number((await d.repo.obterEstado(chavePagina)) ?? "1");
  let registrados = 0;

  for (;;) {
    if (pagina > MAX_PAGINAS_BASELINE) throw new Error(`Primeira ativação passou de ${MAX_PAGINAS_BASELINE} páginas de pedidos Atendido.`);
    const lote = await d.bling.paginaPorSituacao(d.situacaoAtendido, pagina);
    registrados += await d.repo.inserirPedidosBaseline(
      d.filialId,
      lote.filter((r) => r.situacaoId === d.situacaoAtendido).map((r) => ({ numero: r.numero, idBling: r.id, situacao: r.situacaoId })),
      d.agora(),
    );
    pagina++;
    await d.repo.definirEstado(chavePagina, String(pagina));

    if (lote.length < POR_PAGINA) {
      // O cursor começa no início da ativação: o que virou Atendido durante ela ainda é visto.
      await d.repo.definirEstado(chaveCursor, inicio);
      await d.repo.definirEstado(chaveInicio, null);
      await d.repo.definirEstado(chavePagina, null);
      return { tipo: "baseline", registrados, concluida: true };
    }
    if (d.orcamentoMs !== undefined && relogio() - inicioChamada > d.orcamentoMs) {
      return { tipo: "baseline", registrados, concluida: false };
    }
  }
}

async function mensagemRepetido(repo: Repositorio, p: PedidoRow): Promise<string> {
  const ult = await repo.ultimaImpressao(p.id);
  return ult
    ? `Pedido ${p.numero} voltou para Atendido. Já foi impresso em ${formatarDataHora(ult.criado_em)}. Reimprimir?`
    : `Pedido ${p.numero} voltou para Atendido. Ele é anterior ao sistema e não foi impresso por ele.`;
}

export async function cicloMonitorado(d: DepsMonitor, log: Pick<Console, "info" | "error"> = console): Promise<ResultadoCiclo | null> {
  try {
    const r = await executarCiclo(d);
    await d.repo.definirEstado("bling:erro_desde", null);
    await d.repo.definirEstado("bling:erro_msg", null);
    await d.repo.definirEstado("bling:ultima_consulta", d.agora().toISOString());
    if (r.tipo === "baseline") {
      log.info(`[monitor] primeira ativação: +${r.registrados} pedido(s) já atendido(s) registrado(s) sem imprimir${r.concluida ? " (concluída)" : " (continua na próxima chamada)"}`);
    } else if (r.novos || r.alertas) {
      log.info(`[monitor] ${r.novos} pedido(s) novo(s), ${r.alertas} alerta(s)`);
    }
    return r;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!(await d.repo.obterEstado("bling:erro_desde"))) await d.repo.definirEstado("bling:erro_desde", d.agora().toISOString());
    await d.repo.definirEstado("bling:erro_msg", msg);
    if (e instanceof ErroBlingDesconectado && !(await d.repo.alertaPendenteDoTipo("bling_desconectado"))) {
      await d.repo.criarAlerta({
        tipo: "bling_desconectado", pedidoId: null, agora: d.agora(),
        mensagem: "O Bling desconectou o sistema. Um supervisor precisa clicar em \"Reconectar ao Bling\" na Configuração.",
      });
    }
    log.error(`[monitor] erro: ${msg}`);
    return null;
  }
}
