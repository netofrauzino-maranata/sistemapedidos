import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Cabecalho, Icone } from '../components/ui'
import { IndicadorSync, useEstadoSync } from '../components/Layout'
import { useAuth } from '../lib/auth'
import { db, formasForaDeVenda } from '../lib/db'
import { brl, dataHora, hojeISO } from '../lib/formato'
import { nomeCliente, useClientesMapa } from '../lib/hooks'
import { supabase } from '../lib/supabase'
import { STATUS_COR, STATUS_LABEL } from '../lib/tipos'

export default function Inicio() {
  const { perfil, gestor } = useAuth()
  const sync = useEstadoSync()
  const clientes = useClientesMapa()
  const hoje = hojeISO()
  const [doCatalogo, setDoCatalogo] = useState(0)
  useEffect(() => {
    void supabase.from('pedidos_catalogo').select('id', { count: 'exact', head: true }).eq('status', 'nova')
      .then(({ count }) => setDoCatalogo(count ?? 0))
  }, [])
  const mes = hoje.slice(0, 7)

  const resumo = useLiveQuery(async () => {
    const pedidos = await db.pedidos.toArray()
    const meus = gestor ? pedidos : pedidos.filter((p) => p.vendedor_id === perfil?.id)
    const trocas = await formasForaDeVenda()
    const validos = meus.filter((p) => p.status !== 'cancelado' && p.status !== 'orcamento' && !trocas.has(p.forma_pagamento_id ?? ''))
    const diaLocal = (iso: string) => new Date(iso).toLocaleDateString('en-CA')
    const doDia = validos.filter((p) => diaLocal(p.data_pedido) === hoje)
    const doMes = validos.filter((p) => diaLocal(p.data_pedido).startsWith(mes))
    return {
      hojeQtd: doDia.length, hojeTotal: doDia.reduce((s, p) => s + p.total, 0),
      mesQtd: doMes.length, mesTotal: doMes.reduce((s, p) => s + p.total, 0),
      aConfirmar: meus.filter((p) => p.status === 'pendente').length,
      ultimos: [...meus].sort((a, b) => b.data_pedido.localeCompare(a.data_pedido)).slice(0, 5),
    }
  }, [gestor, perfil?.id, hoje])

  const alertas = useLiveQuery(async () => {
    if (!gestor) return null
    const produtos = await db.produtos.filter((p) => p.ativo).toArray()
    const estoque = new Map((await db.estoque.toArray()).map((e) => [e.produto_id, e]))
    const baixo = produtos.filter((p) => (estoque.get(p.id)?.saldo ?? 0) <= p.estoque_minimo)
    const vencendo = (await db.estoqueLotes.toArray()).filter((l) => l.saldo > 0 && l.dias_para_vencer !== null && l.dias_para_vencer <= 30)
    return { baixo: baixo.length, vencendo: vencendo.length }
  }, [gestor])

  return (
    <>
      <Cabecalho logo titulo={`Olá, ${perfil?.nome?.split(' ')[0] ?? ''}`} acao={<IndicadorSync />} />
      <main className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="cartao bg-marca-700 text-white ring-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-marca-100">Vendas hoje</p>
            <p className="mt-1 text-xl font-extrabold">{brl(resumo?.hojeTotal)}</p>
            <p className="text-xs text-marca-100">{resumo?.hojeQtd ?? 0} pedido(s)</p>
          </div>
          <div className="cartao">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">No mês</p>
            <p className="mt-1 text-xl font-extrabold text-marca-700">{brl(resumo?.mesTotal)}</p>
            <p className="text-xs text-stone-500">{resumo?.mesQtd ?? 0} pedido(s)</p>
          </div>
        </div>

        {doCatalogo > 0 && (
          <Link to="/catalogo-pedidos" className="cartao flex items-center gap-3 bg-destaque p-3 font-bold text-stone-900 ring-0">
            <Icone nome="pedido" className="h-6 w-6" />
            <span className="flex-1">{doCatalogo} pedido(s) novo(s) pelo catálogo online</span>
            <Icone nome="voltar" className="h-4 w-4 rotate-180" />
          </Link>
        )}

        <div className="grid grid-cols-3 gap-2">
          <Link to="/pedidos/novo" className="cartao flex flex-col items-center gap-1 bg-destaque p-3 text-center text-sm font-bold text-stone-900 ring-0">
            <Icone nome="mais" className="h-6 w-6" />Novo pedido
          </Link>
          <Link to="/clientes/novo" className="cartao flex flex-col items-center gap-1 p-3 text-center text-sm font-semibold">
            <Icone nome="cliente" className="h-6 w-6 text-marca-600" />Novo cliente
          </Link>
          {gestor ? (
            <Link to="/carga" className="cartao flex flex-col items-center gap-1 p-3 text-center text-sm font-semibold">
              <Icone nome="caminhao" className="h-6 w-6 text-marca-600" />Carga
            </Link>
          ) : (
            <Link to="/catalogo" className="cartao flex flex-col items-center gap-1 p-3 text-center text-sm font-semibold">
              <Icone nome="livro" className="h-6 w-6 text-marca-600" />Catálogo
            </Link>
          )}
        </div>

        {gestor && alertas && (alertas.baixo > 0 || alertas.vencendo > 0 || (resumo?.aConfirmar ?? 0) > 0) && (
          <div className="cartao space-y-2">
            <h2 className="flex items-center gap-2 font-bold text-amber-700"><Icone nome="alerta" /> Atenção</h2>
            {(resumo?.aConfirmar ?? 0) > 0 && <Link to="/pedidos?status=pendente" className="block text-sm">• {resumo?.aConfirmar} pedido(s) aguardando confirmação</Link>}
            {alertas.baixo > 0 && <Link to="/estoque?filtro=baixo" className="block text-sm">• {alertas.baixo} produto(s) com estoque baixo ou zerado</Link>}
            {alertas.vencendo > 0 && <Link to="/estoque?filtro=vencendo" className="block text-sm">• {alertas.vencendo} lote(s) vencendo em até 30 dias</Link>}
          </div>
        )}

        <div className="cartao">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold">Últimos pedidos</h2>
            <Link to="/pedidos" className="text-sm font-semibold text-marca-700">Ver todos</Link>
          </div>
          {!resumo?.ultimos.length && (
            <div className="flex items-center gap-3 py-2">
              <img src="/mascote.png" alt="" className="h-24 w-auto" />
              <div>
                <p className="font-bold text-marca-700">Nenhum pedido ainda.</p>
                <Link to="/pedidos/novo" className="text-sm font-semibold text-apoio">Fazer o primeiro pedido</Link>
              </div>
            </div>
          )}
          <ul className="divide-y divide-stone-100">
            {resumo?.ultimos.map((p) => (
              <li key={p.id}>
                <Link to={`/pedidos/${p.id}`} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{nomeCliente(clientes.get(p.cliente_id))}</p>
                    <p className="text-xs text-stone-500">{p.numero ? `#${p.numero}` : 'Não enviado'} · {dataHora(p.data_pedido)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold">{brl(p.total)}</p>
                    <span className={'etiqueta ' + STATUS_COR[p.status]}>{STATUS_LABEL[p.status]}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-center text-xs text-stone-400">
          {sync.ultimo ? `Sincronizado em ${dataHora(sync.ultimo)}` : 'Ainda não sincronizado'}
          {sync.erro ? ` · ${sync.erro}` : ''}
        </p>
      </main>
    </>
  )
}
