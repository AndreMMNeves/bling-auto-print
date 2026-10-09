// Gera a função da Vercel no formato "Build Output API" (.vercel/output).
// Todo o servidor vira um único arquivo; a Vercel só executa.
import { build } from "esbuild";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

// Na Vercel o banco é sempre o Turso via HTTP: o cliente local (com binário nativo) vira o cliente web.
const clienteWeb = {
  name: "libsql-web",
  setup(b) {
    b.onResolve({ filter: /^@libsql\/client$/ }, (args) => b.resolve("@libsql/client/web", { kind: args.kind, resolveDir: args.resolveDir }));
  },
};

const saida = ".vercel/output";
const funcao = `${saida}/functions/index.func`;
rmSync(saida, { recursive: true, force: true });
mkdirSync(funcao, { recursive: true });

await build({
  entryPoints: ["servidor/src/vercel.ts"],
  outfile: `${funcao}/index.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  plugins: [clienteWeb],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "warning",
});

writeFileSync(`${funcao}/.vc-config.json`, JSON.stringify({
  runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", maxDuration: 60, shouldAddHelpers: false,
}, null, 2));
writeFileSync(`${saida}/config.json`, JSON.stringify({ version: 3, routes: [{ src: "/(.*)", dest: "/index" }] }, null, 2));
console.log(`Função gerada em ${funcao}`);
