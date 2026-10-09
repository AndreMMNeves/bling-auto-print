import { escaparHtml } from "../../../compartilhado/html-util.ts";
import type { LinhaRelatorio, StatusImpressao } from "../banco/repositorio.ts";
import { linhaParaColunas, ROTULO_STATUS } from "../relatorio.ts";
import type { UsuarioSessao } from "./auth.ts";

// Tela inteira: barra lateral no azul da Ônix HOF (destaque cobre na seção atual), conteúdo em vidro claro, fonte Sora.
const CSS = `
:root {
  --fundo: #eef3f9;
  --tinta: #10233f;
  --suave: #5a6b82;
  --vidro: rgba(255, 255, 255, .62);
  --vidro-forte: rgba(255, 255, 255, .86);
  --borda-vidro: rgba(255, 255, 255, .85);
  --brilho: rgba(255, 255, 255, .9);
  --linha: rgba(22, 32, 43, .08);
  --sombra: 0 14px 34px -24px rgba(22, 40, 60, .4);
  --marca: #0b5cb8;
  --marca-clara: #3780d4;
  --marca-suave: rgba(55, 128, 212, .12);
  --lateral: #0a3b78;
  --lateral-fundo: #082f61;
  --cobre: #d08a5c;
  --ok: #1e9e6a;
  --ruim: #d64545;
  --atencao: #c8552d;
  --largura-lateral: 232px;
  color-scheme: light;
}
* { box-sizing: border-box; }
html { min-height: 100%; }
body {
  margin: 0; min-height: 100vh; color: var(--tinta); background: var(--fundo);
  font: 15px/1.5 "Sora", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
body::before {
  content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
  background:
    radial-gradient(60vw 50vh at 100% 0%, #d7e5f6, transparent 70%),
    radial-gradient(50vw 50vh at 30% 100%, #f6e3d8, transparent 70%);
}

/* Barra lateral */
.lateral {
  position: fixed; inset: 0 auto 0 0; width: var(--largura-lateral); z-index: 10;
  display: flex; flex-direction: column; padding: 22px 14px 18px; overflow-y: auto;
  color: rgba(255, 255, 255, .78);
  background: linear-gradient(180deg, var(--lateral), var(--lateral-fundo));
}
.marca { display: flex; align-items: center; gap: 10px; }
.marca img { height: 40px; width: auto; display: block; border-radius: 10px; }
.marca small { font-weight: 600; font-size: .95rem; letter-spacing: -.01em; }
.lateral .marca { padding: 0 8px 18px; color: #fff; }
.lateral .grupo { font-size: .76rem; color: rgba(255, 255, 255, .5); padding: 18px 12px 6px; }
.lateral a {
  display: block; color: inherit; text-decoration: none; padding: 9px 12px; margin: 1px 0; border-radius: 10px;
  font-size: .93rem; border-left: 3px solid transparent; transition: background .15s, color .15s;
}
.lateral a:hover { background: rgba(255, 255, 255, .08); color: #fff; }
.lateral a[aria-current="page"] { background: rgba(255, 255, 255, .12); color: #fff; font-weight: 600; border-left-color: var(--cobre); }
.lateral .rodape { margin-top: auto; padding: 14px 12px 0; border-top: 1px solid rgba(255, 255, 255, .12); font-size: .86rem; }
.lateral .quem { color: #fff; font-weight: 600; display: block; margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lateral .sair {
  font: inherit; font-size: .86rem; color: rgba(255, 255, 255, .78); background: none; border: 1px solid rgba(255, 255, 255, .25);
  border-radius: 999px; padding: 5px 14px; cursor: pointer; box-shadow: none;
}
.lateral .sair:hover { color: #fff; border-color: #fff; filter: none; }

main { padding: 26px 32px 64px; }
body.com-lateral main { margin-left: var(--largura-lateral); }
.topo { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; margin-bottom: 22px; }
.topo h1 { margin: 0 auto 0 0; }
h1 { font-size: 1.75rem; font-weight: 700; letter-spacing: -.03em; margin: 0; }
h2 { font-size: 1.02rem; font-weight: 700; letter-spacing: -.01em; margin: 0 0 12px; }
.secao + .secao { margin-top: 26px; }

/* Vidro */
.cartao {
  background: var(--vidro); border: 1px solid var(--borda-vidro); border-radius: 18px; padding: 18px 20px; margin-bottom: 14px;
  backdrop-filter: blur(24px) saturate(160%); -webkit-backdrop-filter: blur(24px) saturate(160%);
  box-shadow: inset 0 1px 0 var(--brilho), var(--sombra);
}
.estreito { max-width: 440px; }
.entrada { max-width: 400px; margin: 16vh auto 0; padding: 30px 28px; }
.entrada .marca { flex-direction: column; align-items: flex-start; gap: 8px; margin: 0 0 22px; color: var(--marca); }
.entrada .marca img { height: 84px; border-radius: 16px; }

/* Duas colunas: conteúdo principal + coluna de apoio */
.colunas { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 400px); gap: 22px; align-items: start; }
.colunas > * { min-width: 0; }

/* Faixa com os números do dia */
.faixa { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-bottom: 22px; padding: 0; }
.faixa > div { padding: 16px 22px; color: var(--suave); font-size: .88rem; }
.faixa > div + div { border-left: 1px solid var(--linha); }
.numero { display: block; font-size: 2.2rem; font-weight: 300; letter-spacing: -.04em; line-height: 1.1; color: var(--tinta); }

/* Indicadores */
.ok { color: var(--ok); } .ruim { color: var(--ruim); } .atencao { color: var(--atencao); }
.status { display: grid; gap: 6px; font-size: .9rem; }
.bolinha { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; vertical-align: middle; }
.bolinha.ok { background: var(--ok); box-shadow: 0 0 0 4px color-mix(in srgb, var(--ok) 18%, transparent); }
.bolinha.ruim { background: var(--ruim); box-shadow: 0 0 0 4px color-mix(in srgb, var(--ruim) 18%, transparent); }
.pilula {
  display: inline-flex; align-items: center; padding: 7px 14px; border-radius: 999px; font-size: .86rem;
  background: var(--vidro-forte); border: 1px solid var(--borda-vidro); box-shadow: var(--sombra);
}

/* Expedição: nome, chave liga/desliga e situação do PC */
.expedicao h2 { margin: 0 0 8px; }
.expedicao .cabeca { margin-bottom: 8px; }
.expedicao .consultores { color: var(--suave); font-size: .86rem; margin-bottom: 10px; }
.expedicao .acoes { margin-top: 12px; }
.chave {
  display: inline-flex; align-items: center; gap: 10px; padding: 4px 0; background: none; box-shadow: none; color: var(--tinta);
  font-weight: 600; font-size: .84rem; white-space: nowrap;
}
.chave:hover { filter: none; }
.chave .trilho { position: relative; width: 44px; height: 26px; border-radius: 999px; background: #c5cfdb; transition: background .2s; flex: none; }
.chave .trilho::after {
  content: ""; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff;
  box-shadow: 0 2px 4px rgba(0, 0, 0, .2); transition: transform .2s;
}
.chave[aria-checked="true"] .trilho { background: var(--ok); }
.chave[aria-checked="true"] .trilho::after { transform: translateX(18px); }
.chave:disabled { cursor: default; }
.chave:disabled:active { transform: none; }
.aviso-desligada {
  font-size: .82rem; color: var(--atencao); margin: 0 0 10px; padding: 6px 10px; border-radius: 10px;
  background: color-mix(in srgb, var(--atencao) 9%, transparent);
}

/* Etiquetas de situação da impressão */
.etiqueta { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: .8rem; font-weight: 600; }
.etiqueta.impresso { background: color-mix(in srgb, var(--ok) 14%, transparent); color: #157a51; }
.etiqueta.fila, .etiqueta.imprimindo { background: var(--marca-suave); color: var(--marca); }
.etiqueta.salvo { background: rgba(122, 135, 153, .15); color: #556275; }
.etiqueta.erro { background: color-mix(in srgb, var(--ruim) 14%, transparent); color: #b23434; }

/* Tabelas */
.tabela { overflow-x: auto; padding: 4px 8px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-weight: 600; font-size: .78rem; color: var(--suave); padding: 10px 12px; white-space: nowrap; }
td { padding: 10px 12px; border-top: 1px solid var(--linha); font-size: .9rem; white-space: nowrap; }
tbody tr:hover td { background: rgba(55, 128, 212, .05); }
td a { color: var(--marca-clara); text-decoration: none; font-weight: 600; }
td.vazio { color: var(--suave); text-align: center; padding: 28px; white-space: normal; }
.ficha th { width: 1%; padding-right: 28px; }
.ficha td { white-space: normal; }
.ficha tr:first-child > * { border-top: 0; }

/* Formulários */
label { display: block; margin-bottom: 14px; font-size: .86rem; color: var(--suave); }
input, select, textarea {
  display: block; width: 100%; margin-top: 6px; padding: 9px 12px; font: inherit; color: var(--tinta);
  background: var(--vidro-forte); border: 1px solid var(--linha); border-radius: 10px; transition: border-color .15s, box-shadow .15s;
}
input:focus, select:focus, textarea:focus { outline: none; border-color: var(--marca); box-shadow: 0 0 0 4px var(--marca-suave); }
input[type="checkbox"] { display: inline; width: auto; margin: 0 6px 0 0; accent-color: var(--marca); }
button, .botao {
  display: inline-block; padding: 9px 18px; border-radius: 999px; border: 0; cursor: pointer; text-decoration: none;
  font: inherit; font-weight: 600; font-size: .9rem; color: #fff; background: var(--marca);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .3), 0 6px 16px -8px var(--marca); transition: transform .12s, filter .15s;
}
button:hover, .botao:hover { filter: brightness(1.06); }
button:active, .botao:active { transform: scale(.97); }
button.perigo { background: var(--ruim); box-shadow: 0 6px 16px -8px var(--ruim); }
button.secundario, .botao.secundario { background: var(--marca-suave); color: var(--marca); box-shadow: none; }
:focus-visible { outline: 2px solid var(--marca); outline-offset: 3px; }
.lateral :focus-visible { outline-color: #fff; }

.busca { display: flex; gap: 8px; align-items: center; }
.busca input { margin: 0; width: 200px; border-radius: 999px; padding: 8px 14px; }
.busca button { padding: 8px 16px; }
.filtros { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
.filtros label { margin: 0; min-width: 150px; flex: 1; }
.filtros .marcar { flex: 0 0 auto; min-width: 0; padding-bottom: 10px; color: var(--tinta); }
form.inline { display: inline; }
.contagem { color: var(--suave); margin: 0 4px 12px; font-size: .9rem; }
.paginas { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 4px; color: var(--suave); }
.barra-salvar { position: sticky; bottom: 0; padding: 16px 0 6px; background: linear-gradient(transparent, var(--fundo) 45%); }

.erro { color: var(--ruim); font-weight: 600; }
.mensagem {
  margin: 0 0 18px; padding: 12px 16px; border-radius: 14px; color: var(--tinta);
  background: color-mix(in srgb, var(--ok) 14%, var(--vidro-forte)); border: 1px solid var(--borda-vidro);
}
.nada { color: var(--ok); font-size: .9rem; margin: 0 4px; }
.alerta { display: grid; gap: 4px; border-left: 3px solid var(--atencao); }
.alerta .titulo { font-weight: 700; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; }
.alerta .quando { font-weight: 500; color: var(--suave); font-size: .82rem; }
.alerta p { margin: 2px 0 8px; font-size: .92rem; }
.alerta .acoes { display: flex; flex-wrap: wrap; gap: 8px; }
.alerta .acoes .botao, .alerta .acoes button { padding: 7px 14px; font-size: .84rem; }
.grade-alertas { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 14px; }
.grade-alertas .cartao { margin: 0; }

@media (max-width: 1100px) {
  .colunas { grid-template-columns: minmax(0, 1fr); }
  .colunas > aside { order: -1; } /* expedições e alertas antes da tabela */
}
@media (max-width: 760px) {
  .lateral {
    position: sticky; top: 0; width: auto; flex-direction: row; align-items: center; gap: 2px;
    padding: 8px 10px; overflow-x: auto; overflow-y: hidden; scrollbar-width: none;
  }
  .lateral::-webkit-scrollbar { display: none; }
  .lateral .marca { padding: 0 8px 0 0; }
  .lateral .marca img { height: 32px; }
  .lateral .marca small, .lateral .grupo, .lateral .quem { display: none; }
  .lateral a { white-space: nowrap; border-left: 0; border-bottom: 2px solid transparent; border-radius: 8px; }
  .lateral a[aria-current="page"] { border-bottom-color: var(--cobre); }
  .lateral .rodape { margin: 0 0 0 auto; padding: 0 0 0 8px; border: 0; }
  body.com-lateral main { margin-left: 0; }
  main { padding: 18px 16px 48px; }
  h1 { font-size: 1.45rem; }
  .busca { width: 100%; }
  .busca input { flex: 1; width: auto; }
  .faixa > div { padding: 12px 14px; }
  .numero { font-size: 1.7rem; }
  .grade-alertas { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .cartao { background: var(--vidro-forte); }
}
`;

