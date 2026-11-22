import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useOnline } from '../components/Layout'
import { Aviso, Cabecalho, Campo, Icone } from '../components/ui'
import { db } from '../lib/db'
import { brl, data, dataHora, docFormatado, hojeISO, num } from '../lib/formato'
import { ehCliente } from '../lib/hooks'
import { supabase } from '../lib/supabase'
import { sincronizar as sincronizarApp } from '../lib/sync'

// Integração com o VendasExternas (emissor fiscal do Neto).
// A API deles cadastra clientes e produtos, mas não cria pedido.
// Então: cadastros vão automáticos, pedidos vão como espelho (texto pronto
// com os códigos de lá) para o operador lançar rápido.

type Status = { configurada: boolean; final_chave: string; unidade_negocio: number | null; testado_em: string | null; teste_ok: boolean | null; teste_msg: string | null }
type Vinculo = { entidade: 'cliente' | 'produto'; registro_id: string; ve_codigo: number | null; origem: string | null; enviado_em: string | null; erro: string | null }
type Resultado = { criados: number; atualizados: number; vinculados: number; sem_mudanca: number; erros: { id: string; nome: string; erro: string }[] }
type Linha = Record<string, string | number | null> & {
  pedido_id: string; pedido_numero: number; data_pedido: string; razao_social: string; cpf_cnpj: string | null
  cliente_codigo: number; produto_codigo: string; produto_nome: string; unidade: string; quantidade: number
  preco_unitario: number; item_desconto: number; item_total: number; pedido_total: number; pedido_desconto: number
  pedido_frete: number; forma_pagamento: string | null; condicao_pagamento: string | null; vendedor: string | null
  exportado_nfe_em: string | null; status: string; item: number
}

// Nome com que a função foi publicada no Supabase (o painel deu o nome "super-service")
const FUNCAO_VE = 'super-service'

async function chamar(corpo: Record<string, unknown>) {
  const { data: d, error } = await supabase.functions.invoke(FUNCAO_VE, { body: corpo })
  if (error) {
    // tenta ler a mensagem que a função devolveu
    const ctx = (error as { context?: Response }).context
    let msg = error.message
    try { const j = await ctx?.json(); if (j?.erro) msg = j.erro } catch { /* ignora */ }
    throw new Error(msg)
  }
  if (d?.erro) throw new Error(d.erro)
  return d
}

