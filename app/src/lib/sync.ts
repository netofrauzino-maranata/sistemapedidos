import type { Table } from 'dexie'
import { db, getMeta, setMeta } from './db'
import { supabase } from './supabase'
import type { Cliente, ItemPedido, Pedido } from './tipos'

// =====================================================================
// Sincronização offline first
//  1. ENVIA o que foi feito no celular (clientes novos, pedidos).
//  2. BAIXA só o que mudou desde a última vez (coluna atualizado_em).
// Pedido é enviado pela função salvar_pedido, que é idempotente:
// reenviar o mesmo pedido não duplica nem baixa estoque duas vezes.
// =====================================================================

type Estado = { sincronizando: boolean; ultimo: string | null; erro: string | null }
let estado: Estado = { sincronizando: false, ultimo: localStorage.getItem('maranata-ultimo-sync'), erro: null }
const ouvintes = new Set<(e: Estado) => void>()
function emitir(parcial: Partial<Estado>) {
  estado = { ...estado, ...parcial }
  ouvintes.forEach((f) => f(estado))
}
export const estadoSync = () => estado
export function ouvirSync(f: (e: Estado) => void) {
  ouvintes.add(f)
  return () => { ouvintes.delete(f) }
}

const semCamposLocais = <T extends object>(o: T) => {
  const c = { ...o } as Record<string, unknown>
  for (const k of Object.keys(c)) if (k.startsWith('_')) delete c[k]
  return c
}

function erroDeRede(e: unknown) {
  const m = String((e as { message?: string })?.message ?? e)
  return !navigator.onLine || /fetch|network|Failed to fetch|Load failed/i.test(m)
}

// ---------- envio ----------
async function enviarClientes() {
  const pendentes = await db.clientes.where('_sync').anyOf('pendente', 'erro').toArray()
  for (const c of pendentes) {
    const dados = semCamposLocais(c)
    delete dados.codigo
    delete dados.atualizado_em
    delete dados.criado_por
    delete dados.criado_em
    const { data, error } = await supabase.from('clientes').upsert(dados).select().single()
    if (error) {
      if (erroDeRede(error)) throw error
      await db.clientes.update(c.id, { _sync: 'erro', _erro: error.message })
    } else {
      await db.clientes.put({ ...(data as Cliente), _sync: 'ok' })
    }
  }
}

// Localização salva pelo botão "Salvar localização" (pode ser cliente de outro
// vendedor ou sem vendedor): vai por uma função própria, que só mexe nela.
async function enviarLocalizacoes() {
  const pendentes = (await db.clientes.toArray()).filter((c) => c._loc_pendente)
  for (const c of pendentes) {
    const { data, error } = await supabase.rpc('salvar_localizacao_cliente', {
      p_cliente: c.id, p_latitude: c.latitude ?? null, p_longitude: c.longitude ?? null, p_precisao: c.localizacao_precisao ?? null,
    })
    if (error) {
      if (erroDeRede(error)) throw error
      await db.clientes.update(c.id, { _loc_pendente: false, _erro: error.message })
    } else if (data === true || c._sync === 'ok' || !c._sync) {
      // false com cadastro já sincronizado = sem acesso; não fica tentando para sempre
      await db.clientes.update(c.id, { _loc_pendente: false })
    }
    // false com cadastro novo ainda não enviado: tenta de novo no próximo sync
  }
}

export function pedidoParaEnvio(p: Pedido) {
  return {
    id: p.id,
    cliente_id: p.cliente_id,
    vendedor_id: p.vendedor_id,
    status: p.status,
    data_pedido: p.data_pedido,
    data_entrega: p.data_entrega,
    condicao_pagamento_id: p.condicao_pagamento_id,
    forma_pagamento_id: p.forma_pagamento_id,
    desconto: p.desconto,
    frete: p.frete,
    observacao: p.observacao,
    observacao_interna: p.observacao_interna ?? null,
    latitude: p.latitude ?? null,
    longitude: p.longitude ?? null,
    itens: p.itens.map((i) => ({
      id: i.id, produto_id: i.produto_id, quantidade: i.quantidade,
      preco_unitario: i.preco_unitario, desconto: i.desconto,
    })),
  }
}

async function enviarPedidos() {
  const pendentes = await db.pedidos.where('_sync').equals('pendente').sortBy('data_pedido')
  for (const p of pendentes) {
    const { data, error } = await supabase.rpc('salvar_pedido', { p_pedido: pedidoParaEnvio(p) })
    if (error) {
      if (erroDeRede(error)) throw error
      await db.pedidos.update(p.id, { _sync: 'erro', _erro: error.message })
    } else {
      const r = data as Pedido
      await db.pedidos.update(p.id, {
        numero: r.numero, subtotal: r.subtotal, total: r.total, status: r.status,
        atualizado_em: r.atualizado_em, _sync: 'ok', _erro: undefined,
      })
    }
  }
}