// Logo oficial + "Expedição". Usado na barra lateral e no login.
export function marca(): string {
  return `<span class="marca"><img src="/marca/selo.jpg" alt="Ônix - Produtos para Harmonização Facial"><small>Expedição</small></span>`;
}

// Situação da impressão como etiqueta colorida (tabelas do painel, relatório e pedido).
export function etiquetaStatus(status: StatusImpressao): string {
  return `<span class="etiqueta ${status}">${ROTULO_STATUS[status]}</span>`;
}

// Linha do relatório como <td>s: número do pedido vira link e a situação vira etiqueta.
// qtd: quantas colunas mostrar (o painel mostra só as primeiras).
export function celulasRelatorio(l: LinhaRelatorio, qtd?: number): string {
  return linhaParaColunas(l).slice(0, qtd).map((c, i) =>
    i === 1 ? `<td><a href="/pedidos?numero=${encodeURIComponent(c)}">${escaparHtml(c)}</a></td>`
      : i === 6 ? `<td>${etiquetaStatus(l.status)}</td>`
        : `<td>${escaparHtml(c)}</td>`).join("");
}

// Busca rápida de pedido pelo número, no topo do painel.
export function buscaPedido(): string {
  return `<form class="busca" method="get" action="/pedidos" role="search">
  <input name="numero" placeholder="Número do pedido" aria-label="Número do pedido" inputmode="numeric"><button class="secundario">Buscar</button>
</form>`;
}

