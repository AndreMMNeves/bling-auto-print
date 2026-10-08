import { FUSO } from "../tempo.ts";

export const BLING_API = "https://api.bling.com.br/Api/v3";
export const BLING_AUTORIZAR = "https://www.bling.com.br/Api/v3/oauth/authorize";

export type Tokens = { accessToken: string; refreshToken: string; expiraEm: string };
export type ArmazemTokens = { ler(): Tokens | null; gravar(t: Tokens): void };
export type ResumoPedido = { id: number; numero: string; numeroLoja: string | null; situacaoId: number };
export type PedidoBling = {
  id: number;
  numero: string;
  numeroLoja: string | null;
  data: string;
  contato: { nome: string; numeroDocumento: string | null };
  vendedorId: number | null;
  itens: Array<{ codigo: string | null; descricao: string; quantidade: number; produtoId: number | null }>;
  etiqueta: {
    endereco: string | null; numero: string | null; complemento: string | null; bairro: string | null;
    municipio: string | null; uf: string | null; cep: string | null;
  } | null;
  transporte: string | null;
  observacoes: string | null;
};

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

  estaConectado(): boolean {
    return this.#o.armazem.ler() !== null;
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

  async listarPedidosAlterados(desde: Date, ate: Date): Promise<ResumoPedido[]> {
    const todos: ResumoPedido[] = [];
    for (let pagina = 1; ; pagina++) {
      const q = new URLSearchParams({
        pagina: String(pagina),
        limite: "100",
        dataAlteracaoInicial: formatarDataBling(desde),
        dataAlteracaoFinal: formatarDataBling(ate),
      });
      const j = (await this.#get(`/pedidos/vendas?${q}`)) as { data?: any[] };
      const data = j.data ?? [];
      for (const p of data) {
        todos.push({ id: Number(p.id), numero: String(p.numero), numeroLoja: ouNulo(p.numeroLoja), situacaoId: Number(p.situacao?.id) });
      }
      if (data.length < 100) return todos;
    }
  }

  async obterPedido(id: number): Promise<PedidoBling> {
    const d = ((await this.#get(`/pedidos/vendas/${id}`)) as { data: any }).data;
    const et = d.transporte?.etiqueta;
    return {
      id: Number(d.id),
      numero: String(d.numero),
      numeroLoja: ouNulo(d.numeroLoja),
      data: String(d.data ?? ""),
      contato: { nome: ouNulo(d.contato?.nome) ?? "—", numeroDocumento: ouNulo(d.contato?.numeroDocumento) },
      vendedorId: d.vendedor?.id ? Number(d.vendedor.id) : null,
      itens: (d.itens ?? []).map((i: any) => ({
        codigo: ouNulo(i.codigo),
        descricao: String(i.descricao ?? ""),
        quantidade: Number(i.quantidade),
        produtoId: i.produto?.id ? Number(i.produto.id) : null,
      })),
      etiqueta: et
        ? {
            endereco: ouNulo(et.endereco), numero: ouNulo(et.numero), complemento: ouNulo(et.complemento),
            bairro: ouNulo(et.bairro), municipio: ouNulo(et.municipio), uf: ouNulo(et.uf), cep: ouNulo(et.cep),
          }
        : null,
      transporte: ouNulo(d.transporte?.volumes?.[0]?.servico) ?? ouNulo(d.transporte?.contato?.nome),
      observacoes: ouNulo(d.observacoes),
    };
  }

  async obterProduto(id: number): Promise<{ gtin: string | null; codigo: string | null }> {
    const d = ((await this.#get(`/produtos/${id}`)) as { data: any }).data;
    return { gtin: ouNulo(d.gtin), codigo: ouNulo(d.codigo) };
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
    this.#o.armazem.gravar({
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      expiraEm: new Date(this.#o.agora().getTime() + j.expires_in * 1000).toISOString(),
    });
  }

  async #tokenValido(): Promise<string> {
    const t = this.#o.armazem.ler();
    if (!t) throw new ErroBlingDesconectado("O Bling ainda não foi conectado.");
    if (new Date(t.expiraEm).getTime() - this.#o.agora().getTime() < 60_000) {
      await this.#pedirToken({ grant_type: "refresh_token", refresh_token: t.refreshToken });
      return this.#o.armazem.ler()!.accessToken;
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
      await this.#pedirToken({ grant_type: "refresh_token", refresh_token: this.#o.armazem.ler()!.refreshToken });
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
