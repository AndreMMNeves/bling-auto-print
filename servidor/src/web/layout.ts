import { escaparHtml } from "../html-util.ts";
import type { UsuarioSessao } from "./auth.ts";

// Liquid Glass: painéis de vidro fosco flutuando sobre um fundo de pedra polida (ônix).
const CSS = `
:root {
  --fundo: #e9edf2;
  --tinta: #16202b;
  --suave: #5b6775;
  --vidro: rgba(255, 255, 255, .56);
  --vidro-forte: rgba(255, 255, 255, .78);
  --borda-vidro: rgba(255, 255, 255, .8);
  --brilho: rgba(255, 255, 255, .9);
  --linha: rgba(22, 32, 43, .08);
  --sombra: 0 18px 40px -22px rgba(22, 40, 60, .35);
  --jade: #0f8a7e;
  --jade-suave: rgba(15, 138, 126, .12);
  --ok: #1e9e6a;
  --ruim: #d64545;
  --atencao: #c98a12;
  --mancha-1: #8fe3d6;
  --mancha-2: #a9b8ff;
  --mancha-3: #f3cfdc;
  color-scheme: light;
}
* { box-sizing: border-box; }
html { min-height: 100%; }
body {
  margin: 0; min-height: 100vh; color: var(--tinta); background: var(--fundo);
  font: 15px/1.5 "Manrope", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
body::before {
  content: ""; position: fixed; inset: -20vmax; z-index: -1; pointer-events: none;
  background:
    radial-gradient(42vmax 34vmax at 14% 12%, var(--mancha-1), transparent 70%),
    radial-gradient(36vmax 32vmax at 88% 22%, var(--mancha-2), transparent 70%),
    radial-gradient(34vmax 28vmax at 30% 62%, var(--mancha-2), transparent 70%),
    radial-gradient(44vmax 36vmax at 76% 92%, var(--mancha-3), transparent 70%);
  filter: blur(36px);
}

/* Ilha de navegação flutuante */
header { position: sticky; top: 0; z-index: 10; padding: 14px 16px 0; }
.ilha {
  max-width: 1100px; margin: 0 auto; display: flex; align-items: center; gap: 4px;
  padding: 6px 6px 6px 18px; border-radius: 999px; overflow-x: auto; scrollbar-width: none;
  background: var(--vidro-forte); border: 1px solid var(--borda-vidro);
  backdrop-filter: blur(24px) saturate(180%); -webkit-backdrop-filter: blur(24px) saturate(180%);
  box-shadow: inset 0 1px 0 var(--brilho), var(--sombra);
}
.ilha::-webkit-scrollbar { display: none; }
.marca { font-weight: 800; letter-spacing: -.02em; margin-right: auto; white-space: nowrap; padding-right: 12px; }
.marca small { font-weight: 500; color: var(--suave); margin-left: 6px; font-size: .9em; }
.ilha a, .ilha .sair {
  color: var(--tinta); text-decoration: none; white-space: nowrap; padding: 7px 14px; border-radius: 999px;
  font: inherit; font-size: .93rem; background: none; border: 0; cursor: pointer; transition: background .15s;
}
.ilha a:hover, .ilha .sair:hover { background: var(--jade-suave); }
.ilha .quem { color: var(--suave); font-size: .88rem; padding: 0 8px 0 14px; white-space: nowrap; }

main { max-width: 1100px; margin: 0 auto; padding: 28px 16px 64px; }
h1 { font-size: 1.9rem; font-weight: 700; letter-spacing: -.03em; margin: 8px 4px 22px; }
h2 { font-size: 1.05rem; font-weight: 700; letter-spacing: -.01em; margin: 30px 4px 12px; }

/* Vidro */
.cartao {
  background: var(--vidro); border: 1px solid var(--borda-vidro); border-radius: 22px; padding: 20px 22px; margin-bottom: 14px;
  backdrop-filter: blur(28px) saturate(170%); -webkit-backdrop-filter: blur(28px) saturate(170%);
  box-shadow: inset 0 1px 0 var(--brilho), var(--sombra);
}
.cartao h2 { margin-top: 0; }
.estreito { max-width: 400px; margin: 8vh auto; }
.entrada { margin-top: 16vh; padding: 30px 28px; }
.entrada .marca { display: block; font-size: 1.5rem; margin: 0 0 22px; }
.grade { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; }
.grade .cartao { margin: 0; color: var(--suave); }
.numero { font-size: 2.8rem; font-weight: 300; letter-spacing: -.04em; line-height: 1.1; color: var(--tinta); }

.ok { color: var(--ok); } .ruim { color: var(--ruim); } .atencao { color: var(--atencao); }
.status { display: flex; flex-wrap: wrap; gap: 8px 22px; align-items: center; }
.bolinha { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; vertical-align: middle; }
.bolinha.ok { background: var(--ok); box-shadow: 0 0 0 4px color-mix(in srgb, var(--ok) 18%, transparent); }
.bolinha.ruim { background: var(--ruim); box-shadow: 0 0 0 4px color-mix(in srgb, var(--ruim) 18%, transparent); }

/* Tabelas */
.tabela { overflow-x: auto; padding: 6px 8px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-weight: 600; font-size: .8rem; color: var(--suave); padding: 10px 12px; }
td { padding: 11px 12px; border-top: 1px solid var(--linha); font-size: .93rem; white-space: nowrap; }
td a { color: var(--jade); text-decoration: none; font-weight: 600; }

/* Formulários */
label { display: block; margin-bottom: 14px; font-size: .88rem; color: var(--suave); }
input, select, textarea {
  display: block; width: 100%; margin-top: 6px; padding: 10px 12px; font: inherit; color: var(--tinta);
  background: var(--vidro-forte); border: 1px solid var(--linha); border-radius: 12px; transition: border-color .15s, box-shadow .15s;
}
input:focus, select:focus, textarea:focus { outline: none; border-color: var(--jade); box-shadow: 0 0 0 4px var(--jade-suave); }
input[type="checkbox"] { display: inline; width: auto; margin: 0 6px 0 0; accent-color: var(--jade); }
button, .botao {
  display: inline-block; padding: 10px 18px; border-radius: 999px; border: 0; cursor: pointer; text-decoration: none;
  font: inherit; font-weight: 600; font-size: .93rem; color: #fff; background: var(--jade);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .3), 0 6px 16px -8px var(--jade); transition: transform .12s, filter .15s;
}
button:hover, .botao:hover { filter: brightness(1.06); }
button:active, .botao:active { transform: scale(.97); }
button.perigo { background: var(--ruim); box-shadow: 0 6px 16px -8px var(--ruim); }
.cartao button.secundario, .botao.secundario { background: var(--jade-suave); color: var(--jade); box-shadow: none; }
:focus-visible { outline: 2px solid var(--jade); outline-offset: 3px; }

.filtros { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
.filtros label { margin: 0; min-width: 150px; flex: 1; }
form.inline { display: inline; }

.erro { color: var(--ruim); font-weight: 600; }
.mensagem {
  margin: 0 0 16px; padding: 12px 16px; border-radius: 16px; color: var(--tinta);
  background: color-mix(in srgb, var(--ok) 14%, var(--vidro)); border: 1px solid var(--borda-vidro);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
}
.alerta { display: grid; gap: 4px; }
.alerta .titulo { font-weight: 700; display: flex; align-items: center; gap: 10px; }
.alerta .titulo::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--atencao); flex: none; }
.alerta .quando { font-weight: 500; color: var(--suave); font-size: .85rem; }
.alerta p { margin: 2px 0 8px; }
.alerta .acoes { display: flex; flex-wrap: wrap; gap: 8px; }

@media (max-width: 640px) {
  h1 { font-size: 1.5rem; }
  .cartao { padding: 16px; border-radius: 18px; }
  .grade { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .grade .cartao { padding: 14px 12px; font-size: .8rem; }
  .numero { font-size: 1.9rem; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .cartao, .ilha { background: var(--vidro-forte); }
}
`;

