import puppeteer, { type Browser } from "puppeteer-core";
import type { DadosFolha, Via } from "../tipos.ts";
import { codigoBarrasDataUri } from "./codigo-barras.ts";
import { renderizarFolha, type CodigosFolha } from "./html.ts";

export class GeradorPdf {
  #chromePath: string;
  #browser: Promise<Browser> | null = null;

  constructor(chromePath: string) {
    this.#chromePath = chromePath;
  }

  async gerar(dados: DadosFolha, via: Via): Promise<Buffer> {
    const codigos: CodigosFolha = { pedido: await codigoBarrasDataUri(dados.pedido.codigoBarras), porSku: new Map() };
    const { corpo, cabecalho, rodape } = renderizarFolha(dados, via, codigos);

    const page = await (await this.#abrir()).newPage();
    try {
      await page.setContent(corpo, { waitUntil: "load" });
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: cabecalho,
        footerTemplate: rodape,
        margin: { top: "14mm", bottom: "12mm", left: "10mm", right: "10mm" },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }

  #abrir(): Promise<Browser> {
    if (!this.#browser) {
      this.#browser = puppeteer
        .launch({ executablePath: this.#chromePath, headless: true, args: ["--no-sandbox"] })
        .then((b) => {
          b.on("disconnected", () => { this.#browser = null; });
          return b;
        })
        .catch((e) => {
          this.#browser = null;
          throw e;
        });
    }
    return this.#browser;
  }

  async fechar(): Promise<void> {
    const b = this.#browser;
    this.#browser = null;
    if (b) await (await b).close();
  }
}
