# Sistema de Impressão da Expedição — Plano de Implementação (Etapa 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando um pedido do Bling ES vira "Atendido", imprimir automaticamente uma folha de separação A4 (uma única 1ª via por pedido), com reimpressão só por supervisor com justificativa, relatório na web e cópia no Google Sheets.

**Architecture:** Um **servidor** Node.js consulta a API v3 do Bling a cada 30s, aplica as regras (novo → fila; repetido/cancelado → alerta), guarda tudo em SQLite, gera o PDF da folha com o Chrome (puppeteer-core) e serve a página web (Fastify, HTML renderizado no servidor). Um **agente** separado busca trabalhos no servidor via HTTP e imprime direto na impressora do Windows (pdf-to-printer) ou salva numa pasta (modo paralelo). Os dois rodam como serviços do Windows.

**Tech Stack:** Node.js ≥ 24 executando TypeScript nativamente (sem build), `node:sqlite`, `node:test`, Fastify 5 (+ @fastify/formbody, @fastify/cookie), puppeteer-core (Chrome já instalado), bwip-js (Code 128), pdf-to-printer, google-auth-library, node-windows. Dev: typescript, @types/node, pdf-lib.

**Spec:** `docs/superpowers/specs/2026-10-08-sistema-impressao-expedicao-design.md`

## Global Constraints

- Node.js **≥ 24**. O código `.ts` roda direto com `node arquivo.ts` (type stripping). Por isso **só sintaxe TypeScript apagável**: nada de `enum`, `namespace`, parameter properties (`constructor(private x)`). Imports locais **com extensão `.ts`**. Tipos importados com `import type`. O `tsconfig.json` (Task 1) força isso com `erasableSyntaxOnly` e `verbatimModuleSyntax`.
- Testes com `node:test` + `node:assert/strict`. Comandos: `npm test` e `npm run typecheck`. Os dois precisam passar ao final de toda task.
- Todo texto visível ao usuário (páginas, folha, alertas, logs) em **português do Brasil**.
- Datas guardadas no banco como **ISO 8601 UTC** (`Date.toISOString()`) e exibidas no fuso **America/Sao_Paulo** (ES = mesmo fuso, UTC−3, sem horário de verão).
- Folha: **A4**. A **1ª via de um pedido é única para sempre**, garantida por `UNIQUE(pedido_id, tipo_documento, via)` e `UNIQUE(filial_id, numero)`.
- Constantes da spec: consulta ao Bling a cada **30 s** (configurável); margem de consulta **5 min**; impressão: **4 tentativas no total (1 + 3)**; impressão "imprimindo" sem resposta por **5 min** = travada; agente sem comunicação por **2 min** = offline; retomada = intervalo entre consultas **> 5 min**; primeira ativação registra sem imprimir os pedidos Atendido alterados nos últimos **30 dias**.
- Google Sheets **nunca** bloqueia ou atrasa uma impressão.
- Arquivos com segredos (`servidor/config.json`, `agente/config.json`, `dados/`) ficam **fora do git**.
- Commits: este PC não tem identidade git configurada. Todo commit do plano usa
  `git -c user.name="Andre MM Neves" -c user.email="mkt@onixhof.com" commit ...`
  e termina a mensagem com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nos passos abaixo isso está abreviado como `git commit -m "<mensagem>"`.

## Review Focus

1. **Dois ciclos do monitor ao mesmo tempo, ou servidor reiniciado no meio de um ciclo**: o mesmo pedido nunca ganha duas 1ª vias. Teste: `executarCiclo` em paralelo, na Task 6.
2. **Descrição de produto com `<`, `&` ou aspas, e quantidade fracionada (1,5)**: a folha mostra o texto literal e "1,5". Teste: Task 5.
3. **Mais de 100 pedidos alterados na janela (retomada depois de um fim de semana)**: todos são buscados, com paginação. Teste: Task 2.
4. **Agente responde "ok" atrasado para uma impressão já marcada como travada/erro**: ela passa a "impresso" e não é reenfileirada. Teste: Task 7.
5. **Impressão às 23:50 no horário local**: conta no dia certo no relatório e no painel, não no dia seguinte em UTC. Teste: Task 10.

---

### Task 1: Base do projeto e camada de dados

**Files:**
- Create: `package.json`, `tsconfig.json`
- Modify: `.gitignore`
- Create: `compartilhado/tipos.ts`
- Create: `servidor/src/tempo.ts`
- Create: `servidor/src/banco/schema.ts`, `servidor/src/banco/banco.ts`, `servidor/src/banco/repositorio.ts`
- Create: `servidor/test/ajudantes.ts`
- Test: `servidor/test/repositorio.test.ts`, `servidor/test/tempo.test.ts`

**Interfaces:**
- Produces (usado por todas as tasks seguintes):
  - `compartilhado/tipos.ts`: `DadosFolha`, `Via`.
  - `servidor/src/tempo.ts`: `formatarDataHora(iso: string | null): string`, `formatarHora(iso: string | null): string`, `diaLocal(d: Date): string` (`"YYYY-MM-DD"`), `inicioDoDia(dia: string): string`, `fimDoDia(dia: string): string`.
  - `servidor/src/banco/banco.ts`: `abrirBanco(arquivo: string): DatabaseSync`, `transacao<T>(db: DatabaseSync, fn: () => T): T`.
  - `servidor/src/banco/repositorio.ts`: `class Repositorio` (métodos abaixo), tipos `PedidoRow`, `ImpressaoRow`, `AgenteRow`, `StatusImpressao`, `TipoAlerta`, `Situacao`.
  - `servidor/test/ajudantes.ts`: `bancoDeTeste()`, `dadosFolhaExemplo(qtdItens?, numero?)`, `AGORA`.

- [ ] **Step 1: Criar `package.json`, `tsconfig.json` e instalar dependências**

`package.json`:
```json
{
  "name": "onix-impressao-expedicao",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "test": "node --test --test-reporter=spec \"servidor/test/*.test.ts\"",
    "typecheck": "tsc --noEmit",
    "servidor": "node servidor/src/main.ts",
    "agente": "node agente/src/main.ts",
    "criar-usuario": "node servidor/src/cli/criar-usuario.ts",
    "explorar-bling": "node servidor/src/cli/explorar-bling.ts"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["compartilhado", "servidor", "agente"]
}
```

Run:
```bash
npm install fastify @fastify/formbody @fastify/cookie puppeteer-core bwip-js pdf-to-printer google-auth-library node-windows
npm install -D typescript@^5.8 @types/node pdf-lib
```
Expected: instala sem erro e cria `package-lock.json`. `typescript` precisa ser ≥ 5.8 por causa do `erasableSyntaxOnly`.

- [ ] **Step 2: Atualizar `.gitignore`**

Acrescentar ao final de `.gitignore`:
```
dados/
*.db
*.db-wal
*.db-shm
servidor/config.json
agente/config.json
```

- [ ] **Step 3: Criar os tipos compartilhados**

`compartilhado/tipos.ts`:
```ts
// Tudo o que a folha de separação precisa, já resolvido a partir do Bling.
// É guardado como JSON em cada impressão (foto do momento da impressão).
export type DadosFolha = {
  filial: string;
  pedido: {
    numero: string;
    numeroLoja: string | null;
    idBling: number;
    data: string; // data do pedido como veio do Bling, ex. "2026-10-08"
    atendidoEm: string; // ISO UTC: quando o sistema detectou o Atendido
    vendedor: string | null;
    observacoes: string | null;
    codigoBarras: string; // valor que vai no código de barras do pedido
  };
  cliente: { nome: string; documento: string | null };
  entrega: { endereco: string | null; cidadeUf: string | null; cep: string | null };
  transporte: string | null;
  itens: Array<{ quantidade: number; sku: string | null; descricao: string; ean: string | null }>;
};

// Qual via está sendo impressa. numero = 1 é a impressão automática.
export type Via = {
  numero: number;
  motivo: string | null;
  usuario: string | null;
  em: string | null; // ISO UTC
};
```

- [ ] **Step 4: Escrever os testes de tempo (falhando)**

`servidor/test/tempo.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { diaLocal, fimDoDia, formatarDataHora, formatarHora, inicioDoDia } from "../src/tempo.ts";

test("formatarDataHora mostra no fuso de São Paulo", () => {
  assert.equal(formatarDataHora("2026-10-08T17:32:00.000Z"), "08/10/2026 14:32");
  assert.equal(formatarDataHora(null), "—");
});

test("formatarHora mostra só hora e minuto", () => {
  assert.equal(formatarHora("2026-10-08T17:32:00.000Z"), "14:32");
});

test("diaLocal usa o dia de São Paulo, não o de UTC", () => {
  // 02:50 UTC do dia 09 = 23:50 do dia 08 em São Paulo
  assert.equal(diaLocal(new Date("2026-10-09T02:50:00.000Z")), "2026-10-08");
});

test("inicioDoDia e fimDoDia convertem o dia local para UTC", () => {
  assert.equal(inicioDoDia("2026-10-08"), "2026-10-08T03:00:00.000Z");
  assert.equal(fimDoDia("2026-10-08"), "2026-10-09T02:59:59.999Z");
});
```

Run: `npm test`
Expected: FAIL, com "Cannot find module ... tempo.ts".

- [ ] **Step 5: Implementar `tempo.ts`**

`servidor/src/tempo.ts`:
```ts
export const FUSO = "America/Sao_Paulo";

const fmtDataHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const fmtHora = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fmtDia = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" });

export function formatarDataHora(iso: string | null): string {
  if (!iso) return "—";
  return fmtDataHora.format(new Date(iso)).replace(",", "");
}

export function formatarHora(iso: string | null): string {
  if (!iso) return "—";
  return fmtHora.format(new Date(iso));
}

// "YYYY-MM-DD" do dia em São Paulo.
export function diaLocal(d: Date): string {
  return fmtDia.format(d);
}

// O Brasil não tem horário de verão desde 2019: o offset é sempre -03:00.
export function inicioDoDia(dia: string): string {
  return new Date(`${dia}T00:00:00.000-03:00`).toISOString();
}

export function fimDoDia(dia: string): string {
  return new Date(`${dia}T23:59:59.999-03:00`).toISOString();
}
```

Run: `npm test`
Expected: os 4 testes de tempo PASS.

- [ ] **Step 6: Criar schema e abertura do banco**

`servidor/src/banco/schema.ts`:
```ts
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS estado (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS filiais (
  id INTEGER PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agentes (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE,
  ultima_comunicacao TEXT
);
CREATE TABLE IF NOT EXISTS impressoras (
  id INTEGER PRIMARY KEY,
  filial_id INTEGER NOT NULL REFERENCES filiais(id),
  agente_id INTEGER NOT NULL REFERENCES agentes(id),
  nome_windows TEXT NOT NULL,
  UNIQUE (agente_id, nome_windows)
);
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL CHECK (papel IN ('operador', 'supervisor')),
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY,
  filial_id INTEGER NOT NULL REFERENCES filiais(id),
  numero TEXT NOT NULL,
  id_bling INTEGER NOT NULL,
  situacao INTEGER NOT NULL,
  origem TEXT NOT NULL CHECK (origem IN ('baseline', 'monitor')),
  detectado_em TEXT NOT NULL,
  UNIQUE (filial_id, numero)
);
CREATE TABLE IF NOT EXISTS impressoes (
  id INTEGER PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id),
  impressora_id INTEGER NOT NULL REFERENCES impressoras(id),
  via INTEGER NOT NULL,
  tipo_documento TEXT NOT NULL DEFAULT 'folha_separacao',
  dados_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('fila', 'imprimindo', 'impresso', 'erro')),
  tentativas INTEGER NOT NULL DEFAULT 0,
  ultimo_erro TEXT,
  motivo TEXT,
  usuario_id INTEGER REFERENCES usuarios(id),
  criado_em TEXT NOT NULL,
  iniciado_em TEXT,
  impresso_em TEXT,
  UNIQUE (pedido_id, tipo_documento, via)
);
CREATE TABLE IF NOT EXISTS alertas (
  id INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('repetido', 'cancelado', 'falha_impressao', 'retomada', 'bling_desconectado')),
  pedido_id INTEGER REFERENCES pedidos(id),
  mensagem TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  resolvido_por INTEGER REFERENCES usuarios(id),
  resolvido_em TEXT
);
CREATE TABLE IF NOT EXISTS fila_planilha (
  id INTEGER PRIMARY KEY,
  impressao_id INTEGER NOT NULL UNIQUE REFERENCES impressoes(id),
  tentativas INTEGER NOT NULL DEFAULT 0,
  enviado_em TEXT
);
`;
```

`servidor/src/banco/banco.ts`:
```ts
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "./schema.ts";

export function abrirBanco(arquivo: string): DatabaseSync {
  const db = new DatabaseSync(arquivo);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  return db;
}

// Não aninhe: chamar transacao() dentro de outra transacao() dá erro de BEGIN.
export function transacao<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
```

- [ ] **Step 7: Escrever os testes do repositório (falhando)**

`servidor/test/ajudantes.ts`:
```ts
import { abrirBanco } from "../src/banco/banco.ts";
import { Repositorio } from "../src/banco/repositorio.ts";
import type { DadosFolha } from "../../compartilhado/tipos.ts";

export const AGORA = new Date("2026-10-08T17:32:00.000Z"); // 14:32 em São Paulo

export function bancoDeTeste() {
  const repo = new Repositorio(abrirBanco(":memory:"));
  const filialId = repo.garantirFilial("ES", "Espírito Santo");
  const { agenteId, impressoraId } = repo.garantirAgente(filialId, {
    nome: "expedicao-es", token: "token-teste", impressora: "HP A4",
  });
  return { repo, filialId, agenteId, impressoraId };
}

export function dadosFolhaExemplo(qtdItens = 2, numero = "12345"): DadosFolha {
  return {
    filial: "Espírito Santo",
    pedido: {
      numero, numeroLoja: null, idBling: 9000 + Number(numero), data: "2026-10-08",
      atendidoEm: AGORA.toISOString(), vendedor: "Fulano", observacoes: null, codigoBarras: numero,
    },
    cliente: { nome: "Clínica X", documento: "12.345.678/0001-90" },
    entrega: { endereco: "Rua A, 10", cidadeUf: "Vitória/ES", cep: "29000-000" },
    transporte: "SEDEX",
    itens: Array.from({ length: qtdItens }, (_, i) => ({
      quantidade: i + 1,
      sku: `SKU-${String(i + 1).padStart(3, "0")}`,
      descricao: `Produto ${i + 1}`,
      ean: `78900000${String(i + 1).padStart(5, "0")}`,
    })),
  };
}
```

`servidor/test/repositorio.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { AGORA, bancoDeTeste, dadosFolhaExemplo } from "./ajudantes.ts";

test("estado: grava, lê e apaga", () => {
  const { repo } = bancoDeTeste();
  assert.equal(repo.obterEstado("x"), null);
  repo.definirEstado("x", "1");
  repo.definirEstado("x", "2");
  assert.equal(repo.obterEstado("x"), "2");
  repo.definirEstado("x", null);
  assert.equal(repo.obterEstado("x"), null);
});

test("garantirAgente é idempotente e o token identifica agente e impressora", () => {
  const { repo, filialId, agenteId, impressoraId } = bancoDeTeste();
  const de_novo = repo.garantirAgente(filialId, { nome: "expedicao-es", token: "token-teste", impressora: "HP A4" });
  assert.deepEqual(de_novo, { agenteId, impressoraId });
  const ag = repo.buscarAgentePorToken("token-teste");
  assert.equal(ag?.impressora_id, impressoraId);
  assert.equal(ag?.impressora_nome, "HP A4");
  assert.equal(repo.buscarAgentePorToken("errado"), null);
});

test("pedido: número é único por filial", () => {
  const { repo, filialId } = bancoDeTeste();
  repo.inserirPedido({ filialId, numero: "1", idBling: 10, situacao: 9, origem: "monitor", agora: AGORA });
  assert.throws(() => repo.inserirPedido({ filialId, numero: "1", idBling: 10, situacao: 9, origem: "monitor", agora: AGORA }));
  assert.equal(repo.buscarPedido(filialId, "1")?.id_bling, 10);
});

test("impressão: a mesma via de um pedido não pode ser criada duas vezes", () => {
  const { repo, filialId, impressoraId } = bancoDeTeste();
  const pedidoId = repo.inserirPedido({ filialId, numero: "1", idBling: 10, situacao: 9, origem: "monitor", agora: AGORA });
  const base = { pedidoId, impressoraId, dados: dadosFolhaExemplo(), motivo: null, usuarioId: null, agora: AGORA };
  repo.criarImpressao({ ...base, via: 1 });
  assert.throws(() => repo.criarImpressao({ ...base, via: 1 }));
  assert.equal(repo.proximaVia(pedidoId), 2);
});

test("fila: entrega a mais antiga primeiro e marca como imprimindo", () => {
  const { repo, filialId, impressoraId } = bancoDeTeste();
  const ids = ["1", "2"].map((numero) => {
    const pedidoId = repo.inserirPedido({ filialId, numero, idBling: Number(numero), situacao: 9, origem: "monitor", agora: AGORA });
    return repo.criarImpressao({ pedidoId, impressoraId, via: 1, dados: dadosFolhaExemplo(1, numero), motivo: null, usuarioId: null, agora: AGORA });
  });
  const primeira = repo.pegarProximaDaFila(impressoraId, AGORA);
  assert.equal(primeira?.id, ids[0]);
  assert.equal(primeira?.status, "imprimindo");
  assert.equal(repo.pegarProximaDaFila(impressoraId, AGORA)?.id, ids[1]);
  assert.equal(repo.pegarProximaDaFila(impressoraId, AGORA), null);
});

test("falha e reenfileiramento", () => {
  const { repo, filialId, impressoraId } = bancoDeTeste();
  const pedidoId = repo.inserirPedido({ filialId, numero: "1", idBling: 1, situacao: 9, origem: "monitor", agora: AGORA });
  const id = repo.criarImpressao({ pedidoId, impressoraId, via: 1, dados: dadosFolhaExemplo(), motivo: null, usuarioId: null, agora: AGORA });
  repo.pegarProximaDaFila(impressoraId, AGORA);
  repo.marcarFalha(id, "sem papel", "erro");
  const imp = repo.buscarImpressao(id)!;
  assert.equal(imp.status, "erro");
  assert.equal(imp.tentativas, 1);
  assert.equal(imp.ultimo_erro, "sem papel");
  assert.equal(repo.reenfileirarErros(impressoraId), 1);
  assert.equal(repo.buscarImpressao(id)!.status, "fila");
  assert.equal(repo.buscarImpressao(id)!.tentativas, 0);
});

test("travadas: imprimindo há mais tempo que o limite", () => {
  const { repo, filialId, impressoraId } = bancoDeTeste();
  const pedidoId = repo.inserirPedido({ filialId, numero: "1", idBling: 1, situacao: 9, origem: "monitor", agora: AGORA });
  const id = repo.criarImpressao({ pedidoId, impressoraId, via: 1, dados: dadosFolhaExemplo(), motivo: null, usuarioId: null, agora: AGORA });
  repo.pegarProximaDaFila(impressoraId, AGORA);
  assert.deepEqual(repo.listarTravadas(new Date(AGORA.getTime() - 1)).map((i) => i.id), []);
  assert.deepEqual(repo.listarTravadas(new Date(AGORA.getTime() + 1)).map((i) => i.id), [id]);
});

test("alertas: cria e informa se há pendente do tipo", () => {
  const { repo } = bancoDeTeste();
  assert.equal(repo.alertaPendenteDoTipo("bling_desconectado"), false);
  repo.criarAlerta({ tipo: "bling_desconectado", pedidoId: null, mensagem: "x", agora: AGORA });
  assert.equal(repo.alertaPendenteDoTipo("bling_desconectado"), true);
});

test("planilha: enfileirar duas vezes não duplica", () => {
  const { repo, filialId, impressoraId } = bancoDeTeste();
  const pedidoId = repo.inserirPedido({ filialId, numero: "1", idBling: 1, situacao: 9, origem: "monitor", agora: AGORA });
  const id = repo.criarImpressao({ pedidoId, impressoraId, via: 1, dados: dadosFolhaExemplo(), motivo: null, usuarioId: null, agora: AGORA });
  repo.enfileirarPlanilha(id);
  repo.enfileirarPlanilha(id);
  const n = repo.db.prepare("SELECT COUNT(*) AS n FROM fila_planilha").get() as { n: number };
  assert.equal(n.n, 1);
});
```

Run: `npm test`
Expected: FAIL, com "Cannot find module ... repositorio.ts".

- [ ] **Step 8: Implementar o repositório**

`servidor/src/banco/repositorio.ts`:
```ts
import type { DatabaseSync } from "node:sqlite";
import type { DadosFolha } from "../../../compartilhado/tipos.ts";
import { transacao } from "./banco.ts";

export type Situacao = number;
export type StatusImpressao = "fila" | "imprimindo" | "impresso" | "erro";
export type TipoAlerta = "repetido" | "cancelado" | "falha_impressao" | "retomada" | "bling_desconectado";
type Param = string | number | null;

export type PedidoRow = {
  id: number; filial_id: number; numero: string; id_bling: number; situacao: Situacao;
  origem: "baseline" | "monitor"; detectado_em: string;
};
export type ImpressaoRow = {
  id: number; pedido_id: number; impressora_id: number; via: number; tipo_documento: string; dados_json: string;
  status: StatusImpressao; tentativas: number; ultimo_erro: string | null; motivo: string | null;
  usuario_id: number | null; criado_em: string; iniciado_em: string | null; impresso_em: string | null;
};
export type AgenteRow = {
  id: number; nome: string; ultima_comunicacao: string | null; impressora_id: number; impressora_nome: string;
};

export class Repositorio {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  protected um<T>(sql: string, ...p: Param[]): T | null {
    return (this.db.prepare(sql).get(...p) as unknown as T | undefined) ?? null;
  }

  protected todos<T>(sql: string, ...p: Param[]): T[] {
    return this.db.prepare(sql).all(...p) as unknown as T[];
  }

  protected exec(sql: string, ...p: Param[]): { changes: number; id: number } {
    const r = this.db.prepare(sql).run(...p);
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
  }

  // --- estado (chave/valor) ---
  obterEstado(chave: string): string | null {
    return this.um<{ valor: string }>("SELECT valor FROM estado WHERE chave = ?", chave)?.valor ?? null;
  }

  definirEstado(chave: string, valor: string | null): void {
    if (valor === null) {
      this.exec("DELETE FROM estado WHERE chave = ?", chave);
      return;
    }
    this.exec(
      "INSERT INTO estado (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor",
      chave, valor,
    );
  }

  // --- filiais, agentes, impressoras ---
  garantirFilial(codigo: string, nome: string): number {
    this.exec("INSERT INTO filiais (codigo, nome) VALUES (?, ?) ON CONFLICT(codigo) DO UPDATE SET nome = excluded.nome", codigo, nome);
    return this.um<{ id: number }>("SELECT id FROM filiais WHERE codigo = ?", codigo)!.id;
  }

  garantirAgente(filialId: number, a: { nome: string; token: string; impressora: string }): { agenteId: number; impressoraId: number } {
    this.exec("INSERT INTO agentes (nome, token) VALUES (?, ?) ON CONFLICT(nome) DO UPDATE SET token = excluded.token", a.nome, a.token);
    const agenteId = this.um<{ id: number }>("SELECT id FROM agentes WHERE nome = ?", a.nome)!.id;
    this.exec(
      "INSERT INTO impressoras (filial_id, agente_id, nome_windows) VALUES (?, ?, ?) ON CONFLICT(agente_id, nome_windows) DO NOTHING",
      filialId, agenteId, a.impressora,
    );
    const impressoraId = this.um<{ id: number }>(
      "SELECT id FROM impressoras WHERE agente_id = ? AND nome_windows = ?", agenteId, a.impressora,
    )!.id;
    return { agenteId, impressoraId };
  }

  // Se a impressora do agente mudar na config, vale a mais recente.
  buscarAgentePorToken(token: string): AgenteRow | null {
    return this.um<AgenteRow>(
      `SELECT a.id, a.nome, a.ultima_comunicacao, i.id AS impressora_id, i.nome_windows AS impressora_nome
       FROM agentes a JOIN impressoras i ON i.agente_id = a.id
       WHERE a.token = ? ORDER BY i.id DESC LIMIT 1`,
      token,
    );
  }

  registrarComunicacaoAgente(agenteId: number, agora: Date): void {
    this.exec("UPDATE agentes SET ultima_comunicacao = ? WHERE id = ?", agora.toISOString(), agenteId);
  }

  // --- pedidos ---
  buscarPedido(filialId: number, numero: string): PedidoRow | null {
    return this.um<PedidoRow>("SELECT * FROM pedidos WHERE filial_id = ? AND numero = ?", filialId, numero);
  }

  buscarPedidoPorId(id: number): PedidoRow | null {
    return this.um<PedidoRow>("SELECT * FROM pedidos WHERE id = ?", id);
  }

  inserirPedido(p: {
    filialId: number; numero: string; idBling: number; situacao: Situacao; origem: "baseline" | "monitor"; agora: Date;
  }): number {
    return this.exec(
      "INSERT INTO pedidos (filial_id, numero, id_bling, situacao, origem, detectado_em) VALUES (?, ?, ?, ?, ?, ?)",
      p.filialId, p.numero, p.idBling, p.situacao, p.origem, p.agora.toISOString(),
    ).id;
  }

  atualizarSituacao(pedidoId: number, situacao: Situacao): void {
    this.exec("UPDATE pedidos SET situacao = ? WHERE id = ?", situacao, pedidoId);
  }

