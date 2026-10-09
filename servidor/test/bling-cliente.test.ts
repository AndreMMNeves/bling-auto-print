import { test } from "node:test";
import assert from "node:assert/strict";
import { ClienteBling, ErroBlingDesconectado, formatarDataBling, type Tokens } from "../src/bling/cliente.ts";
import { armazemNoBanco } from "../src/bling/armazem.ts";
import { AGORA, bancoDeTeste } from "./ajudantes.ts";

type Resp = { status?: number; json?: unknown };
function fetchFalso(respostas: Array<Resp | ((url: string, init?: RequestInit) => Resp)>) {
  const chamadas: Array<{ url: string; init?: RequestInit }> = [];
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    chamadas.push({ url: u, init });
    const prox = respostas.shift();
    if (!prox) throw new Error(`fetch inesperado: ${u}`);
    const r = typeof prox === "function" ? prox(u, init) : prox;
    return new Response(r.json === undefined ? "" : JSON.stringify(r.json), { status: r.status ?? 200 });
  };
  return { fetch: f as typeof fetch, chamadas };
}

function armazemMemoria(inicial: Tokens | null = null) {
  let t = inicial;
  return { ler: async () => t, gravar: async (n: Tokens) => { t = n; } };
}

const tokenValido = (): Tokens => ({ accessToken: "A1", refreshToken: "R1", expiraEm: new Date(AGORA.getTime() + 3600_000).toISOString() });

function cliente(f: typeof fetch, armazem = armazemMemoria(tokenValido())) {
  return new ClienteBling({
    clientId: "cid", clientSecret: "seg", armazem, fetch: f, agora: () => AGORA,
    intervaloMinimoMs: 0, esperar: async () => {},
  });
}

test("urlAutorizacao leva client_id e state", async () => {
  const u = new URL(cliente(fetchFalso([]).fetch).urlAutorizacao("abc"));
  assert.equal(u.searchParams.get("client_id"), "cid");
  assert.equal(u.searchParams.get("state"), "abc");
  assert.equal(u.searchParams.get("response_type"), "code");
});

test("trocarCodigo usa Basic auth e guarda tokens com validade", async () => {
  const armazem = armazemMemoria();
  const { fetch, chamadas } = fetchFalso([{ json: { access_token: "A", refresh_token: "R", expires_in: 21600 } }]);
  await cliente(fetch, armazem).trocarCodigo("COD");
  const h = chamadas[0].init!.headers as Record<string, string>;
  assert.equal(h.Authorization, `Basic ${Buffer.from("cid:seg").toString("base64")}`);
  assert.match(String(chamadas[0].init!.body), /grant_type=authorization_code/);
  assert.match(String(chamadas[0].init!.body), /code=COD/);
  assert.deepEqual(await armazem.ler(), { accessToken: "A", refreshToken: "R", expiraEm: new Date(AGORA.getTime() + 21600_000).toISOString() });
});

test("renova o token quando falta menos de 1 minuto", async () => {
  const armazem = armazemMemoria({ accessToken: "velho", refreshToken: "R1", expiraEm: new Date(AGORA.getTime() + 30_000).toISOString() });
  const { fetch, chamadas } = fetchFalso([
    { json: { access_token: "novo", refresh_token: "R2", expires_in: 21600 } },
    { json: { data: { id: 1, nome: "x" } } },
  ]);
  await cliente(fetch, armazem).obterBruto("/teste");
  assert.match(String(chamadas[0].init!.body), /grant_type=refresh_token/);
  assert.equal((chamadas[1].init!.headers as Record<string, string>).Authorization, "Bearer novo");
});

test("401 renova o token e repete a chamada uma vez", async () => {
  const { fetch, chamadas } = fetchFalso([
    { status: 401, json: {} },
    { json: { access_token: "A2", refresh_token: "R2", expires_in: 21600 } },
    { json: { data: [] } },
  ]);
  await cliente(fetch).obterBruto("/teste");
  assert.equal(chamadas.length, 3);
});

test("refresh recusado vira ErroBlingDesconectado", async () => {
  const { fetch } = fetchFalso([{ status: 401, json: {} }, { status: 400, json: { error: "invalid_grant" } }]);
  await assert.rejects(cliente(fetch).obterBruto("/teste"), ErroBlingDesconectado);
});

test("sem tokens = desconectado", async () => {
  const c = cliente(fetchFalso([]).fetch, armazemMemoria(null));
  assert.equal(await c.estaConectado(), false);
  await assert.rejects(c.obterBruto("/teste"), ErroBlingDesconectado);
});

// Bling falso que filtra por data de alteração e pagina de 100 em 100, como a API real.
function blingComPedidos(alterados: Array<{ id: number; em: Date }>, ignorarPagina = false) {
  const chamadas: string[] = [];
  const lerData = (s: string) => new Date(`${s.replace(" ", "T")}-03:00`);
  const f = async (url: string | URL | Request) => {
    const u = new URL(String(url));
    chamadas.push(u.search);
    const de = lerData(u.searchParams.get("dataAlteracaoInicial")!);
    const ate = lerData(u.searchParams.get("dataAlteracaoFinal")!);
    const pagina = ignorarPagina ? 1 : Number(u.searchParams.get("pagina"));
    const naJanela = alterados.filter((p) => p.em >= de && p.em <= ate);
    const data = naJanela.slice((pagina - 1) * 100, pagina * 100).map((p) => ({ id: p.id, numero: p.id, situacao: { id: 9 } }));
    return new Response(JSON.stringify({ data }));
  };
  return { fetch: f as typeof fetch, chamadas };
}

