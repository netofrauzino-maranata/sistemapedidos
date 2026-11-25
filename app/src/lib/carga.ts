import { nomeCliente } from './hooks'
import { linkGoogleMaps, temLocalizacao } from './mapa'
import type { Cliente, Empresa, FormaPagamento, Pedido, Perfil } from './tipos'

// Carga: pedidos aprovados de um dia que o gestor escolhe para carregar
// no caminhão da rota do dia seguinte. Tudo calculado no celular.

export type TipoRelatorioCarga = 'vendas' | 'resumo' | 'clientes'

export const NOME_RELATORIO: Record<TipoRelatorioCarga, string> = {
  vendas: 'Resumo das vendas',
  resumo: 'Itens para carregar',
  clientes: 'Detalhado por cliente',
}

// Situações que entram na carga (pedido aprovado e ainda não entregue).
export const STATUS_CARGA = ['pendente', 'confirmado', 'faturado'] as const

export interface DadosCarga {
  titulo: string // ex.: "Carga de 21/11/2026"
  pedidos: Pedido[] // só os selecionados
  clientes: Map<string, Cliente>
  formas: Map<string, FormaPagamento>
  perfis: Map<string, Perfil>
  empresa?: Empresa | null
  vendedor?: string // nome que sai no relatório de carregamento
}

export interface ItemCarga { produto_id: string; codigo: string; nome: string; unidade: string; quantidade: number; total: number }

export function ehTroca(p: Pedido, formas: Map<string, FormaPagamento>) {
  return !!p.forma_pagamento_id && formas.get(p.forma_pagamento_id)?.conta_como_venda === false
}

// Soma os itens de todos os pedidos (lista para separar e carregar).
export function somarItens(pedidos: Pedido[]): ItemCarga[] {
  const m = new Map<string, ItemCarga>()
  for (const p of pedidos) for (const i of p.itens) {
    const a = m.get(i.produto_id) ?? { produto_id: i.produto_id, codigo: i.produto_codigo ?? '', nome: i.produto_nome ?? '', unidade: i.unidade ?? '', quantidade: 0, total: 0 }
    a.quantidade += Number(i.quantidade); a.total += Number(i.total)
    m.set(i.produto_id, a)
  }
  return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome))
}

export function totaisCarga(d: Pick<DadosCarga, 'pedidos' | 'formas'>) {
  const trocas = d.pedidos.filter((p) => ehTroca(p, d.formas))
  const vendas = d.pedidos.filter((p) => !ehTroca(p, d.formas))
  return {
    pedidos: d.pedidos.length,
    vendas: vendas.length,
    trocas: trocas.length,
    valor: vendas.reduce((s, p) => s + Number(p.total), 0),
    valorTrocas: trocas.reduce((s, p) => s + Number(p.total), 0),
    volumes: d.pedidos.reduce((s, p) => s + p.itens.reduce((t, i) => t + Number(i.quantidade), 0), 0),
    itens: somarItens(d.pedidos).length,
    clientes: new Set(d.pedidos.map((p) => p.cliente_id)).size,
  }
}

// Pedidos agrupados por cliente, na ordem do nome.
export function porCliente(d: Pick<DadosCarga, 'pedidos' | 'clientes'>) {
  const m = new Map<string, Pedido[]>()
  for (const p of d.pedidos) m.set(p.cliente_id, [...(m.get(p.cliente_id) ?? []), p])
  return [...m.entries()]
    .map(([id, pedidos]) => ({ cliente: d.clientes.get(id), pedidos }))
    .sort((a, b) => nomeCliente(a.cliente).localeCompare(nomeCliente(b.cliente)))
}

export const rotuloCliente = (c?: Cliente | null) => `${c?.codigo ? c.codigo + ' ' : ''}${nomeCliente(c)}`

// Versão em texto (para mandar no WhatsApp).
export function textoCarga(tipo: TipoRelatorioCarga, d: DadosCarga) {
  const t = totaisCarga(d)
  const q = (v: number) => String(Number(v)).replace('.', ',')
  const r = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const l: string[] = [`*${d.titulo}* - ${NOME_RELATORIO[tipo]}`, '']
  if (tipo === 'resumo') {
    for (const i of somarItens(d.pedidos)) l.push(`${q(i.quantidade)} ${i.unidade.toLowerCase()}  ${i.codigo} ${i.nome}`)
  } else if (tipo === 'vendas') {
    for (const p of d.pedidos) {
      const f = p.forma_pagamento_id ? d.formas.get(p.forma_pagamento_id)?.nome : ''
      l.push(`${rotuloCliente(d.clientes.get(p.cliente_id))}  ${r(p.total)}  ${f ?? ''} #${p.numero ?? '-'}`)
    }
  } else {
    for (const g of porCliente(d)) {
      l.push(`*${rotuloCliente(g.cliente)}*`)
      if (temLocalizacao(g.cliente)) l.push(`  Local: ${linkGoogleMaps(g.cliente.latitude, g.cliente.longitude)}`)
      for (const p of g.pedidos) for (const i of p.itens) l.push(`  ${q(i.quantidade)} ${(i.unidade ?? '').toLowerCase()}  ${i.produto_codigo ?? ''} ${i.produto_nome ?? ''}`)
      l.push('')
    }
  }
  l.push('', `Vendas: ${t.vendas}${t.trocas ? ` · Trocas: ${t.trocas}` : ''} · Itens: ${t.itens} · Volumes: ${q(t.volumes)}`, `Valor das vendas: ${r(t.valor)}`)
  return l.join('\n')
}