  // --- impressões ---
  criarImpressao(i: {
    pedidoId: number; impressoraId: number; via: number; dados: DadosFolha;
    motivo: string | null; usuarioId: number | null; agora: Date;
  }): number {
    return this.exec(
      `INSERT INTO impressoes (pedido_id, impressora_id, via, dados_json, status, motivo, usuario_id, criado_em)
       VALUES (?, ?, ?, ?, 'fila', ?, ?, ?)`,
      i.pedidoId, i.impressoraId, i.via, JSON.stringify(i.dados), i.motivo, i.usuarioId, i.agora.toISOString(),
    ).id;
  }

  proximaVia(pedidoId: number): number {
    return this.um<{ v: number }>("SELECT COALESCE(MAX(via), 0) + 1 AS v FROM impressoes WHERE pedido_id = ?", pedidoId)!.v;
  }

  ultimaImpressao(pedidoId: number): ImpressaoRow | null {
    return this.um<ImpressaoRow>("SELECT * FROM impressoes WHERE pedido_id = ? ORDER BY id DESC LIMIT 1", pedidoId);
  }

  buscarImpressao(id: number): ImpressaoRow | null {
    return this.um<ImpressaoRow>("SELECT * FROM impressoes WHERE id = ?", id);
  }

  pegarProximaDaFila(impressoraId: number, agora: Date): ImpressaoRow | null {
    return transacao(this.db, () => {
      const imp = this.um<ImpressaoRow>(
        "SELECT * FROM impressoes WHERE impressora_id = ? AND status = 'fila' ORDER BY id LIMIT 1", impressoraId,
      );
      if (!imp) return null;
      this.exec("UPDATE impressoes SET status = 'imprimindo', iniciado_em = ? WHERE id = ?", agora.toISOString(), imp.id);
      return { ...imp, status: "imprimindo" as const, iniciado_em: agora.toISOString() };
    });
  }

  marcarImpressa(id: number, agora: Date): void {
    this.exec("UPDATE impressoes SET status = 'impresso', impresso_em = ?, ultimo_erro = NULL WHERE id = ?", agora.toISOString(), id);
  }

  marcarFalha(id: number, erro: string, novoStatus: "fila" | "erro"): void {
    this.exec(
      "UPDATE impressoes SET status = ?, tentativas = tentativas + 1, ultimo_erro = ? WHERE id = ?",
      novoStatus, erro, id,
    );
  }

  listarTravadas(iniciadasAntesDe: Date): ImpressaoRow[] {
    return this.todos<ImpressaoRow>(
      "SELECT * FROM impressoes WHERE status = 'imprimindo' AND iniciado_em < ? ORDER BY id", iniciadasAntesDe.toISOString(),
    );
  }

  reenfileirarErros(impressoraId: number): number {
    return this.exec(
      "UPDATE impressoes SET status = 'fila', tentativas = 0 WHERE impressora_id = ? AND status = 'erro'", impressoraId,
    ).changes;
  }

  // --- alertas ---
  criarAlerta(a: { tipo: TipoAlerta; pedidoId: number | null; mensagem: string; agora: Date }): number {
    return this.exec(
      "INSERT INTO alertas (tipo, pedido_id, mensagem, criado_em) VALUES (?, ?, ?, ?)",
      a.tipo, a.pedidoId, a.mensagem, a.agora.toISOString(),
    ).id;
  }

  alertaPendenteDoTipo(tipo: TipoAlerta): boolean {
    return this.um("SELECT 1 AS x FROM alertas WHERE tipo = ? AND resolvido_em IS NULL LIMIT 1", tipo) !== null;
  }

  // --- usuários (só o necessário aqui; o resto na Task 9) ---
  nomeUsuario(id: number | null): string | null {
    if (id === null) return null;
    return this.um<{ nome: string }>("SELECT nome FROM usuarios WHERE id = ?", id)?.nome ?? null;
  }

  // --- planilha ---
  enfileirarPlanilha(impressaoId: number): void {
    this.exec("INSERT OR IGNORE INTO fila_planilha (impressao_id) VALUES (?)", impressaoId);
  }
}
```

- [ ] **Step 9: Rodar testes e typecheck**

Run: `npm test && npm run typecheck`
Expected: todos os testes PASS, typecheck sem erros. (O aviso `ExperimentalWarning: SQLite` do Node é esperado e pode ser ignorado.)

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore compartilhado servidor
git commit -m "feat: base do projeto e camada de dados (SQLite)"
```

---

### Task 2: Cliente da API do Bling

**Files:**
- Create: `servidor/src/bling/cliente.ts`, `servidor/src/bling/armazem.ts`
- Test: `servidor/test/bling-cliente.test.ts`

**Interfaces:**
- Consumes: `Repositorio.obterEstado/definirEstado` (Task 1).
- Produces:
  - `class ClienteBling` com `urlAutorizacao(state: string): string`, `trocarCodigo(code: string): Promise<void>`, `listarPedidosAlterados(desde: Date, ate: Date): Promise<ResumoPedido[]>`, `obterPedido(id: number): Promise<PedidoBling>`, `obterProduto(id: number): Promise<{ gtin: string | null; codigo: string | null }>`, `obterVendedor(id: number): Promise<{ nome: string | null }>`, `obterBruto(caminho: string): Promise<unknown>`, `estaConectado(): boolean`.
  - Tipos `Tokens`, `ArmazemTokens`, `ResumoPedido`, `PedidoBling`; erros `ErroBlingDesconectado`, `ErroBling`; função `formatarDataBling(d: Date): string`.
  - `armazemNoBanco(repo: Repositorio, filialCodigo: string): ArmazemTokens`.

> **Atenção:** os nomes de campos e filtros da API do Bling abaixo (`dataAlteracaoInicial`, `situacao.id`, `transporte.etiqueta`, `gtin`...) são a melhor informação disponível e serão **confirmados na Task 3**. Se a Task 3 mostrar diferenças, ajuste este arquivo e os testes antes de seguir.

- [ ] **Step 1: Escrever os testes (falhando)**

`servidor/test/bling-cliente.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ClienteBling, ErroBlingDesconectado, formatarDataBling, type Tokens } from "../src/bling/cliente.ts";
import { armazemNoBanco } from "../src/bling/armazem.ts";
import { AGORA, bancoDeTeste } from "./ajudantes.ts";

type Resp = { status?: number; json?: unknown };
function fetchFalso(respostas: Array<Resp | ((url: string, init?: RequestInit) => Resp)>) {
  const chamadas: Array<{ url: string; init?: RequestInit }> = [];
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    chamadas.push({ url: u, init });
    const prox = respostas.shift();
    if (!prox) throw new Error(`fetch inesperado: ${u}`);
    const r = typeof prox === "function" ? prox(u, init) : prox;
    return new Response(r.json === undefined ? "" : JSON.stringify(r.json), { status: r.status ?? 200 });
  };
  return { fetch: f as typeof fetch, chamadas };
}

function armazemMemoria(inicial: Tokens | null = null) {
  let t = inicial;
  return { ler: () => t, gravar: (n: Tokens) => { t = n; } };
}

const tokenValido = (): Tokens => ({ accessToken: "A1", refreshToken: "R1", expiraEm: new Date(AGORA.getTime() + 3600_000).toISOString() });

function cliente(f: typeof fetch, armazem = armazemMemoria(tokenValido())) {
  return new ClienteBling({
    clientId: "cid", clientSecret: "seg", armazem, fetch: f, agora: () => AGORA,
    intervaloMinimoMs: 0, esperar: async () => {},
  });
}

test("urlAutorizacao leva client_id e state", () => {
  const u = new URL(cliente(fetchFalso([]).fetch).urlAutorizacao("abc"));
  assert.equal(u.searchParams.get("client_id"), "cid");
  assert.equal(u.searchParams.get("state"), "abc");
  assert.equal(u.searchParams.get("response_type"), "code");
});

test("trocarCodigo usa Basic auth e guarda tokens com validade", async () => {
  const armazem = armazemMemoria();
  const { fetch, chamadas } = fetchFalso([{ json: { access_token: "A", refresh_token: "R", expires_in: 21600 } }]);
  await cliente(fetch, armazem).trocarCodigo("COD");
  const h = chamadas[0].init!.headers as Record<string, string>;
  assert.equal(h.Authorization, `Basic ${Buffer.from("cid:seg").toString("base64")}`);
  assert.match(String(chamadas[0].init!.body), /grant_type=authorization_code/);
  assert.match(String(chamadas[0].init!.body), /code=COD/);
  assert.deepEqual(armazem.ler(), { accessToken: "A", refreshToken: "R", expiraEm: new Date(AGORA.getTime() + 21600_000).toISOString() });
});

test("renova o token quando falta menos de 1 minuto", async () => {
  const armazem = armazemMemoria({ accessToken: "velho", refreshToken: "R1", expiraEm: new Date(AGORA.getTime() + 30_000).toISOString() });
  const { fetch, chamadas } = fetchFalso([
    { json: { access_token: "novo", refresh_token: "R2", expires_in: 21600 } },
    { json: { data: { id: 1, nome: "x" } } },
  ]);
  await cliente(fetch, armazem).obterBruto("/teste");
  assert.match(String(chamadas[0].init!.body), /grant_type=refresh_token/);
  assert.equal((chamadas[1].init!.headers as Record<string, string>).Authorization, "Bearer novo");
});

test("401 renova o token e repete a chamada uma vez", async () => {
  const { fetch, chamadas } = fetchFalso([
    { status: 401, json: {} },
    { json: { access_token: "A2", refresh_token: "R2", expires_in: 21600 } },
    { json: { data: [] } },
  ]);
  await cliente(fetch).obterBruto("/teste");
  assert.equal(chamadas.length, 3);
});

test("refresh recusado vira ErroBlingDesconectado", async () => {
  const { fetch } = fetchFalso([{ status: 401, json: {} }, { status: 400, json: { error: "invalid_grant" } }]);
  await assert.rejects(cliente(fetch).obterBruto("/teste"), ErroBlingDesconectado);
});

test("sem tokens = desconectado", async () => {
  const c = cliente(fetchFalso([]).fetch, armazemMemoria(null));
  assert.equal(c.estaConectado(), false);
  await assert.rejects(c.obterBruto("/teste"), ErroBlingDesconectado);
});

test("listarPedidosAlterados percorre todas as páginas", async () => {
  const pagina = (n: number, ini: number) => Array.from({ length: n }, (_, i) => ({ id: ini + i, numero: ini + i, numeroLoja: "", situacao: { id: 9 } }));
  const { fetch, chamadas } = fetchFalso([{ json: { data: pagina(100, 1) } }, { json: { data: pagina(30, 101) } }]);
  const lista = await cliente(fetch).listarPedidosAlterados(new Date("2026-10-08T17:00:00Z"), AGORA);
  assert.equal(lista.length, 130);
  assert.deepEqual(lista[0], { id: 1, numero: "1", numeroLoja: null, situacaoId: 9 });
  assert.match(chamadas[0].url, /pagina=1/);
  assert.match(chamadas[1].url, /pagina=2/);
  assert.match(decodeURIComponent(chamadas[0].url.replace(/\+/g, " ")), /dataAlteracaoInicial=2026-10-08 14:00:00/);
});

test("formatarDataBling usa horário de São Paulo", () => {
  assert.equal(formatarDataBling(AGORA), "2026-10-08 14:32:00");
});

test("obterPedido normaliza campos ausentes", async () => {
  const { fetch } = fetchFalso([{ json: { data: {
    id: 77, numero: 12345, numeroLoja: "", data: "2026-10-08",
    contato: { nome: "Clínica X", numeroDocumento: "" },
    vendedor: { id: 0 },
    itens: [{ codigo: "AH-1", descricao: "Ácido", quantidade: "1.5", produto: { id: 5 } }],
    transporte: { volumes: [{ servico: "SEDEX" }], etiqueta: { endereco: "Rua A", numero: "10", municipio: "Vitória", uf: "ES", cep: "29000-000" } },
    observacoes: "",
  } } }]);
  const p = await cliente(fetch).obterPedido(77);
  assert.equal(p.numero, "12345");
  assert.equal(p.numeroLoja, null);
  assert.equal(p.vendedorId, null);
  assert.equal(p.contato.numeroDocumento, null);
  assert.deepEqual(p.itens[0], { codigo: "AH-1", descricao: "Ácido", quantidade: 1.5, produtoId: 5 });
  assert.equal(p.transporte, "SEDEX");
  assert.equal(p.etiqueta?.municipio, "Vitória");
  assert.equal(p.etiqueta?.complemento, null);
  assert.equal(p.observacoes, null);
});

test("armazemNoBanco guarda tokens por filial", () => {
  const { repo } = bancoDeTeste();
  const a = armazemNoBanco(repo, "ES");
  assert.equal(a.ler(), null);
  a.gravar(tokenValido());
  assert.deepEqual(armazemNoBanco(repo, "ES").ler(), tokenValido());
  assert.equal(armazemNoBanco(repo, "SP").ler(), null);
});
```

Run: `npm test`
Expected: FAIL, com "Cannot find module ... cliente.ts".

- [ ] **Step 2: Implementar o cliente**

`servidor/src/bling/cliente.ts`:
```ts
import { FUSO } from "../tempo.ts";

export const BLING_API = "https://api.bling.com.br/Api/v3";
export const BLING_AUTORIZAR = "https://www.bling.com.br/Api/v3/oauth/authorize";

export type Tokens = { accessToken: string; refreshToken: string; expiraEm: string };
export type ArmazemTokens = { ler(): Tokens | null; gravar(t: Tokens): void };
export type ResumoPedido = { id: number; numero: string; numeroLoja: string | null; situacaoId: number };
export type PedidoBling = {
  id: number;
  numero: string;
  numeroLoja: string | null;
  data: string;
  contato: { nome: string; numeroDocumento: string | null };
  vendedorId: number | null;
  itens: Array<{ codigo: string | null; descricao: string; quantidade: number; produtoId: number | null }>;
  etiqueta: {
    endereco: string | null; numero: string | null; complemento: string | null; bairro: string | null;
    municipio: string | null; uf: string | null; cep: string | null;
  } | null;
  transporte: string | null;
  observacoes: string | null;
};

export class ErroBlingDesconectado extends Error {}

export class ErroBling extends Error {
  status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

type OpcoesCliente = {
  clientId: string;
  clientSecret: string;
  armazem: ArmazemTokens;
  fetch?: typeof fetch;
  agora?: () => Date;
  intervaloMinimoMs?: number; // o Bling aceita ~3 requisições/s
  esperar?: (ms: number) => Promise<void>;
};

const fmtBling = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export function formatarDataBling(d: Date): string {
  const partes = fmtBling.formatToParts(d);
  const v = (t: string) => partes.find((x) => x.type === t)!.value;
  return `${v("year")}-${v("month")}-${v("day")} ${v("hour")}:${v("minute")}:${v("second")}`;
}

const ouNulo = (v: unknown): string | null => (v === undefined || v === null || v === "" ? null : String(v));

export class ClienteBling {
  #o: Required<OpcoesCliente>;
  #ultimaChamada = 0;

  constructor(o: OpcoesCliente) {
    this.#o = {
      fetch: globalThis.fetch.bind(globalThis),
      agora: () => new Date(),
      intervaloMinimoMs: 350,
      esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
      ...o,
    };
  }

  estaConectado(): boolean {
    return this.#o.armazem.ler() !== null;
  }

  urlAutorizacao(state: string): string {
    const u = new URL(BLING_AUTORIZAR);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", this.#o.clientId);
    u.searchParams.set("state", state);
    return u.toString();
  }

  async trocarCodigo(code: string): Promise<void> {
    await this.#pedirToken({ grant_type: "authorization_code", code });
  }

  async listarPedidosAlterados(desde: Date, ate: Date): Promise<ResumoPedido[]> {
    const todos: ResumoPedido[] = [];
    for (let pagina = 1; ; pagina++) {
      const q = new URLSearchParams({
        pagina: String(pagina),
        limite: "100",
        dataAlteracaoInicial: formatarDataBling(desde),
        dataAlteracaoFinal: formatarDataBling(ate),
      });
      const j = (await this.#get(`/pedidos/vendas?${q}`)) as { data?: any[] };
      const data = j.data ?? [];
      for (const p of data) {
        todos.push({ id: Number(p.id), numero: String(p.numero), numeroLoja: ouNulo(p.numeroLoja), situacaoId: Number(p.situacao?.id) });
      }
      if (data.length < 100) return todos;
    }
  }

  async obterPedido(id: number): Promise<PedidoBling> {
    const d = ((await this.#get(`/pedidos/vendas/${id}`)) as { data: any }).data;
    const et = d.transporte?.etiqueta;
    return {
      id: Number(d.id),
      numero: String(d.numero),
      numeroLoja: ouNulo(d.numeroLoja),
      data: String(d.data ?? ""),
      contato: { nome: ouNulo(d.contato?.nome) ?? "—", numeroDocumento: ouNulo(d.contato?.numeroDocumento) },
      vendedorId: d.vendedor?.id ? Number(d.vendedor.id) : null,
      itens: (d.itens ?? []).map((i: any) => ({
        codigo: ouNulo(i.codigo),
        descricao: String(i.descricao ?? ""),
        quantidade: Number(i.quantidade),
        produtoId: i.produto?.id ? Number(i.produto.id) : null,
      })),
      etiqueta: et
        ? {
            endereco: ouNulo(et.endereco), numero: ouNulo(et.numero), complemento: ouNulo(et.complemento),
            bairro: ouNulo(et.bairro), municipio: ouNulo(et.municipio), uf: ouNulo(et.uf), cep: ouNulo(et.cep),
          }
        : null,
      transporte: ouNulo(d.transporte?.volumes?.[0]?.servico) ?? ouNulo(d.transporte?.contato?.nome),
      observacoes: ouNulo(d.observacoes),
    };
  }

  async obterProduto(id: number): Promise<{ gtin: string | null; codigo: string | null }> {
    const d = ((await this.#get(`/produtos/${id}`)) as { data: any }).data;
    return { gtin: ouNulo(d.gtin), codigo: ouNulo(d.codigo) };
  }

  async obterVendedor(id: number): Promise<{ nome: string | null }> {
    const d = ((await this.#get(`/vendedores/${id}`)) as { data: any }).data;
    return { nome: ouNulo(d.contato?.nome) };
  }

  // Usado pela ferramenta de exploração (Task 3).
  obterBruto(caminho: string): Promise<unknown> {
    return this.#get(caminho);
  }

  async #pedirToken(corpo: Record<string, string>): Promise<void> {
    const basic = Buffer.from(`${this.#o.clientId}:${this.#o.clientSecret}`).toString("base64");
    const r = await this.#o.fetch(`${BLING_API}/oauth/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "1.0" },
      body: new URLSearchParams(corpo).toString(),
    });
    if (!r.ok) {
      const texto = await r.text();
      if (r.status === 400 || r.status === 401) throw new ErroBlingDesconectado(`O Bling recusou o acesso (${r.status}): ${texto}`);
      throw new ErroBling(r.status, `Erro ao obter token do Bling (${r.status}): ${texto}`);
    }
    const j = (await r.json()) as { access_token: string; refresh_token: string; expires_in: number };
    this.#o.armazem.gravar({
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      expiraEm: new Date(this.#o.agora().getTime() + j.expires_in * 1000).toISOString(),
    });
  }

  async #tokenValido(): Promise<string> {
    const t = this.#o.armazem.ler();
    if (!t) throw new ErroBlingDesconectado("O Bling ainda não foi conectado.");
    if (new Date(t.expiraEm).getTime() - this.#o.agora().getTime() < 60_000) {
      await this.#pedirToken({ grant_type: "refresh_token", refresh_token: t.refreshToken });
      return this.#o.armazem.ler()!.accessToken;
    }
    return t.accessToken;
  }

  async #get(caminho: string, tentativa = 0): Promise<unknown> {
    const espera = this.#ultimaChamada + this.#o.intervaloMinimoMs - Date.now();
    if (espera > 0) await this.#o.esperar(espera);
    this.#ultimaChamada = Date.now();

    const token = await this.#tokenValido();
    const r = await this.#o.fetch(`${BLING_API}${caminho}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (r.status === 401 && tentativa === 0) {
      await this.#pedirToken({ grant_type: "refresh_token", refresh_token: this.#o.armazem.ler()!.refreshToken });
      return this.#get(caminho, 1);
    }
    if (r.status === 429 && tentativa < 3) {
      await this.#o.esperar(1000);
      return this.#get(caminho, tentativa + 1);
    }
    if (!r.ok) throw new ErroBling(r.status, `Bling ${caminho} respondeu ${r.status}: ${await r.text()}`);
    return r.json();
  }
}
```

`servidor/src/bling/armazem.ts`:
```ts
import type { Repositorio } from "../banco/repositorio.ts";
import type { ArmazemTokens, Tokens } from "./cliente.ts";

export function armazemNoBanco(repo: Repositorio, filialCodigo: string): ArmazemTokens {
  const chave = `bling:tokens:${filialCodigo}`;
  return {
    ler: () => {
      const s = repo.obterEstado(chave);
      return s ? (JSON.parse(s) as Tokens) : null;
    },
    gravar: (t) => repo.definirEstado(chave, JSON.stringify(t)),
  };
}
```

- [ ] **Step 3: Rodar testes e typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add servidor
git commit -m "feat: cliente da API v3 do Bling com OAuth, renovação e paginação"
```

---

### Task 3: Configuração, ferramenta de exploração e VERIFICAÇÃO com o Bling real

Esta task termina num **ponto de parada obrigatório**. Os resultados precisam ser apresentados ao usuário antes de começar a Task 4.

**Files:**
- Create: `servidor/src/config.ts`, `servidor/config.exemplo.json`
- Create: `servidor/src/folha/codigo-barras.ts`
- Create: `servidor/src/cli/explorar-bling.ts`
- Create: `docs/verificacao-bling.md` (resultado da verificação)
- Test: `servidor/test/config.test.ts`, `servidor/test/codigo-barras.test.ts`

**Interfaces:**
- Consumes: `ClienteBling`, `armazemNoBanco` (Task 2), `abrirBanco`, `Repositorio` (Task 1).
- Produces:
  - `type Config` e `carregarConfig(arquivo: string): Config`. Os caminhos relativos (`arquivoBanco`, `google.arquivoCredenciais`) são resolvidos a partir da raiz do projeto. Também exporta `RAIZ: string`.
  - `codigoBarrasDataUri(texto: string): Promise<string>` (PNG Code 128 em data URI).

- [ ] **Step 1: Escrever os testes (falhando)**

`servidor/test/config.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { carregarConfig } from "../src/config.ts";

function gravar(obj: unknown): string {
  const arq = join(mkdtempSync(join(tmpdir(), "cfg-")), "config.json");
  writeFileSync(arq, JSON.stringify(obj));
  return arq;
}

const valida = {
  porta: 3010, urlPublica: "http://localhost:3010", segredoSessao: "s", arquivoBanco: "dados/x.db",
  chromePath: "C:/chrome.exe", filial: { codigo: "ES", nome: "Espírito Santo" },
  bling: { clientId: "a", clientSecret: "b", intervaloSegundos: 30, margemMinutos: 5, situacaoAtendido: 9, situacaoCancelado: 12, campoCodigoBarras: "numero" },
  agentes: [{ nome: "expedicao-es", token: "t", impressora: "HP" }],
  google: null,
};

test("carrega config válida e resolve caminho do banco", () => {
  const c = carregarConfig(gravar(valida));
  assert.equal(c.porta, 3010);
  assert.ok(isAbsolute(c.arquivoBanco));
});

test("aponta os campos que faltam", () => {
  assert.throws(
    () => carregarConfig(gravar({ ...valida, segredoSessao: "", bling: { ...valida.bling, clientId: "" } })),
    /segredoSessao.*bling\.clientId/,
  );
});

test("campoCodigoBarras inválido é recusado", () => {
  assert.throws(() => carregarConfig(gravar({ ...valida, bling: { ...valida.bling, campoCodigoBarras: "x" } })), /campoCodigoBarras/);
});
```

`servidor/test/codigo-barras.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { codigoBarrasDataUri } from "../src/folha/codigo-barras.ts";

test("gera PNG em data URI", async () => {
  const uri = await codigoBarrasDataUri("12345");
  assert.match(uri, /^data:image\/png;base64,/);
  const png = Buffer.from(uri.split(",")[1], "base64");
  assert.equal(png.subarray(1, 4).toString(), "PNG");
});
```

Run: `npm test`
Expected: FAIL, com módulos não encontrados.

- [ ] **Step 2: Implementar config e código de barras**

`servidor/src/config.ts`:
```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const RAIZ = fileURLToPath(new URL("../../", import.meta.url));

export type CampoCodigoBarras = "numero" | "numeroLoja" | "id";

export type Config = {
  porta: number;
  urlPublica: string;
  segredoSessao: string;
  arquivoBanco: string;
  chromePath: string;
  filial: { codigo: string; nome: string };
  bling: {
    clientId: string;
    clientSecret: string;
    intervaloSegundos: number;
    margemMinutos: number;
    situacaoAtendido: number;
    situacaoCancelado: number;
    campoCodigoBarras: CampoCodigoBarras;
  };
  agentes: Array<{ nome: string; token: string; impressora: string }>;
  google: null | { arquivoCredenciais: string; planilhaId: string; aba: string };
};

export function carregarConfig(arquivo: string): Config {
  const c = JSON.parse(readFileSync(arquivo, "utf8")) as Config;
  const faltando: string[] = [];
  for (const k of ["porta", "urlPublica", "segredoSessao", "arquivoBanco", "chromePath"] as const) {
    if (c[k] === undefined || c[k] === "") faltando.push(k);
  }
  if (!c.filial?.codigo) faltando.push("filial.codigo");
  if (!c.bling?.clientId) faltando.push("bling.clientId");
  if (!c.bling?.clientSecret) faltando.push("bling.clientSecret");
  if (!Array.isArray(c.agentes) || c.agentes.length === 0) faltando.push("agentes");
  if (faltando.length) throw new Error(`config.json incompleto: ${faltando.join(", ")}`);
  if (!["numero", "numeroLoja", "id"].includes(c.bling.campoCodigoBarras)) {
    throw new Error(`config.json: bling.campoCodigoBarras deve ser "numero", "numeroLoja" ou "id"`);
  }
  c.arquivoBanco = c.arquivoBanco === ":memory:" ? c.arquivoBanco : resolve(RAIZ, c.arquivoBanco);
  if (c.google) c.google.arquivoCredenciais = resolve(RAIZ, c.google.arquivoCredenciais);
  return c;
}
```

