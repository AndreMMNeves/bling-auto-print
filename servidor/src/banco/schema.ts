// Postgres (Supabase / PGlite). Datas ficam como texto ISO UTC, como no resto do sistema.
// Comandos separados por ";" no fim da linha; blocos com ";" dentro ficam entre linhas "@@".
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS estado (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS filiais (
  id SERIAL PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agentes (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE,
  ultima_comunicacao TEXT
);
CREATE TABLE IF NOT EXISTS impressoras (
  id SERIAL PRIMARY KEY,
  filial_id INTEGER NOT NULL REFERENCES filiais(id),
  agente_id INTEGER NOT NULL REFERENCES agentes(id),
  nome_windows TEXT NOT NULL,
  UNIQUE (agente_id, nome_windows)
);
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL CHECK (papel IN ('operador', 'supervisor')),
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS pedidos (
  id SERIAL PRIMARY KEY,
  filial_id INTEGER NOT NULL REFERENCES filiais(id),
  numero TEXT NOT NULL,
  id_bling BIGINT NOT NULL,
  situacao INTEGER NOT NULL,
  origem TEXT NOT NULL CHECK (origem IN ('baseline', 'monitor')),
  detectado_em TEXT NOT NULL,
  UNIQUE (filial_id, numero)
);
CREATE TABLE IF NOT EXISTS impressoes (
  id SERIAL PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id),
  impressora_id INTEGER NOT NULL REFERENCES impressoras(id),
  via INTEGER NOT NULL,
  tipo_documento TEXT NOT NULL DEFAULT 'folha_separacao',
  dados_json TEXT NOT NULL,
  status TEXT NOT NULL,
  tentativas INTEGER NOT NULL DEFAULT 0,
  ultimo_erro TEXT,
  motivo TEXT,
  usuario_id INTEGER REFERENCES usuarios(id),
  criado_em TEXT NOT NULL,
  iniciado_em TEXT,
  impresso_em TEXT,
  UNIQUE (pedido_id, tipo_documento, via)
);
@@
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'impressoes_status_check' AND pg_get_constraintdef(oid) LIKE '%salvo%') THEN
    ALTER TABLE impressoes DROP CONSTRAINT IF EXISTS impressoes_status_check;
    ALTER TABLE impressoes ADD CONSTRAINT impressoes_status_check CHECK (status IN ('fila', 'imprimindo', 'impresso', 'salvo', 'erro'));
  END IF;
END $$
@@
CREATE INDEX IF NOT EXISTS impressoes_fila ON impressoes (impressora_id, status, id);
CREATE INDEX IF NOT EXISTS impressoes_criado ON impressoes (criado_em);
CREATE TABLE IF NOT EXISTS alertas (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('repetido', 'cancelado', 'falha_impressao', 'retomada', 'bling_desconectado')),
  pedido_id INTEGER REFERENCES pedidos(id),
  mensagem TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  resolvido_por INTEGER REFERENCES usuarios(id),
  resolvido_em TEXT
);
CREATE TABLE IF NOT EXISTS fila_planilha (
  id SERIAL PRIMARY KEY,
  impressao_id INTEGER NOT NULL UNIQUE REFERENCES impressoes(id),
  tentativas INTEGER NOT NULL DEFAULT 0,
  enviado_em TEXT
)
`;
