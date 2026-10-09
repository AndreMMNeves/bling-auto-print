import { test } from "node:test";
import assert from "node:assert/strict";
import { codigoBarrasDataUri } from "../folha/codigo-barras.ts";

const svgDe = (uri: string) => Buffer.from(uri.split(",")[1], "base64").toString("utf8");

test("gera SVG vetorial (nítido em qualquer impressora)", async () => {
  const uri = await codigoBarrasDataUri("297469");
  assert.match(uri, /^data:image\/svg\+xml;base64,/);
  const svg = svgDe(uri);
  assert.match(svg, /^<svg[\s\S]*<\/svg>\s*$/);
  assert.match(svg, /<path/); // barras desenhadas como vetor
});

test("tem margem branca (zona de silêncio) dos dois lados para o leitor", async () => {
  const svg = svgDe(await codigoBarrasDataUri("297469"));
  const largura = Number(/viewBox="0 0 (\d+(?:\.\d+)?) /.exec(svg)?.[1]);
  // Com margem, a imagem fica bem mais larga que só as barras de um código de 6 dígitos.
  assert.ok(largura > 100, `largura ${largura}`);
  assert.match(svg, /<rect[^>]*fill="#FFFFFF"/i); // fundo branco atrás das barras
});
