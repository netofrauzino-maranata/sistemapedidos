import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BotaoFlutuante, Busca, Cabecalho, Vazio } from '../components/ui'
import { IndicadorSync } from '../components/Layout'
import { useAuth } from '../lib/auth'
import { db } from '../lib/db'
import { brl, dataHora, normalizar } from '../lib/formato'
import { nomeCliente, useClientesMapa, usePerfisMapa } from '../lib/hooks'
import { STATUS_COR, STATUS_LABEL, type StatusPedido } from '../lib/tipos'

const filtros: (StatusPedido | 'todos' | 'nao_enviados')[] = ['todos', 'nao_enviados', 'orcamento', 'pendente', 'confirmado', 'faturado', 'entregue', 'cancelado']

export default function Pedidos() {
  const { gestor, perfil } = useAuth()
  const [params, setParams] = useSearchParams()
  const filtro = (params.get('status') ?? 'todos') as (typeof filtros)[number]
  const [busca, setBusca] = useState('')
  const clientes = useClientesMapa()
  const perfis = usePerfisMapa()

  const pedidos = useLiveQuery(async () => {
    let lista = await db.pedidos.orderBy('data_pedido').reverse().toArray()
    if (!gestor) lista = lista.filter((p) => p.vendedor_id === perfil?.id)
    if (filtro === 'nao_enviados') lista = lista.filter((p) => p._sync !== 'ok')
    else if (filtro !== 'todos') lista = lista.filter((p) => p.status === filtro)
    return lista
  }, [filtro, gestor, perfil?.id]) ?? []

  const q = normalizar(busca)
  const visiveis = q ? pedidos.filter((p) => {
    const c = clientes.get(p.cliente_id)
    return normalizar(`${p.numero ?? ''} ${c?.razao_social} ${c?.nome_fantasia} ${c?.cidade}`).includes(q)
  }) : pedidos
  const total = visiveis.filter((p) => p.status !== 'cancelado' && p.status !== 'orcamento').reduce((s, p) => s + p.total, 0)

  return (
    <>
      <Cabecalho titulo="Pedidos" acao={<IndicadorSync />} />
      <div className="sticky top-[calc(env(safe-area-inset-top)+3.75rem)] z-10 space-y-2 bg-fundo p-4 pb-2">
        <Busca valor={busca} onChange={setBusca} placeholder="Número, cliente ou cidade" />
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {filtros.map((f) => (
            <button key={f} onClick={() => setParams(f === 'todos' ? {} : { status: f })}
              className={'etiqueta shrink-0 px-3 py-1.5 text-sm ' + (filtro === f ? 'bg-marca-700 text-white' : 'bg-white text-stone-600 ring-1 ring-stone-200')}>
              {f === 'todos' ? 'Todos' : f === 'nao_enviados' ? 'Não enviados' : STATUS_LABEL[f]}
            </button>
          ))}
        </div>
        <p className="text-xs text-stone-500">{visiveis.length} pedido(s) · {brl(total)}</p>
      </div>
      <main className="space-y-2 px-4">
        {!visiveis.length && <Vazio texto="Nenhum pedido aqui." />}
        {visiveis.map((p) => (
          <Link key={p.id} to={`/pedidos/${p.id}`} className="cartao flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{nomeCliente(clientes.get(p.cliente_id))}</p>
              <p className="text-xs text-stone-500">
                {p.numero ? `#${p.numero}` : 'Sem número'} · {dataHora(p.data_pedido)}
                {gestor && perfis.get(p.vendedor_id) ? ` · ${perfis.get(p.vendedor_id)!.nome}` : ''}
              </p>
              {p._sync === 'pendente' && <p className="text-xs font-semibold text-amber-700">Aguardando envio</p>}
              {p._sync === 'erro' && <p className="text-xs font-semibold text-red-700">Erro ao enviar: {p._erro}</p>}
            </div>
            <div className="text-right">
              <p className="font-bold">{brl(p.total)}</p>
              <span className={'etiqueta ' + STATUS_COR[p.status]}>{STATUS_LABEL[p.status]}</span>
            </div>
          </Link>
        ))}
      </main>
      <BotaoFlutuante para="/pedidos/novo" rotulo="Novo pedido" />
    </>
  )
}
