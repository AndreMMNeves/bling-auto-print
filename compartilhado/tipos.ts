// Tudo o que a folha precisa, já resolvido a partir do Bling (modelo "Pedido de Venda" do Bling).
// É guardado como JSON em cada impressão (foto do momento da impressão).
export type ItemFolha = {
  descricao: string;
  sku: string | null;
  unidade: string | null;
  localizacao: string | null;
  quantidade: number;
  precoLista: number | null;
  descontoPct: number | null;
  valorUnitario: number | null;
  total: number | null;
  detalhes: string[]; // linhas extras abaixo da descrição (medidas, peso, descrição detalhada)
  ean: string | null;
};

export type DadosFolha = {
  filial: string;
  pedido: {
    numero: string;
    numeroLoja: string | null;
    idBling: number;
    data: string; // "2026-10-08" como veio do Bling
    dataPrevista?: string | null;
    atendidoEm: string; // ISO UTC: quando o sistema detectou o Atendido
    vendedor: string | null;
    observacoes: string | null;
    codigoBarras: string;
  };
  cliente: {
    nome: string;
    fantasia?: string | null;
    documento: string | null;
    endereco?: string | null; // "Rua X, N° 10, Sala 2, Bairro: Centro."
    cidade?: string | null; // "15501217 - Votuporanga, SP"
    telefone?: string | null;
    email?: string | null;
  };
  entrega: { endereco: string | null; cidadeUf: string | null; cep: string | null };
  transporte: string | null; // serviço (ex.: SEDEX CONTRATO AG)
  transportador?: { nome: string | null; modalidade: string | null; servico: string | null };
  totais?: {
    qtdItens: number; somaQtd: number; descontoItens: number; totalProdutos: number;
    frete: number; outrasDespesas: number; descontoPedido: number; total: number;
  };
  parcelas?: Array<{ dias: number | null; vencimento: string | null; forma: string | null; valor: number; observacao: string | null }>;
  itens: ItemFolha[];
};

// Qual via está sendo impressa. numero = 1 é a impressão automática.
export type Via = {
  numero: number;
  motivo: string | null;
  usuario: string | null;
  em: string | null; // ISO UTC
};
