import type { DadosFolha, ItemFolha } from "../../../compartilhado/tipos.ts";
import type { CampoCodigoBarras } from "../config.ts";
import { ErroBlingDesconectado, type ClienteBling, type ContatoBling, type EnderecoBling, type PedidoBling, type ProdutoBling } from "./cliente.ts";

export type FonteBling = Pick<ClienteBling, "obterPedido" | "obterProduto" | "obterVendedor" | "obterContato" | "obterFormaPagamento">;
export type MontarFolha = (idBling: number, atendidoEm: Date) => Promise<DadosFolha>;

// Texto que o Bling imprime para cada "fretePorConta".
const MODALIDADE_FRETE: Record<number, string> = {
  0: "Contratação do Frete por conta do Remetente (CIF)",
  1: "Contratação do Frete por conta do Destinatário (FOB)",
  2: "Contratação do Frete por conta de Terceiros",
  3: "Transporte Próprio por conta do Remetente",
  4: "Transporte Próprio por conta do Destinatário",
  9: "Sem Ocorrência de Transporte",
};

export function criarMontadorFolha(
  bling: FonteBling,
  opts: { filialNome: string; campoCodigoBarras: CampoCodigoBarras },
): MontarFolha {
  // Mudam raramente: ficam em cache enquanto o servidor estiver de pé.
  const vendedores = new Map<number, string | null>();
  const formas = new Map<number, string | null>();

  return async (idBling, atendidoEm) => {
    const p = await bling.obterPedido(idBling);

    let vendedor: string | null = null;
    if (p.vendedorId) {
      if (!vendedores.has(p.vendedorId)) vendedores.set(p.vendedorId, await semFalhar(() => bling.obterVendedor(p.vendedorId!), (v) => v.nome));
      vendedor = vendedores.get(p.vendedorId) ?? null;
    }

    const contato = p.contato.id ? await semFalhar(() => bling.obterContato(p.contato.id!), (c) => c) : null;

    // Produto é buscado a cada pedido (localização e cadastro podem mudar).
    const produtos = new Map<number, ProdutoBling | null>();
    for (const i of p.itens) {
      if (i.produtoId && !produtos.has(i.produtoId)) produtos.set(i.produtoId, await semFalhar(() => bling.obterProduto(i.produtoId!), (r) => r));
    }

    const itens: ItemFolha[] = p.itens.map((i) => {
      const prod = i.produtoId ? produtos.get(i.produtoId) ?? null : null;
      const valorUnitario = arredondar(i.valor * (1 - i.descontoPct / 100));
      return {
        descricao: i.descricao,
        sku: i.codigo,
        unidade: i.unidade,
        localizacao: prod?.localizacao ?? null,
        quantidade: i.quantidade,
        precoLista: i.valor,
        descontoPct: i.descontoPct,
        valorUnitario,
        total: arredondar(valorUnitario * i.quantidade),
        detalhes: detalhesDoItem(i.descricaoDetalhada, prod),
        ean: prod?.gtin ?? null,
      };
    });

    const parcelas = [];
    for (const parc of p.parcelas) {
      let forma: string | null = null;
      if (parc.formaPagamentoId) {
        if (!formas.has(parc.formaPagamentoId)) formas.set(parc.formaPagamentoId, await semFalhar(() => bling.obterFormaPagamento(parc.formaPagamentoId!), (f) => f.descricao));
        forma = formas.get(parc.formaPagamentoId) ?? null;
      }
      parcelas.push({ dias: diasEntre(p.data, parc.vencimento), vencimento: parc.vencimento, forma, valor: parc.valor, observacao: parc.observacao });
    }

    return {
      filial: opts.filialNome,
      pedido: {
        numero: p.numero,
        numeroLoja: p.numeroLoja,
        idBling: p.id,
        data: p.data,
        dataPrevista: p.dataPrevista,
        atendidoEm: atendidoEm.toISOString(),
        vendedor,
        observacoes: p.observacoes,
        codigoBarras: codigoDoPedido(p, opts.campoCodigoBarras),
      },
      cliente: montarCliente(p, contato),
      entrega: montarEntrega(p.etiqueta),
      transporte: p.transporte,
      transportador: {
        nome: p.transportadorNome,
        modalidade: p.fretePorConta === null ? null : MODALIDADE_FRETE[p.fretePorConta] ?? null,
        servico: p.transporte,
      },
      totais: {
        qtdItens: p.itens.length,
        somaQtd: p.itens.reduce((s, i) => s + i.quantidade, 0),
        descontoItens: arredondar(p.itens.reduce((s, i) => s + i.valor * i.quantidade * (i.descontoPct / 100), 0)),
        totalProdutos: p.totalProdutos,
        frete: p.frete,
        outrasDespesas: p.outrasDespesas,
        descontoPedido: p.desconto.unidade === "PERCENTUAL" ? arredondar(p.totalProdutos * (p.desconto.valor / 100)) : p.desconto.valor,
        total: p.total,
      },
      parcelas,
      itens,
    };
  };
}

