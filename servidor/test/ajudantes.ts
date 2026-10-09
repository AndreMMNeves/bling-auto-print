import type { FastifyInstance } from "fastify";
import { abrirBanco } from "../src/banco/banco.ts";
import { Repositorio } from "../src/banco/repositorio.ts";
import type { DadosFolha } from "../../compartilhado/tipos.ts";
import type { Config } from "../src/config.ts";
import { criarApp, type DepsApp } from "../src/app.ts";
import { hashSenha } from "../src/web/auth.ts";

export const AGORA = new Date("2026-10-08T17:32:00.000Z"); // 14:32 em São Paulo

export async function bancoDeTeste() {
  const repo = new Repositorio(await abrirBanco(":memory:"));
  const filialId = await repo.garantirFilial("ES", "Espírito Santo");
  const { agenteId, impressoraId } = await repo.garantirAgente(filialId, {
    nome: "expedicao-es", token: "token-teste", impressora: "HP A4",
  });
  return { repo, filialId, agenteId, impressoraId };
}

// SQL direto nos testes.
export async function todas<T = Record<string, unknown>>(repo: Repositorio, sql: string, ...args: Array<string | number | null>): Promise<T[]> {
  return (await repo.db.consultar(sql, args)).linhas as T[];
}

export async function uma<T = Record<string, unknown>>(repo: Repositorio, sql: string, ...args: Array<string | number | null>): Promise<T> {
  return (await todas<T>(repo, sql, ...args))[0];
}

// INSERT devolvendo o id gerado.
export async function executar(repo: Repositorio, sql: string, ...args: Array<string | number | null>): Promise<number> {
  return Number((await repo.db.consultar(`${sql} RETURNING id`, args)).linhas[0].id);
}

export function dadosFolhaExemplo(qtdItens = 2, numero = "12345"): DadosFolha {
  const itens = Array.from({ length: qtdItens }, (_, i) => ({
    descricao: `Produto ${i + 1}`,
    sku: `SKU-${String(i + 1).padStart(3, "0")}`,
    unidade: "Un",
    localizacao: `F${100 + i}`,
    quantidade: i + 1,
    precoLista: 100,
    descontoPct: 0,
    valorUnitario: 100,
    total: 100 * (i + 1),
    detalhes: [] as string[],
    ean: `78900000${String(i + 1).padStart(5, "0")}`,
  }));
  const totalProdutos = itens.reduce((s, i) => s + (i.total ?? 0), 0);
  return {
    filial: "Espírito Santo",
    pedido: {
      numero, numeroLoja: null, idBling: 9000 + Number(numero), data: "2026-10-08", dataPrevista: null,
      atendidoEm: AGORA.toISOString(), vendedor: "Fulano", observacoes: null, codigoBarras: numero,
    },
    cliente: {
      nome: "Clínica X", fantasia: null, documento: "12.345.678/0001-90", endereco: "Rua A, N° 10, Bairro: Centro.",
      cidade: "29000000 - Vitória, ES", telefone: "Fone: (27) 3333-4444", email: "clinica@x.com",
    },
    entrega: { endereco: "Rua A, 10", cidadeUf: "Vitória/ES", cep: "29000-000" },
    transporte: "SEDEX",
    transportador: { nome: "Correios", modalidade: "Contratação do Frete por conta do Remetente (CIF)", servico: "SEDEX" },
    totais: {
      qtdItens: itens.length, somaQtd: itens.reduce((s, i) => s + i.quantidade, 0), descontoItens: 0,
      totalProdutos, frete: 20, outrasDespesas: 0, descontoPedido: 0, total: totalProdutos + 20,
    },
    parcelas: [{ dias: 0, vencimento: "2026-10-08", forma: "PIX - ITAÚ", valor: totalProdutos + 20, observacao: null }],
    itens,
  };
}

export function configDeTeste(): Config {
  return {
    porta: 0, urlPublica: "http://localhost:3010", segredoSessao: "segredo-de-teste-com-tamanho-suficiente-123",
    banco: { url: ":memory:" }, filial: { codigo: "ES", nome: "Espírito Santo" },
    bling: { clientId: "a", clientSecret: "b", intervaloSegundos: 30, margemMinutos: 5, situacaoAtendido: 9, situacaoCancelado: 12, campoCodigoBarras: "numero" },
    agentes: [{ nome: "expedicao-es", token: "token-teste-com-32-caracteres-ok!!", impressora: "HP A4" }], google: null,
  };
}

export async function appDeTeste(extra: Partial<DepsApp> = {}) {
  const b = await bancoDeTeste();
  const supervisorId = await b.repo.criarUsuario({ nome: "Sup", email: "sup@x.com", senhaHash: hashSenha("senha-sup"), papel: "supervisor" });
  const operadorId = await b.repo.criarUsuario({ nome: "Op", email: "op@x.com", senhaHash: hashSenha("senha-op"), papel: "operador" });
  const deps: DepsApp = {
    repo: b.repo, config: configDeTeste(), filialId: b.filialId, impressoraId: b.impressoraId, agora: () => AGORA,
    montarFolha: async (idBling) => dadosFolhaExemplo(2, String(idBling - 1000)),
    bling: {
      urlAutorizacao: (s) => `https://bling.test/auth?state=${s}`, trocarCodigo: async () => {}, estaConectado: async () => true,
      listarVendedores: async () => [],
    },
    tarefasPeriodicas: async () => ({ ok: true }),
    ...extra,
  };
  const app = await criarApp(deps);
  return { ...b, app, deps, supervisorId, operadorId };
}

export async function entrar(app: FastifyInstance, email: string, senha: string): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/login", payload: { email, senha } });
  const sc = r.headers["set-cookie"];
  const bruto = Array.isArray(sc) ? sc[0] : sc;
  if (!bruto) throw new Error(`login falhou (${r.statusCode})`);
  return bruto.split(";")[0];
}
