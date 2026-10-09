// Ferramenta de VERIFICAÇÃO (Task 3). Conecta no Bling, baixa respostas reais
// e gera uma página com códigos de barras para testar no checkout do Bling.
// Uso: npm run explorar-bling -- servidor/config.json
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { carregarConfig, RAIZ } from "../config.ts";
import { abrirBanco } from "../banco/banco.ts";
import { Repositorio } from "../banco/repositorio.ts";
import { ClienteBling } from "../bling/cliente.ts";
import { armazemNoBanco } from "../bling/armazem.ts";
import { codigoBarrasDataUri } from "../../../compartilhado/folha/codigo-barras.ts";

const config = carregarConfig(process.argv[2] ?? join(RAIZ, "servidor/config.json"));
mkdirSync(join(RAIZ, "dados"), { recursive: true });
const repo = new Repositorio(await abrirBanco(config.banco.url));
const bling = new ClienteBling({
  clientId: config.bling.clientId, clientSecret: config.bling.clientSecret,
  armazem: armazemNoBanco(repo, config.filial.codigo),
});
const saida = join(RAIZ, "dados", "exploracao");
mkdirSync(saida, { recursive: true });
const salvar = (nome: string, dado: unknown) => writeFileSync(join(saida, nome), JSON.stringify(dado, null, 2));
// Algumas permissões (Situações, Vendedores) podem não existir no aplicativo: anota e segue.
async function tentar(nome: string, caminho: string): Promise<void> {
  try {
    salvar(nome, await bling.obterBruto(caminho));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`Aviso: ${caminho} falhou (${msg})`);
    salvar(nome, { erro: msg });
  }
}

async function conectar(): Promise<void> {
  if (await bling.estaConectado()) return;
  const state = randomBytes(16).toString("hex");
  const porta = Number(new URL(config.urlPublica).port || 80);
  await new Promise<void>((ok, falha) => {
    const srv = createServer(async (req, res) => {
      const u = new URL(req.url ?? "/", config.urlPublica);
      if (u.pathname !== "/bling/callback") { res.writeHead(404).end(); return; }
      if (u.searchParams.get("state") !== state) { res.writeHead(400).end("state inválido"); return; }
      try {
        await bling.trocarCodigo(u.searchParams.get("code") ?? "");
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end("Conectado! Pode fechar esta aba.");
        srv.close();
        ok();
      } catch (e) {
        res.writeHead(500).end(String(e));
        falha(e);
      }
    });
    srv.on("error", falha);
    srv.listen(porta, "127.0.0.1", () => {
      console.log(`\nEscutando em http://localhost:${porta}/bling/callback`);
      console.log(`Abra no navegador (logado no Bling ${config.filial.codigo}):\n\n  ${bling.urlAutorizacao(state)}\n`);
    });
  });
}

await conectar();
const agora = new Date();
const desde = new Date(agora.getTime() - 2 * 86_400_000);

// 1) Filtro por data de alteração funciona? Quantos pedidos e quais situações?
const lista = await bling.listarPedidosAlterados(desde, agora);
salvar("1-lista-alterados-2-dias.json", lista);
const porSituacao = new Map<number, number>();
for (const p of lista) porSituacao.set(p.situacaoId, (porSituacao.get(p.situacaoId) ?? 0) + 1);
console.log("Pedidos alterados nos últimos 2 dias:", lista.length);
console.log("Quantidade por id de situação:", Object.fromEntries(porSituacao));

// 2) Lista bruta sem filtro de alteração, para comparar
await tentar("2-lista-bruta-pagina1.json", "/pedidos/vendas?pagina=1&limite=20");

// 3) Nomes das situações do módulo de vendas
await tentar("3-situacoes-modulos.json", "/situacoes/modulos");
await tentar("3b-atendidos-por-situacao.json", `/pedidos/vendas?pagina=1&limite=5&idsSituacoes[]=${config.bling.situacaoAtendido}`);

// 4) Detalhe bruto de até 3 pedidos + produto e vendedor do primeiro
const amostra = lista.slice(0, 3);
for (const p of amostra) salvar(`4-pedido-${p.numero}.json`, await bling.obterBruto(`/pedidos/vendas/${p.id}`));
if (amostra[0]) {
  const det = await bling.obterPedido(amostra[0].id);
  salvar("5-pedido-normalizado.json", det);
  const prod = det.itens.find((i) => i.produtoId)?.produtoId;
  if (prod) await tentar("6-produto.json", `/produtos/${prod}`);
  if (det.vendedorId) await tentar("7-vendedor.json", `/vendedores/${det.vendedorId}`);

  // 5) Página com 3 candidatos de código de barras para testar no checkout
  const candidatos: Array<[string, string]> = [
    ["numero", det.numero], ["numeroLoja", det.numeroLoja ?? ""], ["id", String(det.id)],
  ];
  const blocos = await Promise.all(candidatos.filter(([, v]) => v).map(async ([campo, v]) =>
    `<div style="margin:12mm 0"><h2>${campo}: ${v}</h2><img src="${await codigoBarrasDataUri(v)}" style="height:18mm"></div>`));
  writeFileSync(join(saida, "codigos-de-barras.html"),
    `<!doctype html><meta charset="utf-8"><title>Teste de código de barras</title><body style="font-family:Arial">` +
    `<h1>Pedido ${det.numero}: qual destes o checkout do Bling aceita?</h1>${blocos.join("")}</body>`);
}
console.log(`\nArquivos salvos em ${saida}`);
