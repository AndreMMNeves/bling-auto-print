import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// pdf-to-printer é CommonJS: o Node não expõe "print" como import nomeado.
import pdfToPrinter from "pdf-to-printer";
import type { Impressora } from "./agente.ts";

// Impressão silenciosa no Windows (pdf-to-printer usa o SumatraPDF embutido).
export class ImpressoraWindows implements Impressora {
  async imprimir(pdf: Buffer, nomeImpressora: string, id: number): Promise<void> {
    const arq = join(tmpdir(), `onix-folha-${id}-${Date.now()}.pdf`);
    await writeFile(arq, pdf);
    try {
      await pdfToPrinter.print(arq, { printer: nomeImpressora, scale: "noscale", paperSize: "A4" });
    } finally {
      await rm(arq, { force: true });
    }
  }
}

// Modo paralelo (Task 16): salva em vez de imprimir.
export class ImpressoraPasta implements Impressora {
  #pasta: string;

  constructor(pasta: string) {
    this.#pasta = pasta;
  }

  async imprimir(pdf: Buffer, _nomeImpressora: string, id: number): Promise<void> {
    await mkdir(this.#pasta, { recursive: true });
    await writeFile(join(this.#pasta, `impressao-${id}.pdf`), pdf);
  }
}

// Cada PC pode ter sua própria impressora (agente/config.json > "impressora").
// Vazio = usa a impressora cadastrada no servidor.
export function comImpressoraLocal(base: Impressora, impressoraLocal: string | undefined): Impressora {
  if (!impressoraLocal) return base;
  return { imprimir: (pdf, _nomeDoServidor, id) => base.imprimir(pdf, impressoraLocal, id) };
}
