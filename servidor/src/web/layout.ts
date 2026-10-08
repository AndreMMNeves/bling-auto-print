import { escaparHtml } from "../html-util.ts";
import type { UsuarioSessao } from "./auth.ts";

const CSS = `
:root { --fundo: #f4f5f7; --cartao: #fff; --texto: #1d2129; --suave: #5f6b7a; --borda: #d9dde3; --verde: #1f8a4c; --vermelho: #c62828; --amarelo: #b26a00; --azul: #1f5fbf; }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, Segoe UI, Arial, sans-serif; background: var(--fundo); color: var(--texto); }
header { background: #14213d; color: #fff; padding: 10px 16px; display: flex; flex-wrap: wrap; gap: 16px; align-items: center; }
header a, header button { color: #fff; text-decoration: none; background: none; border: 0; font: inherit; cursor: pointer; padding: 0; }
header .marca { font-weight: 700; margin-right: auto; }
main { max-width: 1100px; margin: 0 auto; padding: 16px; }
h1 { font-size: 1.4rem; }
.cartao { background: var(--cartao); border: 1px solid var(--borda); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.estreito { max-width: 380px; margin: 40px auto; }
.grade { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.numero { font-size: 2rem; font-weight: 700; }
.ok { color: var(--verde); } .ruim { color: var(--vermelho); } .atencao { color: var(--amarelo); }
.bolinha { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }
.bolinha.ok { background: var(--verde); } .bolinha.ruim { background: var(--vermelho); }
table { width: 100%; border-collapse: collapse; background: var(--cartao); }
th, td { padding: 6px 8px; border-bottom: 1px solid var(--borda); text-align: left; font-size: .92rem; }
.tabela { overflow-x: auto; }
label { display: block; margin-bottom: 10px; }
input, select, textarea { display: block; width: 100%; padding: 8px; border: 1px solid var(--borda); border-radius: 6px; font: inherit; margin-top: 4px; }
button, .botao { background: var(--azul); color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; font: inherit; cursor: pointer; text-decoration: none; display: inline-block; }
button.perigo { background: var(--vermelho); }
.erro { color: var(--vermelho); font-weight: 600; }
.mensagem { background: #e8f5e9; border: 1px solid #a5d6a7; padding: 8px 12px; border-radius: 6px; margin-bottom: 12px; }
.alerta { border-left: 4px solid var(--amarelo); }
.filtros { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; }
.filtros label { margin: 0; }
form.inline { display: inline; }
`;

export function pagina(
  usuario: UsuarioSessao | null,
  titulo: string,
  conteudo: string,
  opts: { atualizarSegundos?: number; mensagem?: string } = {},
): string {
  const nav = usuario
    ? `<a href="/">Painel</a><a href="/alertas">Alertas</a><a href="/relatorio">Relatório</a><a href="/pedidos">Pedidos</a>` +
      (usuario.papel === "supervisor" ? `<a href="/usuarios">Usuários</a><a href="/config">Configuração</a>` : "") +
      `<span>${escaparHtml(usuario.nome)}</span><form class="inline" method="post" action="/logout"><button>Sair</button></form>`
    : "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${opts.atualizarSegundos ? `<meta http-equiv="refresh" content="${opts.atualizarSegundos}">` : ""}
<title>${escaparHtml(titulo)} — Expedição</title><style>${CSS}</style></head>
<body><header><span class="marca">ÔNIX HOF · Expedição</span>${nav}</header>
<main><h1>${escaparHtml(titulo)}</h1>${opts.mensagem ? `<div class="mensagem">${escaparHtml(opts.mensagem)}</div>` : ""}${conteudo}</main></body></html>`;
}
