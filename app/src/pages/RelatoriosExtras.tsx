import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icone } from '../components/ui'
import { db } from '../lib/db'
import { brl, data, dataHora, num } from '../lib/formato'
import { supabase } from '../lib/supabase'
import { useEmpresa } from '../lib/hooks'
import { abrirPdf, compartilharPdf, pdfRelatorio, type LinhaRelatorio } from '../lib/pdf'
import type { Pedido, Produto } from '../lib/tipos'

// Relatórios: vendas por categoria, itens zerados e sugestão de compra.
// Tudo calculado com os dados do aparelho; cada um gera PDF.

const SEM = '__sem__'

export function BotoesPdf({ gerar, arquivo }: { gerar: () => ReturnType<typeof pdfRelatorio>; arquivo: string }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button className="btn-secundario" onClick={() => abrirPdf(gerar())}><Icone nome="pdf" /> Ver PDF</button>
      <button className="btn-primario" onClick={() => void compartilharPdf(gerar(), arquivo)}><Icone nome="exportar" /> Enviar PDF</button>
    </div>
  )
}

// ---------- Vendas por categoria ----------
interface ItemCat { id: string; codigo: string; nome: string; unidade: string; quantidade: number; total: number }
interface GrupoCat { id: string; nome: string; quantidade: number; total: number; pedidos: Set<string>; itens: Map<string, ItemCat> }

