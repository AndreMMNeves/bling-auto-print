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