export default function IntegracaoVE() {
  const online = useOnline()
  const [aba, setAba] = useState<'cadastros' | 'pedidos' | 'conexao'>('cadastros')
  const [status, setStatus] = useState<Status | null>(null)
  const [msg, setMsg] = useState<{ tipo: 'erro' | 'ok' | 'info' | 'alerta'; texto: string } | null>(null)

  async function carregarStatus() {
    const { data: d, error } = await supabase.rpc('status_integracao_ve')
    if (error) return setMsg({ tipo: 'erro', texto: error.message })
    setStatus(d as Status)
    if (!(d as Status).configurada) setAba('conexao')
  }
  useEffect(() => { if (online) void carregarStatus() }, [online])

  return (
    <>
      <Cabecalho titulo="VendasExternas" voltar />
      <main className="space-y-3 p-4">
        {!online && <Aviso tipo="alerta">A integração conversa com o servidor e precisa de internet.</Aviso>}
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-white p-1 text-sm font-semibold shadow-sm">
          {([['cadastros', 'Cadastros'], ['pedidos', 'Pedidos'], ['conexao', 'Conexão']] as const).map(([k, t]) => (
            <button key={k} className={`rounded-lg py-2 ${aba === k ? 'bg-marca-600 text-white' : 'text-stone-600'}`} onClick={() => { setAba(k); setMsg(null) }}>{t}</button>
          ))}
        </div>
        {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
        {status && !status.configurada && aba !== 'conexao' && <Aviso tipo="alerta">Configure as chaves na aba Conexão primeiro.</Aviso>}
        {aba === 'conexao' && <Conexao status={status} online={online} onSalvo={carregarStatus} setMsg={setMsg} />}
        {aba === 'cadastros' && <Cadastros online={online} pronto={!!status?.configurada} setMsg={setMsg} />}
        {aba === 'pedidos' && <Pedidos online={online} setMsg={setMsg} />}
      </main>
    </>
  )
}

type SetMsg = (m: { tipo: 'erro' | 'ok' | 'info' | 'alerta'; texto: string } | null) => void

function Conexao({ status, online, onSalvo, setMsg }: { status: Status | null; online: boolean; onSalvo: () => Promise<void>; setMsg: SetMsg }) {
  const [key, setKey] = useState('')
  const [secret, setSecret] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function salvar() {
    if (!key.trim() || !secret.trim()) return setMsg({ tipo: 'erro', texto: 'Cole as duas chaves.' })
    setOcupado(true); setMsg(null)
    const { error } = await supabase.rpc('salvar_chaves_ve', { p_key: key, p_secret: secret })
    if (error) { setOcupado(false); return setMsg({ tipo: 'erro', texto: error.message }) }
    setKey(''); setSecret('')
    await testar()
  }
  async function testar() {
    setOcupado(true); setMsg(null)
    try {
      const r = await chamar({ acao: 'testar' })
      setMsg({ tipo: r.ok ? 'ok' : 'erro', texto: r.ok ? r.mensagem : `Não conectou: ${r.mensagem}` })
    } catch (e) { setMsg({ tipo: 'erro', texto: (e as Error).message }) }
    setOcupado(false)
    await onSalvo()
  }

  return (
    <>
      <section className="cartao space-y-2 text-sm">
        <p className="font-bold">Situação</p>
        {!status ? <p className="text-stone-500">Carregando...</p> : !status.configurada ? <p>Sem chaves ainda.</p> : (
          <>
            <p>Chave salva (final <b>{status.final_chave}</b>).</p>
            {status.testado_em && <p className={status.teste_ok ? 'text-green-700' : 'text-red-700'}>{status.teste_ok ? 'Conectado' : 'Falhou'} em {dataHora(status.testado_em)}. {status.teste_msg}</p>}
            {status.unidade_negocio && <p className="text-stone-500">Unidade de negócio para preços: {status.unidade_negocio}</p>}
            <button className="btn-secundario w-full" disabled={!online || ocupado} onClick={() => void testar()}>{ocupado ? 'Testando...' : 'Testar conexão'}</button>
          </>
        )}
      </section>
      <section className="cartao space-y-3">
        <p className="font-bold">{status?.configurada ? 'Trocar as chaves' : 'Colar as chaves'}</p>
        <p className="text-sm text-stone-600">No painel do VendasExternas, crie uma integração. Ele mostra duas chaves: cole aqui. Elas ficam guardadas no servidor e ninguém consegue ver de volta pelo app.</p>
        <Campo rotulo="application-key"><input className="campo" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} /></Campo>
        <Campo rotulo="application-secret"><input className="campo" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} /></Campo>
        <button className="btn-primario w-full" disabled={!online || ocupado} onClick={() => void salvar()}>{ocupado ? 'Salvando...' : 'Salvar e testar'}</button>
      </section>
    </>
  )
}

