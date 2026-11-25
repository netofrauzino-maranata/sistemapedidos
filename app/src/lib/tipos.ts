// Tipos espelhando as tabelas do Supabase (supabase/migrations).

export type Papel = 'gestor' | 'vendedor'
export type StatusPedido = 'orcamento' | 'pendente' | 'confirmado' | 'faturado' | 'entregue' | 'cancelado'
export type SyncStatus = 'pendente' | 'ok' | 'erro'

export interface Perfil {
  id: string
  nome: string
  email: string | null
  telefone: string | null
  papel: Papel
  ativo: boolean
  atualizado_em: string
}

export interface Empresa {
  id: number
  razao_social: string
  nome_fantasia: string | null
  cnpj: string | null
  ie: string | null
  telefone: string | null
  whatsapp: string | null
  email: string | null
  cep: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  codigo_ibge: string | null
  logo_url: string | null
  rodape_pedido: string | null
  atualizado_em: string
}

export interface Categoria { id: string; nome: string; ordem: number; ativo: boolean; atualizado_em: string }
export interface CondicaoPagamento { id: string; nome: string; parcelas_dias: number[]; ativo: boolean; atualizado_em: string }
export interface FormaPagamento { id: string; nome: string; codigo_nfe: string | null; ativo: boolean; conta_como_venda?: boolean; atualizado_em: string }
export interface Fornecedor { id: string; nome: string; cpf_cnpj: string | null; telefone: string | null; cidade: string | null; uf: string | null; ativo: boolean; atualizado_em: string }

export interface Produto {
  id: string
  codigo: string
  nome: string
  descricao: string | null
  categoria_id: string | null
  marca: string | null
  unidade: string
  qtd_embalagem: number
  peso_kg: number | null
  gtin: string | null
  ncm: string | null
  cest: string | null
  origem: number
  cfop_padrao: string | null
  preco_venda: number
  preco_minimo: number | null
  preco_custo: number | null
  estoque_minimo: number
  controla_validade: boolean
  foto_url: string | null
  mostrar_catalogo: boolean
  ativo: boolean
  atualizado_em: string
}

export interface Lote {
  id: string
  produto_id: string
  numero: string
  data_fabricacao: string | null
  data_validade: string | null
  custo_unitario: number | null
  atualizado_em: string
}

export interface EstoqueProduto { produto_id: string; saldo: number; proxima_validade: string | null }
export interface EstoqueLote { lote_id: string; produto_id: string; numero: string; data_validade: string | null; saldo: number; dias_para_vencer: number | null }

export interface Cliente {
  id: string
  codigo?: number | null
  tipo_pessoa: 'F' | 'J'
  razao_social: string
  nome_fantasia: string | null
  cpf_cnpj: string | null
  indicador_ie: 1 | 2 | 9
  ie: string | null
  email: string | null
  telefone: string | null
  whatsapp: string | null
  contato: string | null
  cep: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  codigo_ibge: string | null
  latitude?: number | null // localização (GPS) para entrega
  longitude?: number | null
  localizacao_em?: string | null
  localizacao_por?: string | null
  localizacao_precisao?: number | null // metros
  _loc_pendente?: boolean // localização salva no celular, falta enviar
  vendedor_id: string | null
  condicao_pagamento_id: string | null
  forma_pagamento_id: string | null
  tabela_preco_id?: string | null
  link_token?: string // link do catálogo online (/c/token)
  eh_cliente?: boolean // false = só fornecedor (fica fora das vendas)
  eh_fornecedor?: boolean // true = aparece na Entrada de mercadoria
  limite_credito: number | null
  observacao: string | null
  ativo: boolean
  atualizado_em?: string
  _sync?: SyncStatus
  _erro?: string
}

export interface ItemPedido {
  id: string
  produto_id: string
  quantidade: number
  preco_unitario: number
  desconto: number
  total: number
  // cópia para mostrar/imprimir offline
  produto_nome?: string
  produto_codigo?: string
  unidade?: string
}

export interface Pedido {
  id: string
  numero: number | null
  cliente_id: string
  vendedor_id: string
  status: StatusPedido
  data_pedido: string
  data_entrega: string | null
  condicao_pagamento_id: string | null
  forma_pagamento_id: string | null
  subtotal: number
  desconto: number
  frete: number
  total: number
  observacao: string | null
  observacao_interna?: string | null
  nfe_numero?: string | null
  exportado_nfe_em?: string | null
  latitude?: number | null
  longitude?: number | null
  atualizado_em?: string
  itens: ItemPedido[]
  _sync: SyncStatus
  _erro?: string
  desconto_pct?: number | null // só no celular: desconto digitado em %
}

export const STATUS_LABEL: Record<StatusPedido, string> = {
  orcamento: 'Orçamento',
  pendente: 'Pendente',
  confirmado: 'Confirmado',
  faturado: 'Faturado',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
}

export const STATUS_COR: Record<StatusPedido, string> = {
  orcamento: 'bg-stone-200 text-stone-700',
  pendente: 'bg-amber-100 text-amber-800',
  confirmado: 'bg-sky-100 text-sky-800',
  faturado: 'bg-violet-100 text-violet-800',
  entregue: 'bg-emerald-100 text-emerald-800',
  cancelado: 'bg-red-100 text-red-700',
}

export const UNIDADES = ['UN', 'CX', 'FD', 'PCT', 'KG', 'G', 'LT', 'ML', 'DZ', 'SC', 'BD', 'GF']

// Tabela de preço: guarda só os produtos com preço diferente do normal.
export interface TabelaPreco {
  id: string
  codigo: string | null
  nome: string
  ativo: boolean
  atualizado_em?: string
}
export interface TabelaPrecoItem {
  id: string
  tabela_id: string
  produto_id: string
  preco: number
  ativo: boolean
  atualizado_em?: string
}
