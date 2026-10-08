import type { DatabaseSync } from "node:sqlite";
import type { DadosFolha } from "../../../compartilhado/tipos.ts";
import { fimDoDia, inicioDoDia } from "../tempo.ts";
import { transacao } from "./banco.ts";

export type Situacao = number;
export type StatusImpressao = "fila" | "imprimindo" | "impresso" | "erro";
export type TipoAlerta = "repetido" | "cancelado" | "falha_impressao" | "retomada" | "bling_desconectado";
type Param = string | number | null;

export type PedidoRow = {
  id: number; filial_id: number; numero: string; id_bling: number; situacao: Situacao;
  origem: "baseline" | "monitor"; detectado_em: string;
};
export type ImpressaoRow = {
  id: number; pedido_id: number; impressora_id: number; via: number; tipo_documento: string; dados_json: string;
  status: StatusImpressao; tentativas: number; ultimo_erro: string | null; motivo: string | null;
  usuario_id: number | null; criado_em: string; iniciado_em: string | null; impresso_em: string | null;
};
export type FiltroRelatorio = { de: string; ate: string; vendedor?: string; pedido?: string; soReimpressoes?: boolean };
export type LinhaRelatorio = {
  impressaoId: number; criadoEm: string; impressoEm: string | null; numero: string; cliente: string;
  vendedor: string | null; itens: number; via: number; status: StatusImpressao; impressora: string;
  usuario: string | null; motivo: string | null;
};
export type AlertaView = { id: number; tipo: TipoAlerta; pedido_id: number | null; numero: string | null; mensagem: string; criado_em: string };
export type ImpressaoView = {
  id: number; via: number; status: StatusImpressao; criado_em: string; impresso_em: string | null;
  motivo: string | null; usuario: string | null; ultimo_erro: string | null;
};
export type Papel = "operador" | "supervisor";
export type UsuarioRow = { id: number; nome: string; email: string; senha_hash: string; papel: Papel; ativo: number };
export type AgenteRow = {
  id: number; nome: string; ultima_comunicacao: string | null; impressora_id: number; impressora_nome: string;
};

export class Repositorio {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  protected um<T>(sql: string, ...p: Param[]): T | null {
    return (this.db.prepare(sql).get(...p) as unknown as T | undefined) ?? null;
  }

  protected todos<T>(sql: string, ...p: Param[]): T[] {
    return this.db.prepare(sql).all(...p) as unknown as T[];
  }

  protected exec(sql: string, ...p: Param[]): { changes: number; id: number } {
    const r = this.db.prepare(sql).run(...p);
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
  }

  // --- estado (chave/valor) ---
  obterEstado(chave: string): string | null {
    return this.um<{ valor: string }>("SELECT valor FROM estado WHERE chave = ?", chave)?.valor ?? null;
  }

  definirEstado(chave: string, valor: string | null): void {
    if (valor === null) {
      this.exec("DELETE FROM estado WHERE chave = ?", chave);
      return;
    }
    this.exec(
      "INSERT INTO estado (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor",
      chave, valor,
    );
  }

  // --- filiais, agentes, impressoras ---
  garantirFilial(codigo: string, nome: string): number {
    this.exec("INSERT INTO filiais (codigo, nome) VALUES (?, ?) ON CONFLICT(codigo) DO UPDATE SET nome = excluded.nome", codigo, nome);
    return this.um<{ id: number }>("SELECT id FROM filiais WHERE codigo = ?", codigo)!.id;
  }

  garantirAgente(filialId: number, a: { nome: string; token: string; impressora: string }): { agenteId: number; impressoraId: number } {
    this.exec("INSERT INTO agentes (nome, token) VALUES (?, ?) ON CONFLICT(nome) DO UPDATE SET token = excluded.token", a.nome, a.token);
    const agenteId = this.um<{ id: number }>("SELECT id FROM agentes WHERE nome = ?", a.nome)!.id;
    this.exec(
      "INSERT INTO impressoras (filial_id, agente_id, nome_windows) VALUES (?, ?, ?) ON CONFLICT(agente_id, nome_windows) DO NOTHING",
      filialId, agenteId, a.impressora,
    );
    const impressoraId = this.um<{ id: number }>(
      "SELECT id FROM impressoras WHERE agente_id = ? AND nome_windows = ?", agenteId, a.impressora,
    )!.id;
    return { agenteId, impressoraId };
  }

