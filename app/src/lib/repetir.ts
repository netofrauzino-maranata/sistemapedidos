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

// ---------- Pedido do catálogo online -> rascunho de pedido de venda ----------
export const CHAVE_SOLICITACAO = 'maranata-rascunho-catalogo' // {id, numero} do pedido do catálogo

export interface PedidoCatalogo {
  id: string; numero: number; cliente_id: string; total_estimado: number; contato: string | null; observacao: string | null
  status: 'nova' | 'aprovada' | 'recusada'; pedido_id: string | null; criado_em: string
  itens: { produto_id: string; quantidade: number; preco: number }[]
}

export async function rascunhoDoCatalogo(s: PedidoCatalogo): Promise<boolean> {
  try {
    const atual = JSON.parse(localStorage.getItem(CHAVE_RASCUNHO) ?? 'null') as { itens?: unknown[] } | null
    if (atual?.itens?.length && !confirm('Você tem um pedido em andamento. Substituir por este pedido do catálogo?')) return false
  } catch { /* rascunho inválido: segue */ }
  const cliente = await db.clientes.get(s.cliente_id)
  const precos = await mapaPrecos(cliente?.tabela_preco_id)
  const produtos = new Map((await db.produtos.bulkGet(s.itens.map((i) => i.produto_id))).filter(Boolean).map((x) => [x!.id, x!]))
  const itens = s.itens.flatMap((i) => {
    const prod = produtos.get(i.produto_id)
    if (!prod) return []
    const preco = precos.get(prod.id) ?? prod.preco_venda
    return [{ id: uuid(), produto_id: prod.id, quantidade: Number(i.quantidade), preco_unitario: preco, desconto: 0, total: arred(Number(i.quantidade) * preco), produto_nome: prod.nome, produto_codigo: prod.codigo, unidade: prod.unidade }]
  })
  const obs = [`Pedido do catálogo nº ${s.numero}${s.contato ? ` (${s.contato})` : ''}`, s.observacao].filter(Boolean).join('. ')
  localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({
    id: uuid(), cliente_id: s.cliente_id, status: 'pendente', data_pedido: new Date().toISOString(), data_entrega: null,
    condicao_pagamento_id: cliente?.condicao_pagamento_id ?? null, forma_pagamento_id: cliente?.forma_pagamento_id ?? null,
    desconto: 0, frete: 0, observacao: obs, itens,
  }))
  localStorage.removeItem(CHAVE_COPIA)
  localStorage.setItem(CHAVE_SOLICITACAO, JSON.stringify({ id: s.id, numero: s.numero }))
  return true
}
