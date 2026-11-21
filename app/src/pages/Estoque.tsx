import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useOnline } from '../components/Layout'
import { Aviso, Busca, Cabecalho, Campo, Folha, Icone, Vazio } from '../components/ui'
import { db } from '../lib/db'
import { brl, data, normalizar, num } from '../lib/formato'
import { supabase } from '../lib/supabase'
import { sincronizar } from '../lib/sync'
import type { Produto } from '../lib/tipos'

type Filtro = 'todos' | 'baixo' | 'vencendo' | 'negativo'

export default function Estoque() {
  const [params, setParams] = useSearchParams()
  const filtro = (params.get('filtro') ?? 'todos') as Filtro
  const [busca, setBusca] = useState('')
  const [ajustando, setAjustando] = useState<Produto | null>(null)

  const dados = useLiveQuery(async () => {
    const produtos = (await db.produtos.filter((p) => p.ativo).toArray()).sort((a, b) => a.nome.localeCompare(b.nome))
    const est = new Map((await db.estoque.toArray()).map((e) => [e.produto_id, e]))
    const lotes = await db.estoqueLotes.toArray()
    const vencendo = new Set(lotes.filter((l) => l.saldo > 0 && l.dias_para_vencer !== null && l.dias_para_vencer <= 30).map((l) => l.produto_id))
    const valor = produtos.reduce((s, p) => s + Math.max(0, est.get(p.id)?.saldo ?? 0) * (p.preco_custo ?? 0), 0)
    return { produtos, est, lotes, vencendo, valor }
  }, [])

  if (!dados) return null
  const t = normalizar(busca)
  const lista = dados.produtos.filter((p) => {
    const s = dados.est.get(p.id)?.saldo ?? 0
    if (filtro === 'baixo' && s > p.estoque_minimo) return false
    if (filtro === 'negativo' && s >= 0) return false
    if (filtro === 'vencendo' && !dados.vencendo.has(p.id)) return false
    return !t || normalizar(`${p.codigo} ${p.nome} ${p.marca}`).includes(t)
  })

  return (
    <>
      <Cabecalho titulo="Estoque" voltar="/mais" acao={<div className="flex items-center gap-1"><Link to="/estoque/entradas" className="rounded-full p-2 hover:bg-white/10" aria-label="Histórico de entradas"><Icone nome="livro" /></Link><Link to="/estoque/entrada" className="btn bg-destaque px-3 py-1.5 text-sm text-stone-900"><Icone nome="entrada" className="h-4 w-4" /> Entrada</Link></div>} />
      <div className="space-y-2 p-4 pb-2">
        <div className="cartao flex justify-between p-3 text-sm">
          <span>Valor em estoque (custo)</span><b className="text-marca-700">{brl(dados.valor)}</b>
        </div>
        <Busca valor={busca} onChange={setBusca} placeholder="Buscar produto" />
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
          {([['todos', 'Todos'], ['baixo', 'Estoque baixo'], ['vencendo', 'Vencendo 30 dias'], ['negativo', 'Negativo']] as [Filtro, string][]).map(([f, n]) => (
            <button key={f} onClick={() => setParams(f === 'todos' ? {} : { filtro: f })}
              className={'etiqueta shrink-0 px-3 py-1.5 text-sm ' + (filtro === f ? 'bg-marca-700 text-white' : 'bg-white text-stone-600 ring-1 ring-stone-200')}>{n}</button>
          ))}
        </div>
      </div>
      <main className="space-y-2 px-4">
        {!lista.length && <Vazio texto="Nada por aqui." />}
        {lista.map((p) => {
          const s = dados.est.get(p.id)?.saldo ?? 0
          const lotes = dados.lotes.filter((l) => l.produto_id === p.id && l.saldo !== 0)
            .sort((a, b) => (a.data_validade ?? '9').localeCompare(b.data_validade ?? '9'))
          return (
            <div key={p.id} className="cartao p-3">
              <div className="flex items-center gap-2">
                <Link to={`/produtos/${p.id}`} className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.nome}</p>
                  <p className="text-xs text-stone-500">{p.codigo} · mínimo {num(p.estoque_minimo)}</p>
                </Link>
                <p className={'text-lg font-extrabold ' + (s < 0 ? 'text-red-600' : s <= p.estoque_minimo ? 'text-amber-600' : 'text-marca-700')}>{num(s)} <span className="text-xs font-medium">{p.unidade}</span></p>
                <button className="rounded-full p-2 text-stone-500 hover:bg-stone-100" onClick={() => setAjustando(p)} aria-label="Ajustar"><Icone nome="editar" className="h-4 w-4" /></button>
              </div>
              {lotes.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {lotes.map((l) => (
                    <span key={l.lote_id} className={'etiqueta ' + (l.dias_para_vencer !== null && l.dias_para_vencer <= 0 ? 'bg-red-100 text-red-700'
                      : l.dias_para_vencer !== null && l.dias_para_vencer <= 30 ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-stone-600')}>
                      {l.numero}: {num(l.saldo)}{l.data_validade ? ` · ${data(l.data_validade)}` : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </main>
      {ajustando && <Ajuste produto={ajustando} onFechar={() => setAjustando(null)} />}
    </>
  )
}

function Ajuste({ produto, onFechar }: { produto: Produto; onFechar: () => void }) {
  const online = useOnline()
  const lotes = useLiveQuery(() => db.lotes.where('produto_id').equals(produto.id).toArray(), [produto.id]) ?? []
  const [lote, setLote] = useState('')
  const [tipo, setTipo] = useState<'tirar' | 'somar'>('tirar')
  const [qtd, setQtd] = useState('')
  const [motivo, setMotivo] = useState('Perda / avaria')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function salvar() {
    const q = Number(qtd.replace(',', '.'))
    if (!q || q <= 0) return setErro('Informe a quantidade.')
    setEnviando(true); setErro('')
    const { error } = await supabase.rpc('ajustar_estoque', {
      p_produto: produto.id, p_lote: lote || null, p_quantidade: tipo === 'tirar' ? -q : q, p_motivo: motivo,
    })
    setEnviando(false)
    if (error) return setErro(error.message)
    await sincronizar()
    onFechar()
  }

  return (
    <Folha aberta onFechar={onFechar} titulo={`Ajustar ${produto.nome}`}>
      <div className="space-y-3">
        {!online && <Aviso tipo="alerta">Ajuste precisa de internet.</Aviso>}
        <div className="grid grid-cols-2 gap-2">
          <button className={'btn ' + (tipo === 'tirar' ? 'bg-red-600 text-white' : 'bg-stone-100')} onClick={() => setTipo('tirar')}>Tirar</button>
          <button className={'btn ' + (tipo === 'somar' ? 'bg-marca-700 text-white' : 'bg-stone-100')} onClick={() => setTipo('somar')}>Somar</button>
        </div>
        <Campo rotulo="Lote">
          <select className="campo" value={lote} onChange={(e) => setLote(e.target.value)}>
            <option value="">Sem lote</option>
            {lotes.map((l) => <option key={l.id} value={l.id}>{l.numero}{l.data_validade ? ` · ${data(l.data_validade)}` : ''}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Quantidade"><input className="campo" inputMode="decimal" value={qtd} onChange={(e) => setQtd(e.target.value)} /></Campo>
        <Campo rotulo="Motivo">
          <select className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
            {['Perda / avaria', 'Vencido', 'Inventário (contagem)', 'Consumo interno', 'Bonificação a cliente', 'Correção de lançamento'].map((m) => <option key={m}>{m}</option>)}
          </select>
        </Campo>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <button className="btn-primario w-full" disabled={enviando || !online} onClick={() => void salvar()}>Confirmar ajuste</button>
      </div>
    </Folha>
  )
}
