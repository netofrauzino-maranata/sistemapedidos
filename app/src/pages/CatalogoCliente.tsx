import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { brl, normalizar, num } from '../lib/formato'
import { supabase } from '../lib/supabase'

// Catálogo online do cliente (página pública, sem login).
// O link é único de cada cliente: já mostra o preço da tabela dele.
// O cliente escolhe as quantidades e envia; chega para a Maranata aprovar.

interface ProdutoCat { id: string; codigo: string; nome: string; unidade: string; qtd_embalagem: number; marca: string | null; foto_url: string | null; categoria: string | null; preco: number }
interface DadosCat { cliente: string; empresa: { nome: string; telefone: string | null; whatsapp: string | null } | null; produtos: ProdutoCat[] }

const OUTROS = 'Outros'

export default function CatalogoCliente() {
  const { token = '' } = useParams()
  const chave = `maranata-carrinho-${token}`
  const [dados, setDados] = useState<DadosCat | null>(null)
  const [erro, setErro] = useState('')
  const [carrinho, setCarrinho] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(chave) ?? '{}') } catch { return {} }
  })
  const [cat, setCat] = useState('')
  const [q, setQ] = useState('')
  const [revisando, setRevisando] = useState(false)
  const [contato, setContato] = useState('')
  const [obs, setObs] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState<{ numero: number; itens: number; total: number } | null>(null)

  useEffect(() => {
    document.title = 'Catálogo Maranata'
    void supabase.rpc('catalogo_publico', { p_token: token }).then(({ data, error }) => {
      if (error) return setErro('Não foi possível abrir o catálogo. Confira sua internet e tente de novo.')
      if (!data) return setErro('Este link não é válido ou foi desativado. Peça um novo link à Maranata.')
      setDados(data as DadosCat)
    })
  }, [token])

  useEffect(() => {
    try { localStorage.setItem(chave, JSON.stringify(carrinho)) } catch { /* sem armazenamento */ }
  }, [carrinho, chave])

  const categorias = useMemo(() => {
    const s = new Set<string>()
    dados?.produtos.forEach((p) => s.add(p.categoria ?? OUTROS))
    return [...s].sort((a, b) => (a === OUTROS ? 1 : b === OUTROS ? -1 : a.localeCompare(b)))
  }, [dados])

  if (erro) return <Tela><p className="cartao text-center text-stone-700">{erro}</p></Tela>
  if (!dados) return <Tela><p className="text-center text-marca-700">Carregando catálogo...</p></Tela>

  const porId = new Map(dados.produtos.map((p) => [p.id, p]))
  const itens = Object.entries(carrinho).filter(([id, q]) => q > 0 && porId.has(id)).map(([id, q]) => ({ p: porId.get(id)!, q }))
  const total = itens.reduce((s, i) => s + i.q * i.p.preco, 0)
  const unidades = itens.reduce((s, i) => s + i.q, 0)
  const definir = (id: string, v: number) => setCarrinho((c) => ({ ...c, [id]: Math.max(0, Math.min(99999, Math.round(v))) }))

  const t = normalizar(q)
  const visiveis = dados.produtos.filter((p) => (!cat || (p.categoria ?? OUTROS) === cat) && (!t || normalizar(`${p.codigo} ${p.nome} ${p.marca ?? ''}`).includes(t)))
  const grupos = categorias.map((c) => ({ c, ps: visiveis.filter((p) => (p.categoria ?? OUTROS) === c) })).filter((g) => g.ps.length)

  async function enviar() {
    setEnviando(true); setErro('')
    const { data, error } = await supabase.rpc('enviar_pedido_catalogo', {
      p_token: token, p_itens: itens.map((i) => ({ produto_id: i.p.id, quantidade: i.q })), p_contato: contato, p_observacao: obs,
    })
    setEnviando(false)
    if (error) return alert(error.message || 'Não foi possível enviar. Tente de novo.')
    setEnviado(data as { numero: number; itens: number; total: number })
    setCarrinho({}); setRevisando(false)
  }

  if (enviado) {
    const zap = (dados.empresa?.whatsapp || dados.empresa?.telefone || '').replace(/\D/g, '')
    return (
      <Tela nome={dados.cliente}>
        <section className="cartao space-y-3 text-center">
          <img src="/mascote.png" alt="" className="mx-auto h-28" />
          <h1 className="text-xl font-extrabold text-marca-700">Pedido enviado!</h1>
          <p className="text-stone-700">Recebemos sua solicitação nº <b>{enviado.numero}</b> com {enviado.itens} produto(s), total estimado de <b>{brl(enviado.total)}</b>.</p>
          <p className="text-sm text-stone-500">A {dados.empresa?.nome ?? 'Maranata'} vai conferir e confirmar o seu pedido.</p>
          {zap && <a className="btn-secundario w-full" href={`https://wa.me/55${zap.replace(/^55/, '')}?text=${encodeURIComponent(`Olá! Acabei de enviar o pedido nº ${enviado.numero} pelo catálogo.`)}`} target="_blank" rel="noreferrer">Avisar no WhatsApp</a>}
          <button className="btn-primario w-full" onClick={() => setEnviado(null)}>Fazer outro pedido</button>
        </section>
      </Tela>
    )
  }

  return (
    <div className="min-h-full bg-fundo pb-28">
      <header className="bg-marca-700 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] text-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <img src="/logo.png" alt="Maranata" className="h-12" />
          <div className="min-w-0">
            <p className="text-xs text-marca-100">Catálogo de</p>
            <p className="truncate font-bold">{dados.cliente}</p>
          </div>
        </div>
      </header>
      <div className="h-1 bg-destaque" />
      <div className="sticky top-0 z-10 space-y-2 bg-fundo px-4 py-2 shadow-sm">
        <div className="mx-auto max-w-3xl space-y-2">
          <input className="campo" placeholder="Buscar produto" value={q} onChange={(e) => setQ(e.target.value)} />
          {categorias.length > 1 && (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {['', ...categorias].map((c) => (
                <button key={c || 'todos'} onClick={() => setCat(c)}
                  className={'etiqueta shrink-0 px-3 py-1.5 text-sm ' + (cat === c ? 'bg-marca-700 text-white' : 'bg-white text-stone-600 ring-1 ring-stone-200')}>{c || 'Todos'}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      <main className="mx-auto max-w-3xl space-y-5 px-4 pt-3">
        {!grupos.length && <p className="cartao text-center text-sm text-stone-500">Nenhum produto encontrado.</p>}
        {grupos.map((g) => (
          <section key={g.c}>
            {categorias.length > 1 && <h2 className="mb-2 flex items-center gap-2 font-extrabold uppercase tracking-wide text-marca-800"><span className="h-5 w-1.5 rounded bg-destaque" />{g.c}</h2>}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {g.ps.map((p) => {
                const qtd = carrinho[p.id] ?? 0
                return (
                  <article key={p.id} className={'flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ' + (qtd ? 'ring-2 ring-marca-500' : 'ring-stone-200')}>
                    <div className="flex aspect-square items-center justify-center bg-white">
                      {p.foto_url ? <img src={p.foto_url} alt={p.nome} loading="lazy" className="h-full w-full object-contain" />
                        : <img src="/logo.png" alt="" className="w-2/3 opacity-20" />}
                    </div>
                    <div className="flex flex-1 flex-col gap-1 p-2.5">
                      <p className="line-clamp-2 text-sm font-semibold leading-tight">{p.nome}</p>
                      <p className="text-[11px] text-stone-500">Cód. {p.codigo} · {p.unidade}{p.qtd_embalagem > 1 ? ` c/ ${num(p.qtd_embalagem)}` : ''}</p>
                      <p className="mt-auto text-lg font-extrabold text-marca-700">{brl(p.preco)}</p>
                      {qtd === 0 ? (
                        <button className="btn-primario w-full py-2" onClick={() => definir(p.id, 1)}>Adicionar</button>
                      ) : (
                        <div className="flex items-center overflow-hidden rounded-xl ring-1 ring-marca-500">
                          <button className="w-10 py-2 text-lg font-bold text-marca-700" onClick={() => definir(p.id, qtd - 1)} aria-label="Menos">−</button>
                          <input className="w-full min-w-0 py-2 text-center font-bold outline-none" inputMode="numeric" value={qtd}
                            onChange={(e) => definir(p.id, Number(e.target.value.replace(/\D/g, '')) || 0)} />
                          <button className="w-10 py-2 text-lg font-bold text-marca-700" onClick={() => definir(p.id, qtd + 1)} aria-label="Mais">+</button>
                        </div>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        ))}
        <p className="pb-4 text-center text-xs text-stone-400">Preços sujeitos a confirmação. {dados.empresa?.nome}</p>
      </main>

      {itens.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 bg-white/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-stone-500">{itens.length} produto(s) · {num(unidades)} un.</p>
              <p className="text-lg font-extrabold text-marca-700">{brl(total)}</p>
            </div>
            <button className="btn bg-destaque px-5 text-stone-900" onClick={() => setRevisando(true)}>Revisar pedido</button>
          </div>
        </div>
      )}

      {revisando && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setRevisando(false)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-bold">Seu pedido</h2>
              <button className="rounded-full px-3 py-1 text-sm font-semibold text-marca-700" onClick={() => setRevisando(false)}>Continuar escolhendo</button>
            </div>
            <ul className="divide-y divide-stone-100">
              {itens.map(({ p, q }) => (
                <li key={p.id} className="flex items-center gap-2 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{p.nome}</p>
                    <p className="text-xs text-stone-500">{brl(p.preco)} / {p.unidade.toLowerCase()}</p>
                  </div>
                  <div className="flex items-center rounded-xl ring-1 ring-stone-300">
                    <button className="w-8 py-1 font-bold" onClick={() => definir(p.id, q - 1)}>−</button>
                    <span className="w-10 text-center font-bold">{q}</span>
                    <button className="w-8 py-1 font-bold" onClick={() => definir(p.id, q + 1)}>+</button>
                  </div>
                  <b className="w-20 text-right">{brl(q * p.preco)}</b>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between border-t border-stone-200 pt-2 text-lg font-extrabold"><span>Total estimado</span><span className="text-marca-700">{brl(total)}</span></div>
            <div className="mt-3 space-y-2">
              <input className="campo" placeholder="Seu nome (opcional)" value={contato} onChange={(e) => setContato(e.target.value)} />
              <textarea className="campo" rows={2} placeholder="Observação (opcional): melhor dia de entrega, etc." value={obs} onChange={(e) => setObs(e.target.value)} />
              <button className="btn-primario w-full" disabled={enviando || !itens.length} onClick={() => void enviar()}>{enviando ? 'Enviando...' : 'Enviar pedido'}</button>
              <p className="text-center text-xs text-stone-500">A Maranata confere e confirma antes de separar.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Tela({ children, nome }: { children: ReactNode; nome?: string }) {
  return (
    <div className="min-h-full bg-fundo">
      <header className="bg-marca-700 px-4 py-3 text-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3"><img src="/logo.png" alt="Maranata" className="h-12" />{nome && <p className="font-bold">{nome}</p>}</div>
      </header>
      <div className="h-1 bg-destaque" />
      <main className="mx-auto max-w-lg p-4">{children}</main>
    </div>
  )
}
