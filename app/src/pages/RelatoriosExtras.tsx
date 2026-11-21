import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icone } from '../components/ui'
import { db } from '../lib/db'
import { brl, data, num } from '../lib/formato'
import { useEmpresa } from '../lib/hooks'
import { abrirPdf, compartilharPdf, pdfRelatorio, type LinhaRelatorio } from '../lib/pdf'
import type { Pedido, Produto } from '../lib/tipos'

// Relatórios: vendas por categoria, itens zerados e sugestão de compra.
// Tudo calculado com os dados do aparelho; cada um gera PDF.

const SEM = '__sem__'

function BotoesPdf({ gerar, arquivo }: { gerar: () => ReturnType<typeof pdfRelatorio>; arquivo: string }) {
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

// ---------- Itens zerados ----------
export function ItensZerados() {
  const empresa = useEmpresa()
  const [incluirBaixo, setIncluirBaixo] = useState(false)
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
  const lista = r.filter((x) => x.saldo <= 0 || (incluirBaixo && x.p.estoque_minimo > 0 && x.saldo <= x.p.estoque_minimo))
    .sort((a, b) => a.saldo - b.saldo || a.p.nome.localeCompare(b.p.nome))
  const negativos = lista.filter((x) => x.saldo < 0).length

  function gerar() {
    return pdfRelatorio({
      empresa, titulo: incluirBaixo ? 'Itens zerados e baixos' : 'Itens zerados', subtitulo: `Posição de ${data(new Date().toISOString())}`,
      cabecalho: ['Código', 'Produto', 'Categoria', 'Saldo', 'Mínimo', 'Última venda'],
      linhas: lista.map((x) => [x.p.codigo, x.p.nome, x.cat ?? '', num(x.saldo), num(x.p.estoque_minimo), x.ultima ? data(x.ultima) : '']),
      direita: [3, 4], larguras: { 0: 16, 3: 16, 4: 16, 5: 24 },
      totais: [['Zerados', String(lista.filter((x) => x.saldo === 0).length)], ['Negativos', String(negativos)], ['Total na lista', String(lista.length)]],
      nota: 'Saldo negativo = vendido sem estoque lançado. Confira e dê entrada da mercadoria.',
    })
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={incluirBaixo} onChange={(e) => setIncluirBaixo(e.target.checked)} /> Incluir os que estão abaixo do estoque mínimo</label>
      <section className="cartao p-0">
        {!lista.length && <p className="p-6 text-center text-sm text-stone-500">Nenhum item zerado.</p>}
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
      {!!lista.length && <BotoesPdf gerar={gerar} arquivo="itens-zerados.pdf" />}
    </div>
  )
}

// ---------- Sugestão de compra ----------
export function SugestaoCompra() {
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
      empresa, titulo: 'Sugestão de compra', subtitulo: `Venda dos últimos ${base} dias · cobrir ${cobertura} dias`,
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
      {!!lista.length && <BotoesPdf gerar={gerar} arquivo="sugestao-de-compra.pdf" />}
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