function Cadastros({ online, pronto, setMsg }: { online: boolean; pronto: boolean; setMsg: SetMsg }) {
  const clientesQ = useLiveQuery(() => db.clientes.filter((c) => c.ativo && ehCliente(c)).toArray(), [])
  const produtosQ = useLiveQuery(() => db.produtos.filter((p) => p.ativo).toArray(), [])
  const clientes = useMemo(() => clientesQ ?? [], [clientesQ])
  const produtos = useMemo(() => produtosQ ?? [], [produtosQ])
  const [vinculos, setVinculos] = useState<Vinculo[]>([])
  const [progresso, setProgresso] = useState<string | null>(null)
  const [erros, setErros] = useState<{ nome: string; erro: string }[]>([])

  async function carregar() {
    const { data: d, error } = await supabase.from('ve_vinculos').select('*')
    if (error) setMsg({ tipo: 'erro', texto: error.message })
    else setVinculos((d ?? []) as Vinculo[])
  }
  useEffect(() => { if (online) void carregar() }, [online]) // eslint-disable-line react-hooks/exhaustive-deps

  const resumo = useMemo(() => {
    const mapa = new Map(vinculos.map((v) => [v.entidade + v.registro_id, v]))
    const conta = (ent: 'cliente' | 'produto', lista: { id: string; atualizado_em?: string }[]) => {
      let ok = 0, comErro = 0
      const pendentes: string[] = []
      for (const r of lista) {
        const v = mapa.get(ent + r.id)
        if (!v || !v.ve_codigo || v.erro) { pendentes.push(r.id); if (v?.erro) comErro++ }
        else if (v.origem === 'criado' && v.enviado_em && (r.atualizado_em ?? '') > v.enviado_em) pendentes.push(r.id)
        else ok++
      }
      return { total: lista.length, ok, comErro, pendentes }
    }
    return { cliente: conta('cliente', clientes), produto: conta('produto', produtos) }
  }, [vinculos, clientes, produtos])

  async function enviar(ent: 'cliente' | 'produto', todos = false) {
    const ids = todos ? (ent === 'cliente' ? clientes : produtos).map((r) => r.id) : resumo[ent].pendentes
    if (!ids.length) return setMsg({ tipo: 'info', texto: 'Nada pendente para enviar.' })
    setMsg(null); setErros([])
    const soma: Resultado = { criados: 0, atualizados: 0, vinculados: 0, sem_mudanca: 0, erros: [] }
    try {
      for (let i = 0; i < ids.length; i += 20) {
        setProgresso(`Enviando ${ent === 'cliente' ? 'clientes' : 'produtos'}: ${Math.min(i + 20, ids.length)} de ${ids.length}...`)
        const r = (await chamar({ acao: 'sincronizar', entidade: ent, ids: ids.slice(i, i + 20) })) as Resultado
        soma.criados += r.criados; soma.atualizados += r.atualizados; soma.vinculados += r.vinculados; soma.sem_mudanca += r.sem_mudanca
        soma.erros.push(...r.erros)
      }
      setMsg({
        tipo: soma.erros.length ? 'alerta' : 'ok',
        texto: `Pronto. Cadastrados lá: ${soma.criados}. Já existiam e foram ligados: ${soma.vinculados}. Atualizados: ${soma.atualizados}.${soma.erros.length ? ` Com erro: ${soma.erros.length} (veja abaixo).` : ''}`,
      })
      setErros(soma.erros)
    } catch (e) { setMsg({ tipo: 'erro', texto: (e as Error).message }) }
    setProgresso(null)
    await carregar()
  }

  const bloco = (ent: 'cliente' | 'produto', titulo: string) => {
    const r = resumo[ent]
    return (
      <section key={ent} className="cartao space-y-2">
        <div className="flex items-center justify-between">
          <p className="font-bold">{titulo}</p>
          <span className="text-sm text-stone-500">{r.ok} de {r.total} ligados</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-stone-100"><div className="h-full bg-marca-600" style={{ width: `${r.total ? (r.ok / r.total) * 100 : 0}%` }} /></div>
        <p className="text-sm text-stone-600">{r.pendentes.length ? `${r.pendentes.length} para enviar (novos ou alterados)` : 'Tudo em dia.'}{r.comErro ? ` · ${r.comErro} com erro` : ''}</p>
        <button className="btn-primario w-full" disabled={!online || !pronto || !!progresso || !r.pendentes.length} onClick={() => void enviar(ent)}>
          <Icone nome="sync" /> Enviar {titulo.toLowerCase()} para o VendasExternas
        </button>
      </section>
    )
  }

  return (
    <>
      <Aviso tipo="info">Antes de cadastrar, o sistema procura se o registro já existe lá (cliente pelo CPF/CNPJ, produto pelo código de barras ou nome). Se existir, só liga os dois e não mexe nos dados fiscais de lá.</Aviso>
      {progresso && <Aviso tipo="info">{progresso}</Aviso>}
      {bloco('cliente', 'Clientes')}
      {bloco('produto', 'Produtos')}
      {erros.length > 0 && (
        <section className="cartao space-y-1 text-sm">
          <p className="font-bold">Não foram</p>
          {erros.map((e, i) => <p key={i}><b>{e.nome}</b>: <span className="text-red-700">{e.erro}</span></p>)}
        </section>
      )}
    </>
  )
}

