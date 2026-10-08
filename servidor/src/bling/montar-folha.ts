import type { DadosFolha } from "../../../compartilhado/tipos.ts";
import type { CampoCodigoBarras } from "../config.ts";
import type { ClienteBling, PedidoBling } from "./cliente.ts";

export type FonteBling = Pick<ClienteBling, "obterPedido" | "obterProduto" | "obterVendedor">;
export type MontarFolha = (idBling: number, atendidoEm: Date) => Promise<DadosFolha>;

export function criarMontadorFolha(
  bling: FonteBling,
  opts: { filialNome: string; campoCodigoBarras: CampoCodigoBarras },
): MontarFolha {
  const vendedores = new Map<number, string | null>();

  return async (idBling, atendidoEm) => {
    const p = await bling.obterPedido(idBling);

    let vendedor: string | null = null;
    if (p.vendedorId) {
      if (!vendedores.has(p.vendedorId)) vendedores.set(p.vendedorId, (await bling.obterVendedor(p.vendedorId)).nome);
      vendedor = vendedores.get(p.vendedorId) ?? null;
    }

    // EAN muda raramente, mas é buscado a cada pedido para nunca imprimir um EAN velho.
    const gtins = new Map<number, string | null>();
    for (const i of p.itens) {
      if (i.produtoId && !gtins.has(i.produtoId)) gtins.set(i.produtoId, (await bling.obterProduto(i.produtoId)).gtin);
    }

    const itens = p.itens
      .map((i) => ({
        quantidade: i.quantidade,
        sku: i.codigo,
        descricao: i.descricao,
        ean: i.produtoId ? gtins.get(i.produtoId) ?? null : null,
      }))
      .sort((a, b) => (a.sku ?? "￿").localeCompare(b.sku ?? "￿", "pt-BR", { numeric: true }));

    return {
      filial: opts.filialNome,
      pedido: {
        numero: p.numero,
        numeroLoja: p.numeroLoja,
        idBling: p.id,
        data: p.data,
        atendidoEm: atendidoEm.toISOString(),
        vendedor,
        observacoes: p.observacoes,
        codigoBarras: codigoDoPedido(p, opts.campoCodigoBarras),
      },
      cliente: { nome: p.contato.nome, documento: p.contato.numeroDocumento },
      entrega: montarEntrega(p),
      transporte: p.transporte,
      itens,
    };
  };
}

function codigoDoPedido(p: PedidoBling, campo: CampoCodigoBarras): string {
  if (campo === "numeroLoja") return p.numeroLoja ?? p.numero;
  if (campo === "id") return String(p.id);
  return p.numero;
}

function montarEntrega(p: PedidoBling): DadosFolha["entrega"] {
  const e = p.etiqueta;
  if (!e) return { endereco: null, cidadeUf: null, cep: null };
  const rua = [e.endereco, e.numero].filter(Boolean).join(", ");
  const endereco = [rua, e.complemento, e.bairro].filter(Boolean).join(" — ") || null;
  const cidadeUf = [e.municipio, e.uf].filter(Boolean).join("/") || null;
  return { endereco, cidadeUf, cep: e.cep };
}