export function pagina(
  usuario: UsuarioSessao | null,
  titulo: string,
  conteudo: string,
  opts: { atualizarSegundos?: number; mensagem?: string; semTitulo?: boolean } = {},
): string {
  const nav = usuario
    ? `<a href="/">Painel</a><a href="/alertas">Alertas</a><a href="/relatorio">Relatório</a><a href="/pedidos">Pedidos</a>` +
      (usuario.papel === "supervisor" ? `<a href="/usuarios">Usuários</a><a href="/config">Configuração</a>` : "") +
      `<span class="quem">${escaparHtml(usuario.nome)}</span><form class="inline" method="post" action="/logout"><button class="sair">Sair</button></form>`
    : "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${opts.atualizarSegundos ? `<meta http-equiv="refresh" content="${opts.atualizarSegundos}">` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<title>${escaparHtml(titulo)} — Expedição</title><style>${CSS}</style></head>
<body>${usuario ? `<header><nav class="ilha"><span class="marca">Ônix HOF<small>Expedição</small></span>${nav}</nav></header>` : ""}
<main>${opts.semTitulo ? "" : `<h1>${escaparHtml(titulo)}</h1>`}${opts.mensagem ? `<div class="mensagem">${escaparHtml(opts.mensagem)}</div>` : ""}${conteudo}</main></body></html>`;
}
