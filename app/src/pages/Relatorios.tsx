import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Cabecalho, Campo, Icone } from '../components/ui'
import { useAuth } from '../lib/auth'
import { baixarArquivo, gerarCsv } from '../lib/csv'
import { db } from '../lib/db'
import { brl, data, hojeISO, num } from '../lib/formato'
import { nomeCliente } from '../lib/hooks'
import { STATUS_LABEL, type StatusPedido } from '../lib/tipos'

type Aba = 'resumo' | 'vendedor' | 'cliente' | 'produto' | 'positivacao'

function periodo(chave: string): [string, string] {
  const hoje = new Date()
  const iso = (d: Date) => d.toLocaleDateString('en-CA')
  if (chave === 'hoje') return [iso(hoje), iso(hoje)]
  if (chave === '7d') return [iso(new Date(Date.now() - 6 * 864e5)), iso(hoje)]
  if (chave === 'mes') return [iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), iso(hoje)]
  if (chave === 'mesant') return [iso(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)), iso(new Date(hoje.getFullYear(), hoje.getMonth(), 0))]
  return [iso(new Date(hoje.getFullYear(), 0, 1)), iso(hoje)]
}

interface Linha { chave: string; nome: string; pedidos: number; quantidade: number; total: number; extra?: string }

export default function Relatorios() {
  const { gestor, perfil } = useAuth()
  const [aba, setAba] = useState<Aba>('resumo')
  const [atalho, setAtalho] = useState('mes')
  const [ini, setIni] = useState(periodo('mes')[0])
  const [fim, setFim] = useState(hojeISO())
  const [vendedor, setVendedor] = useState('')
  const [incluirOrc, setIncluirOrc] = useState(false)

  function usarAtalho(a: string) { setAtalho(a); const [i, f] = periodo(a); setIni(i); setFim(f) }

  const r = useLiveQuery(async () => {
    const [pedidos, clientes, perfis, produtos] = await Promise.all([db.pedidos.toArray(), db.clientes.toArray(), db.perfis.toArray(), db.produtos.toArray()])
    const cli = new Map(clientes.map((c) => [c.id, c]))
    const per = new Map(perfis.map((p) => [p.id, p]))
    const prod = new Map(produtos.map((p) => [p.id, p]))
    const dia = (s: string) => new Date(s).toLocaleDateString('en-CA')
    const validos: StatusPedido[] = incluirOrc ? ['orcamento', 'pendente', 'confirmado', 'faturado', 'entregue'] : ['pendente', 'confirmado', 'faturado', 'entregue']
    const lista = pedidos.filter((p) => {
      const d = dia(p.data_pedido)
      if (d < ini || d > fim) return false
      if (!gestor && p.vendedor_id !== perfil?.id) return false
      if (vendedor && p.vendedor_id !== vendedor) return false
      return validos.includes(p.status)
    })
    const total = lista.reduce((s, p) => s + p.total, 0)
    const porDia = new Map<string, number>()
    lista.forEach((p) => porDia.set(dia(p.data_pedido), (porDia.get(dia(p.data_pedido)) ?? 0) + p.total))
    const porStatus = new Map<string, { n: number; t: number }>()
    pedidos.filter((p) => { const d = dia(p.data_pedido); return d >= ini && d <= fim && (gestor || p.vendedor_id === perfil?.id) && (!vendedor || p.vendedor_id === vendedor) })
      .forEach((p) => { const x = porStatus.get(p.status) ?? { n: 0, t: 0 }; porStatus.set(p.status, { n: x.n + 1, t: x.t + p.total }) })

    const agrupar = (chaveDe: (p: (typeof lista)[0]) => string, nomeDe: (k: string) => string): Linha[] => {
      const m = new Map<string, Linha>()
      lista.forEach((p) => {
        const k = chaveDe(p)
        const l = m.get(k) ?? { chave: k, nome: nomeDe(k), pedidos: 0, quantidade: 0, total: 0 }
        l.pedidos++; l.total += p.total; l.quantidade += p.itens.reduce((s, i) => s + i.quantidade, 0)
        m.set(k, l)
      })
      return [...m.values()].sort((a, b) => b.total - a.total)
    }
    const porProduto = new Map<string, Linha>()
    lista.forEach((p) => p.itens.forEach((i) => {
      const l = porProduto.get(i.produto_id) ?? { chave: i.produto_id, nome: prod.get(i.produto_id)?.nome ?? i.produto_nome ?? '?', pedidos: 0, quantidade: 0, total: 0, extra: prod.get(i.produto_id)?.unidade }
      l.pedidos++; l.quantidade += i.quantidade; l.total += i.total
      porProduto.set(i.produto_id, l)
    }))
    const compraram = new Set(lista.map((p) => p.cliente_id))
    const ultimaCompra = new Map<string, string>()
    pedidos.filter((p) => validos.includes(p.status)).forEach((p) => {
      const u = ultimaCompra.get(p.cliente_id)
      if (!u || p.data_pedido > u) ultimaCompra.set(p.cliente_id, p.data_pedido)
    })
    const carteira = clientes.filter((c) => c.ativo && (gestor ? (!vendedor || c.vendedor_id === vendedor) : true))
    const semCompra: Linha[] = carteira.filter((c) => !compraram.has(c.id)).map((c) => ({
      chave: c.id, nome: nomeCliente(c), pedidos: 0, quantidade: 0, total: 0,
      extra: ultimaCompra.get(c.id) ? `última compra ${data(ultimaCompra.get(c.id)!)}` : 'nunca comprou',
    })).sort((a, b) => a.nome.localeCompare(b.nome))

    return {
      total, qtd: lista.length, ticket: lista.length ? total / lista.length : 0,
      clientesAtendidos: compraram.size, carteira: carteira.length,
      porDia: [...porDia.entries()].sort(), porStatus,
      vendedor: agrupar((p) => p.vendedor_id, (k) => per.get(k)?.nome ?? '?'),
      cliente: agrupar((p) => p.cliente_id, (k) => nomeCliente(cli.get(k))),
      produto: [...porProduto.values()].sort((a, b) => b.total - a.total),
      positivacao: semCompra,
      perfis,
    }
  }, [ini, fim, vendedor, incluirOrc, gestor, perfil?.id])

  const abas: [Aba, string][] = [['resumo', 'Resumo'], ...(gestor ? [['vendedor', 'Vendedores'] as [Aba, string]] : []), ['cliente', 'Clientes'], ['produto', 'Produtos'], ['positivacao', 'Sem compra']]
  const linhas: Linha[] = r && aba !== 'resumo' ? r[aba] : []
  const maxDia = Math.max(1, ...(r?.porDia.map(([, v]) => v) ?? [1]))

  function exportar() {
    if (!r) return
    const nome = `relatorio-${aba}-${ini}-a-${fim}.csv`
    if (aba === 'resumo') baixarArquivo(gerarCsv(r.porDia.map(([d, v]) => ({ data: data(d), total: Number(v.toFixed(2)) }))), nome)
    else baixarArquivo(gerarCsv(linhas.map((l) => ({ nome: l.nome, pedidos: l.pedidos, quantidade: l.quantidade, total: Number(l.total.toFixed(2)), info: l.extra ?? '' }))), nome)
  }

  return (
    <>
      <Cabecalho titulo="Relatórios" voltar acao={<button className="rounded-full p-2 hover:bg-white/10" onClick={exportar} aria-label="Exportar planilha"><Icone nome="exportar" /></button>} />
      <main className="space-y-3 p-4">
        <section className="cartao space-y-3">
          <div className="-mx-1 flex flex-wrap gap-1">
            {[['hoje', 'Hoje'], ['7d', '7 dias'], ['mes', 'Este mês'], ['mesant', 'Mês passado'], ['ano', 'Ano']].map(([k, n]) => (
              <button key={k} onClick={() => usarAtalho(k)} className={'etiqueta px-3 py-1.5 text-sm ' + (atalho === k ? 'bg-marca-700 text-white' : 'bg-stone-100 text-stone-600')}>{n}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="De"><input type="date" className="campo" value={ini} onChange={(e) => { setIni(e.target.value); setAtalho('') }} /></Campo>
            <Campo rotulo="Até"><input type="date" className="campo" value={fim} onChange={(e) => { setFim(e.target.value); setAtalho('') }} /></Campo>
            {gestor && (
              <Campo rotulo="Vendedor" className="col-span-2">
                <select className="campo" value={vendedor} onChange={(e) => setVendedor(e.target.value)}>
                  <option value="">Todos</option>{r?.perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </Campo>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={incluirOrc} onChange={(e) => setIncluirOrc(e.target.checked)} /> Incluir orçamentos</label>
        </section>

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
          {abas.map(([k, n]) => (
            <button key={k} onClick={() => setAba(k)} className={'etiqueta shrink-0 px-3 py-1.5 text-sm ' + (aba === k ? 'bg-marca-700 text-white' : 'bg-white text-stone-600 ring-1 ring-stone-200')}>{n}</button>
          ))}
        </div>

        {r && aba === 'resumo' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="cartao"><p className="text-xs text-stone-500">Vendido</p><p className="text-xl font-extrabold text-marca-700">{brl(r.total)}</p></div>
              <div className="cartao"><p className="text-xs text-stone-500">Pedidos</p><p className="text-xl font-extrabold">{r.qtd}</p></div>
              <div className="cartao"><p className="text-xs text-stone-500">Ticket médio</p><p className="text-xl font-extrabold">{brl(r.ticket)}</p></div>
              <div className="cartao"><p className="text-xs text-stone-500">Positivação</p><p className="text-xl font-extrabold">{r.clientesAtendidos}/{r.carteira}</p>
                <p className="text-xs text-stone-500">{r.carteira ? Math.round((r.clientesAtendidos / r.carteira) * 100) : 0}% da carteira</p></div>
            </div>
            <section className="cartao">
              <h2 className="mb-2 font-bold">Vendas por dia</h2>
              {!r.porDia.length && <p className="text-sm text-stone-500">Sem vendas no período.</p>}
              <ul className="space-y-1.5">
                {r.porDia.map(([d, v]) => (
                  <li key={d} className="grid grid-cols-[4.5rem_1fr_6rem] items-center gap-2 text-sm">
                    <span className="text-stone-500">{data(d).slice(0, 5)}</span>
                    <span className="h-3 rounded-full bg-marca-500" style={{ width: `${(v / maxDia) * 100}%` }} />
                    <span className="text-right font-semibold">{brl(v)}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="cartao">
              <h2 className="mb-2 font-bold">Por situação</h2>
              <ul className="divide-y divide-stone-100 text-sm">
                {[...r.porStatus.entries()].map(([s, x]) => (
                  <li key={s} className="flex justify-between py-1.5"><span>{STATUS_LABEL[s as StatusPedido]} ({x.n})</span><b>{brl(x.t)}</b></li>
                ))}
              </ul>
            </section>
          </>
        )}

        {r && aba !== 'resumo' && (
          <section className="cartao p-0">
            {!linhas.length && <p className="p-6 text-center text-sm text-stone-500">{aba === 'positivacao' ? 'Todos os clientes compraram no período.' : 'Sem dados no período.'}</p>}
            <ul className="divide-y divide-stone-100">
              {linhas.map((l, i) => (
                <li key={l.chave} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-6 text-right text-xs text-stone-400">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{l.nome}</p>
                    <p className="text-xs text-stone-500">
                      {aba === 'positivacao' ? l.extra : aba === 'produto' ? `${num(l.quantidade)} ${l.extra ?? ''} em ${l.pedidos} pedido(s)` : `${l.pedidos} pedido(s)`}
                    </p>
                  </div>
                  {aba !== 'positivacao' && <b>{brl(l.total)}</b>}
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="text-center text-xs text-stone-400">Calculado com os dados sincronizados no aparelho.</p>
      </main>
    </>
  )
}
