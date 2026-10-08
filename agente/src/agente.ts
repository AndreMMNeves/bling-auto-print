export type Impressora = { imprimir(pdf: Buffer, nomeImpressora: string, id: number): Promise<void> };
export type DepsAgente = { servidorUrl: string; token: string; impressora: Impressora; fetch?: typeof fetch };
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

  const rr = await f(`${d.servidorUrl}/api/agente/impressoes/${t.id}/resultado`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(resultado),
  });
  if (!rr.ok) throw new Error(`Servidor respondeu ${rr.status} ao registrar a impressão ${t.id}`);
  return resultado.ok ? "impresso" : "falhou";
}

export async function esvaziarFila(d: DepsAgente, max = 50): Promise<number> {
  let n = 0;
  while (n < max) {
    if ((await processarUm(d)) === "vazio") break;
    n++;
  }
  return n;
}