// Desconexão do Bling continua derrubando o ciclo; o resto vira campo vazio.
async function semFalhar<T, R>(buscar: () => Promise<T>, extrair: (r: T) => R): Promise<R | null> {
  try {
    return extrair(await buscar());
  } catch (e) {
    if (e instanceof ErroBlingDesconectado) throw e;
    console.error(`[folha] ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

const arredondar = (v: number) => Math.round(v * 100) / 100;

// Como o Bling imprime: "L20 X A8 X P10 CM" e "Peso Bruto: 0.20000".
function detalhesDoItem(descricaoDetalhada: string | null, prod: ProdutoBling | null): string[] {
  const linhas: string[] = [];
  if (descricaoDetalhada) linhas.push(descricaoDetalhada);
  if (prod?.dimensoes) {
    const n = (v: number) => String(Number(v.toFixed(2)));
    linhas.push(`L${n(prod.dimensoes.largura)} X A${n(prod.dimensoes.altura)} X P${n(prod.dimensoes.profundidade)} CM`);
  }
  if (prod?.pesoBruto) linhas.push(`Peso Bruto: ${prod.pesoBruto.toFixed(5)}`);
  return linhas;
}

function diasEntre(de: string, ate: string | null): number | null {
  if (!ate || !/^\d{4}-\d{2}-\d{2}$/.test(de)) return null;
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
}

function montarCliente(p: PedidoBling, c: ContatoBling | null): DadosFolha["cliente"] {
  const end = c?.endereco.endereco ? c.endereco : p.etiqueta;
  const fones = [c?.telefone ? `Fone: ${c.telefone}` : null, c?.celular ? `Celular: ${c.celular}` : null].filter(Boolean).join(", ");
  return {
    nome: p.contato.nome,
    fantasia: c?.fantasia ?? null,
    documento: p.contato.numeroDocumento,
    endereco: end ? linhaEndereco(end) : null,
    cidade: end ? [end.cep, [end.municipio, end.uf].filter(Boolean).join(", ")].filter(Boolean).join(" - ") || null : null,
    telefone: fones || null,
    email: c?.email ?? null,
  };
}

// "Rua Urânio, N° 89, Sala 2, Bairro: Parque Primavera."
function linhaEndereco(e: EnderecoBling): string | null {
  const partes = [e.endereco, e.numero ? `N° ${e.numero}` : null, e.complemento, e.bairro ? `Bairro: ${e.bairro}` : null].filter(Boolean);
  return partes.length ? `${partes.join(", ")}.` : null;
}

function codigoDoPedido(p: PedidoBling, campo: CampoCodigoBarras): string {
  if (campo === "numeroLoja") return p.numeroLoja ?? p.numero;
  if (campo === "id") return String(p.id);
  return p.numero;
}

function montarEntrega(e: EnderecoBling | null): DadosFolha["entrega"] {
  if (!e) return { endereco: null, cidadeUf: null, cep: null };
  const rua = [e.endereco, e.numero].filter(Boolean).join(", ");
  const endereco = [rua, e.complemento, e.bairro].filter(Boolean).join(" — ") || null;
  const cidadeUf = [e.municipio, e.uf].filter(Boolean).join("/") || null;
  return { endereco, cidadeUf, cep: e.cep };
}
