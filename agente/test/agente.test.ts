import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispararCiclo, esvaziarFila, processarUm, type GerarPdf, type Impressora } from "../src/agente.ts";
import { ImpressoraPasta } from "../src/impressora.ts";

// O servidor manda os dados; o agente gera o PDF (aqui, um PDF falso com o número do pedido).
const trabalho = (id: number) => ({ id, impressora: "HP A4", dados: { pedido: { numero: String(id) } }, via: { numero: 1, motivo: null, usuario: null, em: null } });
const gerarPdf: GerarPdf = async (dados) => Buffer.from(`pdf-${dados.pedido.numero}`);

function servidorFalso(trabalhos: number[]) {
  const resultados: Array<{ id: number; corpo: unknown }> = [];
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer tk");
    if (u.endsWith("/api/agente/proximo")) {
      const id = trabalhos.shift();
      if (id === undefined) return new Response(null, { status: 204 });
      return Response.json(trabalho(id));
    }
    const m = u.match(/impressoes\/(\d+)\/resultado$/);
    if (m) { resultados.push({ id: Number(m[1]), corpo: JSON.parse(String(init!.body)) }); return Response.json({ ok: true }); }
    return new Response(null, { status: 404 });
  };
  return { fetch: f as typeof fetch, resultados };
}

function impressoraFalsa(falharCom?: string) {
  const impressos: Array<{ pdf: string; nome: string; id: number }> = [];
  const imp: Impressora = {
    async imprimir(pdf, nome, id) {
      if (falharCom) throw new Error(falharCom);
      impressos.push({ pdf: pdf.toString(), nome, id });
    },
  };
  return { imp, impressos };
}

test("fila vazia", async () => {
  const s = servidorFalso([]);
  assert.equal(await processarUm({ servidorUrl: "http://srv", token: "tk", impressora: impressoraFalsa().imp, fetch: s.fetch, gerarPdf }), "vazio");
});

test("imprime e avisa o servidor", async () => {
  const s = servidorFalso([7]);
  const i = impressoraFalsa();
  assert.equal(await processarUm({ servidorUrl: "http://srv", token: "tk", impressora: i.imp, fetch: s.fetch, gerarPdf }), "impresso");
  assert.deepEqual(i.impressos, [{ pdf: "pdf-7", nome: "HP A4", id: 7 }]);
  assert.deepEqual(s.resultados, [{ id: 7, corpo: { ok: true } }]);
});

test("erro da impressora é enviado ao servidor", async () => {
  const s = servidorFalso([7]);
  const r = await processarUm({ servidorUrl: "http://srv", token: "tk", impressora: impressoraFalsa("Impressora offline").imp, fetch: s.fetch, gerarPdf });
  assert.equal(r, "falhou");
  assert.deepEqual(s.resultados, [{ id: 7, corpo: { ok: false, erro: "Impressora offline" } }]);
});

test("esvaziarFila processa tudo até ficar vazio", async () => {
  const s = servidorFalso([1, 2, 3]);
  const i = impressoraFalsa();
  assert.equal(await esvaziarFila({ servidorUrl: "http://srv", token: "tk", impressora: i.imp, fetch: s.fetch, gerarPdf }), 3);
  assert.deepEqual(i.impressos.map((x) => x.id), [1, 2, 3]);
});

test("ImpressoraPasta salva o PDF", async () => {
  const pasta = join(mkdtempSync(join(tmpdir(), "ag-")), "saida");
  await new ImpressoraPasta(pasta).imprimir(Buffer.from("%PDF"), "HP", 42);
  assert.equal(readFileSync(join(pasta, "impressao-42.pdf"), "utf8"), "%PDF");
});

