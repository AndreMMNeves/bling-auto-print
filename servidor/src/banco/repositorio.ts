import type { Client, InStatement, ResultSet } from "@libsql/client";
import type { DadosFolha } from "../../../compartilhado/tipos.ts";
import { fimDoDia, inicioDoDia } from "../../../compartilhado/tempo.ts";

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
export type NovoPedido = {
  filialId: number; numero: string; idBling: number; situacao: Situacao; origem: "baseline" | "monitor"; agora: Date;
};

function linhas<T>(rs: ResultSet): T[] {
  return rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])) as T);
}

// Todo acesso ao banco é assíncrono (Turso na Vercel, arquivo no PC local).
// Operações que precisam ser atômicas usam um único comando SQL ou db.batch (transação).
export class Repositorio {
  readonly db: Client;

  constructor(db: Client) {
    this.db = db;
  }

  protected async um<T>(sql: string, ...args: Param[]): Promise<T | null> {
    return linhas<T>(await this.db.execute({ sql, args }))[0] ?? null;
  }

  protected async todos<T>(sql: string, ...args: Param[]): Promise<T[]> {
    return linhas<T>(await this.db.execute({ sql, args }));
  }

  protected async exec(sql: string, ...args: Param[]): Promise<{ changes: number; id: number }> {
    const r = await this.db.execute({ sql, args });
    return { changes: r.rowsAffected, id: Number(r.lastInsertRowid ?? 0) };
  }

  // --- estado (chave/valor) ---
  async obterEstado(chave: string): Promise<string | null> {
    return (await this.um<{ valor: string }>("SELECT valor FROM estado WHERE chave = ?", chave))?.valor ?? null;
  }

  async definirEstado(chave: string, valor: string | null): Promise<void> {
    if (valor === null) {
      await this.exec("DELETE FROM estado WHERE chave = ?", chave);
      return;
    }
    await this.exec(
      "INSERT INTO estado (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor",
      chave, valor,
    );
  }

  // --- filiais, agentes, impressoras ---
  async garantirFilial(codigo: string, nome: string): Promise<number> {
    await this.exec("INSERT INTO filiais (codigo, nome) VALUES (?, ?) ON CONFLICT(codigo) DO UPDATE SET nome = excluded.nome", codigo, nome);
    return (await this.um<{ id: number }>("SELECT id FROM filiais WHERE codigo = ?", codigo))!.id;
  }

  async garantirAgente(filialId: number, a: { nome: string; token: string; impressora: string }): Promise<{ agenteId: number; impressoraId: number }> {
    await this.exec("INSERT INTO agentes (nome, token) VALUES (?, ?) ON CONFLICT(nome) DO UPDATE SET token = excluded.token", a.nome, a.token);
    const agenteId = (await this.um<{ id: number }>("SELECT id FROM agentes WHERE nome = ?", a.nome))!.id;
    await this.exec(
      "INSERT INTO impressoras (filial_id, agente_id, nome_windows) VALUES (?, ?, ?) ON CONFLICT(agente_id, nome_windows) DO NOTHING",
      filialId, agenteId, a.impressora,
    );
    const impressoraId = (await this.um<{ id: number }>(
      "SELECT id FROM impressoras WHERE agente_id = ? AND nome_windows = ?", agenteId, a.impressora,
    ))!.id;
    return { agenteId, impressoraId };
  }

  // Se a impressora do agente mudar na config, vale a mais recente.
  async buscarAgentePorToken(token: string): Promise<AgenteRow | null> {
    return this.um<AgenteRow>(
      `SELECT a.id, a.nome, a.ultima_comunicacao, i.id AS impressora_id, i.nome_windows AS impressora_nome
       FROM agentes a JOIN impressoras i ON i.agente_id = a.id
       WHERE a.token = ? ORDER BY i.id DESC LIMIT 1`,
      token,
    );
  }

  async registrarComunicacaoAgente(agenteId: number, agora: Date): Promise<void> {
    await this.exec("UPDATE agentes SET ultima_comunicacao = ? WHERE id = ?", agora.toISOString(), agenteId);
  }

  // --- pedidos ---
  async buscarPedido(filialId: number, numero: string): Promise<PedidoRow | null> {
    return this.um<PedidoRow>("SELECT * FROM pedidos WHERE filial_id = ? AND numero = ?", filialId, numero);
  }

  async buscarPedidoPorId(id: number): Promise<PedidoRow | null> {
    return this.um<PedidoRow>("SELECT * FROM pedidos WHERE id = ?", id);
  }

  async inserirPedido(p: NovoPedido): Promise<number> {
    return (await this.exec(
      "INSERT INTO pedidos (filial_id, numero, id_bling, situacao, origem, detectado_em) VALUES (?, ?, ?, ?, ?, ?)",
      p.filialId, p.numero, p.idBling, p.situacao, p.origem, p.agora.toISOString(),
    )).id;
  }

