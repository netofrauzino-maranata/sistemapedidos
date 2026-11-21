import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Busca, Icone } from '../components/ui'
import { db, formasForaDeVenda } from '../lib/db'
import { brl, data, docFormatado, foneFormatado, normalizar, num } from '../lib/formato'
import { nomeCliente, useEmpresa } from '../lib/hooks'
import { pdfRelatorio, type LinhaRelatorio } from '../lib/pdf'
import { supabase } from '../lib/supabase'
import type { Cliente, Pedido, Produto } from '../lib/tipos'
import { BotoesPdf } from './RelatoriosExtras'

// Relatórios de cadastro: clientes (cadastro + compras) e fornecedores
// (cadastro + entradas de mercadoria). Lista geral e ficha de cada um, com PDF.

interface Filtro { ini: string; fim: string; periodo: string }
const STATUS_VENDA = ['pendente', 'confirmado', 'faturado', 'entregue']
const noPeriodo = (iso: string, f: Filtro) => { const d = new Date(iso).toLocaleDateString('en-CA'); return d >= f.ini && d <= f.fim }
const qtdItens = (p: Pedido) => p.itens.reduce((s, i) => s + Number(i.quantidade), 0)
const endereco = (c: Cliente) => [c.logradouro && `${c.logradouro}, ${c.numero || 's/n'}${c.complemento ? ' ' + c.complemento : ''}`, c.bairro].filter(Boolean).join(' · ')

function Cartao({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className={destaque ? 'rounded-xl bg-marca-700 p-2 text-center text-white' : 'cartao p-2 text-center'}>
      <p className={'text-[11px] ' + (destaque ? 'text-marca-100' : 'text-stone-500')}>{rotulo}</p>
      <p className="truncate font-bold">{valor}</p>
    </div>
  )
}

