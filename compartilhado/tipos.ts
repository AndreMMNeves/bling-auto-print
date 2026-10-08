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