  // Se a impressora do agente mudar na config, vale a mais recente.
  buscarAgentePorToken(token: string): AgenteRow | null {
    return this.um<AgenteRow>(
      `SELECT a.id, a.nome, a.ultima_comunicacao, i.id AS impressora_id, i.nome_windows AS impressora_nome
       FROM agentes a JOIN impressoras i ON i.agente_id = a.id
       WHERE a.token = ? ORDER BY i.id DESC LIMIT 1`,
      token,
    );
  }

  registrarComunicacaoAgente(agenteId: number, agora: Date): void {
    this.exec("UPDATE agentes SET ultima_comunicacao = ? WHERE id = ?", agora.toISOString(), agenteId);
  }

  // --- pedidos ---
  buscarPedido(filialId: number, numero: string): PedidoRow | null {
    return this.um<PedidoRow>("SELECT * FROM pedidos WHERE filial_id = ? AND numero = ?", filialId, numero);
  }

  buscarPedidoPorId(id: number): PedidoRow | null {
    return this.um<PedidoRow>("SELECT * FROM pedidos WHERE id = ?", id);
  }

  inserirPedido(p: {
    filialId: number; numero: string; idBling: number; situacao: Situacao; origem: "baseline" | "monitor"; agora: Date;
  }): number {
    return this.exec(
      "INSERT INTO pedidos (filial_id, numero, id_bling, situacao, origem, detectado_em) VALUES (?, ?, ?, ?, ?, ?)",
      p.filialId, p.numero, p.idBling, p.situacao, p.origem, p.agora.toISOString(),
    ).id;
  }

  atualizarSituacao(pedidoId: number, situacao: Situacao): void {
    this.exec("UPDATE pedidos SET situacao = ? WHERE id = ?", situacao, pedidoId);
  }

  // --- impressões ---
  criarImpressao(i: {
    pedidoId: number; impressoraId: number; via: number; dados: DadosFolha;
    motivo: string | null; usuarioId: number | null; agora: Date;
  }): number {
    return this.exec(
      `INSERT INTO impressoes (pedido_id, impressora_id, via, dados_json, status, motivo, usuario_id, criado_em)
       VALUES (?, ?, ?, ?, 'fila', ?, ?, ?)`,
      i.pedidoId, i.impressoraId, i.via, JSON.stringify(i.dados), i.motivo, i.usuarioId, i.agora.toISOString(),
    ).id;
  }

  proximaVia(pedidoId: number): number {
    return this.um<{ v: number }>("SELECT COALESCE(MAX(via), 0) + 1 AS v FROM impressoes WHERE pedido_id = ?", pedidoId)!.v;
  }

  ultimaImpressao(pedidoId: number): ImpressaoRow | null {
    return this.um<ImpressaoRow>("SELECT * FROM impressoes WHERE pedido_id = ? ORDER BY id DESC LIMIT 1", pedidoId);
  }

  impressoesDoPedido(pedidoId: number): ImpressaoView[] {
    return this.todos<ImpressaoView>(
      `SELECT i.id, i.via, i.status, i.criado_em, i.impresso_em, i.motivo, u.nome AS usuario, i.ultimo_erro
       FROM impressoes i LEFT JOIN usuarios u ON u.id = i.usuario_id
       WHERE i.pedido_id = ? ORDER BY i.id`,
      pedidoId,
    );
  }

  buscarImpressao(id: number): ImpressaoRow | null {
    return this.um<ImpressaoRow>("SELECT * FROM impressoes WHERE id = ?", id);
  }

  pegarProximaDaFila(impressoraId: number, agora: Date): ImpressaoRow | null {
    return transacao(this.db, () => {
      const imp = this.um<ImpressaoRow>(
        "SELECT * FROM impressoes WHERE impressora_id = ? AND status = 'fila' ORDER BY id LIMIT 1", impressoraId,
      );
      if (!imp) return null;
      this.exec("UPDATE impressoes SET status = 'imprimindo', iniciado_em = ? WHERE id = ?", agora.toISOString(), imp.id);
      return { ...imp, status: "imprimindo" as const, iniciado_em: agora.toISOString() };
    });
  }

