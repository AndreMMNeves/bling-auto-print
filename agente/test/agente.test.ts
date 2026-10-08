import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { esvaziarFila, processarUm, type Impressora } from "../src/agente.ts";
import { ImpressoraPasta } from "../src/impressora.ts";

function servidorFalso(trabalhos: number[]) {
  const resultados: Array<{ id: number; corpo: unknown }> = [];
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer tk");
    if (u.endsWith("/api/agente/proximo")) {
      const id = trabalhos.shift();
      if (id === undefined) return new Response(null, { status: 204 });
      return Response.json({ id, impressora: "HP A4", pdfBase64: Buffer.from(`pdf-${id}`).toString("base64") });
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
  assert.equal(await processarUm({ servidorUrl: "http://srv", token: "tk", impressora: impressoraFalsa().imp, fetch: s.fetch }), "vazio");
});

test("imprime e avisa o servidor", async () => {
  const s = servidorFalso([7]);
  const i = impressoraFalsa();
  assert.equal(await processarUm({ servidorUrl: "http://srv", token: "tk", impressora: i.imp, fetch: s.fetch }), "impresso");
  assert.deepEqual(i.impressos, [{ pdf: "pdf-7", nome: "HP A4", id: 7 }]);
  assert.deepEqual(s.resultados, [{ id: 7, corpo: { ok: true } }]);
});

test("erro da impressora é enviado ao servidor", async () => {
  const s = servidorFalso([7]);
  const r = await processarUm({ servidorUrl: "http://srv", token: "tk", impressora: impressoraFalsa("Impressora offline").imp, fetch: s.fetch });
  assert.equal(r, "falhou");
  assert.deepEqual(s.resultados, [{ id: 7, corpo: { ok: false, erro: "Impressora offline" } }]);
});

test("esvaziarFila processa tudo até ficar vazio", async () => {
  const s = servidorFalso([1, 2, 3]);
  const i = impressoraFalsa();
  assert.equal(await esvaziarFila({ servidorUrl: "http://srv", token: "tk", impressora: i.imp, fetch: s.fetch }), 3);
  assert.deepEqual(i.impressos.map((x) => x.id), [1, 2, 3]);
});

test("ImpressoraPasta salva o PDF", async () => {
  const pasta = join(mkdtempSync(join(tmpdir(), "ag-")), "saida");
  await new ImpressoraPasta(pasta).imprimir(Buffer.from("%PDF"), "HP", 42);
  assert.equal(readFileSync(join(pasta, "impressao-42.pdf"), "utf8"), "%PDF");
});
