import { useEffect, useState } from 'react'
import { useOnline } from '../components/Layout'
import { Aviso, Cabecalho, Campo, Icone } from '../components/ui'
import { baixarArquivo, gerarCsv } from '../lib/csv'
import { brl, data, docFormatado, hojeISO } from '../lib/formato'
import { supabase } from '../lib/supabase'
import { sincronizar } from '../lib/sync'

// Exporta as vendas para o emissor de NF-e. Uma linha por item, com todos
// os dados fiscais do cliente e do produto (visão vw_exportacao_nfe).
type LinhaNfe = Record<string, string | number | null> & {
  pedido_id: string; pedido_numero: number; data_pedido: string; razao_social: string; cpf_cnpj: string | null
  pedido_total: number; exportado_nfe_em: string | null; status: string
}

export default function ExportarNfe() {
  const online = useOnline()
  const [ini, setIni] = useState(new Date(Date.now() - 7 * 864e5).toLocaleDateString('en-CA'))
  const [fim, setFim] = useState(hojeISO())
  const [status, setStatus] = useState<string[]>(['confirmado', 'faturado', 'entregue', 'pendente'])
  const [soNovos, setSoNovos] = useState(true)
  const [linhas, setLinhas] = useState<LinhaNfe[]>([])
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [msg, setMsg] = useState<{ tipo: 'erro' | 'ok' | 'info'; texto: string } | null>(null)
  const [carregando, setCarregando] = useState(false)

  async function buscar() {
    setCarregando(true); setMsg(null)
    let q = supabase.from('vw_exportacao_nfe').select('*')
      .gte('data_pedido', ini + 'T00:00:00-03:00').lte('data_pedido', fim + 'T23:59:59-03:00')
      .in('status', status).order('pedido_numero').order('item')
    if (soNovos) q = q.is('exportado_nfe_em', null)
    const { data: d, error } = await q
    setCarregando(false)
    if (error) return setMsg({ tipo: 'erro', texto: error.message })
    const l = (d ?? []) as LinhaNfe[]
    setLinhas(l)
    setMarcados(new Set(l.map((x) => x.pedido_id)))
  }
  useEffect(() => { if (online) void buscar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const pedidos = [...new Map(linhas.map((l) => [l.pedido_id, l])).values()]
  const selecionadas = linhas.filter((l) => marcados.has(l.pedido_id))

  async function exportar(formato: 'csv' | 'json') {
    if (!selecionadas.length) return
    const nome = `vendas-nfe-${ini}-a-${fim}`
    if (formato === 'csv') baixarArquivo(gerarCsv(selecionadas), nome + '.csv')
    else {
      // JSON agrupado por pedido (mais fácil para integração automática)
      const porPedido = pedidos.filter((p) => marcados.has(p.pedido_id)).map((p) => {
        const itens = selecionadas.filter((l) => l.pedido_id === p.pedido_id)
        const { item, produto_codigo, produto_nome, gtin, ncm, cest, origem, cfop, unidade, quantidade, preco_unitario, item_desconto, item_total, ...cab } = itens[0]
        void item; void produto_codigo; void produto_nome; void gtin; void ncm; void cest; void origem; void cfop; void unidade; void quantidade; void preco_unitario; void item_desconto; void item_total
        return { ...cab, itens: itens.map((i) => ({ item: i.item, produto_codigo: i.produto_codigo, produto_nome: i.produto_nome, gtin: i.gtin, ncm: i.ncm, cest: i.cest, origem: i.origem, cfop: i.cfop, unidade: i.unidade, quantidade: i.quantidade, preco_unitario: i.preco_unitario, desconto: i.item_desconto, total: i.item_total })) }
      })
      baixarArquivo(JSON.stringify(porPedido, null, 2), nome + '.json', 'application/json')
    }
    if (confirm('Marcar estes pedidos como exportados? Assim eles não aparecem de novo no filtro "só não exportados".')) {
      const { error } = await supabase.rpc('marcar_exportado_nfe', { p_ids: [...marcados] })
      if (error) setMsg({ tipo: 'erro', texto: error.message })
      else { setMsg({ tipo: 'ok', texto: `${marcados.size} pedido(s) marcados como exportados.` }); void sincronizar(); void buscar() }
    }
  }

  const faltando = selecionadas.filter((l) => !l.ncm || !l.cpf_cnpj || !l.codigo_ibge)

  return (
    <>
      <Cabecalho titulo="Exportar para NF-e" voltar />
      <main className="space-y-3 p-4">
        {!online && <Aviso tipo="alerta">A exportação busca os dados no servidor e precisa de internet.</Aviso>}
        <section className="cartao space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="De"><input type="date" className="campo" value={ini} onChange={(e) => setIni(e.target.value)} /></Campo>
            <Campo rotulo="Até"><input type="date" className="campo" value={fim} onChange={(e) => setFim(e.target.value)} /></Campo>
          </div>
          <div className="flex flex-wrap gap-2">
            {['pendente', 'confirmado', 'faturado', 'entregue'].map((s) => (
              <label key={s} className="flex items-center gap-1 text-sm capitalize">
                <input type="checkbox" checked={status.includes(s)} onChange={(e) => setStatus((x) => (e.target.checked ? [...x, s] : x.filter((y) => y !== s)))} />{s}
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={soNovos} onChange={(e) => setSoNovos(e.target.checked)} /> Só os ainda não exportados</label>
          <button className="btn-secundario w-full" disabled={!online || carregando} onClick={() => void buscar()}>{carregando ? 'Buscando...' : 'Buscar vendas'}</button>
        </section>

        {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
        {faltando.length > 0 && <Aviso tipo="alerta">{faltando.length} item(ns) sem NCM, CPF/CNPJ ou código IBGE. O emissor pode recusar. Complete os cadastros.</Aviso>}

        {pedidos.length > 0 && (
          <section className="cartao p-0">
            <div className="flex items-center justify-between border-b border-stone-100 px-4 py-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={marcados.size === pedidos.length}
                onChange={(e) => setMarcados(e.target.checked ? new Set(pedidos.map((p) => p.pedido_id)) : new Set())} /> {marcados.size} de {pedidos.length}</label>
              <b>{brl(pedidos.filter((p) => marcados.has(p.pedido_id)).reduce((s, p) => s + Number(p.pedido_total), 0))}</b>
            </div>
            <ul className="divide-y divide-stone-100">
              {pedidos.map((p) => (
                <li key={p.pedido_id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <input type="checkbox" checked={marcados.has(p.pedido_id)} onChange={(e) => setMarcados((m) => { const n = new Set(m); if (e.target.checked) n.add(p.pedido_id); else n.delete(p.pedido_id); return n })} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">#{p.pedido_numero} · {p.razao_social}</p>
                    <p className="text-xs text-stone-500">{data(p.data_pedido)} · {docFormatado(p.cpf_cnpj)} · {p.status}{p.exportado_nfe_em ? ' · já exportado' : ''}</p>
                  </div>
                  <b>{brl(Number(p.pedido_total))}</b>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!pedidos.length && !carregando && online && <p className="text-center text-sm text-stone-500">Nenhuma venda para exportar no período.</p>}

        <div className="grid grid-cols-2 gap-2">
          <button className="btn-primario" disabled={!marcados.size} onClick={() => void exportar('csv')}><Icone nome="exportar" /> Planilha CSV</button>
          <button className="btn-secundario" disabled={!marcados.size} onClick={() => void exportar('json')}><Icone nome="exportar" /> JSON</button>
        </div>
      </main>
    </>
  )
}
