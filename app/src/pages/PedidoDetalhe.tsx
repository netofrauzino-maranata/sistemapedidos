import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useOnline } from '../components/Layout'
import { Aviso, Cabecalho, Icone } from '../components/ui'
import { useAuth } from '../lib/auth'
import { db } from '../lib/db'
import { brl, data, dataHora, docFormatado, foneFormatado, num, soDigitos, uuid } from '../lib/formato'
import { nomeCliente } from '../lib/hooks'
import { abrirPdf, compartilharPdf, pdfPedido } from '../lib/pdf'
import { supabase } from '../lib/supabase'
import { sincronizar } from '../lib/sync'
import { STATUS_COR, STATUS_LABEL, type Pedido, type StatusPedido } from '../lib/tipos'

export default function PedidoDetalhe() {
  const { id } = useParams()
  const nav = useNavigate()
  const { gestor, perfil } = useAuth()
  const online = useOnline()
  const [msg, setMsg] = useState<{ tipo: 'erro' | 'ok'; texto: string } | null>(null)
  const [mudando, setMudando] = useState(false)

  const dados = useLiveQuery(async () => {
    const pedido = await db.pedidos.get(id!)
    if (!pedido) return null
    const [cliente, vendedor, empresa, condicao, forma] = await Promise.all([
      db.clientes.get(pedido.cliente_id), db.perfis.get(pedido.vendedor_id), db.empresa.get(1),
      pedido.condicao_pagamento_id ? db.condicoes.get(pedido.condicao_pagamento_id) : undefined,
      pedido.forma_pagamento_id ? db.formas.get(pedido.forma_pagamento_id) : undefined,
    ])
    return { pedido, cliente, vendedor, empresa, condicao, forma }
  }, [id])

  if (dados === undefined) return null
  if (dados === null) return <><Cabecalho titulo="Pedido" voltar /><p className="p-6 text-center">Pedido não encontrado.</p></>
  const { pedido: p, cliente: c } = dados
  const podeEditar = gestor || (p.vendedor_id === perfil?.id && ['orcamento', 'pendente'].includes(p.status))
  const nomeArq = `${p.status === 'orcamento' ? 'orcamento' : 'pedido'}-${p.numero ?? 'provisorio'}-${soDigitos(c?.cpf_cnpj) || 'cliente'}.pdf`

  async function mudarStatus(status: StatusPedido) {
    if (status === 'cancelado' && !confirm('Cancelar este pedido? O estoque será devolvido.')) return
    setMsg(null); setMudando(true)
    try {
      if (p._sync !== 'ok') {
        // ainda não foi para o servidor: muda local e envia
        await db.pedidos.update(p.id, { status, _sync: 'pendente' })
        await sincronizar()
      } else {
        const { data: r, error } = await supabase.rpc('mudar_status_pedido', { p_id: p.id, p_status: status })
        if (error) throw error
        await db.pedidos.update(p.id, { status: (r as Pedido).status, atualizado_em: (r as Pedido).atualizado_em })
        void sincronizar()
      }
      setMsg({ tipo: 'ok', texto: `Pedido marcado como ${STATUS_LABEL[status].toLowerCase()}.` })
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message })
    } finally { setMudando(false) }
  }

  async function duplicar() {
    const novo = {
      ...p, id: uuid(), numero: null, status: 'pendente' as const, data_pedido: new Date().toISOString(),
      data_entrega: null, nfe_numero: null, exportado_nfe_em: null,
      itens: p.itens.map((i) => ({ ...i, id: uuid() })), _sync: 'pendente' as const, _erro: undefined,
    }
    const { _sync, _erro, numero, subtotal, total, ...rascunho } = novo
    void _sync; void _erro; void numero; void subtotal; void total
    localStorage.setItem('maranata-rascunho-pedido', JSON.stringify(rascunho))
    nav('/pedidos/novo')
  }

  function whatsapp() {
    const fone = soDigitos(c?.whatsapp || c?.telefone)
    const linhas = [
      `*${p.status === 'orcamento' ? 'Orçamento' : 'Pedido'} ${p.numero ? '#' + p.numero : ''} · ${dados!.empresa?.nome_fantasia ?? 'Maranata'}*`,
      ...p.itens.map((i) => `• ${num(i.quantidade)} ${i.unidade} ${i.produto_nome} = ${brl(i.total)}`),
      `*Total: ${brl(p.total)}*`,
    ]
    window.open(`https://wa.me/${fone ? '55' + fone.replace(/^55/, '') : ''}?text=${encodeURIComponent(linhas.join('\n'))}`, '_blank')
  }

  const proximos: StatusPedido[] = gestor
    ? (({ orcamento: ['pendente'], pendente: ['confirmado'], confirmado: ['faturado'], faturado: ['entregue'], entregue: [], cancelado: ['pendente'] } as Record<StatusPedido, StatusPedido[]>)[p.status])
    : []

  return (
    <>
      <Cabecalho titulo={p.numero ? `Pedido #${p.numero}` : 'Pedido (não enviado)'} voltar="/pedidos"
        acao={podeEditar && p.status !== 'cancelado' ? <Link to={`/pedidos/${p.id}/editar`} className="rounded-full p-2 hover:bg-white/10" aria-label="Editar"><Icone nome="editar" /></Link> : undefined} />
      <main className="space-y-3 p-4">
        {p._sync === 'pendente' && <Aviso tipo="alerta">Salvo no celular. Será enviado assim que houver internet.</Aviso>}
        {p._sync === 'erro' && <Aviso tipo="erro">Não foi aceito pelo servidor: {p._erro}</Aviso>}
        {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}

        <div className="cartao">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link to={c ? `/clientes/${c.id}` : '#'} className="block truncate text-lg font-bold">{nomeCliente(c)}</Link>
              <p className="text-sm text-stone-500">{c?.razao_social} · {docFormatado(c?.cpf_cnpj)}</p>
              <p className="text-sm text-stone-500">{[c?.cidade, c?.uf].filter(Boolean).join('/')}{c?.telefone ? ' · ' + foneFormatado(c.telefone) : ''}</p>
            </div>
            <span className={'etiqueta ' + STATUS_COR[p.status]}>{STATUS_LABEL[p.status]}</span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div><dt className="text-stone-500">Data</dt><dd className="font-medium">{dataHora(p.data_pedido)}</dd></div>
            <div><dt className="text-stone-500">Vendedor</dt><dd className="font-medium">{dados.vendedor?.nome ?? '—'}</dd></div>
            <div><dt className="text-stone-500">Pagamento</dt><dd className="font-medium">{[dados.condicao?.nome, dados.forma?.nome].filter(Boolean).join(' / ') || '—'}</dd></div>
            <div><dt className="text-stone-500">Entrega</dt><dd className="font-medium">{p.data_entrega ? data(p.data_entrega) : '—'}</dd></div>
            {p.nfe_numero && <div><dt className="text-stone-500">NF-e</dt><dd className="font-medium">{p.nfe_numero}</dd></div>}
          </dl>
        </div>

        <div className="cartao p-0">
          <ul className="divide-y divide-stone-100">
            {p.itens.map((i) => (
              <li key={i.id} className="flex items-center gap-2 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{i.produto_nome}</p>
                  <p className="text-xs text-stone-500">{num(i.quantidade)} {i.unidade} × {brl(i.preco_unitario)}{i.desconto ? ` − ${brl(i.desconto)}` : ''}</p>
                </div>
                <p className="font-bold">{brl(i.total)}</p>
              </li>
            ))}
          </ul>
          <div className="space-y-1 border-t border-stone-100 px-4 py-3 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{brl(p.subtotal)}</span></div>
            {!!p.desconto && <div className="flex justify-between text-red-700"><span>Desconto</span><span>− {brl(p.desconto)}</span></div>}
            {!!p.frete && <div className="flex justify-between"><span>Frete</span><span>{brl(p.frete)}</span></div>}
            <div className="flex justify-between text-lg font-extrabold text-marca-700"><span>Total</span><span>{brl(p.total)}</span></div>
          </div>
        </div>

        {p.observacao && <div className="cartao text-sm"><b>Observação:</b> {p.observacao}</div>}
        {gestor && p.observacao_interna && <div className="cartao text-sm"><b>Interna:</b> {p.observacao_interna}</div>}

        <div className="grid grid-cols-2 gap-2">
          <button className="btn-primario" onClick={() => void compartilharPdf(pdfPedido(dados), nomeArq, `Pedido ${p.numero ?? ''}`)}><Icone nome="pdf" /> Enviar PDF</button>
          <button className="btn-secundario" onClick={() => abrirPdf(pdfPedido(dados))}><Icone nome="pdf" /> Ver / imprimir</button>
          <button className="btn-secundario" onClick={whatsapp}><Icone nome="whatsapp" /> WhatsApp</button>
          <button className="btn-secundario" onClick={() => void duplicar()}><Icone nome="mais" /> Repetir pedido</button>
        </div>

        {(proximos.length > 0 || (podeEditar && p.status !== 'cancelado')) && (
          <div className="cartao space-y-2">
            <h2 className="font-bold">Situação</h2>
            {!online && p._sync === 'ok' && <p className="text-xs text-stone-500">Mudar situação precisa de internet.</p>}
            <div className="flex flex-wrap gap-2">
              {proximos.map((s) => (
                <button key={s} className="btn-primario" disabled={mudando || (!online && p._sync === 'ok')} onClick={() => void mudarStatus(s)}>
                  Marcar {STATUS_LABEL[s].toLowerCase()}
                </button>
              ))}
              {podeEditar && p.status !== 'cancelado' && (
                <button className="btn-perigo" disabled={mudando || (!online && p._sync === 'ok')} onClick={() => void mudarStatus('cancelado')}>Cancelar pedido</button>
              )}
            </div>
          </div>
        )}
      </main>
    </>
  )
}