`servidor/src/folha/codigo-barras.ts`:
```ts
import bwipjs from "bwip-js";

export async function codigoBarrasDataUri(texto: string): Promise<string> {
  const png = await bwipjs.toBuffer({
    bcid: "code128", text: texto, scale: 2, height: 10, includetext: true, textxalign: "center",
  });
  return `data:image/png;base64,${png.toString("base64")}`;
}
```

`servidor/config.exemplo.json`:
```json
{
  "porta": 3010,
  "urlPublica": "http://localhost:3010",
  "segredoSessao": "TROQUE-por-um-texto-aleatorio-com-40-caracteres-ou-mais",
  "arquivoBanco": "dados/expedicao.db",
  "chromePath": "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "filial": { "codigo": "ES", "nome": "Espírito Santo" },
  "bling": {
    "clientId": "",
    "clientSecret": "",
    "intervaloSegundos": 30,
    "margemMinutos": 5,
    "situacaoAtendido": 9,
    "situacaoCancelado": 12,
    "campoCodigoBarras": "numero"
  },
  "agentes": [
    { "nome": "expedicao-es", "token": "TROQUE-por-um-token-aleatorio", "impressora": "NOME EXATO DA IMPRESSORA NO WINDOWS" }
  ],
  "google": null
}
```

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Criar a ferramenta de exploração**

`servidor/src/cli/explorar-bling.ts`:
```ts
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
import { codigoBarrasDataUri } from "../folha/codigo-barras.ts";

const config = carregarConfig(process.argv[2] ?? join(RAIZ, "servidor/config.json"));
mkdirSync(join(RAIZ, "dados"), { recursive: true });
const repo = new Repositorio(abrirBanco(config.arquivoBanco));
const bling = new ClienteBling({
  clientId: config.bling.clientId, clientSecret: config.bling.clientSecret,
  armazem: armazemNoBanco(repo, config.filial.codigo),
});
const saida = join(RAIZ, "dados", "exploracao");
mkdirSync(saida, { recursive: true });
const salvar = (nome: string, dado: unknown) => writeFileSync(join(saida, nome), JSON.stringify(dado, null, 2));

async function conectar(): Promise<void> {
  if (bling.estaConectado()) return;
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
    }).listen(porta);
    console.log(`\nAbra no navegador (logado no Bling ES):\n\n  ${bling.urlAutorizacao(state)}\n`);
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
salvar("2-lista-bruta-pagina1.json", await bling.obterBruto("/pedidos/vendas?pagina=1&limite=20"));

// 3) Nomes das situações do módulo de vendas
salvar("3-situacoes-modulos.json", await bling.obterBruto("/situacoes/modulos"));

// 4) Detalhe bruto de até 3 pedidos + produto e vendedor do primeiro
const amostra = lista.slice(0, 3);
for (const p of amostra) salvar(`4-pedido-${p.numero}.json`, await bling.obterBruto(`/pedidos/vendas/${p.id}`));
if (amostra[0]) {
  const det = await bling.obterPedido(amostra[0].id);
  salvar("5-pedido-normalizado.json", det);
  const prod = det.itens.find((i) => i.produtoId)?.produtoId;
  if (prod) salvar("6-produto.json", await bling.obterBruto(`/produtos/${prod}`));
  if (det.vendedorId) salvar("7-vendedor.json", await bling.obterBruto(`/vendedores/${det.vendedorId}`));

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
```

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add servidor
git commit -m "feat: config, código de barras e ferramenta de exploração do Bling"
```

- [ ] **Step 5: Executar a verificação com o usuário (MANUAL, com o usuário)**

1. Peça ao usuário para criar o aplicativo no Bling ES: Bling → **Central de Extensões / Área do Integrador → Criar aplicativo**. Escopos: **Pedidos de Venda** (leitura), **Produtos** (leitura), **Vendedores** (leitura), **Situações** (leitura). URL de redirecionamento: `http://localhost:3010/bling/callback`. Ele deve informar `client_id` e `client_secret`.
2. Copie `servidor/config.exemplo.json` para `servidor/config.json` e preencha `clientId` e `clientSecret`.
3. Run: `npm run explorar-bling -- servidor/config.json` e peça ao usuário para abrir o link impresso no terminal.
4. Confira em `dados/exploracao/`:
   - **Situação Atendido:** em `3-situacoes-modulos.json` (ou nos pedidos), qual é o `id` de "Atendido" e de "Cancelado"? Anote e ajuste `situacaoAtendido`/`situacaoCancelado` no config.
   - **Filtro de alteração:** `1-lista-alterados-2-dias.json` traz só pedidos alterados no período? Para conferir, peça ao usuário para mudar um pedido de teste para Atendido e rode de novo: ele precisa aparecer com o novo id de situação. Se o filtro `dataAlteracaoInicial` for ignorado (a lista vier igual à `2-lista-bruta`), **PARE** e leve a decisão ao usuário.
   - **Campos:** compare `4-pedido-*.json` com `5-pedido-normalizado.json` (endereço, transporte, itens, vendedor) e `6-produto.json` (onde está o EAN/`gtin`). Corrija o mapeamento em `cliente.ts` e o teste "obterPedido normaliza campos ausentes" se algum caminho for diferente.
5. **Código de barras do checkout:** imprima `dados/exploracao/codigos-de-barras.html` e peça ao usuário para bipar cada código na tela de **separação/checkout do Bling**. Anote qual código abre o pedido e coloque em `bling.campoCodigoBarras`. Se nenhum funcionar, **PARE** e leve ao usuário.
6. Registre tudo em `docs/verificacao-bling.md`: ids de situação, se o filtro de alteração funciona, campo do código de barras e correções feitas no mapeamento. Sem tokens nem segredos.

- [ ] **Step 6: Commit da verificação**

```bash
git add docs/verificacao-bling.md servidor
git commit -m "docs: resultado da verificação com o Bling ES"
```

**PONTO DE PARADA:** apresente o resumo de `docs/verificacao-bling.md` ao usuário e só siga para a Task 4 com o OK dele.

---

### Task 4: Montador dos dados da folha

**Files:**
- Create: `servidor/src/bling/montar-folha.ts`
- Test: `servidor/test/montar-folha.test.ts`

**Interfaces:**
- Consumes: `ClienteBling.obterPedido/obterProduto/obterVendedor`, `PedidoBling` (Task 2); `CampoCodigoBarras` (Task 3); `DadosFolha` (Task 1).
- Produces: `type MontarFolha = (idBling: number, atendidoEm: Date) => Promise<DadosFolha>`; `type FonteBling`; `criarMontadorFolha(bling: FonteBling, opts: { filialNome: string; campoCodigoBarras: CampoCodigoBarras }): MontarFolha`.

- [ ] **Step 1: Escrever os testes (falhando)**

`servidor/test/montar-folha.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarMontadorFolha, type FonteBling } from "../src/bling/montar-folha.ts";
import type { PedidoBling } from "../src/bling/cliente.ts";
import { AGORA } from "./ajudantes.ts";

const pedido = (extra: Partial<PedidoBling> = {}): PedidoBling => ({
  id: 77, numero: "12345", numeroLoja: "MP-999", data: "2026-10-08",
  contato: { nome: "Clínica X", numeroDocumento: "123" }, vendedorId: 3,
  itens: [
    { codigo: "ZZ-9", descricao: "Cânula", quantidade: 10, produtoId: 2 },
    { codigo: "AH-1", descricao: "Ácido", quantidade: 3, produtoId: 1 },
    { codigo: null, descricao: "Brinde", quantidade: 1, produtoId: null },
  ],
  etiqueta: { endereco: "Rua A", numero: "10", complemento: "Sala 2", bairro: "Centro", municipio: "Vitória", uf: "ES", cep: "29000-000" },
  transporte: "SEDEX", observacoes: "Frágil", ...extra,
});

function fonte(p: PedidoBling) {
  const chamadas = { vendedor: 0, produto: 0 };
  const f: FonteBling = {
    obterPedido: async () => p,
    obterProduto: async (id) => { chamadas.produto++; return { gtin: id === 1 ? "7891111111111" : null, codigo: null }; },
    obterVendedor: async () => { chamadas.vendedor++; return { nome: "Fulano" }; },
  };
  return { f, chamadas };
}

test("monta a folha com cliente, entrega, vendedor e EAN", async () => {
  const { f } = fonte(pedido());
  const d = await criarMontadorFolha(f, { filialNome: "Espírito Santo", campoCodigoBarras: "numero" })(77, AGORA);
  assert.equal(d.filial, "Espírito Santo");
  assert.equal(d.pedido.numero, "12345");
  assert.equal(d.pedido.codigoBarras, "12345");
  assert.equal(d.pedido.vendedor, "Fulano");
  assert.equal(d.pedido.atendidoEm, AGORA.toISOString());
  assert.deepEqual(d.entrega, { endereco: "Rua A, 10 — Sala 2 — Centro", cidadeUf: "Vitória/ES", cep: "29000-000" });
  assert.equal(d.transporte, "SEDEX");
});

test("itens ordenados por SKU, sem SKU por último, EAN do cadastro do produto", async () => {
  const { f } = fonte(pedido());
  const d = await criarMontadorFolha(f, { filialNome: "ES", campoCodigoBarras: "numero" })(77, AGORA);
  assert.deepEqual(d.itens.map((i) => i.sku), ["AH-1", "ZZ-9", null]);
  assert.equal(d.itens[0].ean, "7891111111111");
  assert.equal(d.itens[1].ean, null);
  assert.equal(d.itens[2].ean, null);
});

test("campo do código de barras configurável", async () => {
  const { f } = fonte(pedido());
  const porLoja = await criarMontadorFolha(f, { filialNome: "ES", campoCodigoBarras: "numeroLoja" })(77, AGORA);
  assert.equal(porLoja.pedido.codigoBarras, "MP-999");
  const porId = await criarMontadorFolha(f, { filialNome: "ES", campoCodigoBarras: "id" })(77, AGORA);
  assert.equal(porId.pedido.codigoBarras, "77");
  const { f: semLoja } = fonte(pedido({ numeroLoja: null }));
  assert.equal((await criarMontadorFolha(semLoja, { filialNome: "ES", campoCodigoBarras: "numeroLoja" })(77, AGORA)).pedido.codigoBarras, "12345");
});

test("vendedor fica em cache entre pedidos; sem etiqueta vira campos nulos", async () => {
  const { f, chamadas } = fonte(pedido({ etiqueta: null }));
  const montar = criarMontadorFolha(f, { filialNome: "ES", campoCodigoBarras: "numero" });
  const d = await montar(77, AGORA);
  await montar(77, AGORA);
  assert.equal(chamadas.vendedor, 1);
  assert.deepEqual(d.entrega, { endereco: null, cidadeUf: null, cep: null });
});
```

Run: `npm test`
Expected: FAIL, com "Cannot find module ... montar-folha.ts".

- [ ] **Step 2: Implementar**

`servidor/src/bling/montar-folha.ts`:
```ts
import type { DadosFolha } from "../../../compartilhado/tipos.ts";
import type { CampoCodigoBarras } from "../config.ts";
import type { ClienteBling, PedidoBling } from "./cliente.ts";

export type FonteBling = Pick<ClienteBling, "obterPedido" | "obterProduto" | "obterVendedor">;
export type MontarFolha = (idBling: number, atendidoEm: Date) => Promise<DadosFolha>;

export function criarMontadorFolha(
  bling: FonteBling,
  opts: { filialNome: string; campoCodigoBarras: CampoCodigoBarras },
): MontarFolha {
  const vendedores = new Map<number, string | null>();

  return async (idBling, atendidoEm) => {
    const p = await bling.obterPedido(idBling);

    let vendedor: string | null = null;
    if (p.vendedorId) {
      if (!vendedores.has(p.vendedorId)) vendedores.set(p.vendedorId, (await bling.obterVendedor(p.vendedorId)).nome);
      vendedor = vendedores.get(p.vendedorId) ?? null;
    }

    // EAN muda raramente, mas é buscado a cada pedido para nunca imprimir um EAN velho.
    const gtins = new Map<number, string | null>();
    for (const i of p.itens) {
      if (i.produtoId && !gtins.has(i.produtoId)) gtins.set(i.produtoId, (await bling.obterProduto(i.produtoId)).gtin);
    }

    const itens = p.itens
      .map((i) => ({
        quantidade: i.quantidade,
        sku: i.codigo,
        descricao: i.descricao,
        ean: i.produtoId ? gtins.get(i.produtoId) ?? null : null,
      }))
      .sort((a, b) => (a.sku ?? "\uffff").localeCompare(b.sku ?? "\uffff", "pt-BR", { numeric: true }));

    return {
      filial: opts.filialNome,
      pedido: {
        numero: p.numero,
        numeroLoja: p.numeroLoja,
        idBling: p.id,
        data: p.data,
        atendidoEm: atendidoEm.toISOString(),
        vendedor,
        observacoes: p.observacoes,
        codigoBarras: codigoDoPedido(p, opts.campoCodigoBarras),
      },
      cliente: { nome: p.contato.nome, documento: p.contato.numeroDocumento },
      entrega: montarEntrega(p),
      transporte: p.transporte,
      itens,
    };
  };
}

function codigoDoPedido(p: PedidoBling, campo: CampoCodigoBarras): string {
  if (campo === "numeroLoja") return p.numeroLoja ?? p.numero;
  if (campo === "id") return String(p.id);
  return p.numero;
}

function montarEntrega(p: PedidoBling): DadosFolha["entrega"] {
  const e = p.etiqueta;
  if (!e) return { endereco: null, cidadeUf: null, cep: null };
  const rua = [e.endereco, e.numero].filter(Boolean).join(", ");
  const endereco = [rua, e.complemento, e.bairro].filter(Boolean).join(" — ") || null;
  const cidadeUf = [e.municipio, e.uf].filter(Boolean).join("/") || null;
  return { endereco, cidadeUf, cep: e.cep };
}
```

- [ ] **Step 3: Rodar testes e typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add servidor
git commit -m "feat: montador dos dados da folha a partir do Bling"
```

---

### Task 5: Folha de separação (HTML e PDF A4)

**Files:**
- Create: `servidor/src/html-util.ts`
- Create: `servidor/src/folha/html.ts`, `servidor/src/folha/pdf.ts`
- Test: `servidor/test/folha-html.test.ts`, `servidor/test/folha-pdf.test.ts`

**Interfaces:**
- Consumes: `DadosFolha`, `Via` (Task 1); `codigoBarrasDataUri` (Task 3); `formatarDataHora`, `formatarHora` (Task 1).
- Produces:
  - `escaparHtml(s: string | number | null | undefined): string` (retorna `""` para nulo).
  - `renderizarFolha(d: DadosFolha, via: Via, codigos: CodigosFolha): { corpo: string; cabecalho: string; rodape: string }`; `type CodigosFolha = { pedido: string; porSku: Map<string, string> }`; `formatarQuantidade(q: number): string`; `rotuloVia(n: number): string`.
  - `class GeradorPdf { constructor(chromePath: string); gerar(dados: DadosFolha, via: Via): Promise<Buffer>; fechar(): Promise<void> }`.

- [ ] **Step 1: Escrever os testes do HTML (falhando)**

`servidor/test/folha-html.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatarQuantidade, renderizarFolha, rotuloVia, type CodigosFolha } from "../src/folha/html.ts";
import { dadosFolhaExemplo } from "./ajudantes.ts";

const codigos = (porSku: Record<string, string> = {}): CodigosFolha => ({ pedido: "data:image/png;base64,PEDIDO", porSku: new Map(Object.entries(porSku)) });
const via1 = { numero: 1, motivo: null, usuario: null, em: null };

test("descrição com caracteres especiais aparece escapada", () => {
  const d = dadosFolhaExemplo(1);
  d.itens[0].descricao = `Seringa <1ml> & "Luer"`;
  const { corpo } = renderizarFolha(d, via1, codigos());
  assert.ok(corpo.includes("Seringa &lt;1ml&gt; &amp; &quot;Luer&quot;"));
  assert.ok(!corpo.includes("<1ml>"));
});

test("quantidade fracionada no formato brasileiro", () => {
  assert.equal(formatarQuantidade(1.5), "1,5");
  assert.equal(formatarQuantidade(10), "10");
});

test("item sem EAN usa código de barras do SKU; sem EAN e sem SKU mostra —", () => {
  const d = dadosFolhaExemplo(2);
  d.itens[0].ean = null;
  d.itens[1].ean = null;
  d.itens[1].sku = null;
  const { corpo } = renderizarFolha(d, via1, codigos({ "SKU-001": "data:image/png;base64,SKU1" }));
  assert.ok(corpo.includes(`src="data:image/png;base64,SKU1"`));
  assert.match(corpo, /<td class="sku">—<\/td>/);
});

test("1ª via sem bloco de reimpressão; cabeçalho com pedido, código e via", () => {
  const { corpo, cabecalho, rodape } = renderizarFolha(dadosFolhaExemplo(), via1, codigos());
  assert.ok(!corpo.includes("REIMPRESSÃO"));
  assert.ok(cabecalho.includes("12345"));
  assert.ok(cabecalho.includes("data:image/png;base64,PEDIDO"));
  assert.ok(cabecalho.includes("1ª via"));
  assert.ok(rodape.includes(`class="pageNumber"`));
  assert.ok(rodape.includes(`class="totalPages"`));
});

test("reimpressão mostra via, motivo, nome e horário", () => {
  const via = { numero: 2, motivo: "Folha perdida", usuario: "Maria", em: "2026-10-08T18:00:00.000Z" };
  const { corpo, cabecalho } = renderizarFolha(dadosFolhaExemplo(), via, codigos());
  assert.equal(rotuloVia(2), "2ª via");
  assert.ok(cabecalho.includes("2ª via"));
  assert.ok(corpo.includes("REIMPRESSÃO"));
  assert.ok(corpo.includes("Folha perdida"));
  assert.ok(corpo.includes("Maria"));
  assert.ok(corpo.includes("08/10/2026 15:00"));
});

test("campos vazios aparecem como —", () => {
  const d = dadosFolhaExemplo();
  d.cliente.documento = null;
  d.transporte = null;
  d.pedido.vendedor = null;
  const { corpo } = renderizarFolha(d, via1, codigos());
  assert.ok(corpo.includes("Transporte:</b> —"));
  assert.ok(corpo.includes("Vendedor:</b> —"));
});
```

Run: `npm test`
Expected: FAIL, com "Cannot find module ... html.ts".

- [ ] **Step 2: Implementar `html-util.ts` e `folha/html.ts`**

`servidor/src/html-util.ts`:
```ts
const MAPA: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escaparHtml(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, (c) => MAPA[c]);
}
```

`servidor/src/folha/html.ts`:
```ts
import type { DadosFolha, Via } from "../../../compartilhado/tipos.ts";
import { escaparHtml } from "../html-util.ts";
import { formatarDataHora, formatarHora } from "../tempo.ts";

export type CodigosFolha = { pedido: string; porSku: Map<string, string> };

const campo = (s: string | number | null | undefined) => (s === null || s === undefined || s === "" ? "—" : escaparHtml(s));

