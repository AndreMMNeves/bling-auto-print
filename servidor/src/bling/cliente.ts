import { FUSO } from "../../../compartilhado/tempo.ts";

export const BLING_API = "https://api.bling.com.br/Api/v3";
export const BLING_AUTORIZAR = "https://www.bling.com.br/Api/v3/oauth/authorize";

export type Tokens = { accessToken: string; refreshToken: string; expiraEm: string };
export type ArmazemTokens = { ler(): Promise<Tokens | null>; gravar(t: Tokens): Promise<void> };
export type ResumoPedido = { id: number; numero: string; numeroLoja: string | null; situacaoId: number };
export type PedidoBling = {
  id: number;
  numero: string;
  numeroLoja: string | null;
  data: string;
  dataPrevista: string | null;
  contato: { id: number | null; nome: string; numeroDocumento: string | null };
  vendedorId: number | null;
  itens: Array<{
    codigo: string | null; descricao: string; descricaoDetalhada: string | null; unidade: string | null;
    quantidade: number; valor: number; descontoPct: number; produtoId: number | null;
  }>;
  totalProdutos: number;
  total: number;
  outrasDespesas: number;
  desconto: { valor: number; unidade: string | null };
  parcelas: Array<{ vencimento: string | null; valor: number; observacao: string | null; formaPagamentoId: number | null }>;
  frete: number;
  fretePorConta: number | null;
  transportadorNome: string | null;
  etiqueta: {
    endereco: string | null; numero: string | null; complemento: string | null; bairro: string | null;
    municipio: string | null; uf: string | null; cep: string | null;
  } | null;
  transporte: string | null;
  observacoes: string | null;
};

export type ProdutoBling = {
  gtin: string | null; codigo: string | null; localizacao: string | null; pesoBruto: number | null;
  dimensoes: { largura: number; altura: number; profundidade: number } | null;
};
export type EnderecoBling = {
  endereco: string | null; numero: string | null; complemento: string | null; bairro: string | null;
  municipio: string | null; uf: string | null; cep: string | null;
};
export type ContatoBling = { fantasia: string | null; telefone: string | null; celular: string | null; email: string | null; endereco: EnderecoBling };

export class ErroBlingDesconectado extends Error {}

export class ErroBling extends Error {
  status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

type OpcoesCliente = {
  clientId: string;
  clientSecret: string;
  armazem: ArmazemTokens;
  fetch?: typeof fetch;
  agora?: () => Date;
  intervaloMinimoMs?: number; // o Bling aceita ~3 requisições/s
  esperar?: (ms: number) => Promise<void>;
};

const fmtBling = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export function formatarDataBling(d: Date): string {
  const partes = fmtBling.formatToParts(d);
  const v = (t: string) => partes.find((x) => x.type === t)!.value;
  return `${v("year")}-${v("month")}-${v("day")} ${v("hour")}:${v("minute")}:${v("second")}`;
}

const POR_PAGINA = 100;
const MAX_PAGINAS = 20;

// O Bling manda "0000-00-00" quando a data não foi preenchida.
const dataValida = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) && !v.startsWith("0000") ? v.slice(0, 10) : null);

const ouNulo = (v: unknown): string | null => (v === undefined || v === null || v === "" ? null : String(v));

export class ClienteBling {
  #o: Required<OpcoesCliente>;
  #ultimaChamada = 0;

