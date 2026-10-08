import type { DadosFolha, Via } from "../../../compartilhado/tipos.ts";
import { transacao } from "../banco/banco.ts";
import type { ImpressaoRow, Repositorio } from "../banco/repositorio.ts";
import type { MontarFolha } from "../bling/montar-folha.ts";

export const MAX_TENTATIVAS = 4; // 1 tentativa + 3 novas
export const LIMITE_TRAVADA_MS = 5 * 60_000;

export type TrabalhoImpressao = { impressaoId: number; dados: DadosFolha; via: Via };

export function viaDaImpressao(repo: Repositorio, imp: ImpressaoRow): Via {
  return { numero: imp.via, motivo: imp.motivo, usuario: repo.nomeUsuario(imp.usuario_id), em: imp.criado_em };
}

export function entregarProximo(repo: Repositorio, impressoraId: number, agora: Date): TrabalhoImpressao | null {
  const imp = repo.pegarProximaDaFila(impressoraId, agora);
  if (!imp) return null;
  return { impressaoId: imp.id, dados: JSON.parse(imp.dados_json) as DadosFolha, via: viaDaImpressao(repo, imp) };
}

export function registrarResultado(
  repo: Repositorio,
  impressaoId: number,
  r: { ok: true } | { ok: false; erro: string },
  agora: Date,
): void {
  const imp = repo.buscarImpressao(impressaoId);
  if (!imp) throw new Error(`Impressão ${impressaoId} não existe`);

  if (r.ok) {
    // Vale mesmo se ela já tinha sido marcada como travada/erro: a folha saiu.
    transacao(repo.db, () => {
      repo.marcarImpressa(imp.id, agora);
      repo.enfileirarPlanilha(imp.id);
    });
    return;
  }

  const tentativas = imp.tentativas + 1;
  if (tentativas < MAX_TENTATIVAS) {
    repo.marcarFalha(imp.id, r.erro, "fila");
    return;
  }
  repo.marcarFalha(imp.id, r.erro, "erro");
  const pedido = repo.buscarPedidoPorId(imp.pedido_id)!;
  repo.criarAlerta({
    tipo: "falha_impressao", pedidoId: pedido.id, agora,
    mensagem: `Pedido ${pedido.numero}: a impressão falhou ${tentativas} vezes (${r.erro}). Verifique a impressora e clique em "Imprimir pendentes".`,
  });
}

export function recuperarTravadas(repo: Repositorio, agora: Date): number {
  const travadas = repo.listarTravadas(new Date(agora.getTime() - LIMITE_TRAVADA_MS));
  for (const imp of travadas) {
    repo.marcarFalha(imp.id, "Sem resposta do agente durante a impressão", "erro");
    const pedido = repo.buscarPedidoPorId(imp.pedido_id)!;
    repo.criarAlerta({
      tipo: "falha_impressao", pedidoId: pedido.id, agora,
      mensagem: `Pedido ${pedido.numero}: o agente parou de responder durante a impressão. Confira se a folha saiu antes de clicar em "Imprimir pendentes".`,
    });
  }
  return travadas.length;
}

export function imprimirPendentes(repo: Repositorio, impressoraId: number): number {
  return repo.reenfileirarErros(impressoraId);
}

export async function reimprimir(
  repo: Repositorio,
  montarFolha: MontarFolha,
  p: { pedidoId: number; impressoraId: number; motivo: string; usuarioId: number; agora: Date },
): Promise<number> {
  const pedido = repo.buscarPedidoPorId(p.pedidoId);
  if (!pedido) throw new Error(`Pedido ${p.pedidoId} não existe`);
  const dados = await montarFolha(pedido.id_bling, new Date(pedido.detectado_em));
  return transacao(repo.db, () =>
    repo.criarImpressao({
      pedidoId: pedido.id, impressoraId: p.impressoraId, via: repo.proximaVia(pedido.id),
      dados, motivo: p.motivo, usuarioId: p.usuarioId, agora: p.agora,
    }),
  );
}
