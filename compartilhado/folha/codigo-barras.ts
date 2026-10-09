import bwipjs from "bwip-js";

export async function codigoBarrasDataUri(texto: string): Promise<string> {
  const png = await bwipjs.toBuffer({
    bcid: "code128", text: texto, scale: 2, height: 10, includetext: true, textxalign: "center",
  });
  return `data:image/png;base64,${png.toString("base64")}`;
}