test("listarPedidosAlterados traz tudo quando passa de 100, sem repetir", async () => {
  const inicio = new Date("2026-10-06T12:00:00Z").getTime();
  const alterados = Array.from({ length: 250 }, (_, i) => ({ id: i + 1, em: new Date(inicio + i * 60_000) }));
  const b = blingComPedidos(alterados);
  const lista = await cliente(b.fetch).listarPedidosAlterados(new Date(inicio), new Date(inicio + 300 * 60_000));
  assert.equal(lista.length, 250);
  assert.equal(new Set(lista.map((p) => p.id)).size, 250);
  assert.deepEqual(lista.find((p) => p.id === 1), { id: 1, numero: "1", numeroLoja: null, situacaoId: 9 });
  assert.match(decodeURIComponent(b.chamadas[0].replace(/\+/g, " ")), /dataAlteracaoInicial=2026-10-06 09:00:00/);
});

test("listarPedidosAlterados desiste com erro se o Bling não paginar direito", async () => {
  const em = new Date("2026-10-06T12:00:00Z");
  const alterados = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, em }));
  const b = blingComPedidos(alterados, true);
  await assert.rejects(cliente(b.fetch).listarPedidosAlterados(new Date(em.getTime() - 1000), new Date(em.getTime() + 1000)), /páginas/);
});

test("formatarDataBling usa horário de São Paulo", async () => {
  assert.equal(formatarDataBling(AGORA), "2026-10-08 14:32:00");
});

test("obterPedido normaliza campos ausentes", async () => {
  const { fetch } = fetchFalso([{ json: { data: {
    id: 77, numero: 12345, numeroLoja: "", data: "2026-10-08",
    contato: { nome: "Clínica X", numeroDocumento: "" },
    vendedor: { id: 0 },
    itens: [{ codigo: "AH-1", descricao: "Ácido", quantidade: "1.5", produto: { id: 5 } }],
    transporte: { volumes: [{ servico: "SEDEX" }], etiqueta: { endereco: "Rua A", numero: "10", municipio: "Vitória", uf: "ES", cep: "29000-000" } },
    observacoes: "",
  } } }]);
  const p = await cliente(fetch).obterPedido(77);
  assert.equal(p.numero, "12345");
  assert.equal(p.numeroLoja, null);
  assert.equal(p.vendedorId, null);
  assert.equal(p.contato.numeroDocumento, null);
  assert.deepEqual(p.itens[0], { codigo: "AH-1", descricao: "Ácido", descricaoDetalhada: null, unidade: null, quantidade: 1.5, valor: 0, descontoPct: 0, produtoId: 5 });
  assert.equal(p.dataPrevista, null);
  assert.deepEqual(p.parcelas, []);
  assert.equal(p.transporte, "SEDEX");
  assert.equal(p.etiqueta?.municipio, "Vitória");
  assert.equal(p.etiqueta?.complemento, null);
  assert.equal(p.observacoes, null);
});

test("armazemNoBanco guarda tokens por filial", async () => {
  const { repo } = await bancoDeTeste();
  const a = armazemNoBanco(repo, "ES");
  assert.equal(await a.ler(), null);
  await a.gravar(tokenValido());
  assert.deepEqual(await armazemNoBanco(repo, "ES").ler(), tokenValido());
  assert.equal(await armazemNoBanco(repo, "SP").ler(), null);
});

test("paginaPorSituacao busca uma página filtrando pela situação", async () => {
  const { fetch, chamadas } = fetchFalso([{ json: { data: [{ id: 101, numero: 101, situacao: { id: 9 } }] } }]);
  const lista = await cliente(fetch).paginaPorSituacao(9, 2);
  assert.deepEqual(lista, [{ id: 101, numero: "101", numeroLoja: null, situacaoId: 9 }]);
  assert.match(decodeURIComponent(chamadas[0].url), /idsSituacoes\[\]=9/);
  assert.match(chamadas[0].url, /pagina=2/);
});

test("listarPedidosAlterados filtra por vendedor quando pedido", async () => {
  const { fetch, chamadas } = fetchFalso([{ json: { data: [] } }]);
  await cliente(fetch).listarPedidosAlterados(new Date("2026-10-08T17:00:00Z"), AGORA, 15596870677);
  assert.match(chamadas[0].url, /idVendedor=15596870677/);
});

test("listarVendedores traz id e nome dos vendedores ativos", async () => {
  const { fetch, chamadas } = fetchFalso([{ json: { data: [
    { id: 15596870677, contato: { nome: "Larissa" } }, { id: 15596471757, contato: { nome: "Luana Cardoso" } },
  ] } }]);
  assert.deepEqual(await cliente(fetch).listarVendedores(), [
    { id: 15596471757, nome: "Luana Cardoso" }, { id: 15596870677, nome: "Larissa" },
  ].sort((a, b) => a.nome.localeCompare(b.nome)));
  assert.match(chamadas[0].url, /situacaoContato=A/);
});