export function formatarQuantidade(q: number): string {
  return q.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

export function rotuloVia(n: number): string {
  return `${n}ª via`;
}

const ESTILO = `
@page { size: A4; }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #000; margin: 0; }
.bloco { border: 1px solid #000; padding: 2mm 3mm; margin-bottom: 2mm; }
.linha { display: flex; justify-content: space-between; gap: 4mm; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
th, td { border: 1px solid #000; padding: 1mm 1.5mm; text-align: left; vertical-align: middle; }
th { background: #e6e6e6; font-size: 8pt; }
tr { page-break-inside: avoid; }
td.check { width: 6mm; text-align: center; font-size: 11pt; }
td.qtd { width: 13mm; text-align: center; font-weight: bold; font-size: 11pt; }
td.sku { width: 28mm; }
td.ean { width: 44mm; }
td.ean img { height: 8mm; display: block; }
.obs { white-space: pre-wrap; }
.assinaturas { display: flex; gap: 10mm; margin-top: 6mm; }
.assinaturas div { flex: 1; border-top: 1px solid #000; padding-top: 1mm; }
.reimpressao { border: 2px solid #000; padding: 2mm 3mm; font-weight: bold; margin-top: 2mm; }
`;

export function renderizarFolha(d: DadosFolha, via: Via, codigos: CodigosFolha): { corpo: string; cabecalho: string; rodape: string } {
  const linhas = d.itens.map((i) => {
    const ean = i.ean
      ? escaparHtml(i.ean)
      : i.sku && codigos.porSku.has(i.sku)
        ? `<img src="${codigos.porSku.get(i.sku)}" alt="${escaparHtml(i.sku)}">`
        : "—";
    return `<tr><td class="check">☐</td><td class="qtd">${formatarQuantidade(i.quantidade)}</td>` +
      `<td class="sku">${campo(i.sku)}</td><td>${campo(i.descricao)}</td><td class="ean">${ean}</td></tr>`;
  }).join("");

  const totalItens = d.itens.reduce((s, i) => s + i.quantidade, 0);

  const reimpressao = via.numero > 1 || via.motivo
    ? `<div class="reimpressao">REIMPRESSÃO — ${rotuloVia(via.numero)} — Motivo: ${campo(via.motivo)} — Por: ${campo(via.usuario)} em ${formatarDataHora(via.em)}</div>`
    : "";

  const corpo = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${ESTILO}</style></head><body>
<div class="bloco"><div class="linha">
  <span><b>Data do pedido:</b> ${campo(d.pedido.data)}</span>
  <span><b>Atendido:</b> ${formatarDataHora(d.pedido.atendidoEm)}</span>
  <span><b>Vendedor:</b> ${campo(d.pedido.vendedor)}</span>
</div></div>
<div class="bloco">
  <div><b>CLIENTE:</b> ${campo(d.cliente.nome)} — ${campo(d.cliente.documento)}</div>
  <div><b>Entrega:</b> ${campo(d.entrega.endereco)} — ${campo(d.entrega.cidadeUf)} — CEP ${campo(d.entrega.cep)}</div>
  <div><b>Transporte:</b> ${campo(d.transporte)}</div>
</div>
<table>
  <thead><tr><th>☐</th><th>QTD</th><th>SKU</th><th>PRODUTO</th><th>EAN</th></tr></thead>
  <tbody>${linhas}</tbody>
</table>
<div class="bloco" style="margin-top:2mm">
  <div class="linha"><span><b>Total de itens:</b> ${formatarQuantidade(totalItens)} (${d.itens.length} linhas)</span><span><b>Volumes:</b> ______</span></div>
  <div class="obs"><b>Observações do pedido:</b> ${campo(d.pedido.observacoes)}</div>
</div>
<div class="assinaturas"><div>Separado por</div><div>Conferido por</div></div>
${reimpressao}
</body></html>`;

  // Cabeçalho e rodapé do Chrome: repetidos em toda página. Só aceitam estilo inline.
  const cabecalho = `<div style="width:100%;font-family:Arial;font-size:9pt;padding:0 10mm;display:flex;align-items:center;justify-content:space-between;">
  <div><b style="font-size:11pt">ÔNIX HOF — ${escaparHtml(d.filial)}</b><br>FOLHA DE SEPARAÇÃO</div>
  <div style="text-align:center"><b style="font-size:13pt">Pedido nº ${escaparHtml(d.pedido.numero)}</b></div>
  <img src="${codigos.pedido}" style="height:14mm">
  <div style="border:1px solid #000;padding:1mm 2mm;font-weight:bold;font-size:10pt">${rotuloVia(via.numero)}</div>
</div>`;

  const rodape = `<div style="width:100%;font-family:Arial;font-size:8pt;padding:0 10mm;display:flex;justify-content:space-between;">
  <span>Pedido nº ${escaparHtml(d.pedido.numero)} — gerado ${formatarHora(new Date().toISOString())}</span>
  <span>Página <span class="pageNumber"></span>/<span class="totalPages"></span></span>
</div>`;

  return { corpo, cabecalho, rodape };
}
```

Run: `npm test`
Expected: testes de `folha-html` PASS.

- [ ] **Step 3: Escrever os testes do PDF (falhando)**

`servidor/test/folha-pdf.test.ts`:
```ts
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { GeradorPdf } from "../src/folha/pdf.ts";
import { dadosFolhaExemplo } from "./ajudantes.ts";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const pular = existsSync(CHROME) ? false : `Chrome não encontrado em ${CHROME}`;
const gerador = new GeradorPdf(CHROME);
after(() => gerador.fechar());

const via1 = { numero: 1, motivo: null, usuario: null, em: null };
const paginas = async (buf: Buffer) => (await PDFDocument.load(buf)).getPageCount();

test("pedido com 1 item sai em 1 página A4", { skip: pular }, async () => {
  const pdf = await gerador.gerar(dadosFolhaExemplo(1), via1);
  const doc = await PDFDocument.load(pdf);
  assert.equal(doc.getPageCount(), 1);
  const { width, height } = doc.getPage(0).getSize();
  assert.ok(Math.abs(width - 595) < 2 && Math.abs(height - 842) < 2, `tamanho ${width}x${height} não é A4`);
});

test("pedido com 25 itens ainda cabe em 1 página", { skip: pular }, async () => {
  assert.equal(await paginas(await gerador.gerar(dadosFolhaExemplo(25), via1)), 1);
});

test("pedido com 60 itens quebra em mais páginas", { skip: pular }, async () => {
  assert.ok((await paginas(await gerador.gerar(dadosFolhaExemplo(60), via1))) >= 2);
});

test("reimpressão com 25 itens continua em 1 página", { skip: pular }, async () => {
  const via = { numero: 2, motivo: "Folha perdida", usuario: "Maria", em: new Date().toISOString() };
  assert.equal(await paginas(await gerador.gerar(dadosFolhaExemplo(25), via)), 1);
});
```

Run: `npm test`
Expected: FAIL, com "Cannot find module ... pdf.ts".

- [ ] **Step 4: Implementar o gerador de PDF**

`servidor/src/folha/pdf.ts`:
```ts
import puppeteer, { type Browser } from "puppeteer-core";
import type { DadosFolha, Via } from "../../../compartilhado/tipos.ts";
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
    for (const i of dados.itens) {
      if (!i.ean && i.sku && !codigos.porSku.has(i.sku)) codigos.porSku.set(i.sku, await codigoBarrasDataUri(i.sku));
    }
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
        margin: { top: "24mm", bottom: "12mm", left: "10mm", right: "10mm" },
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
```

- [ ] **Step 5: Rodar testes e ajustar o layout se preciso**

Run: `npm test`
Expected: PASS. Se "25 itens ainda cabe em 1 página" falhar, reduza o `padding` de `th, td` em `ESTILO` (por exemplo `0.6mm 1.5mm`) ou a margem `top` até passar. **Não** reduza a fonte abaixo de 8pt.

- [ ] **Step 6: Gerar um PDF de amostra para conferência visual**

Run:
```bash
node -e "import('./servidor/src/folha/pdf.ts').then(async ({GeradorPdf}) => { const {dadosFolhaExemplo} = await import('./servidor/test/ajudantes.ts'); const g = new GeradorPdf('C:/Program Files/Google/Chrome/Application/chrome.exe'); const fs = await import('node:fs'); fs.mkdirSync('dados',{recursive:true}); fs.writeFileSync('dados/amostra-folha.pdf', await g.gerar(dadosFolhaExemplo(12), {numero:1,motivo:null,usuario:null,em:null})); await g.fechar(); console.log('ok dados/amostra-folha.pdf'); })"
```
Expected: `ok dados/amostra-folha.pdf`. Abra o arquivo e confira se o layout bate com a seção 5 da spec.

- [ ] **Step 7: typecheck e commit**

Run: `npm run typecheck`
Expected: sem erros.

```bash
git add servidor
git commit -m "feat: folha de separação A4 em HTML e PDF"
```

---

### Task 6: Monitor (detecção de Atendido e regras)

**Files:**
- Create: `compartilhado/loop.ts`
- Create: `servidor/src/monitor/monitor.ts`
- Test: `servidor/test/monitor.test.ts`

**Interfaces:**
- Consumes: `Repositorio` (Task 1), `transacao` (Task 1), `ResumoPedido`, `ErroBlingDesconectado` (Task 2), `MontarFolha` (Task 4), `formatarDataHora` (Task 1).
- Produces:
  - `repetir(intervaloMs: number, fn: () => Promise<void>): () => void` (loop sem sobreposição; retorna função para parar).
  - `type DepsMonitor`, `type ResultadoCiclo`, `executarCiclo(d: DepsMonitor): Promise<ResultadoCiclo>`.
  - `cicloMonitorado(d: DepsMonitor, log?: Pick<Console, "info" | "error">): Promise<void>`. Grava em `estado` as chaves `bling:erro_desde`, `bling:erro_msg` e `bling:ultima_consulta`.

- [ ] **Step 1: Escrever os testes (falhando)**

`servidor/test/monitor.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { executarCiclo, cicloMonitorado, type DepsMonitor } from "../src/monitor/monitor.ts";
import { ErroBlingDesconectado, type ResumoPedido } from "../src/bling/cliente.ts";
import { AGORA, bancoDeTeste, dadosFolhaExemplo } from "./ajudantes.ts";

const ATENDIDO = 9, CANCELADO = 12, ABERTO = 6;
const resumo = (numero: string, situacaoId: number): ResumoPedido => ({ id: Number(numero) + 1000, numero, numeroLoja: null, situacaoId });

function cenario() {
  const base = bancoDeTeste();
  let lista: ResumoPedido[] = [];
  let agora = AGORA;
  const consultas: Array<{ desde: Date; ate: Date }> = [];
  const deps: DepsMonitor = {
    repo: base.repo,
    bling: { listarPedidosAlterados: async (desde, ate) => { consultas.push({ desde, ate }); return lista; } },
    montarFolha: async (idBling) => dadosFolhaExemplo(1, String(idBling - 1000)),
    filialId: base.filialId, impressoraId: base.impressoraId,
    situacaoAtendido: ATENDIDO, situacaoCancelado: CANCELADO, margemMinutos: 5,
    agora: () => agora,
  };
  return {
    ...base, deps, consultas,
    definirLista: (l: ResumoPedido[]) => { lista = l; },
    avancar: (ms: number) => { agora = new Date(agora.getTime() + ms); },
    impressoes: () => base.repo.db.prepare("SELECT * FROM impressoes ORDER BY id").all() as Array<{ id: number; via: number; dados_json: string }>,
    alertas: () => base.repo.db.prepare("SELECT tipo, mensagem FROM alertas ORDER BY id").all() as Array<{ tipo: string; mensagem: string }>,
  };
}

test("primeira ativação registra os Atendido existentes sem imprimir", async () => {
  const c = cenario();
  c.definirLista([resumo("1", ATENDIDO), resumo("2", ABERTO)]);
  const r = await executarCiclo(c.deps);
  assert.deepEqual(r, { tipo: "baseline", registrados: 1 });
  assert.equal(c.impressoes().length, 0);
  assert.equal(c.repo.buscarPedido(c.filialId, "1")?.origem, "baseline");
  assert.equal(c.repo.buscarPedido(c.filialId, "2"), null);
  assert.equal(c.consultas[0].desde.getTime(), AGORA.getTime() - 30 * 86_400_000);
});

test("pedido novo Atendido vira 1ª via na fila, em ordem de número", async () => {
  const c = cenario();
  await executarCiclo(c.deps);
  c.avancar(30_000);
  c.definirLista([resumo("11", ATENDIDO), resumo("10", ATENDIDO), resumo("12", ABERTO)]);
  const r = await executarCiclo(c.deps);
  assert.deepEqual(r, { tipo: "ciclo", novos: 2, alertas: 0 });
  const imps = c.impressoes();
  assert.deepEqual(imps.map((i) => JSON.parse(i.dados_json).pedido.numero), ["10", "11"]);
  assert.ok(imps.every((i) => i.via === 1));
});

test("consulta usa o cursor menos a margem", async () => {
  const c = cenario();
  await executarCiclo(c.deps);
  c.avancar(30_000);
  await executarCiclo(c.deps);
  assert.equal(c.consultas[1].desde.getTime(), AGORA.getTime() - 5 * 60_000);
});

test("pedido que aparece de novo como Atendido sem mudar não faz nada", async () => {
  const c = cenario();
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", ATENDIDO)]);
  await executarCiclo(c.deps);
  await executarCiclo(c.deps);
  assert.equal(c.impressoes().length, 1);
  assert.equal(c.alertas().length, 0);
});

test("pedido que sai e volta para Atendido gera alerta e não imprime", async () => {
  const c = cenario();
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", ATENDIDO)]);
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", ABERTO)]);
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", ATENDIDO)]);
  await executarCiclo(c.deps);
  assert.equal(c.impressoes().length, 1);
  assert.deepEqual(c.alertas().map((a) => a.tipo), ["repetido"]);
  assert.match(c.alertas()[0].mensagem, /Pedido 10 voltou para Atendido\. Já foi impresso em 08\/10\/2026 14:32/);
});

test("pedido cancelado depois de impresso gera alerta", async () => {
  const c = cenario();
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", ATENDIDO)]);
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", CANCELADO)]);
  await executarCiclo(c.deps);
  assert.deepEqual(c.alertas().map((a) => a.tipo), ["cancelado"]);
  assert.match(c.alertas()[0].mensagem, /CANCELADO/);
});

test("pedido desconhecido que não está Atendido é ignorado", async () => {
  const c = cenario();
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", CANCELADO)]);
  await executarCiclo(c.deps);
  assert.equal(c.repo.buscarPedido(c.filialId, "10"), null);
});

test("retomada depois de mais de 5 min parado gera aviso com a quantidade", async () => {
  const c = cenario();
  await executarCiclo(c.deps);
  c.avancar(13 * 3600_000);
  c.definirLista([resumo("10", ATENDIDO), resumo("11", ATENDIDO)]);
  await executarCiclo(c.deps);
  assert.deepEqual(c.alertas().map((a) => a.tipo), ["retomada"]);
  assert.match(c.alertas()[0].mensagem, /2 pedido\(s\) impresso\(s\) na retomada/);
});

test("dois ciclos ao mesmo tempo não duplicam a 1ª via", async () => {
  const c = cenario();
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", ATENDIDO)]);
  await Promise.all([executarCiclo(c.deps), executarCiclo(c.deps)]);
  assert.equal(c.impressoes().length, 1);
});

test("erro ao montar a folha não avança o cursor e o próximo ciclo tenta de novo", async () => {
  const c = cenario();
  await executarCiclo(c.deps);
  const cursorAntes = c.repo.obterEstado(`monitor:cursor:${c.filialId}`);
  c.definirLista([resumo("10", ATENDIDO)]);
  const montarOk = c.deps.montarFolha;
  c.deps.montarFolha = async () => { throw new Error("Bling 500"); };
  c.avancar(30_000);
  await assert.rejects(executarCiclo(c.deps), /Bling 500/);
  assert.equal(c.repo.obterEstado(`monitor:cursor:${c.filialId}`), cursorAntes);
  c.deps.montarFolha = montarOk;
  await executarCiclo(c.deps);
  assert.equal(c.impressoes().length, 1);
});

test("cicloMonitorado registra erro do Bling e cria alerta de desconexão uma vez só", async () => {
  const c = cenario();
  const log = { info: () => {}, error: () => {} };
  c.deps.bling = { listarPedidosAlterados: async () => { throw new ErroBlingDesconectado("revogado"); } };
  await cicloMonitorado(c.deps, log);
  await cicloMonitorado(c.deps, log);
  assert.equal(c.repo.obterEstado("bling:erro_desde"), AGORA.toISOString());
  assert.equal(c.repo.obterEstado("bling:erro_msg"), "revogado");
  assert.deepEqual(c.alertas().map((a) => a.tipo), ["bling_desconectado"]);
  c.deps.bling = { listarPedidosAlterados: async () => [] };
  await cicloMonitorado(c.deps, log);
  assert.equal(c.repo.obterEstado("bling:erro_desde"), null);
  assert.equal(c.repo.obterEstado("bling:ultima_consulta"), AGORA.toISOString());
});
```

Run: `npm test`
Expected: FAIL, com "Cannot find module ... monitor.ts".

- [ ] **Step 2: Implementar loop e monitor**

`compartilhado/loop.ts`:
```ts
// Executa fn, espera intervaloMs depois que ela TERMINA e repete.
// Nunca roda duas execuções ao mesmo tempo.
export function repetir(intervaloMs: number, fn: () => Promise<void>): () => void {
  let parado = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const rodada = async () => {
    try {
      await fn();
    } catch (e) {
      console.error(e);
    }
    if (!parado) timer = setTimeout(rodada, intervaloMs);
  };
  void rodada();
  return () => {
    parado = true;
    clearTimeout(timer);
  };
}
```

`servidor/src/monitor/monitor.ts`:
```ts
import { transacao } from "../banco/banco.ts";
import type { PedidoRow, Repositorio } from "../banco/repositorio.ts";
import { ErroBlingDesconectado, type ResumoPedido } from "../bling/cliente.ts";
import type { MontarFolha } from "../bling/montar-folha.ts";
import { formatarDataHora } from "../tempo.ts";

export type DepsMonitor = {
  repo: Repositorio;
  bling: { listarPedidosAlterados(desde: Date, ate: Date): Promise<ResumoPedido[]> };
  montarFolha: MontarFolha;
  filialId: number;
  impressoraId: number;
  situacaoAtendido: number;
  situacaoCancelado: number;
  margemMinutos: number;
  agora: () => Date;
};

export type ResultadoCiclo =
  | { tipo: "baseline"; registrados: number }
  | { tipo: "ciclo"; novos: number; alertas: number };

const DIAS_BASELINE = 30;
const LIMIAR_RETOMADA_MS = 5 * 60_000;

export async function executarCiclo(d: DepsMonitor): Promise<ResultadoCiclo> {
  const agora = d.agora();
  const chave = `monitor:cursor:${d.filialId}`;
  const cursor = d.repo.obterEstado(chave);

  if (cursor === null) {
    // Primeira ativação: o que já está Atendido é registrado, nunca impresso.
    const lista = await d.bling.listarPedidosAlterados(new Date(agora.getTime() - DIAS_BASELINE * 86_400_000), agora);
    let registrados = 0;
    for (const r of lista) {
      if (r.situacaoId !== d.situacaoAtendido || d.repo.buscarPedido(d.filialId, r.numero)) continue;
      d.repo.inserirPedido({ filialId: d.filialId, numero: r.numero, idBling: r.id, situacao: r.situacaoId, origem: "baseline", agora });
      registrados++;
    }
    d.repo.definirEstado(chave, agora.toISOString());
    return { tipo: "baseline", registrados };
  }

  const ultimo = new Date(cursor);
  const lista = await d.bling.listarPedidosAlterados(new Date(ultimo.getTime() - d.margemMinutos * 60_000), agora);
  lista.sort((a, b) => Number(a.numero) - Number(b.numero) || a.numero.localeCompare(b.numero));

  let novos = 0;
  let alertas = 0;
  for (const r of lista) {
    const existente = d.repo.buscarPedido(d.filialId, r.numero);

    if (!existente) {
      if (r.situacaoId !== d.situacaoAtendido) continue;
      const dados = await d.montarFolha(r.id, agora);
      // Confere de novo dentro da transação: outro ciclo pode ter criado enquanto esperávamos o Bling.
      const criado = transacao(d.repo.db, () => {
        if (d.repo.buscarPedido(d.filialId, r.numero)) return false;
        const pedidoId = d.repo.inserirPedido({
          filialId: d.filialId, numero: r.numero, idBling: r.id, situacao: r.situacaoId, origem: "monitor", agora,
        });
        d.repo.criarImpressao({ pedidoId, impressoraId: d.impressoraId, via: 1, dados, motivo: null, usuarioId: null, agora });
        return true;
      });
      if (criado) novos++;
      continue;
    }

    if (existente.situacao === r.situacaoId) continue;
    d.repo.atualizarSituacao(existente.id, r.situacaoId);

    if (r.situacaoId === d.situacaoAtendido) {
      d.repo.criarAlerta({ tipo: "repetido", pedidoId: existente.id, mensagem: mensagemRepetido(d.repo, existente), agora });
      alertas++;
    } else if (r.situacaoId === d.situacaoCancelado && d.repo.ultimaImpressao(existente.id)) {
      d.repo.criarAlerta({
        tipo: "cancelado", pedidoId: existente.id, agora,
        mensagem: `Pedido ${existente.numero} foi CANCELADO, mas já foi impresso: retire da separação.`,
      });
      alertas++;
    }
  }

  if (novos > 0 && agora.getTime() - ultimo.getTime() > LIMIAR_RETOMADA_MS) {
    d.repo.criarAlerta({
      tipo: "retomada", pedidoId: null, agora,
      mensagem: `O sistema ficou sem consultar o Bling de ${formatarDataHora(cursor)} a ${formatarDataHora(agora.toISOString())}. ` +
        `${novos} pedido(s) impresso(s) na retomada.`,
    });
    alertas++;
  }

  d.repo.definirEstado(chave, agora.toISOString());
  return { tipo: "ciclo", novos, alertas };
}

function mensagemRepetido(repo: Repositorio, p: PedidoRow): string {
  const ult = repo.ultimaImpressao(p.id);
  return ult
    ? `Pedido ${p.numero} voltou para Atendido. Já foi impresso em ${formatarDataHora(ult.criado_em)}. Reimprimir?`
    : `Pedido ${p.numero} voltou para Atendido. Ele é anterior ao sistema e não foi impresso por ele.`;
}

export async function cicloMonitorado(d: DepsMonitor, log: Pick<Console, "info" | "error"> = console): Promise<void> {
  try {
    const r = await executarCiclo(d);
    d.repo.definirEstado("bling:erro_desde", null);
    d.repo.definirEstado("bling:erro_msg", null);
    d.repo.definirEstado("bling:ultima_consulta", d.agora().toISOString());
    if (r.tipo === "baseline") log.info(`[monitor] primeira ativação: ${r.registrados} pedido(s) já atendido(s) registrado(s) sem imprimir`);
    else if (r.novos || r.alertas) log.info(`[monitor] ${r.novos} pedido(s) novo(s), ${r.alertas} alerta(s)`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!d.repo.obterEstado("bling:erro_desde")) d.repo.definirEstado("bling:erro_desde", d.agora().toISOString());
    d.repo.definirEstado("bling:erro_msg", msg);
    if (e instanceof ErroBlingDesconectado && !d.repo.alertaPendenteDoTipo("bling_desconectado")) {
      d.repo.criarAlerta({
        tipo: "bling_desconectado", pedidoId: null, agora: d.agora(),
        mensagem: "O Bling desconectou o sistema. Um supervisor precisa clicar em \"Reconectar ao Bling\" na Configuração.",
      });
    }
    log.error(`[monitor] erro: ${msg}`);
  }
}
```

- [ ] **Step 3: Rodar testes e typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add compartilhado servidor
git commit -m "feat: monitor de pedidos Atendido com alertas de repetido, cancelado e retomada"
```

---

### Task 7: Fila de impressão e API do agente

**Files:**
- Create: `servidor/src/fila/fila.ts`
- Create: `servidor/src/web/api-agente.ts`
- Test: `servidor/test/fila.test.ts`, `servidor/test/api-agente.test.ts`

**Interfaces:**
- Consumes: `Repositorio` (Task 1), `transacao`, `MontarFolha` (Task 4), `DadosFolha`, `Via`.
- Produces:
  - `MAX_TENTATIVAS = 4`, `LIMITE_TRAVADA_MS = 300_000`.
  - `type TrabalhoImpressao = { impressaoId: number; dados: DadosFolha; via: Via }`.
  - `viaDaImpressao(repo, imp: ImpressaoRow): Via`.
  - `entregarProximo(repo, impressoraId: number, agora: Date): TrabalhoImpressao | null`.
  - `registrarResultado(repo, impressaoId: number, r: { ok: true } | { ok: false; erro: string }, agora: Date): void`.
  - `recuperarTravadas(repo, agora: Date): number`.
  - `imprimirPendentes(repo, impressoraId: number): number`.
  - `reimprimir(repo, montarFolha, p: { pedidoId: number; impressoraId: number; motivo: string; usuarioId: number; agora: Date }): Promise<number>`.
  - `type GerarPdf = (dados: DadosFolha, via: Via) => Promise<Buffer>`; `registrarApiAgente(app: FastifyInstance, d: { repo: Repositorio; gerarPdf: GerarPdf; agora: () => Date }): void`.
  - Protocolo HTTP: `GET /api/agente/proximo` (header `Authorization: Bearer <token>`) responde `204` ou `200 { id, impressora, pdfBase64 }`. `POST /api/agente/impressoes/:id/resultado` recebe `{ ok: boolean, erro?: string }` e responde `{ ok: true }`.

- [ ] **Step 1: Escrever os testes da fila (falhando)**

`servidor/test/fila.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { entregarProximo, imprimirPendentes, recuperarTravadas, registrarResultado, reimprimir } from "../src/fila/fila.ts";
import { AGORA, bancoDeTeste, dadosFolhaExemplo } from "./ajudantes.ts";

function comImpressao() {
  const b = bancoDeTeste();
  const pedidoId = b.repo.inserirPedido({ filialId: b.filialId, numero: "10", idBling: 1010, situacao: 9, origem: "monitor", agora: AGORA });
  const impressaoId = b.repo.criarImpressao({ pedidoId, impressoraId: b.impressoraId, via: 1, dados: dadosFolhaExemplo(1, "10"), motivo: null, usuarioId: null, agora: AGORA });
  return { ...b, pedidoId, impressaoId };
}
const alertas = (repo: ReturnType<typeof bancoDeTeste>["repo"]) =>
  repo.db.prepare("SELECT tipo, mensagem FROM alertas").all() as Array<{ tipo: string; mensagem: string }>;

test("entregarProximo devolve dados e via 1", () => {
  const c = comImpressao();
  const t = entregarProximo(c.repo, c.impressoraId, AGORA)!;
  assert.equal(t.impressaoId, c.impressaoId);
  assert.equal(t.dados.pedido.numero, "10");
  assert.deepEqual(t.via, { numero: 1, motivo: null, usuario: null, em: AGORA.toISOString() });
  assert.equal(entregarProximo(c.repo, c.impressoraId, AGORA), null);
});

test("ok marca impresso e enfileira para a planilha", () => {
  const c = comImpressao();
  entregarProximo(c.repo, c.impressoraId, AGORA);
  registrarResultado(c.repo, c.impressaoId, { ok: true }, AGORA);
  assert.equal(c.repo.buscarImpressao(c.impressaoId)!.status, "impresso");
  const n = c.repo.db.prepare("SELECT COUNT(*) AS n FROM fila_planilha").get() as { n: number };
  assert.equal(n.n, 1);
});

test("3 falhas voltam para a fila; a 4ª vira erro com alerta", () => {
  const c = comImpressao();
  for (let i = 1; i <= 3; i++) {
    entregarProximo(c.repo, c.impressoraId, AGORA);
    registrarResultado(c.repo, c.impressaoId, { ok: false, erro: "sem papel" }, AGORA);
    assert.equal(c.repo.buscarImpressao(c.impressaoId)!.status, "fila");
  }
  entregarProximo(c.repo, c.impressoraId, AGORA);
  registrarResultado(c.repo, c.impressaoId, { ok: false, erro: "sem papel" }, AGORA);
  assert.equal(c.repo.buscarImpressao(c.impressaoId)!.status, "erro");
  assert.deepEqual(alertas(c.repo).map((a) => a.tipo), ["falha_impressao"]);
  assert.match(alertas(c.repo)[0].mensagem, /Pedido 10.*4 vezes.*sem papel/);
});

test("ok atrasado depois de travada vira impresso", () => {
  const c = comImpressao();
  entregarProximo(c.repo, c.impressoraId, AGORA);
  const depois = new Date(AGORA.getTime() + 6 * 60_000);
  assert.equal(recuperarTravadas(c.repo, depois), 1);
  assert.equal(c.repo.buscarImpressao(c.impressaoId)!.status, "erro");
  registrarResultado(c.repo, c.impressaoId, { ok: true }, depois);
  assert.equal(c.repo.buscarImpressao(c.impressaoId)!.status, "impresso");
  assert.equal(imprimirPendentes(c.repo, c.impressoraId), 0);
});

test("travada há menos de 5 min não é mexida", () => {
  const c = comImpressao();
  entregarProximo(c.repo, c.impressoraId, AGORA);
  assert.equal(recuperarTravadas(c.repo, new Date(AGORA.getTime() + 4 * 60_000)), 0);
});

test("imprimirPendentes devolve erros para a fila", () => {
  const c = comImpressao();
  entregarProximo(c.repo, c.impressoraId, AGORA);
  c.repo.marcarFalha(c.impressaoId, "x", "erro");
  assert.equal(imprimirPendentes(c.repo, c.impressoraId), 1);
  assert.equal(c.repo.buscarImpressao(c.impressaoId)!.status, "fila");
});

test("reimprimir cria a próxima via com motivo, usuário e dados novos do Bling", async () => {
  const c = comImpressao();
  const usuarioId = Number(c.repo.db.prepare("INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES ('Maria', 'm@x', 'h', 'supervisor')").run().lastInsertRowid);
  let pedidoPedido: [number, string] | null = null;
  const montar = async (idBling: number, atendidoEm: Date) => {
    pedidoPedido = [idBling, atendidoEm.toISOString()];
    const d = dadosFolhaExemplo(3, "10");
    return d;
  };
  const id = await reimprimir(c.repo, montar, { pedidoId: c.pedidoId, impressoraId: c.impressoraId, motivo: "Folha perdida", usuarioId, agora: AGORA });
  assert.deepEqual(pedidoPedido, [1010, AGORA.toISOString()]);
  const imp = c.repo.buscarImpressao(id)!;
  assert.equal(imp.via, 2);
  assert.equal(imp.motivo, "Folha perdida");
  assert.equal(JSON.parse(imp.dados_json).itens.length, 3);
  c.repo.marcarImpressa(c.impressaoId, AGORA);
  const t = entregarProximo(c.repo, c.impressoraId, AGORA)!;
  assert.deepEqual(t.via, { numero: 2, motivo: "Folha perdida", usuario: "Maria", em: AGORA.toISOString() });
});
```

Run: `npm test`
Expected: FAIL, com "Cannot find module ... fila.ts".

- [ ] **Step 2: Implementar a fila**

`servidor/src/fila/fila.ts`:
```ts
import type { DadosFolha, Via } from "../../../compartilhado/tipos.ts";
import { transacao } from "../banco/banco.ts";
import type { ImpressaoRow, Repositorio } from "../banco/repositorio.ts";
import type { MontarFolha } from "../bling/montar-folha.ts";

export const MAX_TENTATIVAS = 4; // 1 tentativa + 3 novas
export const LIMITE_TRAVADA_MS = 5 * 60_000;

export type TrabalhoImpressao = { impressaoId: number; dados: DadosFolha; via: Via };

export function viaDaImpressao(repo: Repositorio, imp: ImpressaoRow): Via {
  return { numero: imp.via, motivo: imp.motivo, usuario: repo.nomeUsuario(imp.usuario_id), em: imp.criado_em };
}

export function entregarProximo(repo: Repositorio, impressoraId: number, agora: Date): TrabalhoImpressao | null {
  const imp = repo.pegarProximaDaFila(impressoraId, agora);
  if (!imp) return null;
  return { impressaoId: imp.id, dados: JSON.parse(imp.dados_json) as DadosFolha, via: viaDaImpressao(repo, imp) };
}

export function registrarResultado(
  repo: Repositorio,
  impressaoId: number,
  r: { ok: true } | { ok: false; erro: string },
  agora: Date,
): void {
  const imp = repo.buscarImpressao(impressaoId);
  if (!imp) throw new Error(`Impressão ${impressaoId} não existe`);

  if (r.ok) {
    // Vale mesmo se ela já tinha sido marcada como travada/erro: a folha saiu.
    transacao(repo.db, () => {
      repo.marcarImpressa(imp.id, agora);
      repo.enfileirarPlanilha(imp.id);
    });
    return;
  }

  const tentativas = imp.tentativas + 1;
  if (tentativas < MAX_TENTATIVAS) {
    repo.marcarFalha(imp.id, r.erro, "fila");
    return;
  }
  repo.marcarFalha(imp.id, r.erro, "erro");
  const pedido = repo.buscarPedidoPorId(imp.pedido_id)!;
  repo.criarAlerta({
    tipo: "falha_impressao", pedidoId: pedido.id, agora,
    mensagem: `Pedido ${pedido.numero}: a impressão falhou ${tentativas} vezes (${r.erro}). Verifique a impressora e clique em "Imprimir pendentes".`,
  });
}

export function recuperarTravadas(repo: Repositorio, agora: Date): number {
  const travadas = repo.listarTravadas(new Date(agora.getTime() - LIMITE_TRAVADA_MS));
  for (const imp of travadas) {
    repo.marcarFalha(imp.id, "Sem resposta do agente durante a impressão", "erro");
    const pedido = repo.buscarPedidoPorId(imp.pedido_id)!;
    repo.criarAlerta({
      tipo: "falha_impressao", pedidoId: pedido.id, agora,
      mensagem: `Pedido ${pedido.numero}: o agente parou de responder durante a impressão. Confira se a folha saiu antes de clicar em "Imprimir pendentes".`,
    });
  }
  return travadas.length;
}

export function imprimirPendentes(repo: Repositorio, impressoraId: number): number {
  return repo.reenfileirarErros(impressoraId);
}

export async function reimprimir(
  repo: Repositorio,
  montarFolha: MontarFolha,
  p: { pedidoId: number; impressoraId: number; motivo: string; usuarioId: number; agora: Date },
): Promise<number> {
  const pedido = repo.buscarPedidoPorId(p.pedidoId);
  if (!pedido) throw new Error(`Pedido ${p.pedidoId} não existe`);
  const dados = await montarFolha(pedido.id_bling, new Date(pedido.detectado_em));
  return transacao(repo.db, () =>
    repo.criarImpressao({
      pedidoId: pedido.id, impressoraId: p.impressoraId, via: repo.proximaVia(pedido.id),
      dados, motivo: p.motivo, usuarioId: p.usuarioId, agora: p.agora,
    }),
  );
}
```

Run: `npm test`
Expected: testes de `fila` PASS.

- [ ] **Step 3: Escrever os testes da API (falhando)**

`servidor/test/api-agente.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registrarApiAgente, type GerarPdf } from "../src/web/api-agente.ts";
import { AGORA, bancoDeTeste, dadosFolhaExemplo } from "./ajudantes.ts";

function app(gerarPdf: GerarPdf = async () => Buffer.from("%PDF-falso")) {
  const b = bancoDeTeste();
  const pedidoId = b.repo.inserirPedido({ filialId: b.filialId, numero: "10", idBling: 1010, situacao: 9, origem: "monitor", agora: AGORA });
  const impressaoId = b.repo.criarImpressao({ pedidoId, impressoraId: b.impressoraId, via: 1, dados: dadosFolhaExemplo(1, "10"), motivo: null, usuarioId: null, agora: AGORA });
  const f = Fastify();
  registrarApiAgente(f, { repo: b.repo, gerarPdf, agora: () => AGORA });
  return { ...b, f, impressaoId };
}
const auth = { authorization: "Bearer token-teste" };

test("sem token ou token errado = 401", async () => {
  const { f } = app();
  assert.equal((await f.inject({ url: "/api/agente/proximo" })).statusCode, 401);
  assert.equal((await f.inject({ url: "/api/agente/proximo", headers: { authorization: "Bearer x" } })).statusCode, 401);
});

test("entrega o PDF e registra a comunicação do agente", async () => {
  const c = app();
  const r = await c.f.inject({ url: "/api/agente/proximo", headers: auth });
  assert.equal(r.statusCode, 200);
  const j = r.json() as { id: number; impressora: string; pdfBase64: string };
  assert.equal(j.id, c.impressaoId);
  assert.equal(j.impressora, "HP A4");
  assert.equal(Buffer.from(j.pdfBase64, "base64").toString(), "%PDF-falso");
  assert.equal(c.repo.buscarImpressao(c.impressaoId)!.status, "imprimindo");
  assert.equal(c.repo.buscarAgentePorToken("token-teste")!.ultima_comunicacao, AGORA.toISOString());
  assert.equal((await c.f.inject({ url: "/api/agente/proximo", headers: auth })).statusCode, 204);
});

test("resultado ok marca impresso", async () => {
  const c = app();
  await c.f.inject({ url: "/api/agente/proximo", headers: auth });
  const r = await c.f.inject({ method: "POST", url: `/api/agente/impressoes/${c.impressaoId}/resultado`, headers: auth, payload: { ok: true } });
  assert.equal(r.statusCode, 200);
  assert.equal(c.repo.buscarImpressao(c.impressaoId)!.status, "impresso");
});

test("resultado com erro conta tentativa", async () => {
  const c = app();
  await c.f.inject({ url: "/api/agente/proximo", headers: auth });
  await c.f.inject({ method: "POST", url: `/api/agente/impressoes/${c.impressaoId}/resultado`, headers: auth, payload: { ok: false, erro: "offline" } });
  const imp = c.repo.buscarImpressao(c.impressaoId)!;
  assert.equal(imp.status, "fila");
  assert.equal(imp.ultimo_erro, "offline");
});

test("impressão de outra impressora = 404", async () => {
  const c = app();
  c.repo.garantirAgente(c.filialId, { nome: "outro", token: "token-outro", impressora: "Outra" });
  const r = await c.f.inject({ method: "POST", url: `/api/agente/impressoes/${c.impressaoId}/resultado`, headers: { authorization: "Bearer token-outro" }, payload: { ok: true } });
  assert.equal(r.statusCode, 404);
});

test("falha ao gerar PDF = 500 e conta tentativa", async () => {
  const c = app(async () => { throw new Error("chrome caiu"); });
  const r = await c.f.inject({ url: "/api/agente/proximo", headers: auth });
  assert.equal(r.statusCode, 500);
  const imp = c.repo.buscarImpressao(c.impressaoId)!;
  assert.equal(imp.tentativas, 1);
  assert.match(imp.ultimo_erro ?? "", /chrome caiu/);
});
```

Run: `npm test`
Expected: FAIL, com "Cannot find module ... api-agente.ts".

- [ ] **Step 4: Implementar a API**

`servidor/src/web/api-agente.ts`:
```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { DadosFolha, Via } from "../../../compartilhado/tipos.ts";
import type { AgenteRow, Repositorio } from "../banco/repositorio.ts";
import { entregarProximo, registrarResultado } from "../fila/fila.ts";

export type GerarPdf = (dados: DadosFolha, via: Via) => Promise<Buffer>;
export type DepsApiAgente = { repo: Repositorio; gerarPdf: GerarPdf; agora: () => Date };

export function registrarApiAgente(app: FastifyInstance, d: DepsApiAgente): void {
  function autenticar(req: FastifyRequest, reply: FastifyReply): AgenteRow | null {
    const h = req.headers.authorization ?? "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    const agente = token ? d.repo.buscarAgentePorToken(token) : null;
    if (!agente) {
      reply.code(401).send({ erro: "token inválido" });
      return null;
    }
    d.repo.registrarComunicacaoAgente(agente.id, d.agora());
    return agente;
  }

  app.get("/api/agente/proximo", async (req, reply) => {
    const agente = autenticar(req, reply);
    if (!agente) return reply;
    const t = entregarProximo(d.repo, agente.impressora_id, d.agora());
    if (!t) return reply.code(204).send();
    try {
      const pdf = await d.gerarPdf(t.dados, t.via);
      return { id: t.impressaoId, impressora: agente.impressora_nome, pdfBase64: pdf.toString("base64") };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      registrarResultado(d.repo, t.impressaoId, { ok: false, erro: `Falha ao gerar PDF: ${msg}` }, d.agora());
      return reply.code(500).send({ erro: "falha ao gerar PDF" });
    }
  });

  app.post<{ Params: { id: string }; Body: { ok?: boolean; erro?: string } }>(
    "/api/agente/impressoes/:id/resultado",
    async (req, reply) => {
      const agente = autenticar(req, reply);
      if (!agente) return reply;
      const imp = d.repo.buscarImpressao(Number(req.params.id));
      if (!imp || imp.impressora_id !== agente.impressora_id) return reply.code(404).send({ erro: "impressão não encontrada" });
      const b = req.body ?? {};
      registrarResultado(d.repo, imp.id, b.ok ? { ok: true } : { ok: false, erro: String(b.erro ?? "erro desconhecido") }, d.agora());
      return { ok: true };
    },
  );
}
```

- [ ] **Step 5: Rodar testes e typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add servidor
git commit -m "feat: fila de impressão com tentativas e API do agente"
```

---

### Task 8: Agente de impressão

**Files:**
- Create: `agente/src/agente.ts`, `agente/src/impressora.ts`, `agente/src/config.ts`, `agente/src/main.ts`, `agente/config.exemplo.json`
- Modify: `package.json` (script `test`)
- Test: `agente/test/agente.test.ts`

**Interfaces:**
- Consumes: o protocolo HTTP da Task 7; `repetir` (Task 6, `compartilhado/loop.ts`).
- Produces: `type Impressora = { imprimir(pdf: Buffer, nomeImpressora: string, id: number): Promise<void> }`; `processarUm(d: DepsAgente): Promise<"vazio" | "impresso" | "falhou">`; `esvaziarFila(d: DepsAgente, max?: number): Promise<number>`; `ImpressoraWindows`, `ImpressoraPasta`; `carregarConfigAgente(arquivo: string): ConfigAgente`.

- [ ] **Step 1: Atualizar o script de testes**

Em `package.json`, troque o script `test` por:
```json
"test": "node --test --test-reporter=spec \"servidor/test/*.test.ts\" \"agente/test/*.test.ts\"",
```

- [ ] **Step 2: Escrever os testes (falhando)**

`agente/test/agente.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { esvaziarFila, processarUm, type Impressora } from "../src/agente.ts";
import { ImpressoraPasta } from "../src/impressora.ts";

function servidorFalso(trabalhos: number[]) {
  const resultados: Array<{ id: number; corpo: unknown }> = [];
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer tk");
    if (u.endsWith("/api/agente/proximo")) {
      const id = trabalhos.shift();
      if (id === undefined) return new Response(null, { status: 204 });
      return Response.json({ id, impressora: "HP A4", pdfBase64: Buffer.from(`pdf-${id}`).toString("base64") });
    }
    const m = u.match(/impressoes\/(\d+)\/resultado$/);
    if (m) { resultados.push({ id: Number(m[1]), corpo: JSON.parse(String(init!.body)) }); return Response.json({ ok: true }); }
    return new Response(null, { status: 404 });
  };
  return { fetch: f as typeof fetch, resultados };
}

function impressoraFalsa(falharCom?: string) {
  const impressos: Array<{ pdf: string; nome: string; id: number }> = [];
  const imp: Impressora = {
    async imprimir(pdf, nome, id) {
      if (falharCom) throw new Error(falharCom);
      impressos.push({ pdf: pdf.toString(), nome, id });
    },
  };
  return { imp, impressos };
}

test("fila vazia", async () => {
  const s = servidorFalso([]);
  assert.equal(await processarUm({ servidorUrl: "http://srv", token: "tk", impressora: impressoraFalsa().imp, fetch: s.fetch }), "vazio");
});

test("imprime e avisa o servidor", async () => {
  const s = servidorFalso([7]);
  const i = impressoraFalsa();
  assert.equal(await processarUm({ servidorUrl: "http://srv", token: "tk", impressora: i.imp, fetch: s.fetch }), "impresso");
  assert.deepEqual(i.impressos, [{ pdf: "pdf-7", nome: "HP A4", id: 7 }]);
  assert.deepEqual(s.resultados, [{ id: 7, corpo: { ok: true } }]);
});

test("erro da impressora é enviado ao servidor", async () => {
  const s = servidorFalso([7]);
  const r = await processarUm({ servidorUrl: "http://srv", token: "tk", impressora: impressoraFalsa("Impressora offline").imp, fetch: s.fetch });
  assert.equal(r, "falhou");
  assert.deepEqual(s.resultados, [{ id: 7, corpo: { ok: false, erro: "Impressora offline" } }]);
});

test("esvaziarFila processa tudo até ficar vazio", async () => {
  const s = servidorFalso([1, 2, 3]);
  const i = impressoraFalsa();
  assert.equal(await esvaziarFila({ servidorUrl: "http://srv", token: "tk", impressora: i.imp, fetch: s.fetch }), 3);
  assert.deepEqual(i.impressos.map((x) => x.id), [1, 2, 3]);
});

test("ImpressoraPasta salva o PDF", async () => {
  const pasta = join(mkdtempSync(join(tmpdir(), "ag-")), "saida");
  await new ImpressoraPasta(pasta).imprimir(Buffer.from("%PDF"), "HP", 42);
  assert.equal(readFileSync(join(pasta, "impressao-42.pdf"), "utf8"), "%PDF");
});
```

Run: `npm test`
Expected: FAIL, com "Cannot find module ... agente.ts".

- [ ] **Step 3: Implementar o agente**

`agente/src/agente.ts`:
```ts
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
```

`agente/src/impressora.ts`:
```ts
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { print } from "pdf-to-printer";
import type { Impressora } from "./agente.ts";

// Impressão silenciosa no Windows (pdf-to-printer usa o SumatraPDF embutido).
export class ImpressoraWindows implements Impressora {
  async imprimir(pdf: Buffer, nomeImpressora: string, id: number): Promise<void> {
    const arq = join(tmpdir(), `onix-folha-${id}-${Date.now()}.pdf`);
    await writeFile(arq, pdf);
    try {
      await print(arq, { printer: nomeImpressora, scale: "noscale", paperSize: "A4" });
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
```

`agente/src/config.ts`:
```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ_AGENTE = fileURLToPath(new URL("../../", import.meta.url));

export type ConfigAgente = {
  servidorUrl: string;
  token: string;
  modo: "imprimir" | "pasta";
  pasta: string;
  intervaloSegundos: number;
};

export function carregarConfigAgente(arquivo: string): ConfigAgente {
  const c = JSON.parse(readFileSync(arquivo, "utf8")) as ConfigAgente;
  if (!c.servidorUrl || !c.token) throw new Error("agente/config.json: servidorUrl e token são obrigatórios");
  if (c.modo !== "imprimir" && c.modo !== "pasta") throw new Error('agente/config.json: modo deve ser "imprimir" ou "pasta"');
  c.pasta = resolve(RAIZ_AGENTE, c.pasta || "dados/folhas");
  c.intervaloSegundos ||= 5;
  return c;
}
```

`agente/src/main.ts`:
```ts
import { join } from "node:path";
import { repetir } from "../../compartilhado/loop.ts";
import { esvaziarFila } from "./agente.ts";
import { carregarConfigAgente, RAIZ_AGENTE } from "./config.ts";
import { ImpressoraPasta, ImpressoraWindows } from "./impressora.ts";

const c = carregarConfigAgente(process.argv[2] ?? join(RAIZ_AGENTE, "agente/config.json"));
const impressora = c.modo === "pasta" ? new ImpressoraPasta(c.pasta) : new ImpressoraWindows();
console.info(`[agente] iniciado: modo=${c.modo}${c.modo === "pasta" ? ` (${c.pasta})` : ""}, servidor=${c.servidorUrl}`);

repetir(c.intervaloSegundos * 1000, async () => {
  try {
    const n = await esvaziarFila({ servidorUrl: c.servidorUrl, token: c.token, impressora });
    if (n) console.info(`[agente] ${n} trabalho(s) processado(s)`);
  } catch (e) {
    console.error(`[agente] ${e instanceof Error ? e.message : String(e)}`);
  }
});
```

`agente/config.exemplo.json`:
```json
{
  "servidorUrl": "http://localhost:3010",
  "token": "O MESMO token configurado em servidor/config.json > agentes",
  "modo": "pasta",
  "pasta": "dados/folhas",
  "intervaloSegundos": 5
}
```

- [ ] **Step 4: Rodar testes e typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json agente
git commit -m "feat: agente de impressão (Windows e modo pasta)"
```

---

### Task 9: Login, usuários e montagem da aplicação web

**Files:**
- Create: `servidor/src/web/auth.ts`, `servidor/src/web/layout.ts`, `servidor/src/web/usuarios.ts`, `servidor/src/app.ts`, `servidor/src/cli/criar-usuario.ts`
- Modify: `servidor/src/banco/repositorio.ts` (métodos de usuário)
- Modify: `servidor/test/ajudantes.ts` (`configDeTeste`, `appDeTeste`, `entrar`)
- Test: `servidor/test/auth.test.ts`

**Interfaces:**
- Consumes: `Repositorio`, `Config`, `registrarApiAgente`, `GerarPdf`, `MontarFolha`, `escaparHtml`.
- Produces:
  - Repositório: `type Papel = "operador" | "supervisor"`, `type UsuarioRow`, `criarUsuario(u: { nome: string; email: string; senhaHash: string; papel: Papel }): number`, `buscarUsuarioPorEmail(email: string): UsuarioRow | null`, `buscarUsuarioPorId(id: number): UsuarioRow | null`, `listarUsuarios(): UsuarioRow[]`, `definirUsuarioAtivo(id: number, ativo: boolean): void`.
  - `hashSenha(senha: string): string`, `verificarSenha(senha: string, hash: string): boolean`, `type UsuarioSessao`, `registrarAuth(app, d)`, `exigirLogin`, `exigirSupervisor` (preHandlers Fastify), `req.usuario`.
  - `pagina(usuario: UsuarioSessao | null, titulo: string, conteudo: string, opts?: { atualizarSegundos?: number; mensagem?: string }): string`.
  - `type DepsApp = { repo: Repositorio; config: Config; filialId: number; impressoraId: number; agora: () => Date; gerarPdf: GerarPdf; montarFolha: MontarFolha; bling: { urlAutorizacao(state: string): string; trocarCodigo(code: string): Promise<void>; estaConectado(): boolean } }`; `criarApp(d: DepsApp): Promise<FastifyInstance>`.
  - Ajudantes de teste: `configDeTeste(): Config`, `appDeTeste(extra?: Partial<DepsApp>)`, `entrar(app, email, senha): Promise<string>` (cookie).

- [ ] **Step 1: Escrever os testes (falhando)**

Acrescentar ao final de `servidor/test/ajudantes.ts`:
```ts
import type { FastifyInstance } from "fastify";
import type { Config } from "../src/config.ts";
import { criarApp, type DepsApp } from "../src/app.ts";
import { hashSenha } from "../src/web/auth.ts";

export function configDeTeste(): Config {
  return {
    porta: 0, urlPublica: "http://localhost:3010", segredoSessao: "segredo-de-teste-com-tamanho-suficiente-123",
    arquivoBanco: ":memory:", chromePath: "", filial: { codigo: "ES", nome: "Espírito Santo" },
    bling: { clientId: "a", clientSecret: "b", intervaloSegundos: 30, margemMinutos: 5, situacaoAtendido: 9, situacaoCancelado: 12, campoCodigoBarras: "numero" },
    agentes: [{ nome: "expedicao-es", token: "token-teste", impressora: "HP A4" }], google: null,
  };
}

export async function appDeTeste(extra: Partial<DepsApp> = {}) {
  const b = bancoDeTeste();
  const supervisorId = b.repo.criarUsuario({ nome: "Sup", email: "sup@x.com", senhaHash: hashSenha("senha-sup"), papel: "supervisor" });
  const operadorId = b.repo.criarUsuario({ nome: "Op", email: "op@x.com", senhaHash: hashSenha("senha-op"), papel: "operador" });
  const deps: DepsApp = {
    repo: b.repo, config: configDeTeste(), filialId: b.filialId, impressoraId: b.impressoraId, agora: () => AGORA,
    gerarPdf: async () => Buffer.from("%PDF"), montarFolha: async (idBling) => dadosFolhaExemplo(2, String(idBling - 1000)),
    bling: { urlAutorizacao: (s) => `https://bling.test/auth?state=${s}`, trocarCodigo: async () => {}, estaConectado: () => true },
    ...extra,
  };
  const app = await criarApp(deps);
  return { ...b, app, deps, supervisorId, operadorId };
}

export async function entrar(app: FastifyInstance, email: string, senha: string): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/login", payload: { email, senha } });
  const sc = r.headers["set-cookie"];
  const bruto = Array.isArray(sc) ? sc[0] : sc;
  if (!bruto) throw new Error(`login falhou (${r.statusCode})`);
  return bruto.split(";")[0];
}
```

`servidor/test/auth.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashSenha, verificarSenha } from "../src/web/auth.ts";
import { appDeTeste, entrar } from "./ajudantes.ts";

