export type Impressora = { imprimir(pdf: Buffer, nomeImpressora: string, id: number): Promise<void> };
export type DepsAgente = {
  servidorUrl: string; token: string; impressora: Impressora; fetch?: typeof fetch; esperar?: (ms: number) => Promise<void>;
};
export type ResultadoAgente = "vazio" | "impresso" | "falhou";

export async function processarUm(d: DepsAgente): Promise<ResultadoAgente> {
  const f = d.fetch ?? fetch;
  const auth = { Authorization: `Bearer ${d.token}` };

  const r = await f(`${d.servidorUrl}/api/agente/proximo`, { headers: auth });
  if (r.status === 204) return "vazio";
  if (!r.ok) throw new Error(`Servidor respondeu ${r.status} ao pedir o próximo trabalho`);
  const t = (await r.json()) as { id: number; impressora: string; pdfBase64: string };

  let resultado: { ok: true } | { ok: false; erro: string };
  try {
    await d.impressora.imprimir(Buffer.from(t.pdfBase64, "base64"), t.impressora, t.id);
    resultado = { ok: true };
  } catch (e) {
    resultado = { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }

  // A folha já saiu: se o servidor estiver reiniciando, insiste em avisar.
  // Sem isso a impressão vira "travada" e o supervisor reimprime uma 1ª via em dobro.
  const esperar = d.esperar ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let ultimoErro = "";
  for (let tentativa = 0; tentativa <= ESPERAS_RESULTADO_MS.length; tentativa++) {
    if (tentativa > 0) await esperar(ESPERAS_RESULTADO_MS[tentativa - 1]);
    try {
      const rr = await f(`${d.servidorUrl}/api/agente/impressoes/${t.id}/resultado`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(resultado),
      });
      if (rr.ok) return resultado.ok ? "impresso" : "falhou";
      ultimoErro = `status ${rr.status}`;
      if (rr.status < 500) break; // 4xx não melhora tentando de novo
    } catch (e) {
      ultimoErro = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`Não consegui avisar o servidor sobre a impressão ${t.id} (${ultimoErro})`);
}

// Soma ~3,5 min: abaixo dos 5 min em que o servidor considera a impressão travada.
const ESPERAS_RESULTADO_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 30_000, 30_000, 30_000, 30_000, 30_000];

export async function esvaziarFila(d: DepsAgente, max = 50): Promise<number> {
  let n = 0;
  while (n < max) {
    if ((await processarUm(d)) === "vazio") break;
    n++;
  }
  return n;
}
