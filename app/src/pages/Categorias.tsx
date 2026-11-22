import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Aviso, Busca, Cabecalho, Icone } from '../components/ui'
import { db } from '../lib/db'
import { normalizar } from '../lib/formato'
import { supabase } from '../lib/supabase'
import type { Categoria, Produto } from '../lib/tipos'

// Categorias (grupos) de produto, só gestor: criar grupos (Biscoito, Doce...)
// e separar os produtos neles de uma vez. Precisa de internet.

export default function Categorias() {
  const [nova, setNova] = useState('')
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<string>('sem')
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [destino, setDestino] = useState('')
  const [msg, setMsg] = useState<{ tipo: 'erro' | 'ok'; texto: string } | null>(null)
  const [salvando, setSalvando] = useState(false)

  const categorias = useLiveQuery(async () => (await db.categorias.toArray()).filter((c) => c.ativo).sort((a, b) => a.nome.localeCompare(b.nome)), []) ?? []
  const produtos = useLiveQuery(() => db.produtos.filter((p) => p.ativo).toArray(), []) ?? []
  const contagem = new Map<string, number>()
  produtos.forEach((p) => contagem.set(p.categoria_id ?? 'sem', (contagem.get(p.categoria_id ?? 'sem') ?? 0) + 1))

  const t = normalizar(q)
  const lista = produtos
    .filter((p) => filtro === 'todos' || (filtro === 'sem' ? !p.categoria_id : p.categoria_id === filtro))
    .filter((p) => !t || t.split(' ').every((x) => normalizar(`${p.codigo} ${p.nome} ${p.marca ?? ''}`).includes(x)))
    .sort((a, b) => a.nome.localeCompare(b.nome))
  const nomeCat = new Map(categorias.map((c) => [c.id, c.nome]))

  async function criar() {
    setMsg(null)
    if (!nova.trim()) return
    const { data, error } = await supabase.from('categorias').insert({ nome: nova.trim() }).select().single()
    if (error) return setMsg({ tipo: 'erro', texto: error.message })
    await db.categorias.put(data as Categoria)
    setDestino((data as Categoria).id); setNova('')
  }

  async function renomear(c: Categoria) {
    const nome = prompt('Nome da categoria', c.nome)?.trim()
    if (!nome || nome === c.nome) return
    const { data, error } = await supabase.from('categorias').update({ nome }).eq('id', c.id).select().single()
    if (error) return setMsg({ tipo: 'erro', texto: error.message })
    await db.categorias.put(data as Categoria)
  }

  async function mover() {
    setMsg(null)
    if (!marcados.size) return setMsg({ tipo: 'erro', texto: 'Marque os produtos.' })
    if (!destino) return setMsg({ tipo: 'erro', texto: 'Escolha a categoria.' })
    setSalvando(true)
    const ids = [...marcados]
    const { data, error } = await supabase.from('produtos').update({ categoria_id: destino === 'sem' ? null : destino }).in('id', ids).select()
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: error.message })
    await db.produtos.bulkPut(data as Produto[])
    setMsg({ tipo: 'ok', texto: `${ids.length} produto(s) em ${destino === 'sem' ? 'Sem categoria' : nomeCat.get(destino)}.` })
    setMarcados(new Set())
  }

  const todosMarcados = lista.length > 0 && lista.every((p) => marcados.has(p.id))
  const alternar = (id: string) => setMarcados((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <>
      <Cabecalho titulo="Categorias de produtos" voltar="/mais" />
      <main className="space-y-3 p-4 pb-40">
        <p className="text-sm text-stone-600">Crie os grupos (ex.: Biscoito, Doce, Salgadinho) e separe os produtos. É isso que monta o relatório de vendas por categoria.</p>
        <div className="cartao flex gap-2">
          <input className="campo" placeholder="Nova categoria" value={nova} onChange={(e) => setNova(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void criar()} />
          <button className="btn-primario shrink-0" onClick={() => void criar()}><Icone nome="mais" /> Criar</button>
        </div>

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {[['sem', 'Sem categoria'], ['todos', 'Todos'], ...categorias.map((c) => [c.id, c.nome])].map(([id, nome]) => (
            <button key={id} onClick={() => { setFiltro(id); setMarcados(new Set()) }}
              className={'etiqueta shrink-0 px-3 py-1.5 text-sm ' + (filtro === id ? 'bg-marca-700 text-white' : 'bg-white text-stone-600 ring-1 ring-stone-200')}>
              {nome} ({id === 'todos' ? produtos.length : contagem.get(id) ?? 0})
            </button>
          ))}
        </div>
        {filtro !== 'sem' && filtro !== 'todos' && (
          <button className="text-sm font-semibold text-marca-700" onClick={() => { const c = categorias.find((x) => x.id === filtro); if (c) void renomear(c) }}>
            <Icone nome="editar" className="mr-1 inline h-4 w-4" />Renomear esta categoria
          </button>
        )}

        <Busca valor={q} onChange={setQ} placeholder="Buscar produto (ex.: biscoito)" />
        <div className="flex items-center justify-between text-sm">
          <span className="text-stone-500">{lista.length} produto(s) · {marcados.size} marcado(s)</span>
          <button className="font-semibold text-marca-700" onClick={() => setMarcados(todosMarcados ? new Set() : new Set(lista.map((p) => p.id)))}>
            {todosMarcados ? 'Desmarcar todos' : 'Marcar todos'}
          </button>
        </div>
        <ul className="cartao divide-y divide-stone-100 p-0">
          {lista.map((p) => (
            <li key={p.id}>
              <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5">
                <input type="checkbox" className="h-5 w-5 accent-marca-700" checked={marcados.has(p.id)} onChange={() => alternar(p.id)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold"><span className="font-normal text-stone-500">{p.codigo}</span> {p.nome}</p>
                  <p className="text-xs text-stone-500">{p.categoria_id ? nomeCat.get(p.categoria_id) ?? 'Sem categoria' : 'Sem categoria'}</p>
                </div>
              </label>
            </li>
          ))}
          {!lista.length && <li className="p-6 text-center text-sm text-stone-500">Nenhum produto aqui.</li>}
        </ul>
      </main>

      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 mx-auto max-w-lg px-4">
        <div className="cartao space-y-2 shadow-lg">
          {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
          <div className="flex gap-2">
            <select className="campo" value={destino} onChange={(e) => setDestino(e.target.value)}>
              <option value="">Mover para...</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              <option value="sem">Sem categoria</option>
            </select>
            <button className="btn-primario shrink-0" disabled={salvando || !marcados.size} onClick={() => void mover()}>
              {salvando ? 'Salvando...' : `Mover (${marcados.size})`}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