test("hash de senha confere só com a senha certa", () => {
  const h = hashSenha("abc123");
  assert.ok(h.startsWith("scrypt$"));
  assert.equal(verificarSenha("abc123", h), true);
  assert.equal(verificarSenha("errada", h), false);
  assert.equal(verificarSenha("abc123", "lixo"), false);
});

test("login certo redireciona e cria cookie; errado dá 401", async () => {
  const { app } = await appDeTeste();
  const ok = await app.inject({ method: "POST", url: "/login", payload: { email: "SUP@x.com ", senha: "senha-sup" } });
  assert.equal(ok.statusCode, 302);
  assert.ok(ok.headers["set-cookie"]);
  const ruim = await app.inject({ method: "POST", url: "/login", payload: { email: "sup@x.com", senha: "x" } });
  assert.equal(ruim.statusCode, 401);
  assert.match(ruim.body, /E-mail ou senha incorretos/);
});

test("sem login vai para /login", async () => {
  const { app } = await appDeTeste();
  const r = await app.inject({ url: "/usuarios" });
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, "/login");
});

test("cookie adulterado não autentica", async () => {
  const { app } = await appDeTeste();
  const r = await app.inject({ url: "/usuarios", headers: { cookie: "sessao=1:9999999999999.assinatura-falsa" } });
  assert.equal(r.statusCode, 302);
});

test("operador não acessa usuários; supervisor acessa e cria", async () => {
  const { app, repo } = await appDeTeste();
  const op = await entrar(app, "op@x.com", "senha-op");
  assert.equal((await app.inject({ url: "/usuarios", headers: { cookie: op } })).statusCode, 403);

  const sup = await entrar(app, "sup@x.com", "senha-sup");
  const lista = await app.inject({ url: "/usuarios", headers: { cookie: sup } });
  assert.equal(lista.statusCode, 200);
  assert.match(lista.body, /op@x\.com/);

  const criar = await app.inject({ method: "POST", url: "/usuarios", headers: { cookie: sup }, payload: { nome: "Novo <b>", email: "Novo@X.com", senha: "12345678", papel: "operador" } });
  assert.equal(criar.statusCode, 302);
  assert.equal(repo.buscarUsuarioPorEmail("novo@x.com")?.papel, "operador");
  const depois = await app.inject({ url: "/usuarios", headers: { cookie: sup } });
  assert.match(depois.body, /Novo &lt;b&gt;/);
});

test("senha curta ou e-mail repetido são recusados", async () => {
  const { app } = await appDeTeste();
  const sup = await entrar(app, "sup@x.com", "senha-sup");
  const curta = await app.inject({ method: "POST", url: "/usuarios", headers: { cookie: sup }, payload: { nome: "A", email: "a@x.com", senha: "123", papel: "operador" } });
  assert.equal(curta.statusCode, 400);
  const repetido = await app.inject({ method: "POST", url: "/usuarios", headers: { cookie: sup }, payload: { nome: "A", email: "op@x.com", senha: "12345678", papel: "operador" } });
  assert.equal(repetido.statusCode, 400);
});

test("usuário desativado não entra", async () => {
  const { app, repo, operadorId } = await appDeTeste();
  repo.definirUsuarioAtivo(operadorId, false);
  const r = await app.inject({ method: "POST", url: "/login", payload: { email: "op@x.com", senha: "senha-op" } });
  assert.equal(r.statusCode, 401);
});
```

Run: `npm test`
Expected: FAIL, com módulos não encontrados.

- [ ] **Step 2: Métodos de usuário no repositório**

Em `servidor/src/banco/repositorio.ts`, acrescentar os tipos junto dos outros:
```ts
export type Papel = "operador" | "supervisor";
export type UsuarioRow = { id: number; nome: string; email: string; senha_hash: string; papel: Papel; ativo: number };
```
e os métodos dentro da classe, logo após `nomeUsuario`:
```ts
  criarUsuario(u: { nome: string; email: string; senhaHash: string; papel: Papel }): number {
    return this.exec(
      "INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?, ?, ?, ?)",
      u.nome, u.email.trim().toLowerCase(), u.senhaHash, u.papel,
    ).id;
  }

  buscarUsuarioPorEmail(email: string): UsuarioRow | null {
    return this.um<UsuarioRow>("SELECT * FROM usuarios WHERE email = ?", email.trim().toLowerCase());
  }

  buscarUsuarioPorId(id: number): UsuarioRow | null {
    return this.um<UsuarioRow>("SELECT * FROM usuarios WHERE id = ?", id);
  }

  listarUsuarios(): UsuarioRow[] {
    return this.todos<UsuarioRow>("SELECT * FROM usuarios ORDER BY ativo DESC, nome");
  }

  definirUsuarioAtivo(id: number, ativo: boolean): void {
    this.exec("UPDATE usuarios SET ativo = ? WHERE id = ?", ativo ? 1 : 0, id);
  }