  // Primeira ativação: grava em lote, ignorando os que já existem.
  async inserirPedidosBaseline(filialId: number, lista: Array<{ numero: string; idBling: number; situacao: Situacao }>, agora: Date): Promise<number> {
    if (!lista.length) return 0;
    const rs = await this.db.batch(lista.map((p): InStatement => ({
      sql: "INSERT OR IGNORE INTO pedidos (filial_id, numero, id_bling, situacao, origem, detectado_em) VALUES (?, ?, ?, ?, 'baseline', ?)",
      args: [filialId, p.numero, p.idBling, p.situacao, agora.toISOString()],
    })), "write");
    return rs.reduce((s, r) => s + r.rowsAffected, 0);
  }

  // Pedido novo + 1ª via numa transação só. Devolve false se o pedido já existia
  // (outro ciclo chegou antes): nesse caso nada é gravado.
  async inserirPedidoComPrimeiraVia(p: NovoPedido, impressoraId: number, dados: DadosFolha): Promise<boolean> {
    try {
      await this.db.batch([
        {
          sql: "INSERT INTO pedidos (filial_id, numero, id_bling, situacao, origem, detectado_em) VALUES (?, ?, ?, ?, ?, ?)",
          args: [p.filialId, p.numero, p.idBling, p.situacao, p.origem, p.agora.toISOString()],
        },
        {
          sql: `INSERT INTO impressoes (pedido_id, impressora_id, via, dados_json, status, criado_em)
                VALUES ((SELECT id FROM pedidos WHERE filial_id = ? AND numero = ?), ?, 1, ?, 'fila', ?)`,
          args: [p.filialId, p.numero, impressoraId, JSON.stringify(dados), p.agora.toISOString()],
        },
      ], "write");
      return true;
    } catch (e) {
      if (/UNIQUE/i.test(String(e instanceof Error ? e.message : e))) return false;
      throw e;
    }
  }

  async atualizarSituacao(pedidoId: number, situacao: Situacao): Promise<void> {
    await this.exec("UPDATE pedidos SET situacao = ? WHERE id = ?", situacao, pedidoId);
  }

  // --- impressões ---
  async criarImpressao(i: {
    pedidoId: number; impressoraId: number; via: number; dados: DadosFolha;
    motivo: string | null; usuarioId: number | null; agora: Date;
  }): Promise<number> {
    return (await this.exec(
      `INSERT INTO impressoes (pedido_id, impressora_id, via, dados_json, status, motivo, usuario_id, criado_em)
       VALUES (?, ?, ?, ?, 'fila', ?, ?, ?)`,
      i.pedidoId, i.impressoraId, i.via, JSON.stringify(i.dados), i.motivo, i.usuarioId, i.agora.toISOString(),
    )).id;
  }

  // A via é calculada no próprio INSERT: dois pedidos de reimpressão ao mesmo tempo não pegam o mesmo número.
  async criarProximaVia(i: {
    pedidoId: number; impressoraId: number; dados: DadosFolha; motivo: string; usuarioId: number; agora: Date;
  }): Promise<number> {
    return (await this.exec(
      `INSERT INTO impressoes (pedido_id, impressora_id, via, dados_json, status, motivo, usuario_id, criado_em)
       VALUES (?, ?, (SELECT COALESCE(MAX(via), 0) + 1 FROM impressoes WHERE pedido_id = ?), ?, 'fila', ?, ?, ?)`,
      i.pedidoId, i.impressoraId, i.pedidoId, JSON.stringify(i.dados), i.motivo, i.usuarioId, i.agora.toISOString(),
    )).id;
  }

  async proximaVia(pedidoId: number): Promise<number> {
    return (await this.um<{ v: number }>("SELECT COALESCE(MAX(via), 0) + 1 AS v FROM impressoes WHERE pedido_id = ?", pedidoId))!.v;
  }

  async ultimaImpressao(pedidoId: number): Promise<ImpressaoRow | null> {
    return this.um<ImpressaoRow>("SELECT * FROM impressoes WHERE pedido_id = ? ORDER BY id DESC LIMIT 1", pedidoId);
  }

  async impressoesDoPedido(pedidoId: number): Promise<ImpressaoView[]> {
    return this.todos<ImpressaoView>(
      `SELECT i.id, i.via, i.status, i.criado_em, i.impresso_em, i.motivo, u.nome AS usuario, i.ultimo_erro
       FROM impressoes i LEFT JOIN usuarios u ON u.id = i.usuario_id
       WHERE i.pedido_id = ? ORDER BY i.id`,
      pedidoId,
    );
  }

  async buscarImpressao(id: number): Promise<ImpressaoRow | null> {
    return this.um<ImpressaoRow>("SELECT * FROM impressoes WHERE id = ?", id);
  }

