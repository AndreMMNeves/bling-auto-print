import type { DadosFolha } from "../../../compartilhado/tipos.ts";
import { fimDoDia, inicioDoDia } from "../../../compartilhado/tempo.ts";
import { randomBytes } from "node:crypto";
import type { Banco, Param } from "./banco.ts";

export type Situacao = number;
// "salvo": impressão automática desligada no painel; o PDF ficou só no PC.
export type StatusImpressao = "fila" | "imprimindo" | "impresso" | "salvo" | "erro";
export type TipoAlerta = "repetido" | "cancelado" | "falha_impressao" | "retomada" | "bling_desconectado";

export type PedidoRow = {
  id: number; filial_id: number; numero: string; id_bling: number; situacao: Situacao;
  origem: "baseline" | "monitor"; detectado_em: string;
};
export type ImpressaoRow = {
  id: number; pedido_id: number; impressora_id: number; via: number; tipo_documento: string; dados_json: string;
  status: StatusImpressao; tentativas: number; ultimo_erro: string | null; motivo: string | null;
  usuario_id: number | null; criado_em: string; iniciado_em: string | null; impresso_em: string | null;
};
// impressoraId: só a fila de uma expedição (login de expedição). Sem ele: tudo (supervisor).
export type FiltroRelatorio = { de: string; ate: string; vendedor?: string; pedido?: string; soReimpressoes?: boolean; impressoraId?: number };
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
// "expedicao": login de uma expedição (ES, PR...). Vê só os pedidos dos consultores dela e
// é usado pelo agente do PC daquela expedição.
export type Papel = "operador" | "supervisor" | "expedicao";
export type Expedicao = {
  usuario_id: number; nome: string; email: string; ativo: number; impressora_id: number | null; ligada: number | null;
  ultima_comunicacao: string | null; impressora_local: string | null;
};
export type RegraConsultor = { vendedor_id: number; nome: string; usuario_id: number; impressora_id: number };
export type UsuarioRow = { id: number; nome: string; email: string; senha_hash: string; papel: Papel; ativo: number };
export type AgenteRow = {
  id: number; nome: string; ultima_comunicacao: string | null; impressora_id: number; impressora_nome: string;
};
export type NovoPedido = {
  filialId: number; numero: string; idBling: number; situacao: Situacao; origem: "baseline" | "monitor"; agora: Date;
};

// id_bling é BIGINT (ids do Bling passam de 2^31): sai como número via float8 (exato até 2^53).
const COLUNAS_PEDIDO = "id, filial_id, numero, id_bling::float8 AS id_bling, situacao, origem, detectado_em";
const ehDuplicado = (e: unknown) => (e as { code?: string })?.code === "23505" || /duplicate key|unique/i.test(String((e as Error)?.message ?? e));

// Todo acesso ao banco é assíncrono (Supabase na Vercel, PGlite no PC e nos testes).
export class Repositorio {
  readonly db: Banco;

  constructor(db: Banco) {
    this.db = db;
  }

  protected async um<T>(sql: string, ...args: Param[]): Promise<T | null> {
    return ((await this.db.consultar(sql, args)).linhas[0] as T | undefined) ?? null;
  }

  protected async todos<T>(sql: string, ...args: Param[]): Promise<T[]> {
    return (await this.db.consultar(sql, args)).linhas as T[];
  }

  protected async exec(sql: string, ...args: Param[]): Promise<number> {
    return (await this.db.consultar(sql, args)).afetadas;
  }