// ---------- recebimento ----------
async function baixarTabela<T extends { atualizado_em?: string }>(
  remota: string, local: Table<T, never> | Table<T, string> | Table<T, number>,
  filtro?: (row: T) => Promise<boolean>,
) {
  const chave = 'sync:' + remota
  let desde = (await getMeta(chave)) ?? '1970-01-01T00:00:00Z'
  for (;;) {
    const { data, error } = await supabase.from(remota).select('*')
      .gte('atualizado_em', desde).order('atualizado_em').limit(1000)
    if (error) throw error
    const linhas = (data ?? []) as T[]
    const aceitar: T[] = []
    for (const l of linhas) if (!filtro || (await filtro(l))) aceitar.push(l)
    if (aceitar.length) await (local as Table<T, string>).bulkPut(aceitar)
    if (linhas.length) desde = linhas[linhas.length - 1].atualizado_em!
    if (linhas.length < 1000) break
  }
  await setMeta(chave, desde)
}

async function baixarEstoque() {
  const [prod, lotes] = await Promise.all([
    supabase.from('vw_estoque_produtos').select('produto_id, saldo, proxima_validade'),
    supabase.from('vw_estoque_lotes').select('lote_id, produto_id, numero, data_validade, saldo, dias_para_vencer').neq('saldo', 0),
  ])
  if (prod.error) throw prod.error
  if (lotes.error) throw lotes.error
  await db.transaction('rw', db.estoque, db.estoqueLotes, async () => {
    await db.estoque.clear()
    await db.estoque.bulkPut(prod.data ?? [])
    await db.estoqueLotes.clear()
    await db.estoqueLotes.bulkPut(lotes.data ?? [])
  })
}

type PedidoRemoto = Omit<Pedido, 'itens' | '_sync'> & { pedido_itens: (ItemPedido & { item: number })[] }

async function baixarPedidos() {
  const chave = 'sync:pedidos'
  // primeira vez: só os últimos 120 dias, para não pesar o celular
  let desde = (await getMeta(chave)) ?? new Date(Date.now() - 120 * 864e5).toISOString()
  const produtos = new Map((await db.produtos.toArray()).map((p) => [p.id, p]))
  for (;;) {
    const { data, error } = await supabase.from('pedidos').select('*, pedido_itens(*)')
      .gte('atualizado_em', desde).order('atualizado_em').limit(500)
    if (error) throw error
    const linhas = (data ?? []) as PedidoRemoto[]
    for (const r of linhas) {
      const local = await db.pedidos.get(r.id)
      if (local && local._sync !== 'ok') continue // alteração local ainda não enviada
      const { pedido_itens, ...cab } = r
      await db.pedidos.put({
        ...cab,
        itens: pedido_itens.sort((a, b) => a.item - b.item).map((i) => {
          const p = produtos.get(i.produto_id)
          return {
            id: i.id, produto_id: i.produto_id, quantidade: Number(i.quantidade),
            preco_unitario: Number(i.preco_unitario), desconto: Number(i.desconto), total: Number(i.total),
            produto_nome: p?.nome, produto_codigo: p?.codigo, unidade: p?.unidade,
          }
        }),
        _sync: 'ok',
      })
    }
    if (linhas.length) desde = linhas[linhas.length - 1].atualizado_em!
    if (linhas.length < 500) break
  }
  await setMeta(chave, desde)
}

// ---------- orquestração ----------
let emAndamento: Promise<void> | null = null

export function sincronizar(): Promise<void> {
  if (emAndamento) return emAndamento
  if (!navigator.onLine) {
    emitir({ erro: 'Sem internet. Os dados ficam salvos no celular.' })
    return Promise.resolve()
  }
  emAndamento = (async () => {
    emitir({ sincronizando: true, erro: null })
    try {
      const { data: s } = await supabase.auth.getSession()
      if (!s.session) return
      await enviarClientes()
      await enviarLocalizacoes()
      await enviarPedidos()
      await baixarTabela('perfis', db.perfis)
      await baixarTabela('empresa', db.empresa)
      await baixarTabela('categorias', db.categorias)
      await baixarTabela('condicoes_pagamento', db.condicoes)
      await baixarTabela('formas_pagamento', db.formas)
      await baixarTabela('produtos', db.produtos)
      await baixarTabela('tabelas_preco', db.tabelasPreco)
      await baixarTabela('tabela_preco_itens', db.tabelaItens)
      await baixarTabela('lotes', db.lotes)
      await baixarTabela('clientes', db.clientes, async (c) => {
        const local = await db.clientes.get((c as Cliente).id)
        if (local && local._sync && local._sync !== 'ok') return false
        if (local?._loc_pendente) Object.assign(c, {
          latitude: local.latitude, longitude: local.longitude, localizacao_em: local.localizacao_em,
          localizacao_por: local.localizacao_por, localizacao_precisao: local.localizacao_precisao, _loc_pendente: true,
        })
        ;(c as Cliente)._sync = 'ok'
        return true
      })
      await baixarEstoque()
      await baixarPedidos()
      const agora = new Date().toISOString()
      localStorage.setItem('maranata-ultimo-sync', agora)
      emitir({ ultimo: agora })
    } catch (e) {
      emitir({ erro: erroDeRede(e) ? 'Sem conexão com o servidor. Tentaremos de novo.' : String((e as Error).message ?? e) })
    } finally {
      emitir({ sincronizando: false })
      emAndamento = null
    }
  })()
  return emAndamento
}

export function iniciarSincronizacaoAutomatica() {
  window.addEventListener('online', () => void sincronizar())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sincronizar()
  })
  const t = setInterval(() => void sincronizar(), 3 * 60 * 1000)
  void sincronizar()
  return () => clearInterval(t)
}