// ================= CLIENTES =================
export function RelClientes(f: Filtro & { vendedor: string }) {
  const empresa = useEmpresa()
  const [q, setQ] = useState('')
  const [ordem, setOrdem] = useState<'valor' | 'nome'>('valor')
  const [sel, setSel] = useState<string | null>(null)
  const d = useLiveQuery(async () => {
    const [clientes, pedidos, perfis, formas, condicoes, tabelas] = await Promise.all([
      db.clientes.toArray(), db.pedidos.toArray(), db.perfis.toArray(), db.formas.toArray(), db.condicoes.toArray(), db.tabelasPreco.toArray(),
    ])
    const fora = await formasForaDeVenda()
    const vendas = pedidos.filter((p) => STATUS_VENDA.includes(p.status))
    return {
      clientes, vendas, fora,
      perfis: new Map(perfis.map((p) => [p.id, p.nome])), formas: new Map(formas.map((x) => [x.id, x.nome])),
      condicoes: new Map(condicoes.map((x) => [x.id, x.nome])), tabelas: new Map(tabelas.map((x) => [x.id, x.nome])),
    }
  }, [])
  if (!d) return null

  const resumoDe = (id: string) => {
    const todas = d.vendas.filter((p) => p.cliente_id === id && !d.fora.has(p.forma_pagamento_id ?? ''))
    const per = todas.filter((p) => noPeriodo(p.data_pedido, f))
    const ultima = todas.reduce<string | null>((u, p) => (!u || p.data_pedido > u ? p.data_pedido : u), null)
    return { per, qtd: per.length, valor: per.reduce((s, p) => s + p.total, 0), volumes: per.reduce((s, p) => s + qtdItens(p), 0), ultima, historico: todas.reduce((s, p) => s + p.total, 0) }
  }

  if (sel) {
    const c = d.clientes.find((x) => x.id === sel)
    if (c) return <FichaCliente c={c} d={d} f={f} voltar={() => setSel(null)} />
  }

  const t = normalizar(q)
  const lista = d.clientes
    .filter((c) => c.ativo && (!f.vendedor || c.vendedor_id === f.vendedor))
    .filter((c) => !t || normalizar(`${c.codigo ?? ''} ${c.razao_social} ${c.nome_fantasia ?? ''} ${c.cidade ?? ''} ${c.cpf_cnpj ?? ''}`).includes(t))
    .map((c) => ({ c, r: resumoDe(c.id) }))
    .sort((a, b) => (ordem === 'valor' ? b.r.valor - a.r.valor : 0) || nomeCliente(a.c).localeCompare(nomeCliente(b.c)))
  const total = lista.reduce((s, x) => s + x.r.valor, 0)
  const compraram = lista.filter((x) => x.r.qtd > 0).length

  const gerar = () => pdfRelatorio({
    empresa, titulo: 'Relatório de clientes', subtitulo: f.periodo + (f.vendedor ? ` · ${d.perfis.get(f.vendedor) ?? ''}` : ''),
    cabecalho: ['Cód.', 'Cliente', 'Cidade', 'Telefone', 'Forma', 'Última compra', 'Compras', 'Valor'],
    linhas: lista.map(({ c, r }) => [c.codigo ? String(c.codigo) : '', nomeCliente(c), c.cidade ?? '', foneFormatado(c.whatsapp || c.telefone), c.forma_pagamento_id ? d.formas.get(c.forma_pagamento_id) ?? '' : '', r.ultima ? data(r.ultima) : 'nunca', String(r.qtd), brl(r.valor)]),
    direita: [6, 7], larguras: { 0: 11, 2: 24, 3: 26, 4: 18, 5: 20, 6: 15, 7: 22 },
    totais: [['Clientes', String(lista.length)], ['Compraram', String(compraram)], ['Sem compra', String(lista.length - compraram)], ['Valor vendido', brl(total)]],
    nota: 'Compras e valor no período escolhido. Trocas não entram.',
  })

  return (
    <div className="space-y-3">
      <Busca valor={q} onChange={setQ} placeholder="Nome, código, cidade ou CNPJ" />
      <div className="flex items-center justify-between text-sm">
        <span className="text-stone-500">{lista.length} cliente(s) · toque para ver a ficha</span>
        <button className="font-semibold text-marca-700" onClick={() => setOrdem(ordem === 'valor' ? 'nome' : 'valor')}>Ordem: {ordem === 'valor' ? 'maior compra' : 'nome'}</button>
      </div>
      <div className="grid grid-cols-3 gap-2"><Cartao rotulo="Clientes" valor={String(lista.length)} /><Cartao rotulo="Compraram" valor={String(compraram)} /><Cartao rotulo="Vendido" valor={brl(total)} destaque /></div>
      <ul className="cartao divide-y divide-stone-100 p-0">
        {lista.map(({ c, r }) => (
          <li key={c.id}>
            <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm" onClick={() => setSel(c.id)}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{c.codigo ? <span className="font-normal text-stone-500">{c.codigo} </span> : null}{nomeCliente(c)}</p>
                <p className="text-xs text-stone-500">{c.cidade ?? 'Sem cidade'} · {r.ultima ? `última compra ${data(r.ultima)}` : 'nunca comprou'}</p>
              </div>
              <div className="text-right"><p className="font-bold">{brl(r.valor)}</p><p className="text-xs text-stone-500">{r.qtd} compra(s)</p></div>
            </button>
          </li>
        ))}
      </ul>
      {!!lista.length && <BotoesPdf gerar={gerar} arquivo="relatorio-clientes.pdf" />}
    </div>
  )
}

type DadosCli = {
  vendas: Pedido[]; fora: Set<string>; perfis: Map<string, string>; formas: Map<string, string>; condicoes: Map<string, string>; tabelas: Map<string, string>
}