  // Um único UPDATE ... RETURNING: dois agentes nunca pegam o mesmo trabalho.
  async pegarProximaDaFila(impressoraId: number, agora: Date): Promise<ImpressaoRow | null> {
    return this.um<ImpressaoRow>(
      `UPDATE impressoes SET status = 'imprimindo', iniciado_em = ?
       WHERE id = (SELECT id FROM impressoes WHERE impressora_id = ? AND status = 'fila' ORDER BY id LIMIT 1)
       RETURNING *`,
      agora.toISOString(), impressoraId,
    );
  }

  async marcarImpressa(id: number, agora: Date): Promise<void> {
    await this.exec("UPDATE impressoes SET status = 'impresso', impresso_em = ?, ultimo_erro = NULL WHERE id = ?", agora.toISOString(), id);
  }

  // Marca impresso e enfileira para a planilha na mesma transação.
  async registrarImpressa(id: number, agora: Date): Promise<void> {
    await this.db.batch([
      { sql: "UPDATE impressoes SET status = 'impresso', impresso_em = ?, ultimo_erro = NULL WHERE id = ?", args: [agora.toISOString(), id] },
      { sql: "INSERT OR IGNORE INTO fila_planilha (impressao_id) VALUES (?)", args: [id] },
    ], "write");
  }

  async marcarFalha(id: number, erro: string, novoStatus: "fila" | "erro"): Promise<void> {
    await this.exec(
      "UPDATE impressoes SET status = ?, tentativas = tentativas + 1, ultimo_erro = ? WHERE id = ?",
      novoStatus, erro, id,
    );
  }

  async listarTravadas(iniciadasAntesDe: Date): Promise<ImpressaoRow[]> {
    return this.todos<ImpressaoRow>(
      "SELECT * FROM impressoes WHERE status = 'imprimindo' AND iniciado_em < ? ORDER BY id", iniciadasAntesDe.toISOString(),
    );
  }

