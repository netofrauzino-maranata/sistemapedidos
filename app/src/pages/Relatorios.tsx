import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Cabecalho, Campo, Icone } from '../components/ui'
import { useAuth } from '../lib/auth'
import { baixarArquivo, gerarCsv } from '../lib/csv'
import { db, formasForaDeVenda } from '../lib/db'
import { brl, data, hojeISO, num } from '../lib/formato'
import { nomeCliente, useEmpresa } from '../lib/hooks'
import { pdfRelatorio, type LinhaRelatorio, type OpcoesRelatorio } from '../lib/pdf'
import { STATUS_LABEL, type StatusPedido } from '../lib/tipos'
import { RelClientes, RelFornecedores } from './RelatoriosCadastro'
import { BotoesPdf, MovEstoque, NecessidadeCompra, RelatorioEstoque, VendasCategoria } from './RelatoriosExtras'

// Relatórios no modelo do sistema antigo: uma lista; cada um abre com filtro
// de período e vendedor e gera PDF. Calculado com os dados do aparelho.

type Rel = 'vendas' | 'produtos_detalhe' | 'produtos_resumo' | 'categoria' | 'compra' | 'movimento' | 'estoque' | 'zerados'
  | 'vendedor' | 'cliente' | 'positivacao' | 'clientes' | 'fornecedores'

interface ItemMenu { id: Rel; nome: string; desc: string; icone: string; gestor?: boolean; periodo: boolean }
const MENU: { titulo: string; itens: ItemMenu[] }[] = [
  { titulo: 'Vendas', itens: [
    { id: 'vendas', nome: 'Relatório de vendas', desc: 'Cada venda do período, com totais', icone: 'pedido', periodo: true },
    { id: 'produtos_detalhe', nome: 'Produtos vendidos (detalhe)', desc: 'Cada produto e para quem vendeu', icone: 'produto', periodo: true },
    { id: 'produtos_resumo', nome: 'Produtos vendidos (resumo)', desc: 'Quantidade e valor de cada produto', icone: 'caixa', periodo: true },
    { id: 'categoria', nome: 'Vendas por categoria', desc: 'Biscoito, doce... e os itens de cada grupo', icone: 'grafico', periodo: true },
    { id: 'vendedor', nome: 'Vendas por vendedor', desc: 'Total de cada vendedor', icone: 'usuarios', gestor: true, periodo: true },
    { id: 'cliente', nome: 'Vendas por cliente', desc: 'Quem mais comprou', icone: 'cliente', periodo: true },
    { id: 'positivacao', nome: 'Clientes sem compra', desc: 'Positivação da carteira', icone: 'alerta', periodo: true },
  ] },
  { titulo: 'Clientes e fornecedores', itens: [
    { id: 'clientes', nome: 'Relatório de clientes', desc: 'Cadastro e compras de cada cliente', icone: 'cliente', periodo: true },
    { id: 'fornecedores', nome: 'Relatório de fornecedores', desc: 'Cadastro e entradas de cada fornecedor', icone: 'empresa', gestor: true, periodo: true },
  ] },
  { titulo: 'Estoque e compras', itens: [
    { id: 'compra', nome: 'Necessidade de compra', desc: 'Quanto comprar com base na venda', icone: 'entrada', gestor: true, periodo: false },
    { id: 'movimento', nome: 'Relatório de mov. estoque', desc: 'Entradas, vendas e ajustes no período', icone: 'sync', gestor: true, periodo: true },
    { id: 'estoque', nome: 'Relatório de estoque', desc: 'Saldo e valor de cada produto', icone: 'estoque', periodo: false },
    { id: 'zerados', nome: 'Itens zerados', desc: 'Produtos sem saldo ou negativos', icone: 'alerta', periodo: false },
  ] },
]
const TODOS = MENU.flatMap((g) => g.itens)

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
interface Detalhe { pedido: string; data: string; cliente: string; quantidade: number; preco: number; total: number }