  marcarImpressa(id: number, agora: Date): void {
    this.exec("UPDATE impressoes SET status = 'impresso', impresso_em = ?, ultimo_erro = NULL WHERE id = ?", agora.toISOString(), id);
  }

  marcarFalha(id: number, erro: string, novoStatus: "fila" | "erro"): void {
    this.exec(
      "UPDATE impressoes SET status = ?, tentativas = tentativas + 1, ultimo_erro = ? WHERE id = ?",
      novoStatus, erro, id,
    );
  }

  listarTravadas(iniciadasAntesDe: Date): ImpressaoRow[] {
    return this.todos<ImpressaoRow>(
      "SELECT * FROM impressoes WHERE status = 'imprimindo' AND iniciado_em < ? ORDER BY id", iniciadasAntesDe.toISOString(),
    );
  }

  reenfileirarErros(impressoraId: number): number {
    return this.exec(
      "UPDATE impressoes SET status = 'fila', tentativas = 0 WHERE impressora_id = ? AND status = 'erro'", impressoraId,
    ).changes;
  }

  // --- relatório ---
  static readonly SQL_RELATORIO = `
    SELECT i.id AS impressaoId, i.criado_em AS criadoEm, i.impresso_em AS impressoEm, p.numero AS numero,
      json_extract(i.dados_json, '$.cliente.nome') AS cliente, json_extract(i.dados_json, '$.pedido.vendedor') AS vendedor,
      json_array_length(i.dados_json, '$.itens') AS itens, i.via AS via, i.status AS status,
      im.nome_windows AS impressora, u.nome AS usuario, i.motivo AS motivo
    FROM impressoes i
    JOIN pedidos p ON p.id = i.pedido_id
    JOIN impressoras im ON im.id = i.impressora_id
    LEFT JOIN usuarios u ON u.id = i.usuario_id`;

  relatorio(f: FiltroRelatorio): LinhaRelatorio[] {
    const onde = ["i.criado_em BETWEEN ? AND ?"];
    const params: Param[] = [inicioDoDia(f.de), fimDoDia(f.ate)];
    if (f.vendedor) { onde.push("json_extract(i.dados_json, '$.pedido.vendedor') LIKE ?"); params.push(`%${f.vendedor}%`); }
    if (f.pedido) { onde.push("p.numero = ?"); params.push(f.pedido.trim()); }
    if (f.soReimpressoes) onde.push("i.via > 1");
    return this.todos<LinhaRelatorio>(`${Repositorio.SQL_RELATORIO} WHERE ${onde.join(" AND ")} ORDER BY i.id DESC`, ...params);
  }

  linhaRelatorio(impressaoId: number): LinhaRelatorio | null {
    return this.um<LinhaRelatorio>(`${Repositorio.SQL_RELATORIO} WHERE i.id = ?`, impressaoId);
  }

  // --- alertas ---
  criarAlerta(a: { tipo: TipoAlerta; pedidoId: number | null; mensagem: string; agora: Date }): number {
    return this.exec(
      "INSERT INTO alertas (tipo, pedido_id, mensagem, criado_em) VALUES (?, ?, ?, ?)",
      a.tipo, a.pedidoId, a.mensagem, a.agora.toISOString(),
    ).id;
  }

  alertaPendenteDoTipo(tipo: TipoAlerta): boolean {
    return this.um("SELECT 1 AS x FROM alertas WHERE tipo = ? AND resolvido_em IS NULL LIMIT 1", tipo) !== null;
  }

  alertasPendentes(): AlertaView[] {
    return this.todos<AlertaView>(
      `SELECT a.id, a.tipo, a.pedido_id, p.numero, a.mensagem, a.criado_em
       FROM alertas a LEFT JOIN pedidos p ON p.id = a.pedido_id
       WHERE a.resolvido_em IS NULL ORDER BY a.id DESC`,
    );
  }

