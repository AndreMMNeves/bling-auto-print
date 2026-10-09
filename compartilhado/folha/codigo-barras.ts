import bwipjs from "bwip-js";

// Code 128 em SVG (vetor): sai nítido em qualquer impressora, sem borrar as barras finas.
// paddingwidth = zona de silêncio branca dos lados, que os leitores precisam para ler.
export async function codigoBarrasDataUri(texto: string): Promise<string> {
  const svg = bwipjs.toSVG({
    bcid: "code128",
    text: texto,
    height: 8, // proporção larga: na folha ele é exibido com ~6 cm de largura (barras grossas)
    includetext: false, // o número vai como texto na folha, abaixo das barras
    paddingwidth: 12,
    paddingheight: 2,
    backgroundcolor: "FFFFFF",
  });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
