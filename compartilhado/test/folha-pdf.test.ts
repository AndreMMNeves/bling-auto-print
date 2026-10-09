import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { GeradorPdf } from "../folha/pdf.ts";
import { dadosFolhaExemplo } from "../../servidor/test/ajudantes.ts";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const pular = existsSync(CHROME) ? false : `Chrome não encontrado em ${CHROME}`;
const gerador = new GeradorPdf(CHROME);
after(() => gerador.fechar());

const via1 = { numero: 1, motivo: null, usuario: null, em: null };
const paginas = async (buf: Buffer) => (await PDFDocument.load(buf)).getPageCount();

test("pedido com 1 item sai em 1 página A4", { skip: pular }, async () => {
  const pdf = await gerador.gerar(dadosFolhaExemplo(1), via1);
  const doc = await PDFDocument.load(pdf);
  assert.equal(doc.getPageCount(), 1);
  const { width, height } = doc.getPage(0).getSize();
  assert.ok(Math.abs(width - 595) < 2 && Math.abs(height - 842) < 2, `tamanho ${width}x${height} não é A4`);
});

test("pedido com 25 itens ainda cabe em 1 página", { skip: pular }, async () => {
  assert.equal(await paginas(await gerador.gerar(dadosFolhaExemplo(25), via1)), 1);
});

test("pedido com 60 itens quebra em mais páginas", { skip: pular }, async () => {
  assert.ok((await paginas(await gerador.gerar(dadosFolhaExemplo(60), via1))) >= 2);
});

test("reimpressão com 25 itens continua em 1 página", { skip: pular }, async () => {
  const via = { numero: 2, motivo: "Folha perdida", usuario: "Maria", em: new Date().toISOString() };
  assert.equal(await paginas(await gerador.gerar(dadosFolhaExemplo(25), via)), 1);
});