function FichaCliente({ c, d, f, voltar }: { c: Cliente; d: DadosCli; f: Filtro; voltar: () => void }) {
  const empresa = useEmpresa()
  const [aberto, setAberto] = useState<string | null>(null)
  const produtos = useLiveQuery(async () => new Map((await db.produtos.toArray()).map((p) => [p.id, p])), []) ?? new Map<string, Produto>()
  const todas = d.vendas.filter((p) => p.cliente_id === c.id).sort((a, b) => b.data_pedido.localeCompare(a.data_pedido))
  const ehTroca = (p: Pedido) => d.fora.has(p.forma_pagamento_id ?? '')
  const doPeriodo = todas.filter((p) => noPeriodo(p.data_pedido, f))
  const vendas = doPeriodo.filter((p) => !ehTroca(p))
  const valor = vendas.reduce((s, p) => s + p.total, 0)
  const historico = todas.filter((p) => !ehTroca(p))
  const primeira = historico.at(-1)?.data_pedido, ultima = historico[0]?.data_pedido
  const top = new Map<string, { nome: string; codigo: string; un: string; qtd: number; total: number }>()
  vendas.forEach((p) => p.itens.forEach((i) => {
    const pr = produtos.get(i.produto_id)
    const x = top.get(i.produto_id) ?? { nome: pr?.nome ?? i.produto_nome ?? '', codigo: pr?.codigo ?? i.produto_codigo ?? '', un: pr?.unidade ?? i.unidade ?? '', qtd: 0, total: 0 }
    x.qtd += Number(i.quantidade); x.total += Number(i.total); top.set(i.produto_id, x)
  }))
  const maisComprados = [...top.values()].sort((a, b) => b.total - a.total)

  const info: [string, string][] = [
    ['Razão social', c.razao_social], ['Fantasia', c.nome_fantasia ?? ''],
    ['Código', c.codigo ? String(c.codigo) : ''], [c.tipo_pessoa === 'F' ? 'CPF' : 'CNPJ', docFormatado(c.cpf_cnpj)],
    ['IE', c.ie ?? (c.indicador_ie === 9 ? 'Não contribuinte' : '')], ['Contato', c.contato ?? ''],
    ['Telefone', foneFormatado(c.telefone)], ['WhatsApp', foneFormatado(c.whatsapp)],
    ['E-mail', c.email ?? ''], ['Endereço', endereco(c)],
    ['Cidade', [c.cidade, c.uf].filter(Boolean).join('/')], ['CEP', c.cep ?? ''],
    ['Vendedor', c.vendedor_id ? d.perfis.get(c.vendedor_id) ?? '' : ''], ['Tabela de preço', c.tabela_preco_id ? d.tabelas.get(c.tabela_preco_id) ?? '' : 'Padrão'],
    ['Forma', c.forma_pagamento_id ? d.formas.get(c.forma_pagamento_id) ?? '' : ''], ['Condição', c.condicao_pagamento_id ? d.condicoes.get(c.condicao_pagamento_id) ?? '' : ''],
    ['Limite de crédito', c.limite_credito ? brl(c.limite_credito) : ''], ['Situação', c.ativo ? 'Ativo' : 'Inativo'],
    ['Primeira compra', primeira ? data(primeira) : ''], ['Última compra', ultima ? data(ultima) : 'nunca'],
    ['Total histórico', brl(historico.reduce((s, p) => s + p.total, 0))], ['Compras no histórico', String(historico.length)],
    ...(c.observacao ? [['Observação', c.observacao] as [string, string]] : []),
  ]

  function gerar() {
    const linhas: LinhaRelatorio[] = []
    for (const p of doPeriodo) {
      linhas.push({ grupo: [`Pedido #${p.numero ?? '-'} · ${data(p.data_pedido)} · ${(p.forma_pagamento_id && d.formas.get(p.forma_pagamento_id)) || ''}${ehTroca(p) ? ' (troca)' : ''}`, '', num(qtdItens(p)), '', brl(p.total)] })
      for (const i of p.itens) linhas.push([`   ${i.produto_codigo ?? ''} ${i.produto_nome ?? ''}`, i.unidade ?? '', num(i.quantidade), brl(i.preco_unitario), brl(i.total)])
    }
    return pdfRelatorio({
      empresa, titulo: 'Ficha do cliente', subtitulo: `${nomeCliente(c)} · ${f.periodo}`, info: info.filter(([, v]) => v),
      cabecalho: ['Compras no período / produto', 'Un', 'Qtd', 'Preço', 'Valor'], linhas,
      direita: [2, 3, 4], larguras: { 1: 12, 2: 16, 3: 22, 4: 24 },
      totais: [['Compras', String(vendas.length)], ['Volumes', num(vendas.reduce((s, p) => s + qtdItens(p), 0))], ['Ticket médio', brl(vendas.length ? valor / vendas.length : 0)], ['Valor no período', brl(valor)]],
      nota: doPeriodo.length > vendas.length ? 'Trocas aparecem na lista mas não somam no valor.' : undefined,
    })
  }

  return (
    <div className="space-y-3">
      <button className="flex items-center gap-1 text-sm font-semibold text-marca-700" onClick={voltar}><Icone nome="voltar" className="h-4 w-4" /> Todos os clientes</button>
      <section className="cartao space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-lg font-bold leading-tight">{nomeCliente(c)}</p>
            {c.nome_fantasia && <p className="text-sm text-stone-500">{c.razao_social}</p>}
          </div>
          <Link to={`/clientes/${c.id}`} className="shrink-0 text-sm font-semibold text-marca-700">Cadastro</Link>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 pt-2 text-sm">
          {info.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className={k === 'Endereço' || k === 'Observação' || k === 'Razão social' ? 'col-span-2' : ''}>
              <dt className="text-[11px] text-stone-500">{k}</dt><dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <div className="grid grid-cols-3 gap-2"><Cartao rotulo="Compras" valor={String(vendas.length)} /><Cartao rotulo="Ticket médio" valor={brl(vendas.length ? valor / vendas.length : 0)} /><Cartao rotulo="No período" valor={brl(valor)} destaque /></div>

      {!!maisComprados.length && (
        <section className="cartao">
          <h2 className="mb-1 font-bold">Mais comprados no período</h2>
          <ul className="divide-y divide-stone-100 text-sm">
            {maisComprados.slice(0, 10).map((x) => (
              <li key={x.codigo + x.nome} className="flex justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate"><span className="text-stone-500">{x.codigo}</span> {x.nome}</span>
                <span className="shrink-0">{num(x.qtd)} {x.un.toLowerCase()} · <b>{brl(x.total)}</b></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="cartao p-0">
        <h2 className="px-4 pt-3 font-bold">Compras no período</h2>
        {!doPeriodo.length && <p className="p-6 text-center text-sm text-stone-500">Nenhuma compra no período.</p>}
        <ul className="divide-y divide-stone-100">
          {doPeriodo.map((p) => (
            <li key={p.id}>
              <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm" onClick={() => setAberto(aberto === p.id ? null : p.id)}>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">#{p.numero ?? '-'} · {data(p.data_pedido)}</p>
                  <p className="text-xs text-stone-500">{(p.forma_pagamento_id && d.formas.get(p.forma_pagamento_id)) || 'Sem forma'} · {p.itens.length} produto(s){ehTroca(p) ? ' · troca' : ''}</p>
                </div>
                <b className={ehTroca(p) ? 'text-stone-400' : ''}>{brl(p.total)}</b>
              </button>
              {aberto === p.id && (
                <ul className="border-t border-stone-100 bg-stone-50">
                  {p.itens.map((i) => (
                    <li key={i.id} className="flex gap-3 px-6 py-1.5 text-xs">
                      <span className="min-w-0 flex-1 truncate">{num(i.quantidade)} {(i.unidade ?? '').toLowerCase()} · {i.produto_nome}</span>
                      <b>{brl(i.total)}</b>
                    </li>
                  ))}
                  <li className="px-6 py-1.5 text-right text-xs"><Link to={`/pedidos/${p.id}`} className="font-semibold text-marca-700">Abrir pedido</Link></li>
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>
      <BotoesPdf gerar={gerar} arquivo={`ficha-cliente-${c.codigo ?? c.id.slice(0, 6)}.pdf`} />
    </div>
  )
}

// ================= FORNECEDORES =================
interface Forn { id: string; nome: string; cpf_cnpj: string | null; ie: string | null; telefone: string | null; email: string | null; cidade: string | null; uf: string | null; observacao: string | null; ativo: boolean }
interface EntradaF {
  id: string; numero: number; data_entrada: string; tipo: string; numero_nota: string | null; total: number; fornecedor_id: string | null
  entrada_itens: { id: string; produto_id: string; quantidade: number; custo_unitario: number; total: number; lotes: { numero: string; data_validade: string | null } | null }[]
}

export function RelFornecedores(f: Filtro) {
  const empresa = useEmpresa()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [dados, setDados] = useState<{ forn: Forn[]; entradas: EntradaF[] } | null>(null)
  const [erro, setErro] = useState('')
  const produtos = useLiveQuery(async () => new Map((await db.produtos.toArray()).map((p) => [p.id, p])), []) ?? new Map<string, Produto>()

  useEffect(() => {
    let vivo = true
    setErro(''); setDados(null)
    void Promise.all([
      supabase.from('fornecedores').select('*').order('nome'),
      supabase.from('entradas').select('id, numero, data_entrada, tipo, numero_nota, total, fornecedor_id, entrada_itens(id, produto_id, quantidade, custo_unitario, total, lotes(numero, data_validade))')
        .gte('data_entrada', f.ini).lte('data_entrada', f.fim).order('data_entrada', { ascending: false }),
    ]).then(([a, b]) => {
      if (!vivo) return
      const e = a.error ?? b.error
      if (e) return setErro(navigator.onLine ? e.message : 'Sem internet. Este relatório precisa de conexão.')
      setDados({ forn: (a.data ?? []) as Forn[], entradas: (b.data ?? []) as unknown as EntradaF[] })
    })
    return () => { vivo = false }
  }, [f.ini, f.fim])

  if (erro) return <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">{erro}</p>
  if (!dados) return <p className="text-center text-sm text-stone-500">Carregando...</p>

  const doForn = (id: string | null) => dados.entradas.filter((e) => e.fornecedor_id === id)
  const resumo = (es: EntradaF[]) => ({ qtd: es.length, unidades: es.reduce((s, e) => s + e.entrada_itens.reduce((x, i) => x + Number(i.quantidade), 0), 0), valor: es.reduce((s, e) => s + Number(e.total), 0) })

  if (sel) {
    const fo = sel === 'sem' ? null : dados.forn.find((x) => x.id === sel)
    return <FichaFornecedor fo={fo ?? null} entradas={doForn(sel === 'sem' ? null : sel)} produtos={produtos} f={f} voltar={() => setSel(null)} />
  }

  const t = normalizar(q)
  const lista = dados.forn.filter((x) => !t || normalizar(`${x.nome} ${x.cpf_cnpj ?? ''} ${x.cidade ?? ''}`).includes(t))
    .map((x) => ({ x, r: resumo(doForn(x.id)) })).sort((a, b) => b.r.valor - a.r.valor || a.x.nome.localeCompare(b.x.nome))
  const semForn = resumo(doForn(null))
  const total = resumo(dados.entradas)

  const gerar = () => pdfRelatorio({
    empresa, titulo: 'Relatório de fornecedores', subtitulo: f.periodo,
    cabecalho: ['Fornecedor', 'CNPJ/CPF', 'Cidade', 'Telefone', 'Entradas', 'Unidades', 'Valor'],
    linhas: [...lista.map(({ x, r }) => [x.nome, docFormatado(x.cpf_cnpj), [x.cidade, x.uf].filter(Boolean).join('/'), foneFormatado(x.telefone), String(r.qtd), num(r.unidades), brl(r.valor)]),
      ...(semForn.qtd ? [['Sem fornecedor informado', '', '', '', String(semForn.qtd), num(semForn.unidades), brl(semForn.valor)]] : [])],
    direita: [4, 5, 6], larguras: { 1: 32, 2: 26, 3: 26, 4: 16, 5: 18, 6: 24 },
    totais: [['Fornecedores', String(lista.length)], ['Entradas', String(total.qtd)], ['Unidades', num(total.unidades)], ['Valor comprado', brl(total.valor)]],
    nota: 'Entradas e valores no período escolhido.',
  })

  return (
    <div className="space-y-3">
      <Busca valor={q} onChange={setQ} placeholder="Nome, CNPJ ou cidade" />
      <div className="grid grid-cols-3 gap-2"><Cartao rotulo="Fornecedores" valor={String(lista.length)} /><Cartao rotulo="Entradas" valor={String(total.qtd)} /><Cartao rotulo="Comprado" valor={brl(total.valor)} destaque /></div>
      <ul className="cartao divide-y divide-stone-100 p-0">
        {lista.map(({ x, r }) => (
          <li key={x.id}>
            <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm" onClick={() => setSel(x.id)}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{x.nome}</p>
                <p className="text-xs text-stone-500">{[x.cidade, x.uf].filter(Boolean).join('/') || 'Sem cidade'} · {r.qtd} entrada(s)</p>
              </div>
              <b>{brl(r.valor)}</b>
            </button>
          </li>
        ))}
        {semForn.qtd > 0 && (
          <li><button className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm" onClick={() => setSel('sem')}>
            <div className="min-w-0 flex-1"><p className="font-semibold text-stone-500">Sem fornecedor informado</p><p className="text-xs text-stone-500">{semForn.qtd} entrada(s)</p></div>
            <b>{brl(semForn.valor)}</b>
          </button></li>
        )}
        {!lista.length && !semForn.qtd && <li className="p-6 text-center text-sm text-stone-500">Nenhum fornecedor cadastrado. Eles são criados na Entrada de mercadoria.</li>}
      </ul>
      {(!!lista.length || semForn.qtd > 0) && <BotoesPdf gerar={gerar} arquivo="relatorio-fornecedores.pdf" />}
    </div>
  )
}

function FichaFornecedor({ fo, entradas, produtos, f, voltar }: { fo: Forn | null; entradas: EntradaF[]; produtos: Map<string, Produto>; f: Filtro; voltar: () => void }) {
  const empresa = useEmpresa()
  const [aberto, setAberto] = useState<string | null>(null)
  const nome = fo?.nome ?? 'Sem fornecedor informado'
  const valor = entradas.reduce((s, e) => s + Number(e.total), 0)
  const unidades = entradas.reduce((s, e) => s + e.entrada_itens.reduce((x, i) => x + Number(i.quantidade), 0), 0)
  const info: [string, string][] = fo ? [
    ['Nome', fo.nome], ['CNPJ/CPF', docFormatado(fo.cpf_cnpj)], ['IE', fo.ie ?? ''], ['Telefone', foneFormatado(fo.telefone)],
    ['E-mail', fo.email ?? ''], ['Cidade', [fo.cidade, fo.uf].filter(Boolean).join('/')], ['Situação', fo.ativo ? 'Ativo' : 'Inativo'],
    ...(fo.observacao ? [['Observação', fo.observacao] as [string, string]] : []),
  ] : []
  const prod = (id: string) => produtos.get(id)

  function gerar() {
    const linhas: LinhaRelatorio[] = []
    for (const e of entradas) {
      linhas.push({ grupo: [`Entrada #${e.numero} · ${data(e.data_entrada)}${e.numero_nota ? ' · NF ' + e.numero_nota : ''}`, '', '', '', brl(e.total)] })
      for (const i of e.entrada_itens) {
        const p = prod(i.produto_id)
        linhas.push([`   ${p?.codigo ?? ''} ${p?.nome ?? 'Produto'}${i.lotes?.data_validade ? ` (val. ${data(i.lotes.data_validade)})` : ''}`, p?.unidade ?? '', num(i.quantidade), brl(i.custo_unitario), brl(i.total)])
      }
    }
    return pdfRelatorio({
      empresa, titulo: 'Ficha do fornecedor', subtitulo: `${nome} · ${f.periodo}`, info: info.filter(([, v]) => v),
      cabecalho: ['Entradas no período / produto', 'Un', 'Qtd', 'Custo', 'Valor'], linhas,
      direita: [2, 3, 4], larguras: { 1: 12, 2: 16, 3: 22, 4: 24 },
      totais: [['Entradas', String(entradas.length)], ['Unidades', num(unidades)], ['Valor comprado', brl(valor)]],
    })
  }

  return (
    <div className="space-y-3">
      <button className="flex items-center gap-1 text-sm font-semibold text-marca-700" onClick={voltar}><Icone nome="voltar" className="h-4 w-4" /> Todos os fornecedores</button>
      <section className="cartao">
        <p className="text-lg font-bold">{nome}</p>
        {!!info.length && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 pt-2 text-sm">
            {info.filter(([k, v]) => v && k !== 'Nome').map(([k, v]) => (
              <div key={k} className={k === 'Observação' ? 'col-span-2' : ''}><dt className="text-[11px] text-stone-500">{k}</dt><dd className="font-medium">{v}</dd></div>
            ))}
          </dl>
        )}
      </section>
      <div className="grid grid-cols-3 gap-2"><Cartao rotulo="Entradas" valor={String(entradas.length)} /><Cartao rotulo="Unidades" valor={num(unidades)} /><Cartao rotulo="Comprado" valor={brl(valor)} destaque /></div>
      <section className="cartao p-0">
        <h2 className="px-4 pt-3 font-bold">Entradas no período</h2>
        {!entradas.length && <p className="p-6 text-center text-sm text-stone-500">Nenhuma entrada no período.</p>}
        <ul className="divide-y divide-stone-100">
          {entradas.map((e) => (
            <li key={e.id}>
              <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm" onClick={() => setAberto(aberto === e.id ? null : e.id)}>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Entrada #{e.numero} · {data(e.data_entrada)}</p>
                  <p className="text-xs text-stone-500">{e.entrada_itens.length} produto(s){e.numero_nota ? ` · NF ${e.numero_nota}` : ''}</p>
                </div>
                <b>{brl(e.total)}</b>
              </button>
              {aberto === e.id && (
                <ul className="border-t border-stone-100 bg-stone-50">
                  {e.entrada_itens.map((i) => (
                    <li key={i.id} className="flex gap-3 px-6 py-1.5 text-xs">
                      <span className="min-w-0 flex-1 truncate">{num(i.quantidade)} {(prod(i.produto_id)?.unidade ?? '').toLowerCase()} · {prod(i.produto_id)?.nome ?? 'Produto'}{i.lotes?.data_validade ? ` · val. ${data(i.lotes.data_validade)}` : ''}</span>
                      <b>{brl(i.total)}</b>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>
      <BotoesPdf gerar={gerar} arquivo={`ficha-fornecedor-${nome.slice(0, 20).replace(/\W+/g, '-')}.pdf`} />
    </div>
  )
}