```

- [ ] **Step 3: Implementar auth, layout, usuários e app**

`servidor/src/web/auth.ts`:
```ts
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Papel, Repositorio } from "../banco/repositorio.ts";
import { escaparHtml } from "../html-util.ts";
import { pagina } from "./layout.ts";

export type UsuarioSessao = { id: number; nome: string; papel: Papel };

declare module "fastify" {
  interface FastifyRequest {
    usuario: UsuarioSessao | null;
  }
}

const COOKIE = "sessao";
const DURACAO_S = 12 * 3600;

export function hashSenha(senha: string): string {
  const sal = randomBytes(16);
  return `scrypt$${sal.toString("hex")}$${scryptSync(senha, sal, 32).toString("hex")}`;
}

export function verificarSenha(senha: string, armazenado: string): boolean {
  const [alg, salHex, hHex] = armazenado.split("$");
  if (alg !== "scrypt" || !salHex || !hHex) return false;
  const esperado = Buffer.from(hHex, "hex");
  const h = scryptSync(senha, Buffer.from(salHex, "hex"), esperado.length);
  return timingSafeEqual(h, esperado);
}

function paginaLogin(erro: string | null): string {
  return pagina(null, "Entrar", `
<form method="post" action="/login" class="cartao estreito">
  ${erro ? `<p class="erro">${escaparHtml(erro)}</p>` : ""}
  <label>E-mail <input name="email" type="email" required autofocus></label>
  <label>Senha <input name="senha" type="password" required></label>
  <button>Entrar</button>
</form>`);
}

export function registrarAuth(app: FastifyInstance, d: { repo: Repositorio; agora: () => Date }): void {
  app.decorateRequest("usuario", null);

  app.addHook("preHandler", async (req) => {
    req.usuario = null;
    const bruto = req.cookies[COOKIE];
    if (!bruto) return;
    const r = req.unsignCookie(bruto);
    if (!r.valid || !r.value) return;
    const [idStr, expStr] = r.value.split(":");
    if (Number(expStr) < d.agora().getTime()) return;
    const u = d.repo.buscarUsuarioPorId(Number(idStr));
    if (u && u.ativo) req.usuario = { id: u.id, nome: u.nome, papel: u.papel };
  });

  app.get("/login", async (_req, reply) => reply.type("text/html").send(paginaLogin(null)));

  app.post<{ Body: { email?: string; senha?: string } }>("/login", async (req, reply) => {
    const u = d.repo.buscarUsuarioPorEmail(String(req.body?.email ?? ""));
    if (!u || !u.ativo || !verificarSenha(String(req.body?.senha ?? ""), u.senha_hash)) {
      return reply.code(401).type("text/html").send(paginaLogin("E-mail ou senha incorretos."));
    }
    const exp = d.agora().getTime() + DURACAO_S * 1000;
    reply.setCookie(COOKIE, `${u.id}:${exp}`, { signed: true, httpOnly: true, sameSite: "strict", path: "/", maxAge: DURACAO_S });
    return reply.redirect("/");
  });

  app.post("/logout", async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: "/" });
    return reply.redirect("/login");
  });
}

export async function exigirLogin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.usuario) return reply.redirect("/login");
}

export async function exigirSupervisor(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.usuario) return reply.redirect("/login");
  if (req.usuario.papel !== "supervisor") {
    return reply.code(403).type("text/html").send(pagina(req.usuario, "Sem permissão", "<p>Só supervisores podem fazer isso.</p>"));
  }
}
```

`servidor/src/web/layout.ts`:
```ts
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
```

`servidor/src/web/usuarios.ts`:
```ts
import type { FastifyInstance } from "fastify";
import type { Papel, Repositorio } from "../banco/repositorio.ts";
import { escaparHtml } from "../html-util.ts";
import { exigirSupervisor, hashSenha, type UsuarioSessao } from "./auth.ts";
import { pagina } from "./layout.ts";

function tela(repo: Repositorio, usuario: UsuarioSessao, erro: string | null, mensagem?: string): string {
  const linhas = repo.listarUsuarios().map((u) => `<tr>
    <td>${escaparHtml(u.nome)}</td><td>${escaparHtml(u.email)}</td><td>${u.papel === "supervisor" ? "Supervisor" : "Operador"}</td>
    <td>${u.ativo ? "Ativo" : "Desativado"}</td>
    <td>${u.id === usuario.id ? "" : `<form class="inline" method="post" action="/usuarios/${u.id}/ativo">
      <input type="hidden" name="ativo" value="${u.ativo ? "0" : "1"}"><button class="${u.ativo ? "perigo" : ""}">${u.ativo ? "Desativar" : "Reativar"}</button></form>`}</td>
  </tr>`).join("");
  return pagina(usuario, "Usuários", `
<div class="cartao tabela"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Situação</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div>
<form class="cartao estreito" method="post" action="/usuarios">
  <h2>Novo usuário</h2>
  ${erro ? `<p class="erro">${escaparHtml(erro)}</p>` : ""}
  <label>Nome <input name="nome" required></label>
  <label>E-mail <input name="email" type="email" required></label>
  <label>Senha (mínimo 8 caracteres) <input name="senha" type="password" minlength="8" required></label>
  <label>Papel <select name="papel"><option value="operador">Operador</option><option value="supervisor">Supervisor</option></select></label>
  <button>Criar</button>
</form>`, { mensagem });
}

export function registrarUsuarios(app: FastifyInstance, d: { repo: Repositorio }): void {
  app.get("/usuarios", { preHandler: exigirSupervisor }, async (req, reply) =>
    reply.type("text/html").send(tela(d.repo, req.usuario!, null)));

  app.post<{ Body: { nome?: string; email?: string; senha?: string; papel?: string } }>(
    "/usuarios", { preHandler: exigirSupervisor }, async (req, reply) => {
      const nome = String(req.body?.nome ?? "").trim();
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      const senha = String(req.body?.senha ?? "");
      const papel: Papel = req.body?.papel === "supervisor" ? "supervisor" : "operador";
      let erro: string | null = null;
      if (!nome || !email) erro = "Preencha nome e e-mail.";
      else if (senha.length < 8) erro = "A senha precisa ter pelo menos 8 caracteres.";
      else if (d.repo.buscarUsuarioPorEmail(email)) erro = "Já existe um usuário com esse e-mail.";
      if (erro) return reply.code(400).type("text/html").send(tela(d.repo, req.usuario!, erro));
      d.repo.criarUsuario({ nome, email, senhaHash: hashSenha(senha), papel });
      return reply.redirect("/usuarios");
    });

  app.post<{ Params: { id: string }; Body: { ativo?: string } }>(
    "/usuarios/:id/ativo", { preHandler: exigirSupervisor }, async (req, reply) => {
      const id = Number(req.params.id);
      if (id !== req.usuario!.id) d.repo.definirUsuarioAtivo(id, req.body?.ativo === "1");
      return reply.redirect("/usuarios");
    });
}
```

`servidor/src/app.ts`:
```ts
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import type { Repositorio } from "./banco/repositorio.ts";
import type { MontarFolha } from "./bling/montar-folha.ts";
import type { Config } from "./config.ts";
import { registrarApiAgente, type GerarPdf } from "./web/api-agente.ts";
import { registrarAuth } from "./web/auth.ts";
import { registrarUsuarios } from "./web/usuarios.ts";

export type DepsApp = {
  repo: Repositorio;
  config: Config;
  filialId: number;
  impressoraId: number;
  agora: () => Date;
  gerarPdf: GerarPdf;
  montarFolha: MontarFolha;
  bling: { urlAutorizacao(state: string): string; trocarCodigo(code: string): Promise<void>; estaConectado(): boolean };
};

export async function criarApp(d: DepsApp): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(formbody);
  await app.register(cookie, { secret: d.config.segredoSessao });
  registrarAuth(app, d); // primeiro: o hook de sessão precisa valer para todas as rotas
  registrarApiAgente(app, d);
  registrarUsuarios(app, d);
  return app;
}
```

`servidor/src/cli/criar-usuario.ts`:
```ts
// Uso: npm run criar-usuario -- --nome "Fulano" --email f@x.com --senha "********" --papel supervisor
import { parseArgs } from "node:util";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { carregarConfig, RAIZ } from "../config.ts";
import { abrirBanco } from "../banco/banco.ts";
import { Repositorio } from "../banco/repositorio.ts";
import { hashSenha } from "../web/auth.ts";

const { values: a } = parseArgs({
  options: {
    nome: { type: "string" }, email: { type: "string" }, senha: { type: "string" },
    papel: { type: "string", default: "operador" }, config: { type: "string", default: join(RAIZ, "servidor/config.json") },
  },
});
if (!a.nome || !a.email || !a.senha || a.senha.length < 8) {
  console.error('Uso: npm run criar-usuario -- --nome "Fulano" --email f@x.com --senha "minimo8" --papel supervisor|operador');
  process.exit(1);
}
const config = carregarConfig(a.config!);
mkdirSync(dirname(config.arquivoBanco), { recursive: true });
const repo = new Repositorio(abrirBanco(config.arquivoBanco));
const id = repo.criarUsuario({ nome: a.nome, email: a.email, senhaHash: hashSenha(a.senha), papel: a.papel === "supervisor" ? "supervisor" : "operador" });
console.log(`Usuário ${a.email} criado (id ${id}).`);
```

- [ ] **Step 4: Rodar testes e typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add servidor
git commit -m "feat: login, papéis operador/supervisor e cadastro de usuários"
```

---

### Task 10: Relatório e exportação para Excel

**Files:**
- Create: `servidor/src/relatorio.ts`, `servidor/src/web/relatorio.ts`
- Modify: `servidor/src/banco/repositorio.ts` (tipos e métodos de relatório)
- Modify: `servidor/src/app.ts` (registrar rotas)
- Test: `servidor/test/relatorio.test.ts`

**Interfaces:**
- Consumes: `Repositorio`, `exigirLogin`, `pagina`, `inicioDoDia/fimDoDia/diaLocal/formatarDataHora`.
- Produces:
  - Repositório: `type FiltroRelatorio = { de: string; ate: string; vendedor?: string; pedido?: string; soReimpressoes?: boolean }`, `type LinhaRelatorio`, `relatorio(f: FiltroRelatorio): LinhaRelatorio[]`, `linhaRelatorio(impressaoId: number): LinhaRelatorio | null`.
  - `COLUNAS_RELATORIO: string[]`, `linhaParaColunas(l: LinhaRelatorio): string[]`, `gerarCsv(linhas: LinhaRelatorio[]): string`, `ROTULO_STATUS`.
  - Rotas: `GET /relatorio`, `GET /relatorio.csv` (com os mesmos parâmetros de filtro).

- [ ] **Step 1: Escrever os testes (falhando)**

`servidor/test/relatorio.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { gerarCsv } from "../src/relatorio.ts";
import { appDeTeste, dadosFolhaExemplo, entrar } from "./ajudantes.ts";

async function comDados() {
  const c = await appDeTeste();
  const criar = (numero: string, quando: string, via = 1, vendedor = "Fulano", motivo: string | null = null, usuarioId: number | null = null) => {
    const p = c.repo.buscarPedido(c.filialId, numero) ?? { id: c.repo.inserirPedido({ filialId: c.filialId, numero, idBling: 1, situacao: 9, origem: "monitor", agora: new Date(quando) }) };
    const d = dadosFolhaExemplo(3, numero);
    d.pedido.vendedor = vendedor;
    const id = c.repo.criarImpressao({ pedidoId: p.id, impressoraId: c.impressoraId, via, dados: d, motivo, usuarioId, agora: new Date(quando) });
    c.repo.marcarImpressa(id, new Date(quando));
    return id;
  };
  criar("10", "2026-10-08T13:00:00.000Z");
  criar("11", "2026-10-09T02:50:00.000Z", 1, "Beltrano"); // 23:50 do dia 08 em SP
  criar("10", "2026-10-08T15:00:00.000Z", 2, "Fulano", "Folha perdida", c.supervisorId);
  criar("12", "2026-10-09T12:00:00.000Z");
  return c;
}

test("filtra pelo dia local (23:50 conta no próprio dia)", async () => {
  const c = await comDados();
  const linhas = c.repo.relatorio({ de: "2026-10-08", ate: "2026-10-08" });
  assert.deepEqual(linhas.map((l) => l.numero).sort(), ["10", "10", "11"]);
  assert.deepEqual(c.repo.relatorio({ de: "2026-10-09", ate: "2026-10-09" }).map((l) => l.numero), ["12"]);
});

test("filtros por vendedor, pedido e só reimpressões", async () => {
  const c = await comDados();
  const dia = { de: "2026-10-08", ate: "2026-10-09" };
  assert.deepEqual(c.repo.relatorio({ ...dia, vendedor: "beltr" }).map((l) => l.numero), ["11"]);
  assert.equal(c.repo.relatorio({ ...dia, pedido: "10" }).length, 2);
  const re = c.repo.relatorio({ ...dia, soReimpressoes: true });
  assert.equal(re.length, 1);
  assert.equal(re[0].motivo, "Folha perdida");
  assert.equal(re[0].usuario, "Sup");
  assert.equal(re[0].itens, 3);
  assert.equal(re[0].cliente, "Clínica X");
});

test("CSV abre no Excel: BOM, ponto e vírgula, aspas escapadas", () => {
  const csv = gerarCsv([{
    impressaoId: 1, criadoEm: "2026-10-08T17:32:00.000Z", impressoEm: "2026-10-08T17:32:00.000Z", numero: "10",
    cliente: 'Clínica "X"; Ltda', vendedor: null, itens: 2, via: 1, status: "impresso", impressora: "HP", usuario: null, motivo: null,
  }]);
  assert.ok(csv.startsWith("\uFEFF"));
  const [cab, linha] = csv.slice(1).trim().split("\r\n");
  assert.ok(cab.startsWith("Horário;Pedido;Cliente"));
  assert.ok(linha.includes(`"Clínica ""X""; Ltda"`));
  assert.ok(linha.startsWith("08/10/2026 14:32;10;"));
});

test("página do relatório exige login e mostra as linhas do dia", async () => {
  const c = await comDados();
  assert.equal((await c.app.inject({ url: "/relatorio" })).statusCode, 302);
  const op = await entrar(c.app, "op@x.com", "senha-op");
  const r = await c.app.inject({ url: "/relatorio?de=2026-10-08&ate=2026-10-08", headers: { cookie: op } });
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /Folha perdida/);
  const csv = await c.app.inject({ url: "/relatorio.csv?de=2026-10-08&ate=2026-10-08", headers: { cookie: op } });
  assert.equal(csv.statusCode, 200);
  assert.match(String(csv.headers["content-disposition"]), /relatorio-2026-10-08-a-2026-10-08\.csv/);
});
```

Run: `npm test`
Expected: FAIL, com "Cannot find module ... relatorio.ts".

- [ ] **Step 2: Métodos de relatório no repositório**

Em `servidor/src/banco/repositorio.ts`, acrescentar no topo `import { fimDoDia, inicioDoDia } from "../tempo.ts";` e os tipos:
```ts
export type FiltroRelatorio = { de: string; ate: string; vendedor?: string; pedido?: string; soReimpressoes?: boolean };
export type LinhaRelatorio = {
  impressaoId: number; criadoEm: string; impressoEm: string | null; numero: string; cliente: string;
  vendedor: string | null; itens: number; via: number; status: StatusImpressao; impressora: string;
  usuario: string | null; motivo: string | null;
};
```
e dentro da classe:
```ts
  static readonly SQL_RELATORIO = `
    SELECT i.id AS impressaoId, i.criado_em AS criadoEm, i.impresso_em AS impressoEm, p.numero AS numero,
      json_extract(i.dados_json, '$.cliente.nome') AS cliente, json_extract(i.dados_json, '$.pedido.vendedor') AS vendedor,
      json_array_length(i.dados_json, '$.itens') AS itens, i.via AS via, i.status AS status,
      im.nome_windows AS impressora, u.nome AS usuario, i.motivo AS motivo
    FROM impressoes i
    JOIN pedidos p ON p.id = i.pedido_id
    JOIN impressoras im ON im.id = i.impressora_id
    LEFT JOIN usuarios u ON u.id = i.usuario_id`;

  relatorio(f: FiltroRelatorio): LinhaRelatorio[] {
    const onde = ["i.criado_em BETWEEN ? AND ?"];
    const params: Param[] = [inicioDoDia(f.de), fimDoDia(f.ate)];
    if (f.vendedor) { onde.push("json_extract(i.dados_json, '$.pedido.vendedor') LIKE ?"); params.push(`%${f.vendedor}%`); }
    if (f.pedido) { onde.push("p.numero = ?"); params.push(f.pedido.trim()); }
    if (f.soReimpressoes) onde.push("i.via > 1");
    return this.todos<LinhaRelatorio>(`${Repositorio.SQL_RELATORIO} WHERE ${onde.join(" AND ")} ORDER BY i.id DESC`, ...params);
  }

  linhaRelatorio(impressaoId: number): LinhaRelatorio | null {
    return this.um<LinhaRelatorio>(`${Repositorio.SQL_RELATORIO} WHERE i.id = ?`, impressaoId);
  }
```
(O `LIKE` do SQLite ignora maiúsculas/minúsculas em letras ASCII. Basta para nomes de vendedor.)

- [ ] **Step 3: Implementar relatório e rotas**

`servidor/src/relatorio.ts`:
```ts
import type { LinhaRelatorio, StatusImpressao } from "./banco/repositorio.ts";
import { formatarDataHora } from "./tempo.ts";

export const ROTULO_STATUS: Record<StatusImpressao, string> = {
  fila: "Na fila", imprimindo: "Imprimindo", impresso: "Impresso", erro: "Erro",
};

export const COLUNAS_RELATORIO = ["Horário", "Pedido", "Cliente", "Vendedor", "Itens", "Via", "Status", "Impressora", "Reimpresso por", "Motivo"];

export function linhaParaColunas(l: LinhaRelatorio): string[] {
  return [
    formatarDataHora(l.impressoEm ?? l.criadoEm), l.numero, l.cliente ?? "", l.vendedor ?? "", String(l.itens),
    `${l.via}ª`, ROTULO_STATUS[l.status], l.impressora, l.usuario ?? "", l.motivo ?? "",
  ];
}

const celula = (s: string) => (/[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

// Excel em português abre direto: BOM UTF-8 + ponto e vírgula.
export function gerarCsv(linhas: LinhaRelatorio[]): string {
  const todas = [COLUNAS_RELATORIO, ...linhas.map(linhaParaColunas)];
  return "\uFEFF" + todas.map((l) => l.map(celula).join(";")).join("\r\n") + "\r\n";
}
```

`servidor/src/web/relatorio.ts`:
```ts
import type { FastifyInstance } from "fastify";
import type { FiltroRelatorio, Repositorio } from "../banco/repositorio.ts";
import { escaparHtml } from "../html-util.ts";
import { COLUNAS_RELATORIO, gerarCsv, linhaParaColunas } from "../relatorio.ts";
import { diaLocal } from "../tempo.ts";
import { exigirLogin } from "./auth.ts";
import { pagina } from "./layout.ts";

type Query = { de?: string; ate?: string; vendedor?: string; pedido?: string; so?: string };
const DIA = /^\d{4}-\d{2}-\d{2}$/;

function lerFiltro(q: Query, hoje: string): FiltroRelatorio {
  return {
    de: q.de && DIA.test(q.de) ? q.de : hoje,
    ate: q.ate && DIA.test(q.ate) ? q.ate : hoje,
    vendedor: q.vendedor?.trim() || undefined,
    pedido: q.pedido?.trim() || undefined,
    soReimpressoes: q.so === "1",
  };
}

export function registrarRelatorio(app: FastifyInstance, d: { repo: Repositorio; agora: () => Date }): void {
  app.get<{ Querystring: Query }>("/relatorio", { preHandler: exigirLogin }, async (req, reply) => {
    const f = lerFiltro(req.query, diaLocal(d.agora()));
    const linhas = d.repo.relatorio(f);
    const qs = new URLSearchParams({ de: f.de, ate: f.ate, vendedor: f.vendedor ?? "", pedido: f.pedido ?? "", so: f.soReimpressoes ? "1" : "" });
    const corpo = linhas.map((l) => `<tr>${linhaParaColunas(l).map((c, i) =>
      i === 1 ? `<td><a href="/pedidos?numero=${encodeURIComponent(c)}">${escaparHtml(c)}</a></td>` : `<td>${escaparHtml(c)}</td>`).join("")}</tr>`).join("");
    return reply.type("text/html").send(pagina(req.usuario, "Relatório de impressões", `
<form class="cartao filtros" method="get">
  <label>De <input type="date" name="de" value="${f.de}"></label>
  <label>Até <input type="date" name="ate" value="${f.ate}"></label>
  <label>Vendedor <input name="vendedor" value="${escaparHtml(f.vendedor)}"></label>
  <label>Pedido <input name="pedido" value="${escaparHtml(f.pedido)}"></label>
  <label><input type="checkbox" name="so" value="1" ${f.soReimpressoes ? "checked" : ""} style="display:inline;width:auto"> Só reimpressões</label>
  <button>Filtrar</button>
  <a class="botao" href="/relatorio.csv?${qs}">Exportar para Excel</a>
</form>
<p>${linhas.length} impressão(ões)</p>
<div class="tabela"><table><thead><tr>${COLUNAS_RELATORIO.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${corpo}</tbody></table></div>`));
  });

  app.get<{ Querystring: Query }>("/relatorio.csv", { preHandler: exigirLogin }, async (req, reply) => {
    const f = lerFiltro(req.query, diaLocal(d.agora()));
    return reply
      .type("text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="relatorio-${f.de}-a-${f.ate}.csv"`)
      .send(gerarCsv(d.repo.relatorio(f)));
  });
}
```

Em `servidor/src/app.ts`, importar `registrarRelatorio` de `./web/relatorio.ts` e chamar `registrarRelatorio(app, d);` depois de `registrarUsuarios(app, d);`.

- [ ] **Step 4: Rodar testes e typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add servidor
git commit -m "feat: relatório de impressões com filtros e exportação para Excel"
```

---

### Task 11: Painel, alertas e indicadores de status

**Files:**
- Create: `servidor/src/status.ts`, `servidor/src/web/painel.ts`, `servidor/src/web/alertas.ts`
- Modify: `servidor/src/banco/repositorio.ts` (métodos de alertas e contadores)
- Modify: `servidor/src/app.ts`
- Test: `servidor/test/painel.test.ts`

**Interfaces:**
- Consumes: `Repositorio`, `imprimirPendentes` (Task 7), `exigirLogin/exigirSupervisor`, `pagina`, tempo.
- Produces:
  - Repositório: `type AlertaView = { id: number; tipo: TipoAlerta; pedido_id: number | null; numero: string | null; mensagem: string; criado_em: string }`, `alertasPendentes(): AlertaView[]`, `alertasDoPedido(pedidoId: number): AlertaView[]`, `resolverAlerta(id: number, usuarioId: number | null, agora: Date): void`, `resolverAlertasDoTipo(tipo: TipoAlerta, usuarioId: number | null, agora: Date, pedidoId?: number): void`, `contadoresDoDia(dia: string): { impressos: number; naFila: number; alertas: number }`, `ultimaComunicacaoAgente(impressoraId: number): string | null`, `contarErros(impressoraId: number): number`.
  - `type Indicador = { ok: boolean; texto: string }`, `statusSistema(repo, impressoraId: number, agora: Date): { bling: Indicador; agente: Indicador; impressora: Indicador }`, `AGENTE_OFFLINE_MS = 120_000`.
  - Rotas: `GET /`, `POST /fila/imprimir-pendentes` (supervisor), `GET /alertas`, `POST /alertas/:id/resolver` (supervisor).

- [ ] **Step 1: Escrever os testes (falhando)**

