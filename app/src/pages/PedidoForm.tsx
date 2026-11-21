import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Aviso, Busca, Cabecalho, Campo, Folha, Icone, Vazio } from '../components/ui'
import { useAuth } from '../lib/auth'
import { db, mapaPrecos } from '../lib/db'
import { arred, brl, docFormatado, filtrarProdutos, normalizar, num, uuid } from '../lib/formato'
import { nomeCliente, useCondicoes, useEstoqueMapa, useFormas } from '../lib/hooks'
import { CHAVE_COPIA, CHAVE_RASCUNHO, CHAVE_SOLICITACAO } from '../lib/repetir'
import { supabase } from '../lib/supabase'
import { sincronizar } from '../lib/sync'
import type { Cliente, ItemPedido, Pedido, Produto } from '../lib/tipos'

type Rascunho = Omit<Pedido, '_sync' | 'numero' | 'subtotal' | 'total' | 'vendedor_id'> & { vendedor_id?: string; numero?: number | null }


function novoRascunho(): Rascunho {
  return {
    id: uuid(), cliente_id: '', status: 'pendente', data_pedido: new Date().toISOString(),
    data_entrega: null, condicao_pagamento_id: null, forma_pagamento_id: null,
    desconto: 0, frete: 0, observacao: '', itens: [],
  }
}