test("se o servidor cair ao receber o resultado, o agente tenta de novo sem reimprimir", async () => {
  const i = impressoraFalsa();
  let postsResultado = 0;
  const esperas: number[] = [];
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/api/agente/proximo")) return Response.json(trabalho(9));
    postsResultado++;
    if (postsResultado === 1) throw new Error("ECONNREFUSED");
    if (postsResultado === 2) return new Response(null, { status: 503 });
    return Response.json({ ok: true });
  };
  const r = await processarUm({ servidorUrl: "http://srv", token: "tk", impressora: i.imp, fetch: f as typeof fetch, gerarPdf, esperar: async (ms) => { esperas.push(ms); } });
  assert.equal(r, "impresso");
  assert.equal(i.impressos.length, 1);
  assert.equal(postsResultado, 3);
  assert.equal(esperas.length, 2);
});

test("desiste de avisar o servidor antes do limite de travada (5 min)", async () => {
  const esperas: number[] = [];
  const f = async (url: string | URL | Request) => {
    if (String(url).endsWith("/api/agente/proximo")) return Response.json(trabalho(9));
    throw new Error("ECONNREFUSED");
  };
  await assert.rejects(
    processarUm({ servidorUrl: "http://srv", token: "tk", impressora: impressoraFalsa().imp, fetch: f as typeof fetch, gerarPdf, esperar: async (ms) => { esperas.push(ms); } }),
    /impressão 9/,
  );
  assert.ok(esperas.reduce((s, x) => s + x, 0) < 5 * 60_000);
});

test("falha ao gerar o PDF é enviada ao servidor como erro, sem imprimir", async () => {
  const s = servidorFalso([7]);
  const i = impressoraFalsa();
  const r = await processarUm({ servidorUrl: "http://srv", token: "tk", impressora: i.imp, fetch: s.fetch, gerarPdf: async () => { throw new Error("Chrome não abriu"); } });
  assert.equal(r, "falhou");
  assert.equal(i.impressos.length, 0);
  assert.deepEqual(s.resultados, [{ id: 7, corpo: { ok: false, erro: "Falha ao gerar o PDF: Chrome não abriu" } }]);
});

test("dispararCiclo pede ao servidor para consultar o Bling", async () => {
  const chamadas: Array<{ url: string; metodo?: string; auth?: string }> = [];
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), metodo: init?.method, auth: (init?.headers as Record<string, string>).Authorization });
    return Response.json({ executado: true, resultado: { monitor: "2 novo(s)" } });
  };
  const r = await dispararCiclo({ servidorUrl: "https://x.vercel.app", token: "tk", fetch: f as typeof fetch });
  assert.deepEqual(chamadas, [{ url: "https://x.vercel.app/api/agente/ciclo", metodo: "POST", auth: "Bearer tk" }]);
  assert.deepEqual(r, { executado: true, resultado: { monitor: "2 novo(s)" } });
});

test("impressão desligada no painel: só salva o PDF e avisa o servidor que foi salvo", async () => {
  const resultados: unknown[] = [];
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/api/agente/proximo")) return Response.json({ ...trabalho(7), imprimir: false });
    resultados.push(JSON.parse(String(init!.body)));
    return Response.json({ ok: true });
  };
  const impressora = impressoraFalsa();
  const pasta = impressoraFalsa();
  const r = await processarUm({ servidorUrl: "http://srv", token: "tk", impressora: impressora.imp, pasta: pasta.imp, fetch: f as typeof fetch, gerarPdf });
  assert.equal(r, "salvo");
  assert.equal(impressora.impressos.length, 0);
  assert.deepEqual(pasta.impressos.map((x) => x.id), [7]);
  assert.deepEqual(resultados, [{ ok: true, salvo: true }]);
});

test("impressora escolhida no PC tem prioridade sobre a que vem do servidor", async () => {
  const usadas: string[] = [];
  const base: Impressora = { async imprimir(_pdf, nome) { usadas.push(nome); } };
  const { comImpressoraLocal } = await import("../src/impressora.ts");
  await comImpressoraLocal(base, "Brother do Balcão").imprimir(Buffer.from("x"), "EPSON do servidor", 1);
  await comImpressoraLocal(base, "").imprimir(Buffer.from("x"), "EPSON do servidor", 2);
  assert.deepEqual(usadas, ["Brother do Balcão", "EPSON do servidor"]);
});