  constructor(o: OpcoesCliente) {
    this.#o = {
      fetch: globalThis.fetch.bind(globalThis),
      agora: () => new Date(),
      intervaloMinimoMs: 350,
      esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
      ...o,
    };
  }

  async estaConectado(): Promise<boolean> {
    return (await this.#o.armazem.ler()) !== null;
  }

  urlAutorizacao(state: string): string {
    const u = new URL(BLING_AUTORIZAR);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", this.#o.clientId);
    u.searchParams.set("state", state);
    return u.toString();
  }

  async trocarCodigo(code: string): Promise<void> {
    await this.#pedirToken({ grant_type: "authorization_code", code });
  }

  // Paginar uma lista que muda durante a leitura pode pular pedidos. Por isso, se a
  // janela tiver 100+ pedidos, ela é dividida ao meio até cada pedaço caber numa página.
  async listarPedidosAlterados(desde: Date, ate: Date): Promise<ResumoPedido[]> {
    const vistos = new Map<number, ResumoPedido>();
    const pendentes: Array<[Date, Date]> = [[desde, ate]];
    while (pendentes.length) {
      const [de, a] = pendentes.shift()!;
      const pagina1 = await this.#paginaAlterados(de, a, 1);
      if (pagina1.length < POR_PAGINA) {
        for (const p of pagina1) vistos.set(p.id, p);
        continue;
      }
      if (a.getTime() - de.getTime() > 2_000) {
        const meio = new Date(Math.floor((de.getTime() + a.getTime()) / 2000) * 1000);
        pendentes.push([de, meio], [meio, a]);
        continue;
      }
      // 100+ pedidos alterados no mesmo segundo: só aí pagina, com teto.
      for (const p of pagina1) vistos.set(p.id, p);
      for (let pagina = 2; ; pagina++) {
        if (pagina > MAX_PAGINAS) throw new ErroBling(0, `O Bling devolveu mais de ${MAX_PAGINAS} páginas no mesmo segundo; a paginação parece não funcionar.`);
        const lote = await this.#paginaAlterados(de, a, pagina);
        for (const p of lote) vistos.set(p.id, p);
        if (lote.length < POR_PAGINA) break;
      }
    }
    return [...vistos.values()];
  }

  // Usado só na primeira ativação (uma página por vez), para registrar tudo o que já está Atendido.
  async paginaPorSituacao(situacaoId: number, pagina: number): Promise<ResumoPedido[]> {
    const q = new URLSearchParams({ pagina: String(pagina), limite: String(POR_PAGINA), "idsSituacoes[]": String(situacaoId) });
    const j = (await this.#get(`/pedidos/vendas?${q}`)) as { data?: any[] };
    return (j.data ?? []).map((p) => ({
      id: Number(p.id), numero: String(p.numero), numeroLoja: ouNulo(p.numeroLoja), situacaoId: Number(p.situacao?.id),
    }));
  }

  async #paginaAlterados(desde: Date, ate: Date, pagina: number): Promise<ResumoPedido[]> {
    const q = new URLSearchParams({
      pagina: String(pagina),
      limite: String(POR_PAGINA),
      dataAlteracaoInicial: formatarDataBling(desde),
      dataAlteracaoFinal: formatarDataBling(ate),
    });
    const j = (await this.#get(`/pedidos/vendas?${q}`)) as { data?: any[] };
    return (j.data ?? []).map((p) => ({
      id: Number(p.id), numero: String(p.numero), numeroLoja: ouNulo(p.numeroLoja), situacaoId: Number(p.situacao?.id),
    }));
  }

  async obterPedido(id: number): Promise<PedidoBling> {
    const d = ((await this.#get(`/pedidos/vendas/${id}`)) as { data: any }).data;
    const et = d.transporte?.etiqueta;
    return {
      id: Number(d.id),
      numero: String(d.numero),
      numeroLoja: ouNulo(d.numeroLoja),
      data: String(d.data ?? ""),
      dataPrevista: dataValida(d.dataPrevista),
      contato: { id: d.contato?.id ? Number(d.contato.id) : null, nome: ouNulo(d.contato?.nome) ?? "—", numeroDocumento: ouNulo(d.contato?.numeroDocumento) },
      vendedorId: d.vendedor?.id ? Number(d.vendedor.id) : null,
      itens: (d.itens ?? []).map((i: any) => ({
        codigo: ouNulo(i.codigo),
        descricao: String(i.descricao ?? ""),
        descricaoDetalhada: ouNulo(i.descricaoDetalhada),
        unidade: ouNulo(i.unidade),
        quantidade: Number(i.quantidade),
        valor: Number(i.valor ?? 0),
        descontoPct: Number(i.desconto ?? 0),
        produtoId: i.produto?.id ? Number(i.produto.id) : null,
      })),
      totalProdutos: Number(d.totalProdutos ?? 0),
      total: Number(d.total ?? 0),
      outrasDespesas: Number(d.outrasDespesas ?? 0),
      desconto: { valor: Number(d.desconto?.valor ?? 0), unidade: ouNulo(d.desconto?.unidade) },
      parcelas: (d.parcelas ?? []).map((p: any) => ({
        vencimento: dataValida(p.dataVencimento), valor: Number(p.valor ?? 0), observacao: ouNulo(p.observacoes),
        formaPagamentoId: p.formaPagamento?.id ? Number(p.formaPagamento.id) : null,
      })),
      frete: Number(d.transporte?.frete ?? 0),
      fretePorConta: d.transporte?.fretePorConta === undefined || d.transporte?.fretePorConta === null ? null : Number(d.transporte.fretePorConta),
      transportadorNome: ouNulo(d.transporte?.contato?.nome),
      etiqueta: et
        ? {
            endereco: ouNulo(et.endereco), numero: ouNulo(et.numero), complemento: ouNulo(et.complemento),
            bairro: ouNulo(et.bairro), municipio: ouNulo(et.municipio), uf: ouNulo(et.uf), cep: ouNulo(et.cep),
          }
        : null,
      transporte: ouNulo(d.transporte?.volumes?.[0]?.servico),
      observacoes: ouNulo(d.observacoes),
    };
  }

  async obterProduto(id: number): Promise<ProdutoBling> {
    const d = ((await this.#get(`/produtos/${id}`)) as { data: any }).data;
    const dim = d.dimensoes ?? {};
    return {
      gtin: ouNulo(d.gtin), codigo: ouNulo(d.codigo), localizacao: ouNulo(d.estoque?.localizacao),
      pesoBruto: Number(d.pesoBruto ?? 0) || null,
      dimensoes: Number(dim.largura) || Number(dim.altura) || Number(dim.profundidade)
        ? { largura: Number(dim.largura ?? 0), altura: Number(dim.altura ?? 0), profundidade: Number(dim.profundidade ?? 0) }
        : null,
    };
  }

  async obterContato(id: number): Promise<ContatoBling> {
    const d = ((await this.#get(`/contatos/${id}`)) as { data: any }).data;
    const e = d.endereco?.geral ?? {};
    return {
      fantasia: ouNulo(d.fantasia), telefone: ouNulo(d.telefone), celular: ouNulo(d.celular), email: ouNulo(d.email),
      endereco: {
        endereco: ouNulo(e.endereco), numero: ouNulo(e.numero), complemento: ouNulo(e.complemento), bairro: ouNulo(e.bairro),
        municipio: ouNulo(e.municipio), uf: ouNulo(e.uf), cep: ouNulo(e.cep),
      },
    };
  }

  async obterFormaPagamento(id: number): Promise<{ descricao: string | null }> {
    const d = ((await this.#get(`/formas-pagamentos/${id}`)) as { data: any }).data;
    return { descricao: ouNulo(d.descricao) };
  }

  async obterVendedor(id: number): Promise<{ nome: string | null }> {
    const d = ((await this.#get(`/vendedores/${id}`)) as { data: any }).data;
    return { nome: ouNulo(d.contato?.nome) };
  }

  // Usado pela ferramenta de exploração (Task 3).
  obterBruto(caminho: string): Promise<unknown> {
    return this.#get(caminho);
  }

  async #pedirToken(corpo: Record<string, string>): Promise<void> {
    const basic = Buffer.from(`${this.#o.clientId}:${this.#o.clientSecret}`).toString("base64");
    const r = await this.#o.fetch(`${BLING_API}/oauth/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "1.0" },
      body: new URLSearchParams(corpo).toString(),
    });
    if (!r.ok) {
      const texto = await r.text();
      if (r.status === 400 || r.status === 401) throw new ErroBlingDesconectado(`O Bling recusou o acesso (${r.status}): ${texto}`);
      throw new ErroBling(r.status, `Erro ao obter token do Bling (${r.status}): ${texto}`);
    }
    const j = (await r.json()) as { access_token: string; refresh_token: string; expires_in: number };
    await this.#o.armazem.gravar({
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      expiraEm: new Date(this.#o.agora().getTime() + j.expires_in * 1000).toISOString(),
    });
  }

  async #tokenValido(): Promise<string> {
    const t = await this.#o.armazem.ler();
    if (!t) throw new ErroBlingDesconectado("O Bling ainda não foi conectado.");
    if (new Date(t.expiraEm).getTime() - this.#o.agora().getTime() < 60_000) {
      await this.#pedirToken({ grant_type: "refresh_token", refresh_token: t.refreshToken });
      return (await this.#o.armazem.ler())!.accessToken;
    }
    return t.accessToken;
  }

  async #get(caminho: string, tentativa = 0): Promise<unknown> {
    const espera = this.#ultimaChamada + this.#o.intervaloMinimoMs - Date.now();
    if (espera > 0) await this.#o.esperar(espera);
    this.#ultimaChamada = Date.now();

    const token = await this.#tokenValido();
    const r = await this.#o.fetch(`${BLING_API}${caminho}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (r.status === 401 && tentativa === 0) {
      await this.#pedirToken({ grant_type: "refresh_token", refresh_token: (await this.#o.armazem.ler())!.refreshToken });
      return this.#get(caminho, 1);
    }
    if (r.status === 429 && tentativa < 3) {
      await this.#o.esperar(1000);
      return this.#get(caminho, tentativa + 1);
    }
    if (!r.ok) throw new ErroBling(r.status, `Bling ${caminho} respondeu ${r.status}: ${await r.text()}`);
    return r.json();
  }
}
