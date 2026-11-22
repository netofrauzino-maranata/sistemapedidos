import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Aviso, Cabecalho, Folha, Icone, Vazio } from '../components/ui'
import { db } from '../lib/db'
import { brl, data, hojeISO, num } from '../lib/formato'
import { useClientesMapa, useEmpresa, usePerfisMapa } from '../lib/hooks'
import { cupomCarga, imprimir, lerConfig } from '../lib/impressora'
import { abrirPdf, compartilharPdf, pdfCarga } from '../lib/pdf'
import {
  ehTroca, NOME_RELATORIO, porCliente, rotuloCliente, somarItens, STATUS_CARGA, textoCarga, totaisCarga,
  type DadosCarga, type TipoRelatorioCarga,
} from '../lib/carga'
import { STATUS_COR, STATUS_LABEL, type FormaPagamento } from '../lib/tipos'

// Carga do dia (só gestor): pega os pedidos aprovados do dia, o gestor
// desmarca o que não vai no caminhão e tira a lista de itens, o detalhado
// por cliente e o resumo das vendas, em PDF, na térmica ou em texto.

const ABAS: { id: TipoRelatorioCarga; nome: string }[] = [
  { id: 'vendas', nome: 'Vendas' },
  { id: 'resumo', nome: 'Resumo' },
  { id: 'clientes', nome: 'Por cliente' },
]

const chaveFora = (dia: string) => `maranata-carga-fora-${dia}`
function lerFora(dia: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(chaveFora(dia)) ?? '[]') as string[]) } catch { return new Set() }
}
function gravarFora(dia: string, s: Set<string>) {
  try { localStorage.setItem(chaveFora(dia), JSON.stringify([...s])) } catch { /* sem armazenamento */ }
}
function somarDias(dia: string, n: number) {
  const d = new Date(dia + 'T12:00:00'); d.setDate(d.getDate() + n)
  return d.toLocaleDateString('en-CA')
}

