import Dexie, { type Table } from 'dexie'
import type {
  Categoria, Cliente, CondicaoPagamento, Empresa, EstoqueLote, EstoqueProduto,
  FormaPagamento, Lote, Pedido, Perfil, Produto, TabelaPreco, TabelaPrecoItem,
} from './tipos'

// Banco local do celular (IndexedDB). É daqui que as telas leem,
// por isso o app funciona sem internet. A sincronização (sync.ts)
// mantém isso em dia com o Supabase.
export interface Meta { chave: string; valor: string }

class BancoLocal extends Dexie {
  produtos!: Table<Produto, string>
  categorias!: Table<Categoria, string>
  lotes!: Table<Lote, string>
  estoque!: Table<EstoqueProduto, string>
  estoqueLotes!: Table<EstoqueLote, string>
  clientes!: Table<Cliente, string>
  condicoes!: Table<CondicaoPagamento, string>
  formas!: Table<FormaPagamento, string>
  perfis!: Table<Perfil, string>
  empresa!: Table<Empresa, number>
  pedidos!: Table<Pedido, string>
  meta!: Table<Meta, string>
  tabelasPreco!: Table<TabelaPreco, string>
  tabelaItens!: Table<TabelaPrecoItem, string>

  constructor() {
    super('maranata')
    this.version(1).stores({
      produtos: 'id, codigo, nome, categoria_id, ativo',
      categorias: 'id, nome',
      lotes: 'id, produto_id',
      estoque: 'produto_id',
      estoqueLotes: 'lote_id, produto_id',
      clientes: 'id, razao_social, cpf_cnpj, vendedor_id, _sync',
      condicoes: 'id',
      formas: 'id',
      perfis: 'id',
      empresa: 'id',
      pedidos: 'id, numero, cliente_id, vendedor_id, data_pedido, status, _sync',
      meta: 'chave',
    })
    this.version(2).stores({
      tabelasPreco: 'id',
      tabelaItens: 'id, tabela_id, produto_id',
    })
  }
}

export const db = new BancoLocal()

export async function getMeta(chave: string) {
  return (await db.meta.get(chave))?.valor ?? null
}
export async function setMeta(chave: string, valor: string) {
  await db.meta.put({ chave, valor })
}

export async function limparBancoLocal() {
  await db.delete()
  await db.open()
}

// Preço de cada produto para um cliente: o da tabela dele (se houver) ou o normal.
export async function mapaPrecos(tabelaId?: string | null): Promise<Map<string, number>> {
  if (!tabelaId) return new Map()
  const tabela = await db.tabelasPreco.get(tabelaId)
  if (!tabela?.ativo) return new Map()
  const itens = await db.tabelaItens.where('tabela_id').equals(tabelaId).filter((i) => i.ativo).toArray()
  return new Map(itens.map((i) => [i.produto_id, Number(i.preco)]))
}

// Formas que não são venda (ex.: Trocas): baixam estoque mas ficam fora dos relatórios de venda.
export async function formasForaDeVenda(): Promise<Set<string>> {
  return new Set((await db.formas.toArray()).filter((f) => f.conta_como_venda === false).map((f) => f.id))
}