  alertasDoPedido(pedidoId: number): AlertaView[] {
    return this.todos<AlertaView>(
      `SELECT a.id, a.tipo, a.pedido_id, p.numero, a.mensagem, a.criado_em
       FROM alertas a LEFT JOIN pedidos p ON p.id = a.pedido_id
       WHERE a.pedido_id = ? AND a.resolvido_em IS NULL ORDER BY a.id DESC`,
      pedidoId,
    );
  }

  resolverAlerta(id: number, usuarioId: number | null, agora: Date): void {
    this.exec("UPDATE alertas SET resolvido_por = ?, resolvido_em = ? WHERE id = ? AND resolvido_em IS NULL", usuarioId, agora.toISOString(), id);
  }

  resolverAlertasDoTipo(tipo: TipoAlerta, usuarioId: number | null, agora: Date, pedidoId?: number): void {
    if (pedidoId === undefined) {
      this.exec("UPDATE alertas SET resolvido_por = ?, resolvido_em = ? WHERE tipo = ? AND resolvido_em IS NULL", usuarioId, agora.toISOString(), tipo);
    } else {
      this.exec(
        "UPDATE alertas SET resolvido_por = ?, resolvido_em = ? WHERE tipo = ? AND pedido_id = ? AND resolvido_em IS NULL",
        usuarioId, agora.toISOString(), tipo, pedidoId,
      );
    }
  }

  contadoresDoDia(dia: string): { impressos: number; naFila: number; alertas: number } {
    const impressos = this.um<{ n: number }>(
      "SELECT COUNT(*) AS n FROM impressoes WHERE status = 'impresso' AND impresso_em BETWEEN ? AND ?", inicioDoDia(dia), fimDoDia(dia),
    )!.n;
    const naFila = this.um<{ n: number }>("SELECT COUNT(*) AS n FROM impressoes WHERE status IN ('fila', 'imprimindo')")!.n;
    const alertas = this.um<{ n: number }>("SELECT COUNT(*) AS n FROM alertas WHERE resolvido_em IS NULL")!.n;
    return { impressos, naFila, alertas };
  }

  ultimaComunicacaoAgente(impressoraId: number): string | null {
    return this.um<{ u: string | null }>(
      "SELECT a.ultima_comunicacao AS u FROM impressoras i JOIN agentes a ON a.id = i.agente_id WHERE i.id = ?", impressoraId,
    )?.u ?? null;
  }

  contarErros(impressoraId: number): number {
    return this.um<{ n: number }>("SELECT COUNT(*) AS n FROM impressoes WHERE impressora_id = ? AND status = 'erro'", impressoraId)!.n;
  }

  // --- usuários (só o necessário aqui; o resto na Task 9) ---
  nomeUsuario(id: number | null): string | null {
    if (id === null) return null;
    return this.um<{ nome: string }>("SELECT nome FROM usuarios WHERE id = ?", id)?.nome ?? null;
  }

  criarUsuario(u: { nome: string; email: string; senhaHash: string; papel: Papel }): number {
    return this.exec(
      "INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?, ?, ?, ?)",
      u.nome, u.email.trim().toLowerCase(), u.senhaHash, u.papel,
    ).id;
  }

  buscarUsuarioPorEmail(email: string): UsuarioRow | null {
    return this.um<UsuarioRow>("SELECT * FROM usuarios WHERE email = ?", email.trim().toLowerCase());
  }

  buscarUsuarioPorId(id: number): UsuarioRow | null {
    return this.um<UsuarioRow>("SELECT * FROM usuarios WHERE id = ?", id);
  }

  listarUsuarios(): UsuarioRow[] {
    return this.todos<UsuarioRow>("SELECT * FROM usuarios ORDER BY ativo DESC, nome");
  }

  definirUsuarioAtivo(id: number, ativo: boolean): void {
    this.exec("UPDATE usuarios SET ativo = ? WHERE id = ?", ativo ? 1 : 0, id);
  }

  // --- planilha ---
  enfileirarPlanilha(impressaoId: number): void {
    this.exec("INSERT OR IGNORE INTO fila_planilha (impressao_id) VALUES (?)", impressaoId);
  }
}