export default function Carga() {
  const [dia, setDia] = useState(hojeISO())
  const [aba, setAba] = useState<TipoRelatorioCarga>('vendas')
  const [vendedor, setVendedor] = useState('')
  const [fora, setFora] = useState<Set<string>>(() => lerFora(hojeISO()))
  const [imprimindo, setImprimindo] = useState(false)
  const [relatorio, setRelatorio] = useState<TipoRelatorioCarga>('resumo')
  const [msg, setMsg] = useState('')
  const clientes = useClientesMapa()
  const perfis = usePerfisMapa()
  const empresa = useEmpresa()
  const formas = useLiveQuery(async () => new Map((await db.formas.toArray()).map((f) => [f.id, f])), []) ?? new Map<string, FormaPagamento>()

  const doDia = useLiveQuery(async () =>
    (await db.pedidos.toArray())
      .filter((p) => (STATUS_CARGA as readonly string[]).includes(p.status) && new Date(p.data_pedido).toLocaleDateString('en-CA') === dia)
      .sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0)),
  [dia]) ?? []

  const vendedores = [...new Set(doDia.map((p) => p.vendedor_id))]
  const listados = vendedor ? doDia.filter((p) => p.vendedor_id === vendedor) : doDia
  const selecionados = listados.filter((p) => !fora.has(p.id))
  const dados: DadosCarga = { titulo: `Carga de ${data(dia)}`, pedidos: selecionados, clientes, formas, perfis, empresa }
  const t = totaisCarga(dados)

  function trocarDia(novo: string) { if (!novo) return; setDia(novo); setFora(lerFora(novo)) }
  function marcar(ids: string[], incluir: boolean) {
    const s = new Set(fora)
    ids.forEach((id) => (incluir ? s.delete(id) : s.add(id)))
    setFora(s); gravarFora(dia, s)
  }

  function abrirImpressao() { setMsg(''); setRelatorio(aba); setImprimindo(true) }
  const nomeArquivo = () => `carga-${dia}-${relatorio}.pdf`
  async function acao(qual: 'ver' | 'pdf' | 'termica' | 'texto') {
    setMsg('')
    try {
      if (qual === 'ver') abrirPdf(pdfCarga(relatorio, dados))
      else if (qual === 'pdf') await compartilharPdf(pdfCarga(relatorio, dados), nomeArquivo(), `${dados.titulo} - ${NOME_RELATORIO[relatorio]}`)
      else if (qual === 'termica') await imprimir(cupomCarga(relatorio, dados, lerConfig()), lerConfig())
      else {
        const texto = textoCarga(relatorio, dados)
        if (navigator.share) { try { await navigator.share({ text: texto }); return } catch (e) { if ((e as Error).name === 'AbortError') return } }
        await navigator.clipboard.writeText(texto); setMsg('Texto copiado. Cole no WhatsApp.')
      }
    } catch (e) { setMsg((e as Error).message) }
  }

  return (
    <>
      <Cabecalho titulo="Carga" voltar="/mais"
        acao={<button className="rounded-full p-2 hover:bg-white/10" aria-label="Imprimir" disabled={!selecionados.length} onClick={abrirImpressao}><Icone nome="impressora" /></button>} />
      <div className="sticky top-[calc(env(safe-area-inset-top)+3.75rem)] z-10 space-y-2 bg-fundo p-4 pb-2">
        <div className="flex items-center gap-2">
          <button className="btn-secundario px-3" aria-label="Dia anterior" onClick={() => trocarDia(somarDias(dia, -1))}><Icone nome="voltar" /></button>
          <input type="date" className="campo text-center font-bold" value={dia} onChange={(e) => trocarDia(e.target.value)} />
          <button className="btn-secundario px-3" aria-label="Próximo dia" onClick={() => trocarDia(somarDias(dia, 1))}><Icone nome="voltar" className="h-5 w-5 rotate-180" /></button>
        </div>
        {vendedores.length > 1 && (
          <select className="campo" value={vendedor} onChange={(e) => setVendedor(e.target.value)}>
            <option value="">Todos os vendedores</option>
            {vendedores.map((id) => <option key={id} value={id}>{perfis.get(id)?.nome ?? 'Vendedor'}</option>)}
          </select>
        )}
        <div className="grid grid-cols-3 overflow-hidden rounded-xl ring-1 ring-stone-300">
          {ABAS.map((a) => (
            <button key={a.id} onClick={() => setAba(a.id)}
              className={'py-2 text-sm font-bold ' + (aba === a.id ? 'bg-marca-700 text-white' : 'bg-white text-stone-600')}>{a.nome}</button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Total rotulo={aba === 'resumo' ? 'Itens' : 'Vendas'} valor={aba === 'resumo' ? String(t.itens) : `${t.vendas}${t.trocas ? ` + ${t.trocas} troca` : ''}`} />
          <Total rotulo="Volumes" valor={num(t.volumes)} />
          <Total rotulo="Vlr. vendas" valor={brl(t.valor)} destaque />
        </div>
      </div>

      <main className="space-y-2 px-4 pb-4">
        {!doDia.length && <Vazio texto="Nenhum pedido aprovado neste dia." />}

        {aba === 'vendas' && !!listados.length && <>
          <div className="flex items-center justify-between text-sm">
            <span className="text-stone-500">{selecionados.length} de {listados.length} pedido(s) na carga</span>
            {selecionados.length === listados.length
              ? <button className="font-semibold text-marca-700" onClick={() => marcar(listados.map((p) => p.id), false)}>Desmarcar todos</button>
              : <button className="font-semibold text-marca-700" onClick={() => marcar(listados.map((p) => p.id), true)}>Marcar todos</button>}
          </div>
          {listados.map((p) => {
            const dentro = !fora.has(p.id)
            const forma = p.forma_pagamento_id ? formas.get(p.forma_pagamento_id)?.nome : ''
            return (
              <label key={p.id} className={'cartao flex cursor-pointer items-center gap-3 p-3 ' + (dentro ? '' : 'opacity-50')}>
                <input type="checkbox" className="h-5 w-5 accent-marca-700" checked={dentro} onChange={(e) => marcar([p.id], e.target.checked)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{rotuloCliente(clientes.get(p.cliente_id))}</p>
                  <p className="text-xs text-stone-500">
                    {forma || 'Sem forma'} · #{p.numero ?? '-'} · {num(p.itens.reduce((s, i) => s + Number(i.quantidade), 0))} vol.
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold">{brl(p.total)}</p>
                  {ehTroca(p, formas)
                    ? <span className="etiqueta bg-amber-100 text-amber-800">Troca</span>
                    : <span className={'etiqueta ' + STATUS_COR[p.status]}>{STATUS_LABEL[p.status]}</span>}
                </div>
              </label>
            )
          })}
        </>}

        {aba === 'resumo' && !!selecionados.length && (
          <ul className="cartao divide-y divide-stone-100 p-0">
            {somarItens(selecionados).map((i) => (
              <li key={i.produto_id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-16 shrink-0 text-right font-bold text-marca-700">{num(i.quantidade)} <span className="text-xs font-normal lowercase text-stone-500">{i.unidade}</span></span>
                <span className="min-w-0 flex-1 text-sm"><span className="text-stone-500">{i.codigo}</span> {i.nome}</span>
              </li>
            ))}
          </ul>
        )}

        {aba === 'clientes' && porCliente(dados).map((g) => (
          <section key={g.cliente?.id ?? g.pedidos[0].id} className="cartao p-0">
            <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-semibold">{rotuloCliente(g.cliente)}</p>
                <p className="text-xs text-stone-500">{g.cliente?.cidade ?? ''} · {g.pedidos.map((p) => '#' + (p.numero ?? '-')).join(', ')}</p>
              </div>
              <p className="shrink-0 font-bold">{brl(g.pedidos.reduce((s, p) => s + Number(p.total), 0))}</p>
            </div>
            <ul className="divide-y divide-stone-50">
              {g.pedidos.flatMap((p) => p.itens).map((i) => (
                <li key={i.id} className="flex gap-3 px-4 py-1.5 text-sm">
                  <span className="w-14 shrink-0 text-right font-bold">{num(i.quantidade)} <span className="text-xs font-normal lowercase text-stone-500">{i.unidade}</span></span>
                  <span className="min-w-0 flex-1"><span className="text-stone-500">{i.produto_codigo}</span> {i.produto_nome}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {!!doDia.length && !selecionados.length && aba !== 'vendas' && <Vazio texto="Nenhum pedido marcado. Marque na aba Vendas." />}
        {!!selecionados.length && (
          <button className="btn-primario w-full" onClick={abrirImpressao}><Icone nome="impressora" /> Imprimir ou enviar</button>
        )}
      </main>

      <Folha aberta={imprimindo} onFechar={() => setImprimindo(false)} titulo="Imprimir carga">
        <div className="space-y-3">
          <div className="space-y-2">
            {(['resumo', 'clientes', 'vendas'] as const).map((r) => (
              <button key={r} type="button" onClick={() => setRelatorio(r)}
                className={'w-full rounded-xl p-3 text-left ring-1 ' + (relatorio === r ? 'bg-marca-700 text-white ring-marca-700' : 'bg-white ring-stone-300')}>
                <span className="block font-bold">{NOME_RELATORIO[r]}</span>
                <span className={'block text-xs ' + (relatorio === r ? 'text-marca-100' : 'text-stone-500')}>
                  {r === 'resumo' ? 'Lista somada de produtos e quantidades para separar.' : r === 'clientes' ? 'Itens de cada cliente, para entregar.' : 'Cada venda com valor e forma de pagamento.'}
                </span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-secundario" onClick={() => void acao('ver')}><Icone nome="pdf" /> Ver PDF</button>
            <button className="btn-secundario" onClick={() => void acao('pdf')}><Icone nome="exportar" /> Enviar PDF</button>
            <button className="btn-secundario" onClick={() => void acao('termica')}><Icone nome="impressora" /> Térmica</button>
            <button className="btn-secundario" onClick={() => void acao('texto')}><Icone nome="whatsapp" /> Enviar texto</button>
          </div>
          {msg && <Aviso tipo={msg.startsWith('Texto') ? 'ok' : 'erro'}>{msg}</Aviso>}
          <p className="text-xs text-stone-500">{t.pedidos} pedido(s) · {t.clientes} cliente(s) · {t.itens} item(ns) · {num(t.volumes)} volume(s)</p>
        </div>
      </Folha>
    </>
  )
}

function Total({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className={'rounded-xl px-2 py-1.5 ' + (destaque ? 'bg-marca-700 text-white' : 'bg-white ring-1 ring-stone-200')}>
      <p className={'text-[11px] ' + (destaque ? 'text-marca-100' : 'text-stone-500')}>{rotulo}</p>
      <p className="truncate text-sm font-bold">{valor}</p>
    </div>
  )
}
