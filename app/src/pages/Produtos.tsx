import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BotaoFlutuante, Busca, Cabecalho, Vazio } from '../components/ui'
import { IndicadorSync } from '../components/Layout'
import { useAuth } from '../lib/auth'
import { db } from '../lib/db'
import { brl, data, filtrarProdutos, num } from '../lib/formato'
import { useCategorias, useEstoqueMapa } from '../lib/hooks'
import { fotoDoProduto } from '../lib/fotos'

export default function Produtos() {
  const { gestor } = useAuth()
  const [busca, setBusca] = useState('')
  const [cat, setCat] = useState('')
  const categorias = useCategorias()
  const estoque = useEstoqueMapa()
  const lista = useLiveQuery(async () => {
    const todos = (await db.produtos.toArray())
      .filter((p) => p.ativo || gestor)
      .filter((p) => !cat || p.categoria_id === cat)
      .sort((a, b) => a.nome.localeCompare(b.nome))
    return filtrarProdutos(todos, busca)
  }, [busca, cat, gestor]) ?? []

  return (
    <>
      <Cabecalho titulo="Produtos" acao={<IndicadorSync />} />
      <div className="space-y-2 p-4 pb-2">
        <Busca valor={busca} onChange={setBusca} placeholder="Código (ex.: 002) ou nome do produto" />
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <button onClick={() => setCat('')} className={'etiqueta shrink-0 px-3 py-1.5 text-sm ' + (!cat ? 'bg-marca-700 text-white' : 'bg-white text-stone-600 ring-1 ring-stone-200')}>Todas</button>
          {categorias.map((c) => (
            <button key={c.id} onClick={() => setCat(c.id)} className={'etiqueta shrink-0 px-3 py-1.5 text-sm ' + (cat === c.id ? 'bg-marca-700 text-white' : 'bg-white text-stone-600 ring-1 ring-stone-200')}>{c.nome}</button>
          ))}
        </div>
        <p className="text-xs text-stone-500">{lista.length} produto(s)</p>
      </div>
      <main className="space-y-2 px-4">
        {!lista.length && <Vazio texto="Nenhum produto encontrado." />}
        {lista.map((p) => {
          const e = estoque.get(p.id)
          const saldo = e?.saldo ?? 0
          return (
            <Link key={p.id} to={`/produtos/${p.id}`} className={'cartao flex items-center gap-3 p-3 ' + (p.ativo ? '' : 'opacity-50')}>
              {fotoDoProduto(p) ? <img src={fotoDoProduto(p)!} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                : <div className="h-12 w-12 shrink-0 rounded-lg bg-marca-50" />}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{p.nome}</p>
                <p className="truncate text-xs text-stone-500">{p.codigo} · {p.unidade}{p.qtd_embalagem > 1 ? ` c/ ${num(p.qtd_embalagem)}` : ''}{e?.proxima_validade ? ` · vence ${data(e.proxima_validade)}` : ''}</p>
              </div>
              <div className="text-right">
                <p className="font-bold text-marca-700">{brl(p.preco_venda)}</p>
                <p className={'text-xs ' + (saldo <= 0 ? 'font-semibold text-red-600' : saldo <= p.estoque_minimo ? 'font-semibold text-amber-700' : 'text-stone-500')}>Est. {num(saldo)}</p>
              </div>
            </Link>
          )
        })}
      </main>
      {gestor && <BotaoFlutuante para="/produtos/novo" rotulo="Novo produto" />}
    </>
  )
}
