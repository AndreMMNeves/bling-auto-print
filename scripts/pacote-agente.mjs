// Gera dist/OnixAgente.zip: o instalador do agente para levar a outros computadores.
// No outro PC: extrair o zip e dar dois cliques em "Instalar-Agente-Onix.cmd".
// ATENÇÃO: o zip leva o token do agente (é o que autoriza o PC no sistema). Uso interno.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const raiz = process.cwd();
const dist = join(raiz, "dist");
const pasta = join(dist, "OnixAgente");
rmSync(dist, { recursive: true, force: true });
mkdirSync(pasta, { recursive: true });

const semTestes = (origem) => !/[\\/]test([\\/]|$)/.test(origem) && !/[\\/]daemon([\\/]|$)/.test(origem);
cpSync(join(raiz, "agente", "src"), join(pasta, "agente", "src"), { recursive: true, filter: semTestes });
cpSync(join(raiz, "compartilhado"), join(pasta, "compartilhado"), { recursive: true, filter: semTestes });
mkdirSync(join(pasta, "scripts"), { recursive: true });
cpSync(join(raiz, "scripts", "servicos.ts"), join(pasta, "scripts", "servicos.ts"));
for (const f of ["instalar.ps1", "Instalar-Agente-Onix.cmd", "Desinstalar-Agente-Onix.cmd"]) cpSync(join(raiz, "instalador", f), join(pasta, f));

// Só as dependências do agente, nas mesmas versões do projeto.
const raizPkg = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8"));
const deps = Object.fromEntries(["puppeteer-core", "bwip-js", "pdf-to-printer", "node-windows"].map((d) => [d, raizPkg.dependencies[d]]));
writeFileSync(join(pasta, "package.json"), JSON.stringify({
  name: "onix-agente", private: true, type: "module", engines: { node: ">=24" },
  scripts: { agente: "node agente/src/main.ts" }, dependencies: deps,
}, null, 2));

// Servidor e token vêm da config deste PC; impressora e Chrome o instalador descobre no outro PC.
const atual = JSON.parse(readFileSync(join(raiz, "agente", "config.json"), "utf8"));
writeFileSync(join(pasta, "agente", "config.pacote.json"), JSON.stringify({
  servidorUrl: atual.servidorUrl, token: atual.token, modo: "imprimir", pasta: "dados/folhas",
  intervaloSegundos: 5, cicloSegundos: 30,
}, null, 2));

writeFileSync(join(pasta, "LEIA-ME.txt"), [
  "AGENTE DE IMPRESSÃO ÔNIX",
  "",
  "1. Extraia esta pasta em qualquer lugar do computador.",
  "2. Dê dois cliques em Instalar-Agente-Onix.cmd e aceite a permissão de administrador.",
  "3. Escolha a impressora deste computador quando o instalador perguntar.",
  "",
  "O agente fica instalado em C:\\OnixAgente e liga sozinho com o Windows.",
  `Painel: ${atual.servidorUrl} (a impressão automática liga/desliga por lá).`,
  "Para remover: Desinstalar-Agente-Onix.cmd.",
  "",
].join("\r\n"));

execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${pasta}' -DestinationPath '${join(dist, "OnixAgente.zip")}' -Force`]);
console.log(`Pacote gerado: ${join(dist, "OnixAgente.zip")}`);
