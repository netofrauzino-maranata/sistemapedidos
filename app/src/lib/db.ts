import Dexie, { type Table } from 'dexie'
import type {
  Categoria, Cliente, CondicaoPagamento, Empresa, EstoqueLote, EstoqueProduto,
  FormaPagamento, Lote, Pedido, Perfil, Produto,
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