`servidor/test/painel.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { statusSistema } from "../src/status.ts";
import { AGORA, appDeTeste, bancoDeTeste, dadosFolhaExemplo, entrar } from "./ajudantes.ts";

test("status: Bling com erro, agente offline, impressora com erro", () => {
  const b = bancoDeTeste();
  let s = statusSistema(b.repo, b.impressoraId, AGORA);
  assert.equal(s.bling.ok, false);
  assert.match(s.bling.texto, /Ainda não consultou/);
  assert.equal(s.agente.ok, false);
  assert.equal(s.impressora.ok, true);

  b.repo.definirEstado("bling:ultima_consulta", AGORA.toISOString());
  b.repo.registrarComunicacaoAgente(b.agenteId, new Date(AGORA.getTime() - 60_000));
  s = statusSistema(b.repo, b.impressoraId, AGORA);
  assert.equal(s.bling.ok, true);
  assert.equal(s.agente.ok, true);

  b.repo.definirEstado("bling:erro_desde", AGORA.toISOString());
  b.repo.definirEstado("bling:erro_msg", "timeout");
  b.repo.registrarComunicacaoAgente(b.agenteId, new Date(AGORA.getTime() - 3 * 60_000));
  const pedidoId = b.repo.inserirPedido({ filialId: b.filialId, numero: "1", idBling: 1, situacao: 9, origem: "monitor", agora: AGORA });
  const id = b.repo.criarImpressao({ pedidoId, impressoraId: b.impressoraId, via: 1, dados: dadosFolhaExemplo(), motivo: null, usuarioId: null, agora: AGORA });
  b.repo.marcarFalha(id, "x", "erro");
  s = statusSistema(b.repo, b.impressoraId, AGORA);
  assert.match(s.bling.texto, /Sem conexão com o Bling desde 08\/10\/2026 14:32: timeout/);
  assert.match(s.agente.texto, /sem resposta desde 08\/10\/2026 14:29/);
  assert.equal(s.impressora.ok, false);
  assert.match(s.impressora.texto, /1 impressão\(ões\) com erro/);
});

async function comAlertaEErro() {
  const c = await appDeTeste();
  const pedidoId = c.repo.inserirPedido({ filialId: c.filialId, numero: "10", idBling: 1010, situacao: 9, origem: "monitor", agora: AGORA });
  const imp = c.repo.criarImpressao({ pedidoId, impressoraId: c.impressoraId, via: 1, dados: dadosFolhaExemplo(1, "10"), motivo: null, usuarioId: null, agora: AGORA });
  c.repo.marcarFalha(imp, "sem papel", "erro");
  const alertaId = c.repo.criarAlerta({ tipo: "falha_impressao", pedidoId, mensagem: "Pedido 10: falhou", agora: AGORA });
  return { ...c, pedidoId, imp, alertaId };
}

test("painel mostra contadores e alertas", async () => {
  const c = await comAlertaEErro();
  const op = await entrar(c.app, "op@x.com", "senha-op");
  const r = await c.app.inject({ url: "/", headers: { cookie: op } });
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /Pedido 10: falhou/);
  assert.match(r.body, /http-equiv="refresh"/);
  assert.doesNotMatch(r.body, /Imprimir pendentes/); // operador não vê o botão
});

test("operador não resolve alerta nem reenfileira; supervisor sim", async () => {
  const c = await comAlertaEErro();
  const op = await entrar(c.app, "op@x.com", "senha-op");
  assert.equal((await c.app.inject({ method: "POST", url: `/alertas/${c.alertaId}/resolver`, headers: { cookie: op } })).statusCode, 403);
  assert.equal((await c.app.inject({ method: "POST", url: "/fila/imprimir-pendentes", headers: { cookie: op } })).statusCode, 403);

  const sup = await entrar(c.app, "sup@x.com", "senha-sup");
  const r = await c.app.inject({ method: "POST", url: "/fila/imprimir-pendentes", headers: { cookie: sup } });
  assert.equal(r.statusCode, 302);
  assert.equal(c.repo.buscarImpressao(c.imp)!.status, "fila");
  assert.equal(c.repo.alertasPendentes().length, 0); // alertas de falha resolvidos junto
});

test("resolver alerta registra quem resolveu", async () => {
  const c = await comAlertaEErro();
  const sup = await entrar(c.app, "sup@x.com", "senha-sup");
  await c.app.inject({ method: "POST", url: `/alertas/${c.alertaId}/resolver`, headers: { cookie: sup } });
  const a = c.repo.db.prepare("SELECT resolvido_por, resolvido_em FROM alertas WHERE id = ?").get(c.alertaId) as { resolvido_por: number; resolvido_em: string };
  assert.equal(a.resolvido_por, c.supervisorId);
  assert.equal(a.resolvido_em, AGORA.toISOString());
});

test("contadores do dia usam o dia local", () => {
  const b = bancoDeTeste();
  const pedidoId = b.repo.inserirPedido({ filialId: b.filialId, numero: "1", idBling: 1, situacao: 9, origem: "monitor", agora: AGORA });
  const id = b.repo.criarImpressao({ pedidoId, impressoraId: b.impressoraId, via: 1, dados: dadosFolhaExemplo(), motivo: null, usuarioId: null, agora: AGORA });
  b.repo.marcarImpressa(id, new Date("2026-10-09T02:50:00.000Z"));
  assert.equal(b.repo.contadoresDoDia("2026-10-08").impressos, 1);
  assert.equal(b.repo.contadoresDoDia("2026-10-09").impressos, 0);
});
```

Run: `npm test`
Expected: FAIL, com "Cannot find module ... status.ts".

- [ ] **Step 2: Métodos no repositório**

Em `servidor/src/banco/repositorio.ts`, acrescentar o tipo:
```ts
export type AlertaView = { id: number; tipo: TipoAlerta; pedido_id: number | null; numero: string | null; mensagem: string; criado_em: string };
```
e os métodos dentro da classe (na seção de alertas):
```ts
  alertasPendentes(): AlertaView[] {
    return this.todos<AlertaView>(
      `SELECT a.id, a.tipo, a.pedido_id, p.numero, a.mensagem, a.criado_em
       FROM alertas a LEFT JOIN pedidos p ON p.id = a.pedido_id
       WHERE a.resolvido_em IS NULL ORDER BY a.id DESC`,
    );
  }

  alertasDoPedido(pedidoId: number): AlertaView[] {
    return this.todos<AlertaView>(
      `SELECT a.id, a.tipo, a.pedido_id, p.numero, a.mensagem, a.criado_em
       FROM alertas a LEFT JOIN pedidos p ON p.id = a.pedido_id
       WHERE a.pedido_id = ? AND a.resolvido_em IS NULL ORDER BY a.id DESC`,
      pedidoId,
    );
  }

  resolverAlerta(id: number, usuarioId: number | null, agora: Date): void {
    this.exec("UPDATE alertas SET resolvido_por = ?, resolvido_em = ? WHERE id = ? AND resolvido_em IS NULL", usuarioId, agora.toISOString(), id);
  }

  resolverAlertasDoTipo(tipo: TipoAlerta, usuarioId: number | null, agora: Date, pedidoId?: number): void {
    if (pedidoId === undefined) {
      this.exec("UPDATE alertas SET resolvido_por = ?, resolvido_em = ? WHERE tipo = ? AND resolvido_em IS NULL", usuarioId, agora.toISOString(), tipo);
    } else {
      this.exec(
        "UPDATE alertas SET resolvido_por = ?, resolvido_em = ? WHERE tipo = ? AND pedido_id = ? AND resolvido_em IS NULL",
        usuarioId, agora.toISOString(), tipo, pedidoId,
      );
    }
  }

  contadoresDoDia(dia: string): { impressos: number; naFila: number; alertas: number } {
    const impressos = this.um<{ n: number }>(
      "SELECT COUNT(*) AS n FROM impressoes WHERE status = 'impresso' AND impresso_em BETWEEN ? AND ?", inicioDoDia(dia), fimDoDia(dia),
    )!.n;
    const naFila = this.um<{ n: number }>("SELECT COUNT(*) AS n FROM impressoes WHERE status IN ('fila', 'imprimindo')")!.n;
    const alertas = this.um<{ n: number }>("SELECT COUNT(*) AS n FROM alertas WHERE resolvido_em IS NULL")!.n;
    return { impressos, naFila, alertas };
  }

  ultimaComunicacaoAgente(impressoraId: number): string | null {
    return this.um<{ u: string | null }>(
      "SELECT a.ultima_comunicacao AS u FROM impressoras i JOIN agentes a ON a.id = i.agente_id WHERE i.id = ?", impressoraId,
    )?.u ?? null;
  }

  contarErros(impressoraId: number): number {
    return this.um<{ n: number }>("SELECT COUNT(*) AS n FROM impressoes WHERE impressora_id = ? AND status = 'erro'", impressoraId)!.n;
  }
```

- [ ] **Step 3: Implementar status, painel e alertas**

`servidor/src/status.ts`:
```ts
import type { Repositorio } from "./banco/repositorio.ts";
import { formatarDataHora, formatarHora } from "./tempo.ts";

export type Indicador = { ok: boolean; texto: string };
export const AGENTE_OFFLINE_MS = 2 * 60_000;

export function statusSistema(repo: Repositorio, impressoraId: number, agora: Date): { bling: Indicador; agente: Indicador; impressora: Indicador } {
  const erroDesde = repo.obterEstado("bling:erro_desde");
  const ultima = repo.obterEstado("bling:ultima_consulta");
  const bling: Indicador = erroDesde
    ? { ok: false, texto: `Sem conexão com o Bling desde ${formatarDataHora(erroDesde)}: ${repo.obterEstado("bling:erro_msg") ?? ""}` }
    : ultima
      ? { ok: true, texto: `Bling OK (última consulta ${formatarHora(ultima)})` }
      : { ok: false, texto: "Ainda não consultou o Bling" };

  const com = repo.ultimaComunicacaoAgente(impressoraId);
  const agente: Indicador = !com
    ? { ok: false, texto: "Agente de impressão nunca se conectou" }
    : agora.getTime() - new Date(com).getTime() > AGENTE_OFFLINE_MS
      ? { ok: false, texto: `Agente de impressão sem resposta desde ${formatarDataHora(com)}` }
      : { ok: true, texto: `Agente OK (${formatarHora(com)})` };

  const erros = repo.contarErros(impressoraId);
  const impressora: Indicador = erros
    ? { ok: false, texto: `${erros} impressão(ões) com erro` }
    : { ok: true, texto: "Impressora OK" };

  return { bling, agente, impressora };
}
```

`servidor/src/web/alertas.ts`:
```ts
import type { FastifyInstance } from "fastify";
import type { AlertaView, Repositorio } from "../banco/repositorio.ts";
import { escaparHtml } from "../html-util.ts";
import { formatarDataHora } from "../tempo.ts";
import { exigirLogin, exigirSupervisor, type UsuarioSessao } from "./auth.ts";
import { pagina } from "./layout.ts";

const TITULO: Record<AlertaView["tipo"], string> = {
  repetido: "Pedido repetido", cancelado: "Cancelado após impressão", falha_impressao: "Falha de impressão",
  retomada: "Retomada", bling_desconectado: "Bling desconectado",
};

export function listaAlertas(alertas: AlertaView[], usuario: UsuarioSessao): string {
  if (!alertas.length) return `<p class="ok">Nenhum alerta pendente.</p>`;
  return alertas.map((a) => `<div class="cartao alerta">
    <b>${TITULO[a.tipo]}</b> · ${formatarDataHora(a.criado_em)}
    <p>${escaparHtml(a.mensagem)}</p>
    ${a.pedido_id ? `<a class="botao" href="/pedidos/${a.pedido_id}">Abrir pedido ${escaparHtml(a.numero)}</a> ` : ""}
    ${usuario.papel === "supervisor" ? `<form class="inline" method="post" action="/alertas/${a.id}/resolver"><button>Marcar como resolvido</button></form>` : ""}
  </div>`).join("");
}

export function registrarAlertas(app: FastifyInstance, d: { repo: Repositorio; agora: () => Date }): void {
  app.get("/alertas", { preHandler: exigirLogin }, async (req, reply) =>
    reply.type("text/html").send(pagina(req.usuario, "Alertas", listaAlertas(d.repo.alertasPendentes(), req.usuario!), { atualizarSegundos: 30 })));

  app.post<{ Params: { id: string } }>("/alertas/:id/resolver", { preHandler: exigirSupervisor }, async (req, reply) => {
    d.repo.resolverAlerta(Number(req.params.id), req.usuario!.id, d.agora());
    return reply.redirect(String(req.headers.referer ?? "/alertas"));
  });
}
```

`servidor/src/web/painel.ts`:
```ts
import type { FastifyInstance } from "fastify";
import type { Repositorio } from "../banco/repositorio.ts";
import { imprimirPendentes } from "../fila/fila.ts";
import { escaparHtml } from "../html-util.ts";
import { linhaParaColunas, COLUNAS_RELATORIO } from "../relatorio.ts";
import { statusSistema, type Indicador } from "../status.ts";
import { diaLocal } from "../tempo.ts";
import { listaAlertas } from "./alertas.ts";
import { exigirLogin, exigirSupervisor } from "./auth.ts";
import { pagina } from "./layout.ts";

const ind = (i: Indicador) => `<div><span class="bolinha ${i.ok ? "ok" : "ruim"}"></span>${escaparHtml(i.texto)}</div>`;

export function registrarPainel(app: FastifyInstance, d: { repo: Repositorio; impressoraId: number; agora: () => Date }): void {
  app.get<{ Querystring: { reenfileirados?: string } }>("/", { preHandler: exigirLogin }, async (req, reply) => {
    const agora = d.agora();
    const hoje = diaLocal(agora);
    const s = statusSistema(d.repo, d.impressoraId, agora);
    const c = d.repo.contadoresDoDia(hoje);
    const supervisor = req.usuario!.papel === "supervisor";
    const recentes = d.repo.relatorio({ de: hoje, ate: hoje }).slice(0, 20);
    const mensagem = req.query.reenfileirados !== undefined ? `${Number(req.query.reenfileirados)} impressão(ões) devolvida(s) para a fila.` : undefined;

    const html = `
<div class="cartao">${ind(s.bling)}${ind(s.agente)}${ind(s.impressora)}
  ${supervisor && !s.impressora.ok ? `<form method="post" action="/fila/imprimir-pendentes" style="margin-top:8px"><button>Imprimir pendentes</button></form>` : ""}
</div>
<div class="grade">
  <div class="cartao"><div class="numero">${c.impressos}</div>impressos hoje</div>
  <div class="cartao"><div class="numero">${c.naFila}</div>na fila</div>
  <div class="cartao"><div class="numero ${c.alertas ? "atencao" : ""}">${c.alertas}</div>alertas pendentes</div>
</div>
<h2>Alertas</h2>
${listaAlertas(d.repo.alertasPendentes().slice(0, 5), req.usuario!)}
<h2>Últimas impressões de hoje</h2>
<div class="tabela"><table><thead><tr>${COLUNAS_RELATORIO.map((col) => `<th>${col}</th>`).join("")}</tr></thead>
<tbody>${recentes.map((l) => `<tr>${linhaParaColunas(l).map((col) => `<td>${escaparHtml(col)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    return reply.type("text/html").send(pagina(req.usuario, "Painel", html, { atualizarSegundos: 30, mensagem }));
  });

  app.post("/fila/imprimir-pendentes", { preHandler: exigirSupervisor }, async (req, reply) => {
    const n = imprimirPendentes(d.repo, d.impressoraId);
    d.repo.resolverAlertasDoTipo("falha_impressao", req.usuario!.id, d.agora());
    return reply.redirect(`/?reenfileirados=${n}`);
  });
}
```

Em `servidor/src/app.ts`, importar e chamar `registrarPainel(app, d);` e `registrarAlertas(app, d);` depois de `registrarRelatorio(app, d);`.

- [ ] **Step 4: Rodar testes e typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add servidor
git commit -m "feat: painel com status, contadores e alertas"
```

---

### Task 12: Página do pedido e reimpressão com justificativa

**Files:**
- Create: `servidor/src/web/pedidos.ts`
- Modify: `servidor/src/banco/repositorio.ts` (`impressoesDoPedido`)
- Modify: `servidor/src/app.ts`
- Test: `servidor/test/pedidos.test.ts`

**Interfaces:**
- Consumes: `reimprimir` (Task 7), `alertasDoPedido`, `resolverAlertasDoTipo` (Task 11), `listaAlertas` (Task 11), `ROTULO_STATUS` (Task 10), `DepsApp.montarFolha`.
- Produces:
  - Repositório: `type ImpressaoView = { id: number; via: number; status: StatusImpressao; criado_em: string; impresso_em: string | null; motivo: string | null; usuario: string | null; ultimo_erro: string | null }`, `impressoesDoPedido(pedidoId: number): ImpressaoView[]`.
  - `MOTIVOS_REIMPRESSAO = ["Folha perdida", "Folha danificada", "Pedido alterado", "Erro na impressora", "Outro"]`.
  - Rotas: `GET /pedidos` (busca por `?numero=`), `GET /pedidos/:id`, `POST /pedidos/:id/reimprimir` (supervisor; corpo `motivo`, `outro`).

- [ ] **Step 1: Escrever os testes (falhando)**

`servidor/test/pedidos.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { AGORA, appDeTeste, dadosFolhaExemplo, entrar } from "./ajudantes.ts";

async function comPedido(extra = {}) {
  const c = await appDeTeste(extra);
  const pedidoId = c.repo.inserirPedido({ filialId: c.filialId, numero: "10", idBling: 1010, situacao: 9, origem: "monitor", agora: AGORA });
  const imp = c.repo.criarImpressao({ pedidoId, impressoraId: c.impressoraId, via: 1, dados: dadosFolhaExemplo(1, "10"), motivo: null, usuarioId: null, agora: AGORA });
  c.repo.marcarImpressa(imp, AGORA);
  c.repo.criarAlerta({ tipo: "repetido", pedidoId, mensagem: "Pedido 10 voltou para Atendido", agora: AGORA });
  return { ...c, pedidoId };
}

test("busca por número redireciona para o pedido", async () => {
  const c = await comPedido();
  const op = await entrar(c.app, "op@x.com", "senha-op");
  const r = await c.app.inject({ url: "/pedidos?numero=10", headers: { cookie: op } });
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, `/pedidos/${c.pedidoId}`);
  const nao = await c.app.inject({ url: "/pedidos?numero=999", headers: { cookie: op } });
  assert.match(nao.body, /Pedido 999 não encontrado/);
});

test("operador vê histórico mas não o formulário de reimpressão", async () => {
  const c = await comPedido();
  const op = await entrar(c.app, "op@x.com", "senha-op");
  const r = await c.app.inject({ url: `/pedidos/${c.pedidoId}`, headers: { cookie: op } });
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /1ª via/);
  assert.doesNotMatch(r.body, /action="\/pedidos\/\d+\/reimprimir"/);
  const post = await c.app.inject({ method: "POST", url: `/pedidos/${c.pedidoId}/reimprimir`, headers: { cookie: op }, payload: { motivo: "Folha perdida" } });
  assert.equal(post.statusCode, 403);
});

test("supervisor reimprime: cria 2ª via e resolve alerta de repetido", async () => {
  const c = await comPedido();
  const sup = await entrar(c.app, "sup@x.com", "senha-sup");
  const r = await c.app.inject({ method: "POST", url: `/pedidos/${c.pedidoId}/reimprimir`, headers: { cookie: sup }, payload: { motivo: "Folha perdida" } });
  assert.equal(r.statusCode, 302);
  const ult = c.repo.ultimaImpressao(c.pedidoId)!;
  assert.equal(ult.via, 2);
  assert.equal(ult.motivo, "Folha perdida");
  assert.equal(ult.usuario_id, c.supervisorId);
  assert.equal(ult.status, "fila");
  assert.equal(c.repo.alertasDoPedido(c.pedidoId).length, 0);
});

test("motivo Outro exige texto; motivo inválido é recusado", async () => {
  const c = await comPedido();
  const sup = await entrar(c.app, "sup@x.com", "senha-sup");
  const semTexto = await c.app.inject({ method: "POST", url: `/pedidos/${c.pedidoId}/reimprimir`, headers: { cookie: sup }, payload: { motivo: "Outro", outro: "  " } });
  assert.equal(semTexto.statusCode, 400);
  const invalido = await c.app.inject({ method: "POST", url: `/pedidos/${c.pedidoId}/reimprimir`, headers: { cookie: sup }, payload: { motivo: "Porque sim" } });
  assert.equal(invalido.statusCode, 400);
  const comTexto = await c.app.inject({ method: "POST", url: `/pedidos/${c.pedidoId}/reimprimir`, headers: { cookie: sup }, payload: { motivo: "Outro", outro: "Cliente pediu cópia" } });
  assert.equal(comTexto.statusCode, 302);
  assert.equal(c.repo.ultimaImpressao(c.pedidoId)!.motivo, "Outro: Cliente pediu cópia");
});

test("Bling fora do ar na reimpressão mostra erro e não cria via", async () => {
  const c = await comPedido({ montarFolha: async () => { throw new Error("Bling 503"); } });
  const sup = await entrar(c.app, "sup@x.com", "senha-sup");
  const r = await c.app.inject({ method: "POST", url: `/pedidos/${c.pedidoId}/reimprimir`, headers: { cookie: sup }, payload: { motivo: "Folha perdida" } });
  assert.equal(r.statusCode, 502);
  assert.match(r.body, /Bling 503/);
  assert.equal(c.repo.ultimaImpressao(c.pedidoId)!.via, 1);
});
```

Run: `npm test`
Expected: FAIL (rotas inexistentes → 404).

- [ ] **Step 2: Método no repositório**

Em `servidor/src/banco/repositorio.ts`, acrescentar o tipo:
```ts
export type ImpressaoView = {
  id: number; via: number; status: StatusImpressao; criado_em: string; impresso_em: string | null;
  motivo: string | null; usuario: string | null; ultimo_erro: string | null;
};
```
e o método na seção de impressões:
```ts
  impressoesDoPedido(pedidoId: number): ImpressaoView[] {
    return this.todos<ImpressaoView>(
      `SELECT i.id, i.via, i.status, i.criado_em, i.impresso_em, i.motivo, u.nome AS usuario, i.ultimo_erro
       FROM impressoes i LEFT JOIN usuarios u ON u.id = i.usuario_id
       WHERE i.pedido_id = ? ORDER BY i.id`,
      pedidoId,
    );
  }
```

- [ ] **Step 3: Implementar as rotas**

`servidor/src/web/pedidos.ts`:
```ts
import type { FastifyInstance } from "fastify";
import type { Repositorio } from "../banco/repositorio.ts";
import type { MontarFolha } from "../bling/montar-folha.ts";
import { reimprimir } from "../fila/fila.ts";
import { escaparHtml } from "../html-util.ts";
import { ROTULO_STATUS } from "../relatorio.ts";
import { formatarDataHora } from "../tempo.ts";
import { listaAlertas } from "./alertas.ts";
import { exigirLogin, exigirSupervisor, type UsuarioSessao } from "./auth.ts";
import { pagina } from "./layout.ts";

export const MOTIVOS_REIMPRESSAO = ["Folha perdida", "Folha danificada", "Pedido alterado", "Erro na impressora", "Outro"];

type DepsPedidos = { repo: Repositorio; filialId: number; impressoraId: number; montarFolha: MontarFolha; agora: () => Date };

function telaPedido(d: DepsPedidos, pedidoId: number, usuario: UsuarioSessao, erro: string | null): string | null {
  const p = d.repo.buscarPedidoPorId(pedidoId);
  if (!p) return null;
  const imps = d.repo.impressoesDoPedido(p.id);
  const linhas = imps.map((i) => `<tr><td>${i.via}ª via</td><td>${ROTULO_STATUS[i.status]}</td>
    <td>${formatarDataHora(i.impresso_em ?? i.criado_em)}</td><td>${escaparHtml(i.usuario) || "Automática"}</td>
    <td>${escaparHtml(i.motivo)}</td><td>${escaparHtml(i.ultimo_erro)}</td></tr>`).join("");
  const form = usuario.papel === "supervisor" ? `
<form class="cartao estreito" method="post" action="/pedidos/${p.id}/reimprimir">
  <h2>Reimprimir</h2>
  ${erro ? `<p class="erro">${escaparHtml(erro)}</p>` : ""}
  <label>Motivo <select name="motivo">${MOTIVOS_REIMPRESSAO.map((m) => `<option>${m}</option>`).join("")}</select></label>
  <label>Se for "Outro", explique <input name="outro" maxlength="200"></label>
  <button>Reimprimir (sai como ${d.repo.proximaVia(p.id)}ª via)</button>
</form>` : "";
  return pagina(usuario, `Pedido ${p.numero}`, `
<div class="cartao">
  <div><b>Detectado em:</b> ${formatarDataHora(p.detectado_em)} ${p.origem === "baseline" ? "(já estava Atendido quando o sistema foi ligado)" : ""}</div>
  <div><b>Situação no Bling (id):</b> ${p.situacao}</div>
</div>
${listaAlertas(d.repo.alertasDoPedido(p.id), usuario)}
<h2>Impressões</h2>
<div class="tabela"><table><thead><tr><th>Via</th><th>Status</th><th>Quando</th><th>Por</th><th>Motivo</th><th>Erro</th></tr></thead>
<tbody>${linhas || `<tr><td colspan="6">Nenhuma impressão.</td></tr>`}</tbody></table></div>
${form}`);
}

export function registrarPedidos(app: FastifyInstance, d: DepsPedidos): void {
  app.get<{ Querystring: { numero?: string } }>("/pedidos", { preHandler: exigirLogin }, async (req, reply) => {
    const numero = req.query.numero?.trim();
    if (numero) {
      const p = d.repo.buscarPedido(d.filialId, numero);
      if (p) return reply.redirect(`/pedidos/${p.id}`);
    }
    return reply.type("text/html").send(pagina(req.usuario, "Pedidos", `
${numero ? `<p class="erro">Pedido ${escaparHtml(numero)} não encontrado no sistema.</p>` : ""}
<form class="cartao filtros" method="get"><label>Número do pedido <input name="numero" autofocus></label><button>Buscar</button></form>`));
  });

  app.get<{ Params: { id: string } }>("/pedidos/:id", { preHandler: exigirLogin }, async (req, reply) => {
    const html = telaPedido(d, Number(req.params.id), req.usuario!, null);
    if (!html) return reply.code(404).type("text/html").send(pagina(req.usuario, "Não encontrado", "<p>Pedido não encontrado.</p>"));
    return reply.type("text/html").send(html);
  });

  app.post<{ Params: { id: string }; Body: { motivo?: string; outro?: string } }>(
    "/pedidos/:id/reimprimir", { preHandler: exigirSupervisor }, async (req, reply) => {
      const pedidoId = Number(req.params.id);
      if (!d.repo.buscarPedidoPorId(pedidoId)) return reply.code(404).send();
      const escolhido = String(req.body?.motivo ?? "");
      const outro = String(req.body?.outro ?? "").trim();
      let erro: string | null = null;
      if (!MOTIVOS_REIMPRESSAO.includes(escolhido)) erro = "Escolha um motivo da lista.";
      else if (escolhido === "Outro" && !outro) erro = 'Explique o motivo quando escolher "Outro".';
      if (erro) return reply.code(400).type("text/html").send(telaPedido(d, pedidoId, req.usuario!, erro));

      const motivo = escolhido === "Outro" ? `Outro: ${outro}` : escolhido;
      try {
        await reimprimir(d.repo, d.montarFolha, { pedidoId, impressoraId: d.impressoraId, motivo, usuarioId: req.usuario!.id, agora: d.agora() });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.code(502).type("text/html").send(telaPedido(d, pedidoId, req.usuario!, `Não foi possível buscar o pedido no Bling: ${msg}`));
      }
      d.repo.resolverAlertasDoTipo("repetido", req.usuario!.id, d.agora(), pedidoId);
      return reply.redirect(`/pedidos/${pedidoId}`);
    });
}
```