  protected async inserir(sql: string, ...args: Param[]): Promise<number> {
    return Number((await this.um<{ id: number }>(`${sql} RETURNING id`, ...args))!.id);
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
      "INSERT INTO estado (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor",
      chave, valor,
    );
  }

  // --- filiais, agentes, impressoras ---
  async garantirFilial(codigo: string, nome: string): Promise<number> {
    return this.inserir("INSERT INTO filiais (codigo, nome) VALUES (?, ?) ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome", codigo, nome);
  }

  async garantirAgente(filialId: number, a: { nome: string; token: string; impressora: string }): Promise<{ agenteId: number; impressoraId: number }> {
    const agenteId = await this.inserir(
      "INSERT INTO agentes (nome, token) VALUES (?, ?) ON CONFLICT (nome) DO UPDATE SET token = EXCLUDED.token", a.nome, a.token,
    );
    const impressoraId = await this.inserir(
      `INSERT INTO impressoras (filial_id, agente_id, nome_windows) VALUES (?, ?, ?)
       ON CONFLICT (agente_id, nome_windows) DO UPDATE SET filial_id = EXCLUDED.filial_id`,
      filialId, agenteId, a.impressora,
    );
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
    return this.um<PedidoRow>(`SELECT ${COLUNAS_PEDIDO} FROM pedidos WHERE filial_id = ? AND numero = ?`, filialId, numero);
  }

  async buscarPedidoPorId(id: number): Promise<PedidoRow | null> {
    return this.um<PedidoRow>(`SELECT ${COLUNAS_PEDIDO} FROM pedidos WHERE id = ?`, id);
  }

  async inserirPedido(p: NovoPedido): Promise<number> {
    return this.inserir(
      "INSERT INTO pedidos (filial_id, numero, id_bling, situacao, origem, detectado_em) VALUES (?, ?, ?, ?, ?, ?)",
      p.filialId, p.numero, p.idBling, p.situacao, p.origem, p.agora.toISOString(),
    );
  }

  // Primeira ativação: grava em lote, ignorando os que já existem.
  async inserirPedidosBaseline(filialId: number, lista: Array<{ numero: string; idBling: number; situacao: Situacao }>, agora: Date): Promise<number> {
    if (!lista.length) return 0;
    const valores = lista.map(() => "(?, ?, ?, ?, 'baseline', ?)").join(", ");
    const args = lista.flatMap((p) => [filialId, p.numero, p.idBling, p.situacao, agora.toISOString()]);
    return this.exec(
      `INSERT INTO pedidos (filial_id, numero, id_bling, situacao, origem, detectado_em) VALUES ${valores} ON CONFLICT (filial_id, numero) DO NOTHING`,
      ...args,
    );
  }

  // Pedido novo + 1ª via numa transação só. Devolve false se o pedido já existia
  // (outro ciclo chegou antes): nesse caso nada é gravado.
  async inserirPedidoComPrimeiraVia(p: NovoPedido, impressoraId: number, dados: DadosFolha): Promise<boolean> {
    try {
      await this.db.transacao(async (consultar) => {
        const { linhas } = await consultar(
          "INSERT INTO pedidos (filial_id, numero, id_bling, situacao, origem, detectado_em) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
          [p.filialId, p.numero, p.idBling, p.situacao, p.origem, p.agora.toISOString()],
        );
        await consultar(
          "INSERT INTO impressoes (pedido_id, impressora_id, via, dados_json, status, criado_em) VALUES (?, ?, 1, ?, 'fila', ?)",
          [Number(linhas[0].id), impressoraId, JSON.stringify(dados), p.agora.toISOString()],
        );
      });
      return true;
    } catch (e) {
      if (ehDuplicado(e)) return false;
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
    return this.inserir(
      `INSERT INTO impressoes (pedido_id, impressora_id, via, dados_json, status, motivo, usuario_id, criado_em)
       VALUES (?, ?, ?, ?, 'fila', ?, ?, ?)`,
      i.pedidoId, i.impressoraId, i.via, JSON.stringify(i.dados), i.motivo, i.usuarioId, i.agora.toISOString(),
    );
  }

  // A via é calculada no próprio INSERT: dois pedidos de reimpressão ao mesmo tempo não pegam o mesmo número.
  async criarProximaVia(i: {
    pedidoId: number; impressoraId: number; dados: DadosFolha; motivo: string; usuarioId: number; agora: Date;
  }): Promise<number> {
    return this.inserir(
      `INSERT INTO impressoes (pedido_id, impressora_id, via, dados_json, status, motivo, usuario_id, criado_em)
       VALUES (?, ?, (SELECT COALESCE(MAX(via), 0) + 1 FROM impressoes WHERE pedido_id = ?), ?, 'fila', ?, ?, ?)`,
      i.pedidoId, i.impressoraId, i.pedidoId, JSON.stringify(i.dados), i.motivo, i.usuarioId, i.agora.toISOString(),
    );
  }

  async proximaVia(pedidoId: number): Promise<number> {
    return (await this.um<{ v: number }>("SELECT (COALESCE(MAX(via), 0) + 1)::int AS v FROM impressoes WHERE pedido_id = ?", pedidoId))!.v;
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

  // Um único UPDATE com SKIP LOCKED: dois agentes nunca pegam o mesmo trabalho.
  async pegarProximaDaFila(impressoraId: number, agora: Date): Promise<ImpressaoRow | null> {
    return this.um<ImpressaoRow>(
      `UPDATE impressoes SET status = 'imprimindo', iniciado_em = ?
       WHERE id = (SELECT id FROM impressoes WHERE impressora_id = ? AND status = 'fila' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING *`,
      agora.toISOString(), impressoraId,
    );
  }

  async marcarImpressa(id: number, agora: Date): Promise<void> {
    await this.exec("UPDATE impressoes SET status = 'impresso', impresso_em = ?, ultimo_erro = NULL WHERE id = ?", agora.toISOString(), id);
  }

  // Marca impresso e enfileira para a planilha na mesma transação.
  async registrarImpressa(id: number, agora: Date, status: "impresso" | "salvo" = "impresso"): Promise<void> {
    await this.db.transacao(async (consultar) => {
      await consultar("UPDATE impressoes SET status = ?, impresso_em = ?, ultimo_erro = NULL WHERE id = ?", [status, agora.toISOString(), id]);
      await consultar("INSERT INTO fila_planilha (impressao_id) VALUES (?) ON CONFLICT (impressao_id) DO NOTHING", [id]);
    });
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
    return this.exec("UPDATE impressoes SET status = 'fila', tentativas = 0 WHERE impressora_id = ? AND status = 'erro'", impressoraId);
  }

  // --- relatório ---
  static readonly SQL_RELATORIO = `
    SELECT i.id AS "impressaoId", i.criado_em AS "criadoEm", i.impresso_em AS "impressoEm", p.numero AS numero,
      i.dados_json::jsonb #>> '{cliente,nome}' AS cliente, i.dados_json::jsonb #>> '{pedido,vendedor}' AS vendedor,
      jsonb_array_length(i.dados_json::jsonb -> 'itens') AS itens, i.via AS via, i.status AS status,
      im.nome_windows AS impressora, u.nome AS usuario, i.motivo AS motivo
    FROM impressoes i
    JOIN pedidos p ON p.id = i.pedido_id
    JOIN impressoras im ON im.id = i.impressora_id
    LEFT JOIN usuarios u ON u.id = i.usuario_id`;

  async relatorio(f: FiltroRelatorio): Promise<LinhaRelatorio[]> {
    const onde = ["i.criado_em BETWEEN ? AND ?"];
    const params: Param[] = [inicioDoDia(f.de), fimDoDia(f.ate)];
    if (f.vendedor) { onde.push("i.dados_json::jsonb #>> '{pedido,vendedor}' ILIKE ?"); params.push(`%${f.vendedor}%`); }
    if (f.pedido) { onde.push("p.numero = ?"); params.push(f.pedido.trim()); }
    if (f.soReimpressoes) onde.push("i.via > 1");
    if (f.impressoraId !== undefined) { onde.push("i.impressora_id = ?"); params.push(f.impressoraId); }
    return this.todos<LinhaRelatorio>(`${Repositorio.SQL_RELATORIO} WHERE ${onde.join(" AND ")} ORDER BY i.id DESC`, ...params);
  }

  async linhaRelatorio(impressaoId: number): Promise<LinhaRelatorio | null> {
    return this.um<LinhaRelatorio>(`${Repositorio.SQL_RELATORIO} WHERE i.id = ?`, impressaoId);
  }

  // --- alertas ---
  async criarAlerta(a: { tipo: TipoAlerta; pedidoId: number | null; mensagem: string; agora: Date }): Promise<number> {
    return this.inserir(
      "INSERT INTO alertas (tipo, pedido_id, mensagem, criado_em) VALUES (?, ?, ?, ?)",
      a.tipo, a.pedidoId, a.mensagem, a.agora.toISOString(),
    );
  }

  async alertaPendenteDoTipo(tipo: TipoAlerta): Promise<boolean> {
    return (await this.um("SELECT 1 AS x FROM alertas WHERE tipo = ? AND resolvido_em IS NULL LIMIT 1", tipo)) !== null;
  }

  // Com impressoraId: só alertas de pedidos que passaram por aquela fila.
  async alertasPendentes(impressoraId?: number): Promise<AlertaView[]> {
    const daFila = impressoraId === undefined ? "" : "AND EXISTS (SELECT 1 FROM impressoes i WHERE i.pedido_id = a.pedido_id AND i.impressora_id = ?)";
    return this.todos<AlertaView>(
      `SELECT a.id, a.tipo, a.pedido_id, p.numero, a.mensagem, a.criado_em
       FROM alertas a LEFT JOIN pedidos p ON p.id = a.pedido_id
       WHERE a.resolvido_em IS NULL ${daFila} ORDER BY a.id DESC`,
      ...(impressoraId === undefined ? [] : [impressoraId]),
    );
  }

  async pedidoDaFila(pedidoId: number, impressoraId: number): Promise<boolean> {
    return (await this.um("SELECT 1 AS x FROM impressoes WHERE pedido_id = ? AND impressora_id = ? LIMIT 1", pedidoId, impressoraId)) !== null;
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

  async contadoresDoDia(dia: string, impressoraId?: number): Promise<{ impressos: number; naFila: number; alertas: number }> {
    const fila = impressoraId === undefined ? "" : "AND impressora_id = ?";
    const p = impressoraId === undefined ? [] : [impressoraId];
    const r = (await this.um<{ impressos: number; naFila: number }>(
      `SELECT
        (SELECT COUNT(*)::int FROM impressoes WHERE status = 'impresso' AND impresso_em BETWEEN ? AND ? ${fila}) AS impressos,
        (SELECT COUNT(*)::int FROM impressoes WHERE status IN ('fila', 'imprimindo') ${fila}) AS "naFila"`,
      inicioDoDia(dia), fimDoDia(dia), ...p, ...p,
    ))!;
    return { ...r, alertas: (await this.alertasPendentes(impressoraId)).length };
  }

  async ultimaComunicacaoAgente(impressoraId: number): Promise<string | null> {
    return (await this.um<{ u: string | null }>(
      "SELECT a.ultima_comunicacao AS u FROM impressoras i JOIN agentes a ON a.id = i.agente_id WHERE i.id = ?", impressoraId,
    ))?.u ?? null;
  }

  async contarErros(impressoraId: number): Promise<number> {
    return (await this.um<{ n: number }>("SELECT COUNT(*)::int AS n FROM impressoes WHERE impressora_id = ? AND status = 'erro'", impressoraId))!.n;
  }

  // --- expedições (usuários com fila própria) ---
  async garantirFilaDoUsuario(usuarioId: number, filialId: number): Promise<{ agenteId: number; impressoraId: number; token: string }> {
    const existente = await this.um<{ agenteId: number; impressoraId: number; token: string }>(
      `SELECT a.id AS "agenteId", i.id AS "impressoraId", a.token FROM agentes a JOIN impressoras i ON i.agente_id = a.id
       WHERE a.usuario_id = ? ORDER BY i.id LIMIT 1`, usuarioId,
    );
    if (existente) return existente;
    const nome = (await this.um<{ nome: string }>("SELECT nome FROM usuarios WHERE id = ?", usuarioId))!.nome;
    const token = randomBytes(24).toString("hex");
    const agenteId = await this.inserir("INSERT INTO agentes (nome, token, usuario_id) VALUES (?, ?, ?)", `usuario-${usuarioId}`, token, usuarioId);
    const impressoraId = await this.inserir("INSERT INTO impressoras (filial_id, agente_id, nome_windows) VALUES (?, ?, ?)", filialId, agenteId, nome);
    return { agenteId, impressoraId, token };
  }

  async impressoraDoUsuario(usuarioId: number): Promise<number | null> {
    return (await this.um<{ id: number }>(
      "SELECT i.id FROM impressoras i JOIN agentes a ON a.id = i.agente_id WHERE a.usuario_id = ? ORDER BY i.id LIMIT 1", usuarioId,
    ))?.id ?? null;
  }

  async impressaoLigada(impressoraId: number): Promise<boolean> {
    return (await this.um<{ ligada: number }>("SELECT ligada FROM impressoras WHERE id = ?", impressoraId))?.ligada === 1;
  }

  async definirImpressaoLigada(impressoraId: number, ligada: boolean): Promise<void> {
    await this.exec("UPDATE impressoras SET ligada = ? WHERE id = ?", ligada ? 1 : 0, impressoraId);
  }

  async registrarImpressoraLocal(agenteId: number, nome: string | null): Promise<void> {
    await this.exec("UPDATE agentes SET impressora_local = ? WHERE id = ?", nome, agenteId);
  }

  async listarExpedicoes(): Promise<Expedicao[]> {
    return this.todos<Expedicao>(
      `SELECT u.id AS usuario_id, u.nome, u.email, u.ativo, i.id AS impressora_id, i.ligada, a.ultima_comunicacao, a.impressora_local
       FROM usuarios u LEFT JOIN agentes a ON a.usuario_id = u.id LEFT JOIN impressoras i ON i.agente_id = a.id
       WHERE u.papel = 'expedicao' ORDER BY u.nome`,
    );
  }

  // --- consultores (vendedor do Bling → expedição) ---
  async definirConsultor(vendedorId: number, nome: string, usuarioId: number | null): Promise<void> {
    await this.exec(
      `INSERT INTO consultores (vendedor_id, nome, usuario_id) VALUES (?, ?, ?)
       ON CONFLICT (vendedor_id) DO UPDATE SET nome = EXCLUDED.nome, usuario_id = EXCLUDED.usuario_id`,
      vendedorId, nome, usuarioId,
    );
  }

  // Só consultores ligados a uma expedição ativa que já tem fila.
  async regrasConsultores(): Promise<RegraConsultor[]> {
    return this.todos<RegraConsultor>(
      `SELECT c.vendedor_id::float8 AS vendedor_id, c.nome, c.usuario_id, i.id AS impressora_id
       FROM consultores c JOIN usuarios u ON u.id = c.usuario_id AND u.ativo = 1
       JOIN agentes a ON a.usuario_id = u.id JOIN impressoras i ON i.agente_id = a.id
       ORDER BY c.nome`,
    );
  }

  async consultoresDoUsuario(usuarioId: number): Promise<Array<{ vendedor_id: number; nome: string }>> {
    return this.todos("SELECT vendedor_id::float8 AS vendedor_id, nome FROM consultores WHERE usuario_id = ? ORDER BY nome", usuarioId);
  }

  async todosConsultores(): Promise<Array<{ vendedor_id: number; nome: string; usuario_id: number | null }>> {
    return this.todos("SELECT vendedor_id::float8 AS vendedor_id, nome, usuario_id FROM consultores ORDER BY nome");
  }

  // --- usuários ---
  async nomeUsuario(id: number | null): Promise<string | null> {
    if (id === null) return null;
    return (await this.um<{ nome: string }>("SELECT nome FROM usuarios WHERE id = ?", id))?.nome ?? null;
  }

  async criarUsuario(u: { nome: string; email: string; senhaHash: string; papel: Papel }): Promise<number> {
    return this.inserir(
      "INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?, ?, ?, ?)",
      u.nome, u.email.trim().toLowerCase(), u.senhaHash, u.papel,
    );
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
    await this.exec("INSERT INTO fila_planilha (impressao_id) VALUES (?) ON CONFLICT (impressao_id) DO NOTHING", impressaoId);
  }

  async pendentesPlanilha(limite: number): Promise<number[]> {
    return (await this.todos<{ impressao_id: number }>(
      "SELECT impressao_id FROM fila_planilha WHERE enviado_em IS NULL ORDER BY id LIMIT ?", limite,
    )).map((r) => r.impressao_id);
  }

  async marcarPlanilhaEnviada(impressaoIds: number[], agora: Date): Promise<void> {
    if (!impressaoIds.length) return;
    await this.exec(`UPDATE fila_planilha SET enviado_em = ? WHERE impressao_id IN (${impressaoIds.map(() => "?").join(", ")})`, agora.toISOString(), ...impressaoIds);
  }

  async registrarFalhaPlanilha(impressaoIds: number[]): Promise<void> {
    if (!impressaoIds.length) return;
    await this.exec(`UPDATE fila_planilha SET tentativas = tentativas + 1 WHERE impressao_id IN (${impressaoIds.map(() => "?").join(", ")})`, ...impressaoIds);
  }
}