function montarEspelho(itens: Linha[], codVe: Map<string, number>) {
  const p = itens[0]
  const cliVe = codVe.get('cliente:' + p.cliente_codigo)
  const l: string[] = []
  l.push(`PEDIDO #${p.pedido_numero} · ${data(p.data_pedido)}${p.vendedor ? ' · ' + p.vendedor : ''}`)
  l.push(`Cliente: ${cliVe ? `[VE ${cliVe}] ` : ''}${p.razao_social}${p.cpf_cnpj ? ' · ' + docFormatado(p.cpf_cnpj) : ''}`)
  if (p.forma_pagamento || p.condicao_pagamento) l.push(`Pagamento: ${[p.forma_pagamento, p.condicao_pagamento].filter(Boolean).join(' · ')}`)
  l.push('Itens:')
  for (const i of itens) {
    const ve = codVe.get('produto:' + i.produto_codigo)
    l.push(`${i.item}) ${ve ? `[VE ${ve}] ` : ''}cód ${i.produto_codigo} ${i.produto_nome} · ${num(Number(i.quantidade))} ${i.unidade} x ${brl(Number(i.preco_unitario))}${Number(i.item_desconto) ? ` (desc. ${brl(Number(i.item_desconto))})` : ''} = ${brl(Number(i.item_total))}`)
  }
  if (Number(p.pedido_desconto)) l.push(`Desconto no pedido: ${brl(Number(p.pedido_desconto))}`)
  if (Number(p.pedido_frete)) l.push(`Frete: ${brl(Number(p.pedido_frete))}`)
  l.push(`TOTAL: ${brl(Number(p.pedido_total))}`)
  return l.join('\n')
}