function lateral(u: UsuarioSessao): string {
  const link = (href: string, texto: string) => `<a href="${href}">${texto}</a>`;
  return `<nav class="lateral" aria-label="Menu">
  ${marca()}
  ${link("/", "Painel")}${link("/alertas", "Alertas")}${link("/pedidos", "Pedidos")}${link("/relatorio", "Relatório")}
  ${u.papel === "supervisor" ? `<span class="grupo">Administração</span>${link("/consultores", "Consultores")}${link("/usuarios", "Usuários")}${link("/config", "Configuração")}` : ""}
  <div class="rodape"><span class="quem">${escaparHtml(u.nome)}</span><form class="inline" method="post" action="/logout"><button class="sair">Sair</button></form></div>
</nav>
<script>
  // Marca no menu a seção da página aberta (/pedidos/12 fica em Pedidos).
  for (const a of document.querySelectorAll(".lateral a")) {
    const h = a.getAttribute("href");
    if (h === "/" ? location.pathname === "/" : location.pathname.startsWith(h)) a.setAttribute("aria-current", "page");
  }
</script>`;
}

// Recarrega sozinha, mas não no meio de uma digitação (busca, formulário).
function atualizacao(segundos: number): string {
  return `<noscript><meta http-equiv="refresh" content="${segundos}"></noscript>
<script>
  setInterval(() => {
    const campo = document.activeElement;
    if (!(campo && campo.matches("input, select, textarea") && campo.value)) location.reload();
  }, ${segundos * 1000});
</script>`;
}

export function pagina(
  usuario: UsuarioSessao | null,
  titulo: string,
  conteudo: string,
  opts: { atualizarSegundos?: number; mensagem?: string; semTitulo?: boolean; topo?: string } = {},
): string {
  const cabecalho = opts.semTitulo ? "" : `<div class="topo"><h1>${escaparHtml(titulo)}</h1>${opts.topo ?? ""}</div>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${opts.atualizarSegundos ? atualizacao(opts.atualizarSegundos) : ""}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<title>${escaparHtml(titulo)} — Expedição</title><style>${CSS}</style></head>
<body${usuario ? ` class="com-lateral"` : ""}>${usuario ? lateral(usuario) : ""}
<main>${cabecalho}${opts.mensagem ? `<div class="mensagem">${escaparHtml(opts.mensagem)}</div>` : ""}${conteudo}</main></body></html>`;
}