  async reenfileirarErros(impressoraId: number): Promise<number> {
    return (await this.exec(
      "UPDATE impressoes SET status = 'fila', tentativas = 0 WHERE impressora_id = ? AND status = 'erro'", impressoraId,
    )).changes;
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

  async relatorio(f: FiltroRelatorio): Promise<LinhaRelatorio[]> {
    const onde = ["i.criado_em BETWEEN ? AND ?"];
    const params: Param[] = [inicioDoDia(f.de), fimDoDia(f.ate)];
    if (f.vendedor) { onde.push("json_extract(i.dados_json, '$.pedido.vendedor') LIKE ?"); params.push(`%${f.vendedor}%`); }
    if (f.pedido) { onde.push("p.numero = ?"); params.push(f.pedido.trim()); }
    if (f.soReimpressoes) onde.push("i.via > 1");
    return this.todos<LinhaRelatorio>(`${Repositorio.SQL_RELATORIO} WHERE ${onde.join(" AND ")} ORDER BY i.id DESC`, ...params);
  }

  async linhaRelatorio(impressaoId: number): Promise<LinhaRelatorio | null> {
    return this.um<LinhaRelatorio>(`${Repositorio.SQL_RELATORIO} WHERE i.id = ?`, impressaoId);
  }

  // --- alertas ---
  async criarAlerta(a: { tipo: TipoAlerta; pedidoId: number | null; mensagem: string; agora: Date }): Promise<number> {
    return (await this.exec(
      "INSERT INTO alertas (tipo, pedido_id, mensagem, criado_em) VALUES (?, ?, ?, ?)",
      a.tipo, a.pedidoId, a.mensagem, a.agora.toISOString(),
    )).id;
  }

  async alertaPendenteDoTipo(tipo: TipoAlerta): Promise<boolean> {
    return (await this.um("SELECT 1 AS x FROM alertas WHERE tipo = ? AND resolvido_em IS NULL LIMIT 1", tipo)) !== null;
  }

  async alertasPendentes(): Promise<AlertaView[]> {
    return this.todos<AlertaView>(
      `SELECT a.id, a.tipo, a.pedido_id, p.numero, a.mensagem, a.criado_em
       FROM alertas a LEFT JOIN pedidos p ON p.id = a.pedido_id
       WHERE a.resolvido_em IS NULL ORDER BY a.id DESC`,
    );
  }

  async alertasDoPedido(pedidoId: number): Promise<AlertaView[]> {
    return this.todos<AlertaView>(
      `SELECT a.id, a.tipo, a.pedido_id, p.numero, a.mensagem, a.criado_em
       FROM alertas a LEFT JOIN pedidos p ON p.id = a.pedido_id
       WHERE a.pedido_id = ? AND a.resolvido_em IS NULL ORDER BY a.id DESC`,
      pedidoId,
    );
  }

  async resolverAlerta(id: number, usuarioId: number | null, agora: Date): Promise<void> {
    await this.exec("UPDATE alertas SET resolvido_por = ?, resolvido_em = ? WHERE id = ? AND resolvido_em IS NULL", usuarioId, agora.toISOString(), id);
  }

  async resolverAlertasDoTipo(tipo: TipoAlerta, usuarioId: number | null, agora: Date, pedidoId?: number): Promise<void> {
    if (pedidoId === undefined) {
      await this.exec("UPDATE alertas SET resolvido_por = ?, resolvido_em = ? WHERE tipo = ? AND resolvido_em IS NULL", usuarioId, agora.toISOString(), tipo);
    } else {
      await this.exec(
        "UPDATE alertas SET resolvido_por = ?, resolvido_em = ? WHERE tipo = ? AND pedido_id = ? AND resolvido_em IS NULL",
        usuarioId, agora.toISOString(), tipo, pedidoId,
      );
    }
  }

  async contadoresDoDia(dia: string): Promise<{ impressos: number; naFila: number; alertas: number }> {
    const r = await this.um<{ impressos: number; naFila: number; alertas: number }>(
      `SELECT
        (SELECT COUNT(*) FROM impressoes WHERE status = 'impresso' AND impresso_em BETWEEN ? AND ?) AS impressos,
        (SELECT COUNT(*) FROM impressoes WHERE status IN ('fila', 'imprimindo')) AS naFila,
        (SELECT COUNT(*) FROM alertas WHERE resolvido_em IS NULL) AS alertas`,
      inicioDoDia(dia), fimDoDia(dia),
    );
    return r!;
  }

  async ultimaComunicacaoAgente(impressoraId: number): Promise<string | null> {
    return (await this.um<{ u: string | null }>(
      "SELECT a.ultima_comunicacao AS u FROM impressoras i JOIN agentes a ON a.id = i.agente_id WHERE i.id = ?", impressoraId,
    ))?.u ?? null;
  }

  async contarErros(impressoraId: number): Promise<number> {
    return (await this.um<{ n: number }>("SELECT COUNT(*) AS n FROM impressoes WHERE impressora_id = ? AND status = 'erro'", impressoraId))!.n;
  }

  // --- usuários ---
  async nomeUsuario(id: number | null): Promise<string | null> {
    if (id === null) return null;
    return (await this.um<{ nome: string }>("SELECT nome FROM usuarios WHERE id = ?", id))?.nome ?? null;
  }

  async criarUsuario(u: { nome: string; email: string; senhaHash: string; papel: Papel }): Promise<number> {
    return (await this.exec(
      "INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?, ?, ?, ?)",
      u.nome, u.email.trim().toLowerCase(), u.senhaHash, u.papel,
    )).id;
  }

  async buscarUsuarioPorEmail(email: string): Promise<UsuarioRow | null> {
    return this.um<UsuarioRow>("SELECT * FROM usuarios WHERE email = ?", email.trim().toLowerCase());
  }

  async buscarUsuarioPorId(id: number): Promise<UsuarioRow | null> {
    return this.um<UsuarioRow>("SELECT * FROM usuarios WHERE id = ?", id);
  }

  async listarUsuarios(): Promise<UsuarioRow[]> {
    return this.todos<UsuarioRow>("SELECT * FROM usuarios ORDER BY ativo DESC, nome");
  }

  async definirUsuarioAtivo(id: number, ativo: boolean): Promise<void> {
    await this.exec("UPDATE usuarios SET ativo = ? WHERE id = ?", ativo ? 1 : 0, id);
  }

  // --- planilha ---
  async enfileirarPlanilha(impressaoId: number): Promise<void> {
    await this.exec("INSERT OR IGNORE INTO fila_planilha (impressao_id) VALUES (?)", impressaoId);
  }

  async pendentesPlanilha(limite: number): Promise<number[]> {
    return (await this.todos<{ impressao_id: number }>(
      "SELECT impressao_id FROM fila_planilha WHERE enviado_em IS NULL ORDER BY id LIMIT ?", limite,
    )).map((r) => r.impressao_id);
  }

  async marcarPlanilhaEnviada(impressaoIds: number[], agora: Date): Promise<void> {
    if (!impressaoIds.length) return;
    await this.db.batch(impressaoIds.map((id) => ({ sql: "UPDATE fila_planilha SET enviado_em = ? WHERE impressao_id = ?", args: [agora.toISOString(), id] })), "write");
  }

  async registrarFalhaPlanilha(impressaoIds: number[]): Promise<void> {
    if (!impressaoIds.length) return;
    await this.db.batch(impressaoIds.map((id) => ({ sql: "UPDATE fila_planilha SET tentativas = tentativas + 1 WHERE impressao_id = ?", args: [id] })), "write");
  }
}