function Pedidos({ online, setMsg }: { online: boolean; setMsg: SetMsg }) {
  const [ini, setIni] = useState(new Date(Date.now() - 3 * 864e5).toLocaleDateString('en-CA'))
  const [fim, setFim] = useState(hojeISO())
  const [soNovos, setSoNovos] = useState(true)
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [codVe, setCodVe] = useState<Map<string, number>>(new Map())
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [carregando, setCarregando] = useState(false)
  const [aberto, setAberto] = useState<string | null>(null)

  async function buscar() {
    setCarregando(true); setMsg(null)
    let q = supabase.from('vw_exportacao_nfe').select('*')
      .gte('data_pedido', ini + 'T00:00:00-03:00').lte('data_pedido', fim + 'T23:59:59-03:00')
      .in('status', ['pendente', 'confirmado', 'faturado', 'entregue']).order('pedido_numero').order('item')
    if (soNovos) q = q.is('exportado_nfe_em', null)
    const [{ data: d, error }, { data: c }] = await Promise.all([q, supabase.from('vw_ve_codigos').select('*')])
    setCarregando(false)
    if (error) return setMsg({ tipo: 'erro', texto: error.message })
    setCodVe(new Map((c ?? []).map((x: { entidade: string; codigo: string; ve_codigo: number }) => [x.entidade + ':' + x.codigo, x.ve_codigo])))
    // Trocas não vão para nota
    const l = ((d ?? []) as Linha[]).filter((x) => !/troca/i.test(String(x.forma_pagamento ?? '')))
    setLinhas(l)
    setMarcados(new Set())
  }
  useEffect(() => { if (online) void buscar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const pedidos = useMemo(() => {
    const m = new Map<string, Linha[]>()
    for (const l of linhas) m.set(l.pedido_id, [...(m.get(l.pedido_id) ?? []), l])
    return [...m.values()]
  }, [linhas])
  const textoSelecionados = () => pedidos.filter((p) => marcados.has(p[0].pedido_id)).map((p) => montarEspelho(p, codVe)).join('\n\n----------\n\n')

  async function copiar() {
    const t = textoSelecionados()
    if (!t) return
    try { await navigator.clipboard.writeText(t); setMsg({ tipo: 'ok', texto: `Espelho de ${marcados.size} pedido(s) copiado. Cole no VendasExternas ou no WhatsApp.` }) }
    catch { setMsg({ tipo: 'erro', texto: 'Não consegui copiar. Use o botão Compartilhar.' }) }
  }
  async function compartilhar() {
    const t = textoSelecionados()
    if (!t) return
    if (navigator.share) { try { await navigator.share({ text: t }) } catch { /* cancelou */ } }
    else void copiar()
  }
  async function marcarLancados() {
    if (!marcados.size) return
    if (!confirm(`Marcar ${marcados.size} pedido(s) como lançados no VendasExternas? Eles saem da lista "só não lançados".`)) return
    const { error } = await supabase.rpc('marcar_exportado_nfe', { p_ids: [...marcados] })
    if (error) return setMsg({ tipo: 'erro', texto: error.message })
    setMsg({ tipo: 'ok', texto: `${marcados.size} pedido(s) marcados como lançados.` })
    void sincronizarApp(); void buscar()
  }

  const semVe = pedidos.filter((p) => marcados.has(p[0].pedido_id)).some((p) => !codVe.get('cliente:' + p[0].cliente_codigo) || p.some((i) => !codVe.get('produto:' + i.produto_codigo)))

  return (
    <>
      <Aviso tipo="info">A API do VendasExternas ainda não aceita pedido. Selecione as vendas e copie o espelho: ele já traz o código de lá [VE] de cada cliente e produto, para lançar rápido.</Aviso>
      <section className="cartao space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="De"><input type="date" className="campo" value={ini} onChange={(e) => setIni(e.target.value)} /></Campo>
          <Campo rotulo="Até"><input type="date" className="campo" value={fim} onChange={(e) => setFim(e.target.value)} /></Campo>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={soNovos} onChange={(e) => setSoNovos(e.target.checked)} /> Só os ainda não lançados</label>
        <button className="btn-secundario w-full" disabled={!online || carregando} onClick={() => void buscar()}>{carregando ? 'Buscando...' : 'Buscar vendas'}</button>
      </section>

      {semVe && <Aviso tipo="alerta">Algum cliente ou produto selecionado ainda não está ligado ao VendasExternas. Envie os cadastros na aba Cadastros.</Aviso>}

      {pedidos.length > 0 && (
        <section className="cartao p-0">
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={marcados.size === pedidos.length}
              onChange={(e) => setMarcados(e.target.checked ? new Set(pedidos.map((p) => p[0].pedido_id)) : new Set())} /> {marcados.size} de {pedidos.length}</label>
            <b>{brl(pedidos.filter((p) => marcados.has(p[0].pedido_id)).reduce((s, p) => s + Number(p[0].pedido_total), 0))}</b>
          </div>
          <ul className="divide-y divide-stone-100">
            {pedidos.map((itens) => {
              const p = itens[0]
              return (
                <li key={p.pedido_id} className="px-4 py-2 text-sm">
                  <div className="flex items-center gap-3">
                    <input type="checkbox" checked={marcados.has(p.pedido_id)} onChange={(e) => setMarcados((m) => { const n = new Set(m); if (e.target.checked) n.add(p.pedido_id); else n.delete(p.pedido_id); return n })} />
                    <button className="min-w-0 flex-1 text-left" onClick={() => setAberto(aberto === p.pedido_id ? null : p.pedido_id)}>
                      <p className="truncate font-semibold">#{p.pedido_numero} · {p.razao_social}</p>
                      <p className="text-xs text-stone-500">{data(p.data_pedido)} · {itens.length} item(ns) · {p.status}{p.exportado_nfe_em ? ' · já lançado' : ''}</p>
                    </button>
                    <b>{brl(Number(p.pedido_total))}</b>
                  </div>
                  {aberto === p.pedido_id && <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-stone-50 p-2 text-xs">{montarEspelho(itens, codVe)}</pre>}
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {!pedidos.length && !carregando && online && <p className="text-center text-sm text-stone-500">Nenhuma venda no período.</p>}

      <div className="grid grid-cols-2 gap-2">
        <button className="btn-primario" disabled={!marcados.size} onClick={() => void copiar()}><Icone nome="exportar" /> Copiar espelho</button>
        <button className="btn-secundario" disabled={!marcados.size} onClick={() => void compartilhar()}>Compartilhar</button>
      </div>
      <button className="btn-secundario w-full" disabled={!marcados.size} onClick={() => void marcarLancados()}>Marcar como lançados</button>
    </>
  )
}