Em `servidor/src/app.ts`, importar e chamar `registrarPedidos(app, d);` depois de `registrarAlertas(app, d);`.

- [ ] **Step 4: Rodar testes e typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add servidor
git commit -m "feat: página do pedido e reimpressão com justificativa"
```

---

### Task 13: Conexão com o Bling e página de configuração

**Files:**
- Create: `servidor/src/web/config.ts`
- Modify: `servidor/src/app.ts`
- Test: `servidor/test/config-web.test.ts`

**Interfaces:**
- Consumes: `DepsApp.bling` (`urlAutorizacao`, `trocarCodigo`, `estaConectado`), `resolverAlertasDoTipo`, `statusSistema`.
- Produces: rotas `GET /config` (supervisor), `GET /bling/conectar` (supervisor), `GET /bling/callback?code&state` (sem login: o cookie `SameSite=Strict` não volta no redirecionamento vindo do Bling, e quem protege essa rota é o `state` de uso único). Chave de estado `bling:oauth_state` = `"<state>:<usuarioId>"`.

- [ ] **Step 1: Escrever os testes (falhando)**

`servidor/test/config-web.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { AGORA, appDeTeste, entrar } from "./ajudantes.ts";

test("operador não acessa configuração", async () => {
  const c = await appDeTeste();
  const op = await entrar(c.app, "op@x.com", "senha-op");
  assert.equal((await c.app.inject({ url: "/config", headers: { cookie: op } })).statusCode, 403);
  assert.equal((await c.app.inject({ url: "/bling/conectar", headers: { cookie: op } })).statusCode, 403);
});

test("configuração mostra filial, impressora e estado da conexão", async () => {
  const c = await appDeTeste();
  const sup = await entrar(c.app, "sup@x.com", "senha-sup");
  const r = await c.app.inject({ url: "/config", headers: { cookie: sup } });
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /Espírito Santo/);
  assert.match(r.body, /HP A4/);
  assert.match(r.body, /Reconectar ao Bling/);
});

test("fluxo OAuth: conectar guarda state, callback troca código e resolve alerta", async () => {
  let codigoRecebido = "";
  const c = await appDeTeste({ bling: { urlAutorizacao: (s) => `https://bling.test/auth?state=${s}`, trocarCodigo: async (code) => { codigoRecebido = code; }, estaConectado: () => true } });
  c.repo.criarAlerta({ tipo: "bling_desconectado", pedidoId: null, mensagem: "x", agora: AGORA });
  c.repo.definirEstado("bling:erro_desde", AGORA.toISOString());
  const sup = await entrar(c.app, "sup@x.com", "senha-sup");

  const ir = await c.app.inject({ url: "/bling/conectar", headers: { cookie: sup } });
  assert.equal(ir.statusCode, 302);
  const state = new URL(String(ir.headers.location)).searchParams.get("state")!;
  assert.ok(state.length >= 32);

  const errado = await c.app.inject({ url: `/bling/callback?code=C&state=outro` });
  assert.equal(errado.statusCode, 400);

  const volta = await c.app.inject({ url: `/bling/callback?code=COD123&state=${state}` });
  assert.equal(volta.statusCode, 302);
  assert.equal(codigoRecebido, "COD123");
  assert.equal(c.repo.alertaPendenteDoTipo("bling_desconectado"), false);
  assert.equal(c.repo.obterEstado("bling:erro_desde"), null);
  assert.equal(c.repo.obterEstado("bling:oauth_state"), null);

  const reuso = await c.app.inject({ url: `/bling/callback?code=COD123&state=${state}` });
  assert.equal(reuso.statusCode, 400);
});

test("falha ao trocar o código mostra o erro", async () => {
  const c = await appDeTeste({ bling: { urlAutorizacao: (s) => `https://bling.test/auth?state=${s}`, trocarCodigo: async () => { throw new Error("invalid_client"); }, estaConectado: () => false } });
  const sup = await entrar(c.app, "sup@x.com", "senha-sup");
  const ir = await c.app.inject({ url: "/bling/conectar", headers: { cookie: sup } });
  const state = new URL(String(ir.headers.location)).searchParams.get("state")!;
  const r = await c.app.inject({ url: `/bling/callback?code=X&state=${state}` });
  assert.equal(r.statusCode, 502);
  assert.match(r.body, /invalid_client/);
});
```

Run: `npm test`
Expected: FAIL (rotas inexistentes).

- [ ] **Step 2: Implementar**

`servidor/src/web/config.ts`:
```ts
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { DepsApp } from "../app.ts";
import { escaparHtml } from "../html-util.ts";
import { statusSistema } from "../status.ts";
import { exigirSupervisor } from "./auth.ts";
import { pagina } from "./layout.ts";

const CHAVE_STATE = "bling:oauth_state";

export function registrarConfig(app: FastifyInstance, d: DepsApp): void {
  app.get<{ Querystring: { ok?: string } }>("/config", { preHandler: exigirSupervisor }, async (req, reply) => {
    const s = statusSistema(d.repo, d.impressoraId, d.agora());
    const c = d.config;
    return reply.type("text/html").send(pagina(req.usuario, "Configuração", `
<div class="cartao">
  <h2>Bling</h2>
  <p>${d.bling.estaConectado() ? "Conectado." : '<span class="ruim">Não conectado.</span>'} ${escaparHtml(s.bling.texto)}</p>
  <a class="botao" href="/bling/conectar">${d.bling.estaConectado() ? "Reconectar ao Bling" : "Conectar ao Bling"}</a>
</div>
<div class="cartao"><table>
  <tr><th>Filial</th><td>${escaparHtml(c.filial.nome)} (${escaparHtml(c.filial.codigo)})</td></tr>
  <tr><th>Impressora</th><td>${c.agentes.map((a) => `${escaparHtml(a.impressora)} (agente ${escaparHtml(a.nome)})`).join("<br>")}</td></tr>
  <tr><th>Consulta ao Bling</th><td>a cada ${c.bling.intervaloSegundos}s, margem ${c.bling.margemMinutos} min</td></tr>
  <tr><th>Situação Atendido / Cancelado</th><td>${c.bling.situacaoAtendido} / ${c.bling.situacaoCancelado}</td></tr>
  <tr><th>Código de barras do pedido</th><td>${escaparHtml(c.bling.campoCodigoBarras)}</td></tr>
  <tr><th>Google Sheets</th><td>${c.google ? `planilha ${escaparHtml(c.google.planilhaId)}, aba ${escaparHtml(c.google.aba)}` : "desligado"}</td></tr>
</table><p>Para mudar estes valores, edite <code>servidor/config.json</code> e reinicie o serviço.</p></div>`,
      { mensagem: req.query.ok ? "Bling conectado com sucesso." : undefined }));
  });

  app.get("/bling/conectar", { preHandler: exigirSupervisor }, async (req, reply) => {
    const state = randomBytes(24).toString("hex");
    d.repo.definirEstado(CHAVE_STATE, `${state}:${req.usuario!.id}`);
    return reply.redirect(d.bling.urlAutorizacao(state));
  });

  app.get<{ Querystring: { code?: string; state?: string } }>("/bling/callback", async (req, reply) => {
    const salvo = d.repo.obterEstado(CHAVE_STATE);
    const [state, usuarioIdStr] = (salvo ?? "").split(":");
    if (!salvo || !req.query.state || req.query.state !== state) {
      return reply.code(400).type("text/html").send(pagina(null, "Link inválido", '<p>Este link de conexão expirou. Volte em <a href="/config">Configuração</a> e clique em conectar de novo.</p>'));
    }
    d.repo.definirEstado(CHAVE_STATE, null); // uso único
    try {
      await d.bling.trocarCodigo(String(req.query.code ?? ""));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(502).type("text/html").send(pagina(null, "Falha ao conectar", `<p class="erro">${escaparHtml(msg)}</p><p><a href="/config">Tentar de novo</a></p>`));
    }
    d.repo.resolverAlertasDoTipo("bling_desconectado", Number(usuarioIdStr) || null, d.agora());
    d.repo.definirEstado("bling:erro_desde", null);
    d.repo.definirEstado("bling:erro_msg", null);
    return reply.redirect("/config?ok=1");
  });
}
```

Em `servidor/src/app.ts`, importar e chamar `registrarConfig(app, d);` depois de `registrarPedidos(app, d);`.

- [ ] **Step 3: Rodar testes e typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add servidor
git commit -m "feat: conexão OAuth com o Bling e página de configuração"
```

---

### Task 14: Envio para o Google Sheets

**Files:**
- Create: `servidor/src/planilha/planilha.ts`
- Modify: `servidor/src/banco/repositorio.ts` (métodos da fila da planilha)
- Test: `servidor/test/planilha.test.ts`

**Interfaces:**
- Consumes: `linhaRelatorio` (Task 10), `linhaParaColunas`, `COLUNAS_RELATORIO` (Task 10), `enfileirarPlanilha` (Task 1).
- Produces:
  - Repositório: `pendentesPlanilha(limite: number): number[]` (ids de impressão), `marcarPlanilhaEnviada(impressaoIds: number[], agora: Date): void`, `registrarFalhaPlanilha(impressaoIds: number[]): void`.
  - `type EnviarLinhas = (linhas: string[][]) => Promise<void>`; `processarFilaPlanilha(repo, enviar: EnviarLinhas, agora: Date): Promise<number>`; `criarEnviadorSheets(cfg: { arquivoCredenciais: string; planilhaId: string; aba: string }): EnviarLinhas`.

- [ ] **Step 1: Escrever os testes (falhando)**

`servidor/test/planilha.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { processarFilaPlanilha } from "../src/planilha/planilha.ts";
import { registrarResultado } from "../src/fila/fila.ts";
import { AGORA, bancoDeTeste, dadosFolhaExemplo } from "./ajudantes.ts";

function comImpressas(n: number) {
  const b = bancoDeTeste();
  for (let i = 1; i <= n; i++) {
    const pedidoId = b.repo.inserirPedido({ filialId: b.filialId, numero: String(i), idBling: i, situacao: 9, origem: "monitor", agora: AGORA });
    const id = b.repo.criarImpressao({ pedidoId, impressoraId: b.impressoraId, via: 1, dados: dadosFolhaExemplo(2, String(i)), motivo: null, usuarioId: null, agora: AGORA });
    b.repo.pegarProximaDaFila(b.impressoraId, AGORA);
    registrarResultado(b.repo, id, { ok: true }, AGORA);
  }
  return b;
}

test("envia as linhas pendentes no formato do relatório e marca como enviadas", async () => {
  const b = comImpressas(2);
  const enviados: string[][][] = [];
  assert.equal(await processarFilaPlanilha(b.repo, async (l) => { enviados.push(l); }, AGORA), 2);
  assert.equal(enviados.length, 1);
  assert.deepEqual(enviados[0].map((l) => l[1]), ["1", "2"]);
  assert.equal(enviados[0][0][0], "08/10/2026 14:32");
  assert.deepEqual(b.repo.pendentesPlanilha(10), []);
});

test("sem pendentes não chama o Google", async () => {
  const b = bancoDeTeste();
  let chamou = false;
  assert.equal(await processarFilaPlanilha(b.repo, async () => { chamou = true; }, AGORA), 0);
  assert.equal(chamou, false);
});

test("falha do Google mantém pendente e conta tentativa, sem lançar erro", async () => {
  const b = comImpressas(1);
  assert.equal(await processarFilaPlanilha(b.repo, async () => { throw new Error("503"); }, AGORA), 0);
  assert.equal(b.repo.pendentesPlanilha(10).length, 1);
  const t = b.repo.db.prepare("SELECT tentativas FROM fila_planilha").get() as { tentativas: number };
  assert.equal(t.tentativas, 1);
});
```

Run: `npm test`
Expected: FAIL, com "Cannot find module ... planilha.ts".

- [ ] **Step 2: Métodos no repositório**

Em `servidor/src/banco/repositorio.ts`, na seção de planilha:
```ts
  pendentesPlanilha(limite: number): number[] {
    return this.todos<{ impressao_id: number }>(
      "SELECT impressao_id FROM fila_planilha WHERE enviado_em IS NULL ORDER BY id LIMIT ?", limite,
    ).map((r) => r.impressao_id);
  }

  marcarPlanilhaEnviada(impressaoIds: number[], agora: Date): void {
    const st = this.db.prepare("UPDATE fila_planilha SET enviado_em = ? WHERE impressao_id = ?");
    for (const id of impressaoIds) st.run(agora.toISOString(), id);
  }

  registrarFalhaPlanilha(impressaoIds: number[]): void {
    const st = this.db.prepare("UPDATE fila_planilha SET tentativas = tentativas + 1 WHERE impressao_id = ?");
    for (const id of impressaoIds) st.run(id);
  }
```

- [ ] **Step 3: Implementar o envio**

`servidor/src/planilha/planilha.ts`:
```ts
import { GoogleAuth } from "google-auth-library";
import type { Repositorio } from "../banco/repositorio.ts";
import { linhaParaColunas } from "../relatorio.ts";

export type EnviarLinhas = (linhas: string[][]) => Promise<void>;

// Nunca lança erro: a planilha não pode atrapalhar a impressão.
export async function processarFilaPlanilha(repo: Repositorio, enviar: EnviarLinhas, agora: Date): Promise<number> {
  const ids = repo.pendentesPlanilha(50);
  if (!ids.length) return 0;
  const linhas = ids.map((id) => repo.linhaRelatorio(id)).filter((l) => l !== null).map(linhaParaColunas);
  try {
    await enviar(linhas);
  } catch (e) {
    repo.registrarFalhaPlanilha(ids);
    console.error(`[planilha] falha ao enviar ${ids.length} linha(s): ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
  repo.marcarPlanilhaEnviada(ids, agora);
  return ids.length;
}

export function criarEnviadorSheets(cfg: { arquivoCredenciais: string; planilhaId: string; aba: string }): EnviarLinhas {
  const auth = new GoogleAuth({ keyFile: cfg.arquivoCredenciais, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const intervalo = encodeURIComponent(`${cfg.aba}!A1`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.planilhaId}/values/${intervalo}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  return async (linhas) => {
    const client = await auth.getClient();
    await client.request({ url, method: "POST", data: { values: linhas } });
  };
}
```

- [ ] **Step 4: Rodar testes e typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add servidor
git commit -m "feat: envio das impressões para o Google Sheets com reenvio"
```

---

### Task 15: Inicialização, serviços do Windows e documentação

**Files:**
- Create: `servidor/src/main.ts`, `scripts/servicos.ts`
- Modify: `README.md` (reescrever para o sistema novo)
- Test: execução manual (smoke test), além de `npm test` e `npm run typecheck`

**Interfaces:**
- Consumes: todas as anteriores.
- Produces: `npm run servidor`, `npm run agente`, `node scripts/servicos.ts instalar|desinstalar`.

- [ ] **Step 1: Criar `servidor/src/main.ts`**

```ts
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { repetir } from "../../compartilhado/loop.ts";
import { criarApp } from "./app.ts";
import { abrirBanco } from "./banco/banco.ts";
import { Repositorio } from "./banco/repositorio.ts";
import { armazemNoBanco } from "./bling/armazem.ts";
import { ClienteBling } from "./bling/cliente.ts";
import { criarMontadorFolha } from "./bling/montar-folha.ts";
import { carregarConfig, RAIZ } from "./config.ts";
import { recuperarTravadas } from "./fila/fila.ts";
import { GeradorPdf } from "./folha/pdf.ts";
import { cicloMonitorado } from "./monitor/monitor.ts";
import { criarEnviadorSheets, processarFilaPlanilha } from "./planilha/planilha.ts";

const config = carregarConfig(process.argv[2] ?? join(RAIZ, "servidor/config.json"));
mkdirSync(dirname(config.arquivoBanco), { recursive: true });
const repo = new Repositorio(abrirBanco(config.arquivoBanco));
const agora = () => new Date();

const filialId = repo.garantirFilial(config.filial.codigo, config.filial.nome);
const registros = config.agentes.map((a) => repo.garantirAgente(filialId, a));
const impressoraId = registros[0].impressoraId; // Etapa 1: uma impressora

const bling = new ClienteBling({
  clientId: config.bling.clientId, clientSecret: config.bling.clientSecret,
  armazem: armazemNoBanco(repo, config.filial.codigo),
});
const montarFolha = criarMontadorFolha(bling, { filialNome: config.filial.nome, campoCodigoBarras: config.bling.campoCodigoBarras });
const gerador = new GeradorPdf(config.chromePath);

const app = await criarApp({
  repo, config, filialId, impressoraId, agora, montarFolha, bling,
  gerarPdf: (dados, via) => gerador.gerar(dados, via),
});
await app.listen({ host: "0.0.0.0", port: config.porta });
console.info(`[servidor] página em ${config.urlPublica} (porta ${config.porta})`);

const depsMonitor = {
  repo, bling, montarFolha, filialId, impressoraId, agora,
  situacaoAtendido: config.bling.situacaoAtendido, situacaoCancelado: config.bling.situacaoCancelado,
  margemMinutos: config.bling.margemMinutos,
};
repetir(config.bling.intervaloSegundos * 1000, async () => {
  if (!bling.estaConectado()) return; // espera alguém conectar em /config
  await cicloMonitorado(depsMonitor);
});

repetir(60_000, async () => {
  const n = recuperarTravadas(repo, agora());
  if (n) console.error(`[fila] ${n} impressão(ões) travada(s) marcada(s) como erro`);
});

if (config.google) {
  const enviar = criarEnviadorSheets(config.google);
  repetir(60_000, async () => { await processarFilaPlanilha(repo, enviar, agora()); });
}

if (!bling.estaConectado()) console.info(`[servidor] Bling ainda não conectado: entre como supervisor em ${config.urlPublica}/config`);

const encerrar = async () => {
  await app.close();
  await gerador.fechar();
  process.exit(0);
};
process.on("SIGINT", encerrar);
process.on("SIGTERM", encerrar);
```

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 2: Smoke test local (modo pasta, sem impressora)**

1. Com `servidor/config.json` da Task 3 (Bling já conectado), crie `agente/config.json` a partir do exemplo, com `"modo": "pasta"` e o mesmo token.
2. Run: `npm run criar-usuario -- --nome "Teste" --email teste@local --senha "teste1234" --papel supervisor`
3. Em dois terminais: `npm run servidor` e `npm run agente`.
4. Abra `http://localhost:3010`, entre com `teste@local`. Expected: o painel mostra **Bling OK** e **Agente OK**. O log do servidor mostra "primeira ativação: N pedido(s) já atendido(s) registrado(s) sem imprimir".
5. Peça ao usuário para marcar **um pedido de teste** como Atendido no Bling ES. Expected: em até ~35s aparece `dados/folhas/impressao-<id>.pdf`, e o painel conta 1 impresso hoje.
6. Abra o PDF e confira contra a seção 5 da spec. Reimprima o pedido pela página dele com o motivo "Folha perdida" e confira se sai a "2ª via" com o bloco de reimpressão.
7. Pare o agente por 6 minutos, marque outro pedido de teste e confira o alerta de travada e a falha (se ficou "imprimindo"). Também confira se o painel mostra "Agente sem resposta". Religue o agente.

- [ ] **Step 3: Script de serviços do Windows**

`scripts/servicos.ts`:
```ts
// Instala/remove servidor e agente como serviços do Windows (sobem com o PC e reiniciam se caírem).
// Rodar num terminal "Executar como administrador":
//   node scripts/servicos.ts instalar
//   node scripts/servicos.ts desinstalar
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import nodeWindows from "node-windows";

const RAIZ = fileURLToPath(new URL("../", import.meta.url));
const acao = process.argv[2];
if (acao !== "instalar" && acao !== "desinstalar") {
  console.error("Uso: node scripts/servicos.ts instalar|desinstalar");
  process.exit(1);
}

const servicos = [
  { name: "Onix Expedicao - Servidor", script: join(RAIZ, "servidor/src/main.ts") },
  { name: "Onix Expedicao - Agente", script: join(RAIZ, "agente/src/main.ts") },
];

for (const s of servicos) {
  const svc = new nodeWindows.Service({
    name: s.name,
    description: "Sistema de impressão da expedição (Bling → folha de separação)",
    script: s.script,
    workingDirectory: RAIZ,
    wait: 5,
    grow: 0.5,
    maxRestarts: 1000,
  });
  svc.on("install", () => { console.log(`instalado: ${s.name}`); svc.start(); });
  svc.on("alreadyinstalled", () => console.log(`já instalado: ${s.name}`));
  svc.on("uninstall", () => console.log(`removido: ${s.name}`));
  svc.on("error", (e: unknown) => console.error(`erro em ${s.name}:`, e));
  if (acao === "instalar") svc.install(); else svc.uninstall();
}
```

Se o typecheck reclamar da falta de tipos de `node-windows`, crie `scripts/node-windows.d.ts`:
```ts
declare module "node-windows" {
  export class Service {
    constructor(o: { name: string; description: string; script: string; workingDirectory?: string; wait?: number; grow?: number; maxRestarts?: number });
    on(evento: string, fn: (...a: any[]) => void): void;
    install(): void;
    uninstall(): void;
    start(): void;
  }
  const _default: { Service: typeof Service };
  export default _default;
}
```
e acrescente `"scripts"` ao `include` do `tsconfig.json`.

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 4: Reescrever o `README.md`**

Substitua o conteúdo de `README.md` por um guia do sistema novo com estas seções (texto em português, passos numerados):
1. **O que é**: um parágrafo da seção 1 da spec, com link para `docs/superpowers/specs/2026-10-08-sistema-impressao-expedicao-design.md`.
2. **Requisitos**: Windows, Node.js 24+, Google Chrome, impressora A4 instalada no Windows **para todos os usuários** (o serviço roda como Sistema Local).
3. **Instalação**: `git clone`/copiar a pasta → `npm ci` → copiar os dois `config.exemplo.json` para `config.json` e preencher → `npm run criar-usuario` (primeiro supervisor) → `node scripts/servicos.ts instalar` (terminal de administrador) → abrir `http://localhost:3010/config` → **Conectar ao Bling**.
4. **Criar o aplicativo no Bling**: os mesmos passos da Task 3, Step 5.1.
5. **Google Sheets (opcional)**: criar projeto no Google Cloud → ativar a "Google Sheets API" → criar conta de serviço → baixar a chave JSON para `dados/google.json` → compartilhar a planilha com o e-mail da conta de serviço (Editor) → preencher `"google": { "arquivoCredenciais": "dados/google.json", "planilhaId": "<id da URL>", "aba": "Impressões" }` → reiniciar o serviço do servidor.
6. **Uso diário**: painel, alertas, reimpressão (só supervisor), imprimir pendentes, relatório e exportação.
7. **Problemas comuns**: tabela com Bling desconectado, agente sem resposta, impressora com erro, e onde ver os logs (pasta `daemon` criada pelo node-windows ao lado de cada script).
8. **Extensão antiga**: "foi substituída por este sistema; o código está em `legado/extensao/`" (a mudança acontece na Task 16).

- [ ] **Step 5: Rodar tudo e commit**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add servidor scripts README.md tsconfig.json
git commit -m "feat: inicialização do servidor, serviços do Windows e README"
```

---

### Task 16: Entrada em uso (com o usuário)

Esta task é **manual e acompanhada pelo usuário**. Nada aqui é feito sem a confirmação dele em cada passo.

**Files:**
- Move: `manifest.json`, `background.js`, `content_listing.js`, `content_print.js`, `popup.html`, `popup.js`, `icons/` → `legado/extensao/`
- Modify: `docs/verificacao-bling.md` (anotar resultado do paralelo)

- [ ] **Step 1: Instalar no PC da expedição**

Siga o README (Task 15, Step 4, seção 3) no PC da expedição do ES, com `agente/config.json` em `"modo": "pasta"`. Cadastre os supervisores e operadores informados pelo usuário. Confirme no painel: Bling OK e Agente OK.

- [ ] **Step 2: Paralelo de 1 a 2 dias**

A expedição continua trabalhando como hoje (extensão ligada). Ao fim de cada dia, compare com o usuário:
- Todos os pedidos atendidos no Bling ES no dia têm PDF em `dados/folhas/`? (Compare o relatório do sistema com a lista de Atendidos do Bling.)
- A folha está boa para separar? Ajustes de layout pedidos pelo usuário entram como correções na Task 5 (com teste).
- O código de barras impresso abre o pedido no checkout do Bling?

Anote os resultados em `docs/verificacao-bling.md`. Se faltar pedido, **PARE** e investigue (superpowers:systematic-debugging) antes de ativar.

- [ ] **Step 3: Ativação**

Com o OK do usuário, **no mesmo momento**:
1. Em `agente/config.json`, troque para `"modo": "imprimir"` e reinicie o serviço "Onix Expedicao - Agente".
2. Remova a extensão antiga do Chrome da expedição (`chrome://extensions` → Remover), para não imprimir em dobro.
3. Peça um pedido de teste Atendido e confirme que a folha saiu na impressora.

- [ ] **Step 4: Arquivar a extensão no repositório**

```bash
mkdir -p legado/extensao
git mv manifest.json background.js content_listing.js content_print.js popup.html popup.js icons legado/extensao/
git add docs/verificacao-bling.md
git commit -m "chore: arquiva a extensão antiga em legado/extensao após a ativação do sistema novo"
```