export default function PedidoForm() {
  const { id } = useParams()
  const nav = useNavigate()
  const { perfil, gestor } = useAuth()
  const condicoes = useCondicoes()
  const formas = useFormas()
  const estoque = useEstoqueMapa()

  const [p, setP] = useState<Rascunho | null>(null)
  const [escolherCliente, setEscolherCliente] = useState(false)
  const [escolherProduto, setEscolherProduto] = useState(false)
  const [editandoItem, setEditandoItem] = useState<ItemPedido | null>(null)
  const [erro, setErro] = useState('')
  const [copia] = useState<{ numero: number | null; fora: number } | null>(() => {
    if (id) return null
    try { return JSON.parse(localStorage.getItem(CHAVE_COPIA) ?? 'null') } catch { return null }
  })
  const [solicitacao] = useState<{ id: string; numero: number } | null>(() => {
    if (id) return null
    try { return JSON.parse(localStorage.getItem(CHAVE_SOLICITACAO) ?? 'null') } catch { return null }
  })

  // carrega pedido existente ou rascunho salvo
  useEffect(() => {
    if (id) {
      void db.pedidos.get(id).then((x) => {
        if (!x) return nav('/pedidos', { replace: true })
        if (!gestor && !['orcamento', 'pendente'].includes(x.status)) return nav(`/pedidos/${id}`, { replace: true })
        setP(x)
      })
    } else {
      try {
        const salvo = localStorage.getItem(CHAVE_RASCUNHO)
        setP(salvo ? JSON.parse(salvo) : novoRascunho())
      } catch { setP(novoRascunho()) }
    }
  }, [id, gestor, nav])

  // guarda rascunho a cada mudança (se o app fechar, não perde o pedido)
  useEffect(() => {
    if (p && !id) localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(p))
  }, [p, id])

  const cliente = useLiveQuery(() => (p?.cliente_id ? db.clientes.get(p.cliente_id) : undefined), [p?.cliente_id])
  const precosTabela = useLiveQuery(() => mapaPrecos(cliente?.tabela_preco_id), [cliente?.tabela_preco_id])
  const nomeTabela = useLiveQuery(async () => (cliente?.tabela_preco_id ? (await db.tabelasPreco.get(cliente.tabela_preco_id))?.nome : undefined), [cliente?.tabela_preco_id])
  const subtotal = useMemo(() => arred((p?.itens ?? []).reduce((s, i) => s + i.total, 0)), [p?.itens])
  const descontoTotal = p?.desconto_pct != null ? arred(subtotal * p.desconto_pct / 100) : (p?.desconto ?? 0)
  const total = arred(subtotal - descontoTotal + (p?.frete ?? 0))

  if (!p) return null
  const set = (parcial: Partial<Rascunho>) => setP({ ...p, ...parcial })

  const precoDe = (prod: Produto) => precosTabela?.get(prod.id) ?? prod.preco_venda

  async function escolheCliente(c: Cliente) {
    setEscolherCliente(false)
    // troca de cliente: itens que estavam no preço da tabela antiga passam para a tabela nova
    const antigos = precosTabela ?? new Map<string, number>()
    const novos = await mapaPrecos(c.tabela_preco_id)
    const produtos = new Map((await db.produtos.bulkGet(p!.itens.map((i) => i.produto_id))).filter(Boolean).map((x) => [x!.id, x!]))
    const itens = p!.itens.map((i) => {
      const prod = produtos.get(i.produto_id)
      if (!prod) return i
      const precoAntigo = antigos.get(prod.id) ?? prod.preco_venda
      if (Math.abs(i.preco_unitario - precoAntigo) > 0.001) return i // preço mexido à mão: mantém
      const preco = novos.get(prod.id) ?? prod.preco_venda
      return { ...i, preco_unitario: preco, total: arred(i.quantidade * preco - i.desconto) }
    })
    set({
      cliente_id: c.id,
      condicao_pagamento_id: c.condicao_pagamento_id ?? p!.condicao_pagamento_id,
      forma_pagamento_id: c.forma_pagamento_id ?? p!.forma_pagamento_id,
      itens,
    })
  }

  function escolheProduto(prod: Produto) {
    setEscolherProduto(false)
    const existente = p!.itens.find((i) => i.produto_id === prod.id)
    setEditandoItem(existente ?? {
      id: uuid(), produto_id: prod.id, quantidade: 1, preco_unitario: precoDe(prod), desconto: 0,
      total: precoDe(prod), produto_nome: prod.nome, produto_codigo: prod.codigo, unidade: prod.unidade,
    })
  }

  function salvarItem(item: ItemPedido) {
    const itens = p!.itens.some((i) => i.id === item.id)
      ? p!.itens.map((i) => (i.id === item.id ? item : i))
      : [...p!.itens, item]
    set({ itens })
    setEditandoItem(null)
  }

  async function salvar() {
    setErro('')
    if (!p!.cliente_id) return setErro('Escolha o cliente.')
    if (!p!.itens.length) return setErro('Adicione pelo menos um produto.')
    if (total < 0) return setErro('O desconto é maior que o pedido.')
    const pedido: Pedido = {
      ...p!, numero: p!.numero ?? null, vendedor_id: p!.vendedor_id ?? perfil!.id,
      desconto: descontoTotal, subtotal, total, _sync: 'pendente', _erro: undefined,
    }
    await db.pedidos.put(pedido)
    if (!id) { localStorage.removeItem(CHAVE_RASCUNHO); localStorage.removeItem(CHAVE_COPIA); localStorage.removeItem(CHAVE_SOLICITACAO) }
    if (solicitacao) {
      // marca o pedido do catálogo como aprovado; liga ao pedido depois que ele chega no servidor
      void supabase.from('pedidos_catalogo').update({ status: 'aprovada' }).eq('id', solicitacao.id).then(() =>
        sincronizar().then(() => supabase.from('pedidos_catalogo').update({ pedido_id: pedido.id, cliente_id: pedido.cliente_id }).eq('id', solicitacao.id)))
    } else void sincronizar()
    nav(`/pedidos/${pedido.id}`, { replace: true })
  }

  function descartar() {
    if (!confirm('Descartar este pedido?')) return
    if (!id) { localStorage.removeItem(CHAVE_RASCUNHO); localStorage.removeItem(CHAVE_COPIA); localStorage.removeItem(CHAVE_SOLICITACAO) }
    nav(-1)
  }

  return (
    <>
      <Cabecalho titulo={id ? `Editar pedido ${p.numero ? '#' + p.numero : ''}` : 'Novo pedido'} voltar
        acao={<button className="rounded-full p-2 hover:bg-white/10" onClick={descartar} aria-label="Descartar"><Icone nome="lixo" /></button>} />
      <main className="space-y-3 p-4 pb-48">
        {solicitacao && <Aviso tipo="info">Pedido do catálogo nº {solicitacao.numero}, enviado pelo cliente. Confira itens e preços e salve para virar pedido de venda.</Aviso>}
        {copia && <Aviso tipo="info">Cópia da venda {copia.numero ? `#${copia.numero}` : 'anterior'}, já com os preços de hoje. Confira, mude as quantidades, tire ou inclua itens e salve.{copia.fora ? ` ${copia.fora} produto(s) desativado(s) ficaram de fora.` : ''}</Aviso>}
        {/* cliente */}
        <button className="cartao flex w-full items-center gap-3 text-left" onClick={() => setEscolherCliente(true)}>
          <span className="rounded-full bg-marca-100 p-2 text-marca-700"><Icone nome="cliente" /></span>
          {cliente ? (
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold">{nomeCliente(cliente)}</span>
              <span className="block truncate text-xs text-stone-500">{docFormatado(cliente.cpf_cnpj)} · {cliente.cidade}</span>
              {nomeTabela && <span className="etiqueta mt-0.5 bg-destaque/30 text-marca-800">Tabela {nomeTabela}</span>}
            </span>
          ) : <span className="flex-1 font-semibold text-marca-700">Escolher cliente</span>}
          <Icone nome="editar" className="h-4 w-4 text-stone-400" />
        </button>

        {/* itens */}
        <div className="cartao p-0">
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
            <h2 className="font-bold">Produtos ({p.itens.length})</h2>
            <button className="btn-secundario px-3 py-1.5 text-sm" onClick={() => setEscolherProduto(true)}><Icone nome="mais" className="h-4 w-4" /> Adicionar</button>
          </div>
          {!p.itens.length && <p className="p-6 text-center text-sm text-stone-500">Toque em Adicionar para incluir produtos.</p>}
          <ul className="divide-y divide-stone-100">
            {p.itens.map((i) => (
              <li key={i.id} className="flex items-center gap-2 px-4 py-2.5">
                <button className="min-w-0 flex-1 text-left" onClick={() => setEditandoItem(i)}>
                  <p className="truncate font-semibold">{i.produto_nome}</p>
                  <p className="text-xs text-stone-500">{num(i.quantidade)} {i.unidade} × {brl(i.preco_unitario)}{i.desconto ? ` − ${brl(i.desconto)}` : ''}</p>
                </button>
                <p className="font-bold">{brl(i.total)}</p>
                <button className="rounded-full p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600" aria-label="Remover"
                  onClick={() => set({ itens: p.itens.filter((x) => x.id !== i.id) })}><Icone nome="fechar" className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        </div>

        {/* pagamento e entrega */}
        <div className="cartao grid grid-cols-2 gap-3">
          <Campo rotulo="Condição">
            <select className="campo" value={p.condicao_pagamento_id ?? ''} onChange={(e) => set({ condicao_pagamento_id: e.target.value || null })}>
              <option value="">Selecione</option>
              {condicoes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Forma de pagamento">
            <select className="campo" value={p.forma_pagamento_id ?? ''} onChange={(e) => set({ forma_pagamento_id: e.target.value || null })}>
              <option value="">Selecione</option>
              {formas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Campo>
          {formas.find((f) => f.id === p.forma_pagamento_id)?.conta_como_venda === false && (
            <p className="col-span-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">Troca: tira do estoque, mas não entra no relatório de vendas.</p>
          )}
          <Campo rotulo="Entrega prevista">
            <input type="date" className="campo" value={p.data_entrega ?? ''} onChange={(e) => set({ data_entrega: e.target.value || null })} />
          </Campo>
          <div className="col-span-2">
            <span className="rotulo">Isto é um</span>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => set({ status: p.status === 'orcamento' ? 'pendente' : p.status })}
                className={'rounded-xl p-2.5 text-left ring-1 ' + (p.status !== 'orcamento' ? 'bg-marca-700 text-white ring-marca-700' : 'bg-white ring-stone-300')}>
                <span className="block font-bold">Pedido de venda</span>
                <span className={'block text-xs ' + (p.status !== 'orcamento' ? 'text-marca-100' : 'text-stone-500')}>Cliente comprou. Tira do estoque.</span>
              </button>
              <button type="button" onClick={() => set({ status: 'orcamento' })}
                className={'rounded-xl p-2.5 text-left ring-1 ' + (p.status === 'orcamento' ? 'bg-marca-700 text-white ring-marca-700' : 'bg-white ring-stone-300')}>
                <span className="block font-bold">Orçamento</span>
                <span className={'block text-xs ' + (p.status === 'orcamento' ? 'text-marca-100' : 'text-stone-500')}>Só uma proposta de preço. Não mexe no estoque.</span>
              </button>
            </div>
            {gestor && p.status !== 'orcamento' && (
              <select className="campo mt-2" value={p.status} onChange={(e) => set({ status: e.target.value as Pedido['status'] })}>
                <option value="pendente">Situação: aguardando confirmação</option>
                <option value="confirmado">Situação: confirmado</option>
                <option value="faturado">Situação: faturado</option>
                <option value="entregue">Situação: entregue</option>
              </select>
            )}
          </div>
          <Campo rotulo="Desconto no total">
            <CampoDesconto pct={p.desconto_pct != null} valor={p.desconto_pct != null ? p.desconto_pct : p.desconto}
              onChange={(pct, v) => set(pct ? { desconto_pct: v, desconto: arred(subtotal * v / 100) } : { desconto_pct: null, desconto: v })} />
            {p.desconto_pct != null && descontoTotal > 0 && <span className="mt-1 block text-xs text-stone-500">= {brl(descontoTotal)}</span>}
          </Campo>
          <Campo rotulo="Frete (R$)">
            <input type="number" inputMode="decimal" step="0.01" min="0" className="campo" value={p.frete || ''}
              onChange={(e) => set({ frete: Number(e.target.value) || 0 })} />
          </Campo>
          <Campo rotulo="Observação (sai no pedido)" className="col-span-2">
            <textarea className="campo" rows={2} value={p.observacao ?? ''} onChange={(e) => set({ observacao: e.target.value })} />
          </Campo>
          {gestor && (
            <Campo rotulo="Observação interna (não sai no PDF)" className="col-span-2">
              <textarea className="campo" rows={2} value={p.observacao_interna ?? ''} onChange={(e) => set({ observacao_interna: e.target.value })} />
            </Campo>
          )}
        </div>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
      </main>

      {/* rodapé com total */}
      <div className="fixed inset-x-0 bottom-[calc(4.6rem+env(safe-area-inset-bottom))] z-30 border-t border-stone-200 bg-white p-3 shadow-[0_-4px_12px_rgba(0,0,0,.05)]">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="flex-1">
            <p className="text-xs text-stone-500">Subtotal {brl(subtotal)}{descontoTotal ? ` · desc. ${brl(descontoTotal)}` : ''}{p.frete ? ` · frete ${brl(p.frete)}` : ''}</p>
            <p className="text-xl font-extrabold text-marca-700">{brl(total)}</p>
          </div>
          <button className="btn-primario px-6" onClick={() => void salvar()}><Icone nome="ok" /> Salvar</button>
        </div>
      </div>

      <EscolherCliente aberta={escolherCliente} onFechar={() => setEscolherCliente(false)} onEscolher={escolheCliente} />
      <EscolherProduto aberta={escolherProduto} onFechar={() => setEscolherProduto(false)} onEscolher={escolheProduto} estoque={estoque} precoDe={precoDe} />
      {editandoItem && (
        <EditarItem item={editandoItem} gestor={gestor} saldo={estoque.get(editandoItem.produto_id)?.saldo}
          onFechar={() => setEditandoItem(null)} onSalvar={salvarItem} />
      )}
    </>
  )
}

function EscolherCliente({ aberta, onFechar, onEscolher }: { aberta: boolean; onFechar: () => void; onEscolher: (c: Cliente) => void }) {
  const [q, setQ] = useState('')
  const nav = useNavigate()
  const lista = useLiveQuery(async () => {
    const t = normalizar(q)
    const todos = await db.clientes.filter((c) => c.ativo && c.eh_cliente !== false).toArray()
    return todos.filter((c) => !t || normalizar(`${c.razao_social} ${c.nome_fantasia} ${c.cpf_cnpj} ${c.cidade} ${c.codigo}`).includes(t))
      .sort((a, b) => nomeCliente(a).localeCompare(nomeCliente(b))).slice(0, 60)
  }, [q]) ?? []
  return (
    <Folha aberta={aberta} onFechar={onFechar} titulo="Escolher cliente">
      <Busca valor={q} onChange={setQ} placeholder="Nome, CNPJ ou cidade" />
      <ul className="mt-2 divide-y divide-stone-100">
        {lista.map((c) => (
          <li key={c.id}>
            <button className="w-full py-2.5 text-left" onClick={() => onEscolher(c)}>
              <p className="font-semibold">{nomeCliente(c)}</p>
              <p className="text-xs text-stone-500">{c.razao_social !== nomeCliente(c) ? c.razao_social + ' · ' : ''}{docFormatado(c.cpf_cnpj)} · {c.cidade}</p>
            </button>
          </li>
        ))}
      </ul>
      {!lista.length && <Vazio texto="Nenhum cliente encontrado." />}
      <button className="btn-secundario mt-3 w-full" onClick={() => nav('/clientes/novo?voltar=pedido')}><Icone nome="mais" /> Cadastrar cliente</button>
    </Folha>
  )
}

function EscolherProduto({ aberta, onFechar, onEscolher, estoque, precoDe }: {
  aberta: boolean; onFechar: () => void; onEscolher: (p: Produto) => void; estoque: Map<string, { saldo: number }>
  precoDe: (p: Produto) => number
}) {
  const [q, setQ] = useState('')
  const lista = useLiveQuery(async () => {
    const todos = (await db.produtos.filter((p) => p.ativo).toArray()).sort((a, b) => a.nome.localeCompare(b.nome))
    return filtrarProdutos(todos, q).slice(0, 80)
  }, [q]) ?? []
  return (
    <Folha aberta={aberta} onFechar={onFechar} titulo="Adicionar produto">
      <Busca valor={q} onChange={setQ} autoFocus onEnter={() => { if (lista[0]) { onEscolher(lista[0]); setQ('') } }}
        placeholder="Código (ex.: 002) ou nome do produto" />
      <ul className="mt-2 divide-y divide-stone-100">
        {lista.map((p) => {
          const saldo = estoque.get(p.id)?.saldo ?? 0
          return (
            <li key={p.id}>
              <button className="flex w-full items-center gap-3 py-2.5 text-left" onClick={() => onEscolher(p)}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.nome}</p>
                  <p className="text-xs text-stone-500">{p.codigo} · {p.unidade}{p.qtd_embalagem > 1 ? ` c/ ${num(p.qtd_embalagem)}` : ''}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-marca-700">{brl(precoDe(p))}</p>
                  {precoDe(p) !== p.preco_venda && <p className="text-[11px] text-stone-400 line-through">{brl(p.preco_venda)}</p>}
                  <p className={'text-xs ' + (saldo > 0 ? 'text-stone-500' : 'font-semibold text-red-600')}>Estoque {num(saldo)}</p>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
      {!lista.length && <Vazio texto="Nenhum produto encontrado." />}
    </Folha>
  )
}

function EditarItem({ item, gestor, saldo, onFechar, onSalvar }: {
  item: ItemPedido; gestor: boolean; saldo?: number; onFechar: () => void; onSalvar: (i: ItemPedido) => void
}) {
  const produto = useLiveQuery(() => db.produtos.get(item.produto_id), [item.produto_id])
  const [qtd, setQtd] = useState(String(item.quantidade))
  const [preco, setPreco] = useState(String(item.preco_unitario))
  const [desc, setDesc] = useState(item.desconto || 0)
  const [descPct, setDescPct] = useState(false)
  const q = Number(qtd.replace(',', '.')) || 0
  const pr = Number(preco.replace(',', '.')) || 0
  const d = descPct ? arred(q * pr * desc / 100) : desc
  const totalItem = arred(q * pr - d)
  const minimo = produto?.preco_minimo ?? null
  const precoEfetivo = q ? (q * pr - d) / q : pr
  const abaixoMinimo = minimo !== null && precoEfetivo < minimo - 0.001
  const bloqueado = q <= 0 || totalItem < 0 || (abaixoMinimo && !gestor)

  return (
    <Folha aberta onFechar={onFechar} titulo={item.produto_nome ?? 'Item'}>
      <div className="space-y-3">
        <p className="text-sm text-stone-500">Estoque atual: <b>{num(saldo ?? 0)} {item.unidade}</b>{minimo !== null ? ` · preço mínimo ${brl(minimo)}` : ''}</p>
        <Campo rotulo="Quantidade">
          <div className="flex items-center gap-2">
            <button className="btn-secundario h-12 w-12 p-0" onClick={() => setQtd(String(Math.max(0, q - 1)))}><Icone nome="menos" /></button>
            <input className="campo text-center text-xl font-bold" inputMode="decimal" value={qtd} onChange={(e) => setQtd(e.target.value)} />
            <button className="btn-secundario h-12 w-12 p-0" onClick={() => setQtd(String(q + 1))}><Icone nome="mais" /></button>
          </div>
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Preço unitário"><input className="campo" inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} /></Campo>
          <Campo rotulo="Desconto no item">
            <CampoDesconto pct={descPct} valor={desc} onChange={(pct, v) => { setDescPct(pct); setDesc(v) }} />
            {descPct && d > 0 && <span className="mt-1 block text-xs text-stone-500">= {brl(d)}</span>}
          </Campo>
        </div>
        {saldo !== undefined && q > saldo && <Aviso tipo="alerta">Quantidade maior que o estoque. O pedido será aceito, mas o gestor verá o alerta.</Aviso>}
        {abaixoMinimo && <Aviso tipo={gestor ? 'alerta' : 'erro'}>Abaixo do preço mínimo ({brl(minimo)}).{gestor ? '' : ' Fale com o gestor.'}</Aviso>}
        <div className="flex items-center justify-between rounded-xl bg-marca-50 px-4 py-3">
          <span className="font-semibold">Total do item</span>
          <span className="text-xl font-extrabold text-marca-700">{brl(totalItem)}</span>
        </div>
        <button className="btn-primario w-full" disabled={bloqueado}
          onClick={() => onSalvar({ ...item, quantidade: q, preco_unitario: pr, desconto: d, total: totalItem })}>
          Confirmar
        </button>
      </div>
    </Folha>
  )
}

// Desconto em R$ ou %: o botão ao lado troca o modo (trocar zera o valor).
function CampoDesconto({ pct, valor, onChange }: { pct: boolean; valor: number; onChange: (pct: boolean, valor: number) => void }) {
  const [texto, setTexto] = useState(valor ? String(valor).replace('.', ',') : '')
  return (
    <div className="flex gap-1">
      <input className="campo min-w-0" inputMode="decimal" placeholder="0" value={texto}
        onChange={(e) => { setTexto(e.target.value); onChange(pct, Math.max(0, Number(e.target.value.replace(',', '.')) || 0)) }} />
      <div className="flex shrink-0 overflow-hidden rounded-xl ring-1 ring-stone-300">
        {([false, true] as const).map((m) => (
          <button key={String(m)} type="button" onClick={() => { if (m !== pct) { setTexto(''); onChange(m, 0) } }}
            className={'w-10 text-sm font-bold ' + (pct === m ? 'bg-marca-700 text-white' : 'bg-white text-stone-600')}>{m ? '%' : 'R$'}</button>
        ))}
      </div>
    </div>
  )
}