export function VendasCategoria({ pedidos, periodo }: { pedidos: Pedido[]; periodo: string }) {
  const empresa = useEmpresa()
  const [aberto, setAberto] = useState<string | null>(null)
  const base = useLiveQuery(async () => ({
    produtos: new Map((await db.produtos.toArray()).map((p) => [p.id, p])),
    categorias: new Map((await db.categorias.toArray()).map((c) => [c.id, c.nome])),
  }), [])
  if (!base) return null

  const m = new Map<string, GrupoCat>()
  for (const p of pedidos) for (const i of p.itens) {
    const prod = base.produtos.get(i.produto_id)
    const cat = prod?.categoria_id && base.categorias.has(prod.categoria_id) ? prod.categoria_id : SEM
    const g = m.get(cat) ?? { id: cat, nome: cat === SEM ? 'Sem categoria' : base.categorias.get(cat)!, quantidade: 0, total: 0, pedidos: new Set(), itens: new Map() }
    g.quantidade += Number(i.quantidade); g.total += Number(i.total); g.pedidos.add(p.id)
    const it = g.itens.get(i.produto_id) ?? { id: i.produto_id, codigo: prod?.codigo ?? i.produto_codigo ?? '', nome: prod?.nome ?? i.produto_nome ?? '', unidade: prod?.unidade ?? i.unidade ?? '', quantidade: 0, total: 0 }
    it.quantidade += Number(i.quantidade); it.total += Number(i.total)
    g.itens.set(i.produto_id, it); m.set(cat, g)
  }
  const grupos = [...m.values()].sort((a, b) => b.total - a.total)
  const total = grupos.reduce((s, g) => s + g.total, 0)
  const pct = (v: number) => (total ? `${((v / total) * 100).toFixed(1).replace('.', ',')}%` : '0%')
  const itensOrdenados = (g: GrupoCat) => [...g.itens.values()].sort((a, b) => b.total - a.total)

  function gerar() {
    const linhas: LinhaRelatorio[] = []
    for (const g of grupos) {
      linhas.push({ grupo: [g.nome.toUpperCase(), '', num(g.quantidade), brl(g.total), pct(g.total)] })
      for (const i of itensOrdenados(g)) linhas.push([`   ${i.codigo} ${i.nome}`, i.unidade, num(i.quantidade), brl(i.total), pct(i.total)])
    }
    return pdfRelatorio({
      empresa, titulo: 'Vendas por categoria', subtitulo: periodo,
      cabecalho: ['Categoria / produto', 'Un', 'Qtd', 'Valor', '% venda'], linhas,
      direita: [2, 3, 4], larguras: { 1: 12, 2: 18, 3: 28, 4: 18 },
      totais: [['Categorias', String(grupos.length)], ['Vendas', String(pedidos.length)], ['Volumes', num(grupos.reduce((s, g) => s + g.quantidade, 0))], ['Valor vendido', brl(total)]],
      nota: 'Trocas não entram. Produtos sem categoria aparecem em "Sem categoria".',
    })
  }

  return (
    <div className="space-y-3">
      {m.has(SEM) && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          Há produtos sem categoria. Separe em grupos (Biscoito, Doce...) em <Link to="/config/categorias" className="font-bold underline">Mais &gt; Categorias de produtos</Link>.
        </p>
      )}
      {!grupos.length && <p className="cartao p-6 text-center text-sm text-stone-500">Sem vendas no período.</p>}
      {grupos.map((g) => (
        <section key={g.id} className="cartao p-0">
          <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setAberto(aberto === g.id ? null : g.id)}>
            <div className="min-w-0 flex-1">
              <p className="font-bold">{g.nome}</p>
              <p className="text-xs text-stone-500">{g.itens.size} produto(s) · {num(g.quantidade)} vol. · {g.pedidos.size} venda(s)</p>
              <span className="mt-1 block h-2 rounded-full bg-marca-500" style={{ width: total ? `${(g.total / total) * 100}%` : 0 }} />
            </div>
            <div className="text-right">
              <p className="font-bold">{brl(g.total)}</p>
              <p className="text-xs text-stone-500">{pct(g.total)}</p>
            </div>
          </button>
          {aberto === g.id && (
            <ul className="divide-y divide-stone-100 border-t border-stone-100">
              {itensOrdenados(g).map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate"><span className="text-stone-500">{i.codigo}</span> {i.nome}</p>
                    <p className="text-xs text-stone-500">{num(i.quantidade)} {i.unidade.toLowerCase()} · {pct(i.total)} da venda</p>
                  </div>
                  <b>{brl(i.total)}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {!!grupos.length && <BotoesPdf gerar={gerar} arquivo="vendas-por-categoria.pdf" />}
    </div>
  )
}

// ---------- Relatório de estoque (posição atual; filtro zerados / abaixo do mínimo) ----------
export function RelatorioEstoque({ inicial = 'todos' }: { inicial?: 'todos' | 'zerados' | 'baixo' }) {
  const empresa = useEmpresa()
  const [filtro, setFiltro] = useState(inicial)
  const r = useLiveQuery(async () => {
    const [produtos, estoque, pedidos, categorias] = await Promise.all([db.produtos.filter((p) => p.ativo).toArray(), db.estoque.toArray(), db.pedidos.toArray(), db.categorias.toArray()])
    const saldo = new Map(estoque.map((e) => [e.produto_id, Number(e.saldo)]))
    const cat = new Map(categorias.map((c) => [c.id, c.nome]))
    const ultima = new Map<string, string>()
    for (const p of pedidos) if (p.status !== 'orcamento' && p.status !== 'cancelado') for (const i of p.itens) {
      const u = ultima.get(i.produto_id); if (!u || p.data_pedido > u) ultima.set(i.produto_id, p.data_pedido)
    }
    return produtos.map((p) => ({ p, saldo: saldo.get(p.id) ?? 0, ultima: ultima.get(p.id), cat: p.categoria_id ? cat.get(p.categoria_id) : undefined }))
  }, [])
  if (!r) return null
  const lista = r.filter((x) => filtro === 'todos' || x.saldo <= 0 || (filtro === 'baixo' && x.p.estoque_minimo > 0 && x.saldo <= x.p.estoque_minimo))
    .sort((a, b) => filtro === 'todos' ? a.p.nome.localeCompare(b.p.nome) : a.saldo - b.saldo || a.p.nome.localeCompare(b.p.nome))
  const valorCusto = lista.reduce((s, x) => s + Math.max(0, x.saldo) * Number(x.p.preco_custo ?? 0), 0)
  const nomeFiltro = { todos: 'Relatório de estoque', zerados: 'Itens zerados', baixo: 'Itens zerados e abaixo do mínimo' }[filtro]

  function gerar() {
    return pdfRelatorio({
      empresa, titulo: nomeFiltro, subtitulo: `Posição de ${dataHora(new Date().toISOString())}`,
      cabecalho: ['Código', 'Produto', 'Categoria', 'Saldo', 'Mínimo', 'Custo', 'Valor', 'Última venda'],
      linhas: lista.map((x) => [x.p.codigo, x.p.nome, x.cat ?? '', num(x.saldo), num(x.p.estoque_minimo), x.p.preco_custo ? brl(x.p.preco_custo) : '', x.saldo > 0 && x.p.preco_custo ? brl(x.saldo * x.p.preco_custo) : '', x.ultima ? data(x.ultima) : '']),
      direita: [3, 4, 5, 6], larguras: { 0: 14, 3: 15, 4: 15, 5: 19, 6: 22, 7: 21 },
      totais: [['Produtos', String(lista.length)], ['Zerados', String(lista.filter((x) => x.saldo === 0).length)], ['Negativos', String(lista.filter((x) => x.saldo < 0).length)], ['Unidades', num(lista.reduce((s, x) => s + Math.max(0, x.saldo), 0))], ['Valor (custo)', brl(valorCusto)]],
      nota: 'Saldo negativo = vendido sem estoque lançado. Confira e dê entrada da mercadoria.',
    })
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 overflow-hidden rounded-xl ring-1 ring-stone-300">
        {([['todos', 'Todos'], ['zerados', 'Zerados'], ['baixo', 'Abaixo mín.']] as const).map(([k, n]) => (
          <button key={k} type="button" onClick={() => setFiltro(k)} className={'py-2 text-sm font-bold ' + (filtro === k ? 'bg-marca-700 text-white' : 'bg-white text-stone-600')}>{n}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="cartao"><p className="text-xs text-stone-500">Produtos</p><p className="text-xl font-extrabold">{lista.length}</p></div>
        <div className="cartao"><p className="text-xs text-stone-500">Valor em estoque (custo)</p><p className="text-xl font-extrabold text-marca-700">{brl(valorCusto)}</p></div>
      </div>
      <section className="cartao p-0">
        {!lista.length && <p className="p-6 text-center text-sm text-stone-500">Nenhum item aqui.</p>}
        <ul className="divide-y divide-stone-100">
          {lista.map((x) => (
            <li key={x.p.id}>
              <Link to={`/produtos/${x.p.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold"><span className="font-normal text-stone-500">{x.p.codigo}</span> {x.p.nome}</p>
                  <p className="text-xs text-stone-500">{x.cat ?? 'Sem categoria'}{x.ultima ? ` · última venda ${data(x.ultima)}` : ' · sem vendas'}</p>
                </div>
                <span className={'font-bold ' + (x.saldo < 0 ? 'text-red-700' : x.saldo === 0 ? 'text-amber-700' : 'text-stone-700')}>{num(x.saldo)} {x.p.unidade.toLowerCase()}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      {!!lista.length && <BotoesPdf gerar={gerar} arquivo={`${filtro === 'todos' ? 'estoque' : 'itens-zerados'}.pdf`} />}
    </div>
  )
}

// ---------- Relatório de movimentação de estoque (lê do servidor) ----------
interface Mov { id: string; produto_id: string; tipo: string; quantidade: number; motivo: string | null; criado_em: string; pedidos: { numero: number | null } | null; entradas: { numero: number } | null }
const TIPO_MOV: Record<string, string> = { entrada: 'Entrada', venda: 'Venda', estorno_venda: 'Estorno de venda', ajuste: 'Ajuste' }

export function MovEstoque({ ini, fim, periodo }: { ini: string; fim: string; periodo: string }) {
  const empresa = useEmpresa()
  const [modo, setModo] = useState<'resumo' | 'detalhe'>('resumo')
  const [movs, setMovs] = useState<Mov[] | null>(null)
  const [erro, setErro] = useState('')
  const produtos = useLiveQuery(async () => new Map((await db.produtos.toArray()).map((p) => [p.id, p])), []) ?? new Map<string, Produto>()
  const saldos = useLiveQuery(async () => new Map((await db.estoque.toArray()).map((e) => [e.produto_id, Number(e.saldo)])), []) ?? new Map<string, number>()

  useEffect(() => {
    let vivo = true
    setMovs(null); setErro('')
    const ate = new Date(fim + 'T00:00:00'); ate.setDate(ate.getDate() + 1)
    void (async () => {
      const todos: Mov[] = []
      for (let de = 0; ; de += 1000) {
        const { data: d, error } = await supabase.from('movimentos_estoque')
          .select('id, produto_id, tipo, quantidade, motivo, criado_em, pedidos(numero), entradas(numero)')
          .gte('criado_em', new Date(ini + 'T00:00:00').toISOString()).lt('criado_em', ate.toISOString())
          .order('criado_em').range(de, de + 999)
        if (error) { if (vivo) setErro(navigator.onLine ? error.message : 'Sem internet. Este relatório precisa de conexão.'); return }
        todos.push(...((d ?? []) as unknown as Mov[]))
        if (!d || d.length < 1000) break
      }
      if (vivo) setMovs(todos)
    })()
    return () => { vivo = false }
  }, [ini, fim])

  const resumo = new Map<string, { entrada: number; venda: number; ajuste: number }>()
  for (const m of movs ?? []) {
    const r = resumo.get(m.produto_id) ?? { entrada: 0, venda: 0, ajuste: 0 }
    const q = Number(m.quantidade)
    if (m.tipo === 'entrada') r.entrada += q
    else if (m.tipo === 'venda' || m.tipo === 'estorno_venda') r.venda += q
    else r.ajuste += q
    resumo.set(m.produto_id, r)
  }
  const linhasResumo = [...resumo.entries()].map(([id, r]) => ({ p: produtos.get(id), id, ...r, liquido: r.entrada + r.venda + r.ajuste }))
    .sort((a, b) => (a.p?.nome ?? '').localeCompare(b.p?.nome ?? ''))
  const tot = linhasResumo.reduce((s, x) => ({ e: s.e + x.entrada, v: s.v + x.venda, a: s.a + x.ajuste }), { e: 0, v: 0, a: 0 })
  const sinal = (v: number) => (v > 0 ? '+' : '') + num(v)
  const origem = (m: Mov) => m.tipo === 'entrada' ? `Entrada #${m.entradas?.numero ?? ''}` : m.pedidos ? `Pedido #${m.pedidos.numero ?? '-'}` : m.motivo ?? ''

  function gerar() {
    if (modo === 'resumo') return pdfRelatorio({
      empresa, titulo: 'Movimentação de estoque', subtitulo: `${periodo} · resumo por produto`,
      cabecalho: ['Código', 'Produto', 'Entradas', 'Vendas', 'Ajustes', 'Saldo do período', 'Saldo atual'],
      linhas: linhasResumo.map((x) => [x.p?.codigo ?? '', x.p?.nome ?? 'Produto', sinal(x.entrada), sinal(x.venda), sinal(x.ajuste), sinal(x.liquido), num(saldos.get(x.id) ?? 0)]),
      direita: [2, 3, 4, 5, 6], larguras: { 0: 14, 2: 18, 3: 18, 4: 18, 5: 24, 6: 20 },
      totais: [['Produtos', String(linhasResumo.length)], ['Entradas', sinal(tot.e)], ['Vendas', sinal(tot.v)], ['Ajustes', sinal(tot.a)]],
      nota: 'Vendas já descontam os estornos (pedido cancelado ou editado).',
    })
    return pdfRelatorio({
      empresa, titulo: 'Movimentação de estoque', subtitulo: `${periodo} · detalhado`,
      cabecalho: ['Data', 'Código', 'Produto', 'Tipo', 'Origem', 'Qtd'],
      linhas: (movs ?? []).map((m) => [dataHora(m.criado_em), produtos.get(m.produto_id)?.codigo ?? '', produtos.get(m.produto_id)?.nome ?? 'Produto', TIPO_MOV[m.tipo] ?? m.tipo, origem(m), sinal(Number(m.quantidade))]),
      direita: [5], larguras: { 0: 26, 1: 14, 3: 24, 5: 16 },
      totais: [['Movimentos', String(movs?.length ?? 0)], ['Entradas', sinal(tot.e)], ['Vendas', sinal(tot.v)], ['Ajustes', sinal(tot.a)]],
    })
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 overflow-hidden rounded-xl ring-1 ring-stone-300">
        {([['resumo', 'Resumo por produto'], ['detalhe', 'Detalhado']] as const).map(([k, n]) => (
          <button key={k} type="button" onClick={() => setModo(k)} className={'py-2 text-sm font-bold ' + (modo === k ? 'bg-marca-700 text-white' : 'bg-white text-stone-600')}>{n}</button>
        ))}
      </div>
      {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">{erro}</p>}
      {!movs && !erro && <p className="text-center text-sm text-stone-500">Carregando...</p>}
      {movs && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="cartao p-2"><p className="text-[11px] text-stone-500">Entradas</p><p className="font-bold text-emerald-700">{sinal(tot.e)}</p></div>
          <div className="cartao p-2"><p className="text-[11px] text-stone-500">Vendas</p><p className="font-bold text-red-700">{sinal(tot.v)}</p></div>
          <div className="cartao p-2"><p className="text-[11px] text-stone-500">Ajustes</p><p className="font-bold">{sinal(tot.a)}</p></div>
        </div>
      )}
      {movs && !movs.length && <p className="cartao p-6 text-center text-sm text-stone-500">Nenhuma movimentação no período.</p>}
      {movs && !!movs.length && (
        <section className="cartao p-0">
          <ul className="divide-y divide-stone-100">
            {modo === 'resumo' ? linhasResumo.map((x) => (
              <li key={x.id} className="px-4 py-2.5 text-sm">
                <p className="truncate font-semibold"><span className="font-normal text-stone-500">{x.p?.codigo}</span> {x.p?.nome ?? 'Produto'}</p>
                <p className="text-xs text-stone-500">Entradas {sinal(x.entrada)} · Vendas {sinal(x.venda)} · Ajustes {sinal(x.ajuste)} · <b className="text-stone-700">Período {sinal(x.liquido)}</b></p>
              </li>
            )) : movs.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate"><span className="text-stone-500">{produtos.get(m.produto_id)?.codigo}</span> {produtos.get(m.produto_id)?.nome ?? 'Produto'}</p>
                  <p className="text-xs text-stone-500">{dataHora(m.criado_em)} · {TIPO_MOV[m.tipo] ?? m.tipo} · {origem(m)}</p>
                </div>
                <b className={Number(m.quantidade) > 0 ? 'text-emerald-700' : 'text-red-700'}>{sinal(Number(m.quantidade))}</b>
              </li>
            ))}
          </ul>
        </section>
      )}
      {movs && !!movs.length && <BotoesPdf gerar={gerar} arquivo={`movimentacao-estoque-${modo}.pdf`} />}
    </div>
  )
}

// ---------- Sugestão de compra ----------
export function NecessidadeCompra() {
  const empresa = useEmpresa()
  const [base, setBase] = useState(30) // dias de venda analisados
  const [cobertura, setCobertura] = useState(15) // dias que a compra deve cobrir
  const [soComSugestao, setSoComSugestao] = useState(true)
  const r = useLiveQuery(async () => {
    const [produtos, estoque, pedidos] = await Promise.all([db.produtos.filter((p) => p.ativo).toArray(), db.estoque.toArray(), db.pedidos.toArray()])
    const saldo = new Map(estoque.map((e) => [e.produto_id, Number(e.saldo)]))
    const desde = new Date(Date.now() - base * 864e5).toISOString()
    // tudo que saiu do estoque no período (troca também consome mercadoria)
    const vendido = new Map<string, number>()
    for (const p of pedidos) {
      if (p.data_pedido < desde || p.status === 'orcamento' || p.status === 'cancelado') continue
      for (const i of p.itens) vendido.set(i.produto_id, (vendido.get(i.produto_id) ?? 0) + Number(i.quantidade))
    }
    return produtos.map((p: Produto) => {
      const v = vendido.get(p.id) ?? 0
      const media = v / base
      const s = saldo.get(p.id) ?? 0
      const necessario = media * cobertura + Number(p.estoque_minimo || 0)
      const sugestao = Math.max(0, Math.ceil(necessario - s))
      const dias = media > 0 ? Math.max(0, Math.floor(s / media)) : null
      return { p, vendido: v, media, saldo: s, sugestao, dias, custo: sugestao * Number(p.preco_custo ?? 0) }
    })
  }, [base, cobertura])
  if (!r) return null
  const lista = r.filter((x) => !soComSugestao || x.sugestao > 0).sort((a, b) => (a.dias ?? 1e9) - (b.dias ?? 1e9) || b.sugestao - a.sugestao)
  const custoTotal = lista.reduce((s, x) => s + x.custo, 0)

  function gerar() {
    return pdfRelatorio({
      empresa, titulo: 'Necessidade de compra', subtitulo: `Venda dos últimos ${base} dias · cobrir ${cobertura} dias`,
      cabecalho: ['Código', 'Produto', 'Vendido', 'Média/dia', 'Saldo', 'Dura (dias)', 'Comprar', 'Custo est.'],
      linhas: lista.map((x) => [x.p.codigo, x.p.nome, num(x.vendido), x.media.toFixed(1).replace('.', ','), num(x.saldo), x.dias === null ? '-' : String(x.dias), num(x.sugestao), x.custo ? brl(x.custo) : '']),
      direita: [2, 3, 4, 5, 6, 7], larguras: { 0: 14, 2: 16, 3: 16, 4: 15, 5: 16, 6: 17, 7: 22 },
      totais: [['Produtos', String(lista.filter((x) => x.sugestao > 0).length)], ['Unidades', num(lista.reduce((s, x) => s + x.sugestao, 0))], ['Custo estimado', brl(custoTotal)]],
      nota: `Comprar = média de venda por dia x ${cobertura} dias + estoque mínimo - saldo atual. Inclui trocas, porque também saem do estoque. Custo pelo último custo cadastrado.`,
    })
  }

  return (
    <div className="space-y-3">
      <section className="cartao space-y-2 text-sm">
        <p className="font-semibold">Olhar a venda dos últimos (dias)</p>
        <Opcoes valor={base} opcoes={[15, 30, 60, 90]} on={setBase} />
        <p className="font-semibold">Comprar para quantos dias</p>
        <Opcoes valor={cobertura} opcoes={[7, 15, 30, 45]} on={setCobertura} />
        <label className="flex items-center gap-2"><input type="checkbox" checked={soComSugestao} onChange={(e) => setSoComSugestao(e.target.checked)} /> Mostrar só o que precisa comprar</label>
      </section>
      <div className="grid grid-cols-2 gap-2">
        <div className="cartao"><p className="text-xs text-stone-500">Produtos a comprar</p><p className="text-xl font-extrabold">{lista.filter((x) => x.sugestao > 0).length}</p></div>
        <div className="cartao"><p className="text-xs text-stone-500">Custo estimado</p><p className="text-xl font-extrabold text-marca-700">{brl(custoTotal)}</p></div>
      </div>
      <section className="cartao p-0">
        {!lista.length && <p className="p-6 text-center text-sm text-stone-500">Nada para comprar com esses filtros.</p>}
        <ul className="divide-y divide-stone-100">
          {lista.map((x) => (
            <li key={x.p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold"><span className="font-normal text-stone-500">{x.p.codigo}</span> {x.p.nome}</p>
                <p className="text-xs text-stone-500">
                  Vendeu {num(x.vendido)} · saldo {num(x.saldo)} · {x.dias === null ? 'sem venda' : `dura ${x.dias} dia(s)`}
                </p>
              </div>
              <div className="text-right">
                <p className="font-extrabold text-marca-700">{num(x.sugestao)} <span className="text-xs font-normal lowercase text-stone-500">{x.p.unidade}</span></p>
                {x.custo > 0 && <p className="text-xs text-stone-500">{brl(x.custo)}</p>}
              </div>
            </li>
          ))}
        </ul>
      </section>
      {!!lista.length && <BotoesPdf gerar={gerar} arquivo="necessidade-de-compra.pdf" />}
      <p className="text-center text-xs text-stone-400">Comprar = média por dia x dias escolhidos + estoque mínimo - saldo.</p>
    </div>
  )
}

function Opcoes({ valor, opcoes, on }: { valor: number; opcoes: number[]; on: (n: number) => void }) {
  return (
    <div className="flex overflow-hidden rounded-xl ring-1 ring-stone-300">
      {opcoes.map((o) => (
        <button key={o} type="button" onClick={() => on(o)} className={'flex-1 py-1.5 text-sm font-bold ' + (valor === o ? 'bg-marca-700 text-white' : 'bg-white text-stone-600')}>{o}</button>
      ))}
    </div>
  )
}
