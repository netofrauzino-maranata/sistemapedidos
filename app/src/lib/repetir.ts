import { db, mapaPrecos } from './db'
import { arred, uuid } from './formato'
import type { Pedido } from './tipos'

// Repetir (duplicar) um pedido: monta um rascunho novo com os mesmos itens,
// já no preço de hoje (tabela do cliente), e abre na tela de pedido para editar.
export const CHAVE_RASCUNHO = 'maranata-rascunho-pedido'
export const CHAVE_COPIA = 'maranata-rascunho-copia' // nº do pedido de origem, só para avisar na tela

export async function repetirPedido(p: Pedido): Promise<boolean> {
  try {
    const atual = JSON.parse(localStorage.getItem(CHAVE_RASCUNHO) ?? 'null') as { itens?: unknown[] } | null
    if (atual?.itens?.length && !confirm('Você tem um pedido em andamento. Substituir pela cópia?')) return false
  } catch { /* rascunho inválido: segue */ }

  const cliente = await db.clientes.get(p.cliente_id)
  const precos = await mapaPrecos(cliente?.tabela_preco_id)
  const produtos = new Map((await db.produtos.bulkGet(p.itens.map((i) => i.produto_id))).filter(Boolean).map((x) => [x!.id, x!]))
  const itens = p.itens.flatMap((i) => {
    const prod = produtos.get(i.produto_id)
    if (!prod?.ativo) return [] // produto desativado não volta
    const preco = precos.get(prod.id) ?? prod.preco_venda
    return [{
      ...i, id: uuid(), preco_unitario: preco, desconto: 0, total: arred(i.quantidade * preco),
      produto_nome: prod.nome, produto_codigo: prod.codigo, unidade: prod.unidade,
    }]
  })
  const rascunho = {
    id: uuid(), cliente_id: p.cliente_id, status: p.status === 'orcamento' ? 'orcamento' : 'pendente',
    data_pedido: new Date().toISOString(), data_entrega: null,
    condicao_pagamento_id: p.condicao_pagamento_id, forma_pagamento_id: p.forma_pagamento_id,
    desconto: 0, desconto_pct: p.desconto_pct ?? null, frete: 0, observacao: '', itens,
  }
  localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(rascunho))
  localStorage.setItem(CHAVE_COPIA, JSON.stringify({ numero: p.numero, fora: p.itens.length - itens.length }))
  return true
}