export default function Relatorios() {
  const { gestor } = useAuth()
  const [params, setParams] = useSearchParams()
  const rel = params.get('r') as Rel | null
  const item = TODOS.find((i) => i.id === rel && (!i.gestor || gestor))

  if (!item) {
    return (
      <>
        <Cabecalho titulo="Relatórios" voltar="/mais" />
        <main className="space-y-4 p-4">
          {MENU.map((g) => (
            <section key={g.titulo}>
              <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-stone-500">{g.titulo}</h2>
              <nav className="cartao divide-y divide-stone-100 p-0">
                {g.itens.filter((i) => !i.gestor || gestor).map((i) => (
                  <button key={i.id} onClick={() => setParams({ r: i.id })} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-marca-50 text-marca-700"><Icone nome={i.icone} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{i.nome}</span>
                      <span className="block text-xs text-stone-500">{i.desc}</span>
                    </span>
                    <Icone nome="voltar" className="h-4 w-4 rotate-180 text-stone-400" />
                  </button>
                ))}
              </nav>
            </section>
          ))}
        </main>
      </>
    )
  }
  return <Relatorio item={item} />
}

function Relatorio({ item }: { item: ItemMenu }) {
  const { gestor, perfil } = useAuth()
  const empresa = useEmpresa()
  const [atalho, setAtalho] = useState('mes')
  const [ini, setIni] = useState(periodo('mes')[0])
  const [fim, setFim] = useState(hojeISO())
  const [vendedor, setVendedor] = useState('')
  const [incluirOrc, setIncluirOrc] = useState(false)
  const [aberto, setAberto] = useState<string | null>(null)
  const rel = item.id
  const textoPeriodo = `${data(ini)} a ${data(fim)}`

  function usarAtalho(a: string) { setAtalho(a); const [i, f] = periodo(a); setIni(i); setFim(f) }

  const r = useLiveQuery(async () => {
    const [pedidos, clientes, perfis, produtos, formas] = await Promise.all([db.pedidos.toArray(), db.clientes.toArray(), db.perfis.toArray(), db.produtos.toArray(), db.formas.toArray()])
    const cli = new Map(clientes.map((c) => [c.id, c]))
    const per = new Map(perfis.map((p) => [p.id, p]))
    const prod = new Map(produtos.map((p) => [p.id, p]))
    const forma = new Map(formas.map((f) => [f.id, f.nome]))
    const dia = (s: string) => new Date(s).toLocaleDateString('en-CA')
    const validos: StatusPedido[] = incluirOrc ? ['orcamento', 'pendente', 'confirmado', 'faturado', 'entregue'] : ['pendente', 'confirmado', 'faturado', 'entregue']
    const foraDeVenda = await formasForaDeVenda()
    const doPeriodo = pedidos.filter((p) => {
      const d = dia(p.data_pedido)
      if (d < ini || d > fim) return false
      if (!gestor && p.vendedor_id !== perfil?.id) return false
      if (vendedor && p.vendedor_id !== vendedor) return false
      return validos.includes(p.status)
    }).sort((a, b) => a.data_pedido.localeCompare(b.data_pedido))
    // Trocas baixam estoque mas não são venda: ficam fora dos totais
    const lista = doPeriodo.filter((p) => !foraDeVenda.has(p.forma_pagamento_id ?? ''))
    const trocas = doPeriodo.filter((p) => foraDeVenda.has(p.forma_pagamento_id ?? ''))
    const total = lista.reduce((s, p) => s + p.total, 0)

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
    const porProduto = new Map<string, Linha & { codigo: string; detalhes: Detalhe[] }>()
    lista.forEach((p) => p.itens.forEach((i) => {
      const pr = prod.get(i.produto_id)
      const l = porProduto.get(i.produto_id) ?? { chave: i.produto_id, codigo: pr?.codigo ?? i.produto_codigo ?? '', nome: pr?.nome ?? i.produto_nome ?? '?', pedidos: 0, quantidade: 0, total: 0, extra: pr?.unidade ?? i.unidade, detalhes: [] }
      l.pedidos++; l.quantidade += i.quantidade; l.total += i.total
      l.detalhes.push({ pedido: p.numero ? String(p.numero) : '-', data: p.data_pedido, cliente: nomeCliente(cli.get(p.cliente_id)), quantidade: i.quantidade, preco: i.preco_unitario, total: i.total })
      porProduto.set(i.produto_id, l)
    }))
    const compraram = new Set(lista.map((p) => p.cliente_id))
    const ultimaCompra = new Map<string, string>()
    pedidos.filter((p) => validos.includes(p.status) && !foraDeVenda.has(p.forma_pagamento_id ?? '')).forEach((p) => {
      const u = ultimaCompra.get(p.cliente_id)
      if (!u || p.data_pedido > u) ultimaCompra.set(p.cliente_id, p.data_pedido)
    })
    const carteira = clientes.filter((c) => c.ativo && c.eh_cliente !== false && (gestor ? (!vendedor || c.vendedor_id === vendedor) : true))
    const semCompra: Linha[] = carteira.filter((c) => !compraram.has(c.id)).map((c) => ({
      chave: c.id, nome: nomeCliente(c), pedidos: 0, quantidade: 0, total: 0,
      extra: ultimaCompra.get(c.id) ? `última compra ${data(ultimaCompra.get(c.id)!)}` : 'nunca comprou',
    })).sort((a, b) => a.nome.localeCompare(b.nome))

    return {
      lista, cli, per, forma,
      trocasQtd: trocas.length, trocasTotal: trocas.reduce((s, p) => s + p.total, 0),
      total, qtd: lista.length, ticket: lista.length ? total / lista.length : 0,
      volumes: lista.reduce((s, p) => s + p.itens.reduce((t, i) => t + i.quantidade, 0), 0),
      clientesAtendidos: compraram.size, carteira: carteira.length,
      vendedor: agrupar((p) => p.vendedor_id, (k) => per.get(k)?.nome ?? '?'),
      cliente: agrupar((p) => p.cliente_id, (k) => nomeCliente(cli.get(k))),
      produto: [...porProduto.values()].sort((a, b) => b.total - a.total),
      positivacao: semCompra,
      perfis,
    }
  }, [ini, fim, vendedor, incluirOrc, gestor, perfil?.id])

  // Tabela usada no PDF e na planilha
  function tabela(): Omit<OpcoesRelatorio, 'empresa'> | null {
    if (!r) return null
    const base = { titulo: item.nome, subtitulo: textoPeriodo + (vendedor ? ` · ${r.per.get(vendedor)?.nome ?? ''}` : '') }
    const totaisVenda: [string, string][] = [['Vendas', String(r.qtd)], ['Clientes', String(r.clientesAtendidos)], ['Volumes', num(r.volumes)], ['Ticket médio', brl(r.ticket)], ['Valor vendido', brl(r.total)]]
    const notaTroca = r.trocasQtd ? `Trocas no período (fora das vendas): ${r.trocasQtd} · ${brl(r.trocasTotal)}.` : undefined
    if (rel === 'vendas') return {
      ...base, cabecalho: ['Nº', 'Data', 'Cliente', 'Vendedor', 'Forma', 'Situação', 'Valor'],
      linhas: r.lista.map((p) => [p.numero ? String(p.numero) : '-', data(p.data_pedido), nomeCliente(r.cli.get(p.cliente_id)), r.per.get(p.vendedor_id)?.nome ?? '', p.forma_pagamento_id ? r.forma.get(p.forma_pagamento_id) ?? '' : '', STATUS_LABEL[p.status], brl(p.total)]),
      direita: [6], larguras: { 0: 14, 1: 20, 4: 22, 5: 22, 6: 24 }, totais: totaisVenda, nota: notaTroca,
    }
    if (rel === 'produtos_resumo') return {
      ...base, cabecalho: ['Código', 'Produto', 'Un', 'Qtd', 'Vendas', 'Preço médio', 'Valor'],
      linhas: r.produto.map((l) => [l.codigo, l.nome, l.extra ?? '', num(l.quantidade), String(l.pedidos), brl(l.quantidade ? l.total / l.quantidade : 0), brl(l.total)]),
      direita: [3, 4, 5, 6], larguras: { 0: 14, 2: 10, 3: 16, 4: 15, 5: 22, 6: 24 },
      totais: [['Produtos', String(r.produto.length)], ['Vendas', String(r.qtd)], ['Volumes', num(r.volumes)], ['Valor vendido', brl(r.total)]], nota: notaTroca,
    }
    if (rel === 'produtos_detalhe') {
      const linhas: LinhaRelatorio[] = []
      for (const l of r.produto) {
        linhas.push({ grupo: [`${l.codigo} ${l.nome}`, '', '', num(l.quantidade), '', brl(l.total)] })
        for (const d of l.detalhes) linhas.push([`   ${d.cliente}`, d.pedido, data(d.data), num(d.quantidade), brl(d.preco), brl(d.total)])
      }
      return {
        ...base, cabecalho: ['Produto / cliente', 'Pedido', 'Data', 'Qtd', 'Preço', 'Valor'], linhas,
        direita: [3, 4, 5], larguras: { 1: 16, 2: 20, 3: 15, 4: 20, 5: 24 },
        totais: [['Produtos', String(r.produto.length)], ['Vendas', String(r.qtd)], ['Volumes', num(r.volumes)], ['Valor vendido', brl(r.total)]], nota: notaTroca,
      }
    }
    if (rel === 'vendedor' || rel === 'cliente') {
      const ls = r[rel]
      return {
        ...base, cabecalho: [rel === 'vendedor' ? 'Vendedor' : 'Cliente', 'Vendas', 'Volumes', 'Ticket médio', 'Valor', '% venda'],
        linhas: ls.map((l) => [l.nome, String(l.pedidos), num(l.quantidade), brl(l.total / l.pedidos), brl(l.total), r.total ? `${((l.total / r.total) * 100).toFixed(1).replace('.', ',')}%` : '']),
        direita: [1, 2, 3, 4, 5], larguras: { 1: 16, 2: 18, 3: 24, 4: 26, 5: 18 }, totais: totaisVenda, nota: notaTroca,
      }
    }
    if (rel === 'positivacao') return {
      ...base, cabecalho: ['Cliente', 'Situação'], linhas: r.positivacao.map((l) => [l.nome, l.extra ?? '']), larguras: { 1: 50 },
      totais: [['Carteira', String(r.carteira)], ['Compraram', String(r.clientesAtendidos)], ['Sem compra', String(r.positivacao.length)], ['Positivação', `${r.carteira ? Math.round((r.clientesAtendidos / r.carteira) * 100) : 0}%`]],
    }
    return null
  }

  const gerarPdf = () => pdfRelatorio({ empresa, ...tabela()! })
  function exportarCsv() {
    const t = tabela(); if (!t) return
    const linhas = t.linhas.map((l) => Object.fromEntries((Array.isArray(l) ? l : l.grupo).map((v, k) => [t.cabecalho[k], v.trim()])))
    baixarArquivo(gerarCsv(linhas, t.cabecalho), `${rel}-${ini}-a-${fim}.csv`)
  }
  const temTabela = ['vendas', 'produtos_resumo', 'produtos_detalhe', 'vendedor', 'cliente', 'positivacao'].includes(rel)

  return (
    <>
      <Cabecalho titulo={item.nome} voltar="/relatorios"
        acao={temTabela ? <button className="rounded-full p-2 hover:bg-white/10" onClick={exportarCsv} aria-label="Exportar planilha"><Icone nome="exportar" /></button> : undefined} />
      <main className="space-y-3 p-4">
        {item.periodo && (
          <section className="cartao space-y-3">
            <div className="-mx-1 flex flex-wrap gap-1">
              {[['hoje', 'Hoje'], ['7d', '7 dias'], ['mes', 'Este mês'], ['mesant', 'Mês passado'], ['ano', 'Ano']].map(([k, n]) => (
                <button key={k} onClick={() => usarAtalho(k)} className={'etiqueta px-3 py-1.5 text-sm ' + (atalho === k ? 'bg-marca-700 text-white' : 'bg-stone-100 text-stone-600')}>{n}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="De"><input type="date" className="campo" value={ini} onChange={(e) => { if (e.target.value) { setIni(e.target.value); setAtalho('') } }} /></Campo>
              <Campo rotulo="Até"><input type="date" className="campo" value={fim} onChange={(e) => { if (e.target.value) { setFim(e.target.value); setAtalho('') } }} /></Campo>
              {gestor && rel !== 'movimento' && rel !== 'fornecedores' && (
                <Campo rotulo="Vendedor" className="col-span-2">
                  <select className="campo" value={vendedor} onChange={(e) => setVendedor(e.target.value)}>
                    <option value="">Todos</option>{r?.perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </Campo>
              )}
            </div>
            {!['movimento', 'clientes', 'fornecedores'].includes(rel) && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={incluirOrc} onChange={(e) => setIncluirOrc(e.target.checked)} /> Incluir orçamentos</label>}
          </section>
        )}

        {rel === 'categoria' && r && <VendasCategoria pedidos={r.lista} periodo={textoPeriodo} />}
        {rel === 'compra' && <NecessidadeCompra />}
        {rel === 'movimento' && <MovEstoque ini={ini} fim={fim} periodo={textoPeriodo} />}
        {rel === 'estoque' && <RelatorioEstoque />}
        {rel === 'clientes' && <RelClientes ini={ini} fim={fim} periodo={textoPeriodo} vendedor={vendedor} />}
        {rel === 'fornecedores' && <RelFornecedores ini={ini} fim={fim} periodo={textoPeriodo} />}
        {rel === 'zerados' && <RelatorioEstoque inicial="zerados" />}

        {r && temTabela && <>
          {rel !== 'positivacao' && (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="cartao p-2"><p className="text-[11px] text-stone-500">Vendas</p><p className="font-bold">{r.qtd}</p></div>
              <div className="cartao p-2"><p className="text-[11px] text-stone-500">Volumes</p><p className="font-bold">{num(r.volumes)}</p></div>
              <div className="rounded-xl bg-marca-700 p-2 text-white"><p className="text-[11px] text-marca-100">Vendido</p><p className="truncate font-bold">{brl(r.total)}</p></div>
            </div>
          )}
          {rel === 'positivacao' && (
            <p className="cartao text-sm">Positivação: <b>{r.clientesAtendidos} de {r.carteira}</b> clientes ({r.carteira ? Math.round((r.clientesAtendidos / r.carteira) * 100) : 0}%)</p>
          )}
          {r.trocasQtd > 0 && rel !== 'positivacao' && <p className="text-xs text-stone-500">Trocas no período (fora das vendas): {r.trocasQtd} · {brl(r.trocasTotal)}</p>}

          <section className="cartao p-0">
            <ul className="divide-y divide-stone-100">
              {rel === 'vendas' && r.lista.map((p) => (
                <li key={p.id}>
                  <Link to={`/pedidos/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{nomeCliente(r.cli.get(p.cliente_id))}</p>
                      <p className="text-xs text-stone-500">#{p.numero ?? '-'} · {data(p.data_pedido)} · {p.forma_pagamento_id ? r.forma.get(p.forma_pagamento_id) : ''}{gestor ? ` · ${r.per.get(p.vendedor_id)?.nome ?? ''}` : ''}</p>
                    </div>
                    <b>{brl(p.total)}</b>
                  </Link>
                </li>
              ))}
              {(rel === 'produtos_resumo' || rel === 'produtos_detalhe') && r.produto.map((l) => (
                <li key={l.chave}>
                  <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm" onClick={() => rel === 'produtos_detalhe' && setAberto(aberto === l.chave ? null : l.chave)}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold"><span className="font-normal text-stone-500">{l.codigo}</span> {l.nome}</p>
                      <p className="text-xs text-stone-500">{num(l.quantidade)} {(l.extra ?? '').toLowerCase()} em {l.pedidos} venda(s)</p>
                    </div>
                    <b>{brl(l.total)}</b>
                  </button>
                  {rel === 'produtos_detalhe' && aberto === l.chave && (
                    <ul className="border-t border-stone-100 bg-stone-50">
                      {l.detalhes.map((d, k) => (
                        <li key={k} className="flex items-center gap-3 px-6 py-1.5 text-xs">
                          <span className="min-w-0 flex-1 truncate">{d.cliente} <span className="text-stone-500">· #{d.pedido} · {data(d.data)}</span></span>
                          <span>{num(d.quantidade)} x {brl(d.preco)}</span>
                          <b>{brl(d.total)}</b>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
              {(rel === 'vendedor' || rel === 'cliente' || rel === 'positivacao') && r[rel].map((l, i) => (
                <li key={l.chave} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-6 text-right text-xs text-stone-400">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{l.nome}</p>
                    <p className="text-xs text-stone-500">{rel === 'positivacao' ? l.extra : `${l.pedidos} venda(s) · ${num(l.quantidade)} vol.`}</p>
                  </div>
                  {rel !== 'positivacao' && <b>{brl(l.total)}</b>}
                </li>
              ))}
            </ul>
            {!(rel === 'vendas' ? r.lista : rel === 'produtos_resumo' || rel === 'produtos_detalhe' ? r.produto : r[rel as 'vendedor']).length && (
              <p className="p-6 text-center text-sm text-stone-500">{rel === 'positivacao' ? 'Todos os clientes compraram no período.' : 'Sem vendas no período.'}</p>
            )}
          </section>
          <BotoesPdf gerar={gerarPdf} arquivo={`${rel}-${ini}-a-${fim}.pdf`} />
        </>}
        <p className="text-center text-xs text-stone-400">Calculado com os dados sincronizados no aparelho.</p>
      </main>
    </>
  )
}
