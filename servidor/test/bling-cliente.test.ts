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
  return { ler: () => t, gravar: (n: Tokens) => { t = n; } };
}

const tokenValido = (): Tokens => ({ accessToken: "A1", refreshToken: "R1", expiraEm: new Date(AGORA.getTime() + 3600_000).toISOString() });

function cliente(f: typeof fetch, armazem = armazemMemoria(tokenValido())) {
  return new ClienteBling({
    clientId: "cid", clientSecret: "seg", armazem, fetch: f, agora: () => AGORA,
    intervaloMinimoMs: 0, esperar: async () => {},
  });
}

test("urlAutorizacao leva client_id e state", () => {
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
  assert.deepEqual(armazem.ler(), { accessToken: "A", refreshToken: "R", expiraEm: new Date(AGORA.getTime() + 21600_000).toISOString() });
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
  assert.equal(c.estaConectado(), false);
  await assert.rejects(c.obterBruto("/teste"), ErroBlingDesconectado);
});

test("listarPedidosAlterados percorre todas as páginas", async () => {
  const pagina = (n: number, ini: number) => Array.from({ length: n }, (_, i) => ({ id: ini + i, numero: ini + i, numeroLoja: "", situacao: { id: 9 } }));
  const { fetch, chamadas } = fetchFalso([{ json: { data: pagina(100, 1) } }, { json: { data: pagina(30, 101) } }]);
  const lista = await cliente(fetch).listarPedidosAlterados(new Date("2026-10-08T17:00:00Z"), AGORA);
  assert.equal(lista.length, 130);
  assert.deepEqual(lista[0], { id: 1, numero: "1", numeroLoja: null, situacaoId: 9 });
  assert.match(chamadas[0].url, /pagina=1/);
  assert.match(chamadas[1].url, /pagina=2/);
  assert.match(decodeURIComponent(chamadas[0].url.replace(/\+/g, " ")), /dataAlteracaoInicial=2026-10-08 14:00:00/);
});

test("formatarDataBling usa horário de São Paulo", () => {
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
  assert.deepEqual(p.itens[0], { codigo: "AH-1", descricao: "Ácido", quantidade: 1.5, produtoId: 5 });
  assert.equal(p.transporte, "SEDEX");
  assert.equal(p.etiqueta?.municipio, "Vitória");
  assert.equal(p.etiqueta?.complemento, null);
  assert.equal(p.observacoes, null);
});

test("armazemNoBanco guarda tokens por filial", () => {
  const { repo } = bancoDeTeste();
  const a = armazemNoBanco(repo, "ES");
  assert.equal(a.ler(), null);
  a.gravar(tokenValido());
  assert.deepEqual(armazemNoBanco(repo, "ES").ler(), tokenValido());
  assert.equal(armazemNoBanco(repo, "SP").ler(), null);
});
