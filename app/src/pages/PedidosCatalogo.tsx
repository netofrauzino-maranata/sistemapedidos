import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Aviso, Cabecalho, Icone, Vazio } from '../components/ui'
import { brl, dataHora, num } from '../lib/formato'
import { nomeCliente, useClientesMapa, useProdutosMapa } from '../lib/hooks'
import { rascunhoDoCatalogo, type PedidoCatalogo } from '../lib/repetir'
import { supabase } from '../lib/supabase'

// Pedidos que os clientes enviaram pelo catálogo online. O gestor (ou o
// vendedor do cliente) confere e transforma em pedido de venda, ou recusa.
// Lê direto do servidor (precisa de internet).

const ABAS = [['nova', 'Novos'], ['aprovada', 'Aprovados'], ['recusada', 'Recusados']] as const

export default function PedidosCatalogo() {
  const nav = useNavigate()
  const [aba, setAba] = useState<PedidoCatalogo['status']>('nova')
  const [lista, setLista] = useState<PedidoCatalogo[] | null>(null)
  const [erro, setErro] = useState('')
  const [aberto, setAberto] = useState<string | null>(null)
  const clientes = useClientesMapa()
  const produtos = useProdutosMapa()

  const carregar = useCallback(() => {
    setErro('')
    void supabase.from('pedidos_catalogo').select('*').eq('status', aba).order('criado_em', { ascending: false }).limit(200)
      .then(({ data, error }) => {
        if (error) setErro(navigator.onLine ? error.message : 'Sem internet. Esta tela precisa de conexão.')
        else setLista((data ?? []) as PedidoCatalogo[])
      })
  }, [aba])
  useEffect(() => { setLista(null); carregar() }, [carregar])

  async function aprovar(s: PedidoCatalogo) {
    if (!clientes.get(s.cliente_id)) return setErro('Cliente ainda não está neste aparelho. Sincronize e tente de novo.')
    if (await rascunhoDoCatalogo(s)) nav('/pedidos/novo')
  }
  async function recusar(s: PedidoCatalogo) {
    if (!confirm(`Recusar o pedido do catálogo nº ${s.numero}?`)) return
    const { error } = await supabase.from('pedidos_catalogo').update({ status: 'recusada' }).eq('id', s.id)
    if (error) return setErro(error.message)
    carregar()
  }
  async function reabrir(s: PedidoCatalogo) {
    const { error } = await supabase.from('pedidos_catalogo').update({ status: 'nova' }).eq('id', s.id)
    if (error) return setErro(error.message)
    carregar()
  }

  return (
    <>
      <Cabecalho titulo="Pedidos do catálogo" voltar="/mais"
        acao={<button className="rounded-full p-2 hover:bg-white/10" aria-label="Atualizar" onClick={carregar}><Icone nome="sync" /></button>} />
      <main className="space-y-3 p-4">
        <p className="text-sm text-stone-600">Pedidos que os clientes mandaram pelo link do catálogo. Para mandar o link, abra o cliente e toque em <b>Enviar catálogo</b>.</p>
        <div className="grid grid-cols-3 overflow-hidden rounded-xl ring-1 ring-stone-300">
          {ABAS.map(([k, n]) => (
            <button key={k} onClick={() => setAba(k)} className={'py-2 text-sm font-bold ' + (aba === k ? 'bg-marca-700 text-white' : 'bg-white text-stone-600')}>{n}</button>
          ))}
        </div>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {!lista && !erro && <p className="text-center text-sm text-stone-500">Carregando...</p>}
        {lista && !lista.length && <Vazio texto={aba === 'nova' ? 'Nenhum pedido novo do catálogo.' : 'Nada aqui.'} />}
        {lista?.map((s) => {
          const c = clientes.get(s.cliente_id)
          const abrir = aberto === s.id
          const unidades = s.itens.reduce((t, i) => t + Number(i.quantidade), 0)
          return (
            <section key={s.id} className="cartao p-0">
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setAberto(abrir ? null : s.id)}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{c ? nomeCliente(c) : 'Cliente'}</p>
                  <p className="text-xs text-stone-500">Nº {s.numero} · {dataHora(s.criado_em)} · {s.itens.length} produto(s), {num(unidades)} un.</p>
                  {s.contato && <p className="text-xs text-stone-500">Enviado por {s.contato}</p>}
                </div>
                <div className="text-right">
                  <p className="font-bold">{brl(s.total_estimado)}</p>
                  <Icone nome="voltar" className={'ml-auto h-4 w-4 text-stone-400 ' + (abrir ? 'rotate-90' : '-rotate-90')} />
                </div>
              </button>
              {abrir && (
                <div className="space-y-2 border-t border-stone-100 px-4 pb-3 pt-2">
                  {s.observacao && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Obs.: {s.observacao}</p>}
                  <ul className="divide-y divide-stone-100">
                    {s.itens.map((i) => {
                      const p = produtos.get(i.produto_id)
                      return (
                        <li key={i.produto_id} className="flex gap-3 py-1.5 text-sm">
                          <span className="w-12 shrink-0 text-right font-bold text-marca-700">{num(i.quantidade)}</span>
                          <span className="min-w-0 flex-1 truncate"><span className="text-stone-500">{p?.codigo}</span> {p?.nome ?? 'Produto'}</span>
                          <span className="shrink-0">{brl(Number(i.quantidade) * Number(i.preco))}</span>
                        </li>
                      )
                    })}
                  </ul>
                  {s.status === 'nova' && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button className="btn-perigo" onClick={() => void recusar(s)}>Recusar</button>
                      <button className="btn-primario" onClick={() => void aprovar(s)}><Icone nome="ok" /> Gerar pedido</button>
                    </div>
                  )}
                  {s.status === 'aprovada' && s.pedido_id && <Link to={`/pedidos/${s.pedido_id}`} className="btn-secundario w-full">Abrir pedido de venda</Link>}
                  {s.status === 'recusada' && <button className="btn-secundario w-full" onClick={() => void reabrir(s)}>Voltar para novos</button>}
                </div>
              )}
            </section>
          )
        })}
      </main>
    </>
  )
}
