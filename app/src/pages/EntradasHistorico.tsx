import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useOnline } from '../components/Layout'
import { Aviso, Busca, Cabecalho, Icone, Vazio } from '../components/ui'
import { brl, data, dataHora, hojeISO, normalizar, num } from '../lib/formato'
import { useProdutosMapa, usePerfisMapa } from '../lib/hooks'
import { supabase } from '../lib/supabase'

// Histórico das entradas de mercadoria (só gestor), para conferência:
// quando foi lançada, por quem, quais itens, quantidades, lote e validade.
// Lê direto do servidor (precisa de internet).

interface ItemHist { id: string; produto_id: string; quantidade: number; custo_unitario: number; total: number; lotes: { numero: string; data_validade: string | null } | null }
interface EntradaHist {
  id: string; numero: number; data_entrada: string; tipo: string; numero_nota: string | null; observacao: string | null
  total: number; usuario_id: string | null; criado_em: string
  fornecedores: { nome: string } | null
  entrada_itens: ItemHist[]
}

const TIPO: Record<string, string> = { compra: 'Compra', bonificacao: 'Bonificação', devolucao: 'Devolução de cliente', outros: 'Outros' }

function diasAtras(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n)
  return d.toLocaleDateString('en-CA')
}

export default function EntradasHistorico() {
  const online = useOnline()
  const [params] = useSearchParams()
  const nova = params.get('nova')
  const [de, setDe] = useState(diasAtras(30))
  const [ate, setAte] = useState(hojeISO())
  const [q, setQ] = useState('')
  const [lista, setLista] = useState<EntradaHist[] | null>(null)
  const [erro, setErro] = useState('')
  const [aberta, setAberta] = useState<string | null>(nova)
  const produtos = useProdutosMapa()
  const perfis = usePerfisMapa()

  useEffect(() => {
    let ativo = true
    setErro('')
    void supabase.from('entradas')
      .select('id, numero, data_entrada, tipo, numero_nota, observacao, total, usuario_id, criado_em, fornecedores(nome), entrada_itens(id, produto_id, quantidade, custo_unitario, total, lotes(numero, data_validade))')
      .gte('data_entrada', de).lte('data_entrada', ate)
      .order('data_entrada', { ascending: false }).order('criado_em', { ascending: false })
      .then(({ data: d, error }) => {
        if (!ativo) return
        if (error) setErro(online ? error.message : 'Sem internet. O histórico de entradas precisa de conexão.')
        else setLista((d ?? []) as unknown as EntradaHist[])
      })
    return () => { ativo = false }
  }, [de, ate, online])

  const t = normalizar(q)
  const nomeProd = (id: string) => produtos.get(id)
  const visiveis = (lista ?? []).filter((e) => !t || e.entrada_itens.some((i) => {
    const p = nomeProd(i.produto_id)
    return normalizar(`${p?.codigo} ${p?.nome}`).includes(t)
  }) || normalizar(`${e.numero} ${e.numero_nota ?? ''} ${e.fornecedores?.nome ?? ''}`).includes(t))
  const qtdTotal = visiveis.reduce((s, e) => s + e.entrada_itens.reduce((x, i) => x + Number(i.quantidade), 0), 0)

  return (
    <>
      <Cabecalho titulo="Histórico de entradas" voltar="/estoque"
        acao={<Link to="/estoque/entrada" className="btn bg-destaque px-3 py-1.5 text-sm text-stone-900"><Icone nome="mais" className="h-4 w-4" /> Nova</Link>} />
      <main className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-stone-500">De<input type="date" className="campo" value={de} onChange={(e) => e.target.value && setDe(e.target.value)} /></label>
          <label className="text-xs text-stone-500">Até<input type="date" className="campo" value={ate} onChange={(e) => e.target.value && setAte(e.target.value)} /></label>
        </div>
        <Busca valor={q} onChange={setQ} placeholder="Produto, fornecedor ou nº da nota" />
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {lista && <p className="text-xs text-stone-500">{visiveis.length} entrada(s) · {num(qtdTotal)} unidade(s) · {brl(visiveis.reduce((s, e) => s + Number(e.total), 0))}</p>}
        {!lista && !erro && <p className="text-center text-sm text-stone-500">Carregando...</p>}
        {lista && !visiveis.length && <Vazio texto="Nenhuma entrada neste período." />}

        {visiveis.map((e) => {
          const qtd = e.entrada_itens.reduce((s, i) => s + Number(i.quantidade), 0)
          const abrir = aberta === e.id
          return (
            <section key={e.id} className={'cartao p-0 ' + (nova === e.id ? 'ring-2 ring-marca-500' : '')}>
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setAberta(abrir ? null : e.id)}>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Entrada #{e.numero} · {data(e.data_entrada)}</p>
                  <p className="truncate text-xs text-stone-500">
                    {TIPO[e.tipo] ?? e.tipo}{e.fornecedores?.nome ? ` · ${e.fornecedores.nome}` : ''}{e.numero_nota ? ` · NF ${e.numero_nota}` : ''}
                  </p>
                  <p className="text-xs text-stone-500">{e.entrada_itens.length} produto(s) · {num(qtd)} un.</p>
                </div>
                <div className="text-right">
                  <p className="font-bold">{brl(e.total)}</p>
                  <Icone nome="voltar" className={'ml-auto h-4 w-4 text-stone-400 transition ' + (abrir ? 'rotate-90' : '-rotate-90')} />
                </div>
              </button>
              {abrir && (
                <div className="border-t border-stone-100 px-4 pb-3">
                  <p className="py-2 text-xs text-stone-500">
                    Lançada em {dataHora(e.criado_em)}{e.usuario_id && perfis.get(e.usuario_id) ? ` por ${perfis.get(e.usuario_id)!.nome}` : ''}
                    {e.observacao ? ` · ${e.observacao}` : ''}
                  </p>
                  <ul className="divide-y divide-stone-100">
                    {e.entrada_itens.map((i) => {
                      const p = nomeProd(i.produto_id)
                      const lote = i.lotes && !['SEM-LOTE'].includes(i.lotes.numero) && !i.lotes.numero.startsWith('VAL-') ? i.lotes.numero : ''
                      return (
                        <li key={i.id} className="flex gap-3 py-2 text-sm">
                          <span className="w-14 shrink-0 text-right font-bold text-marca-700">{num(i.quantidade)} <span className="text-xs font-normal lowercase text-stone-500">{p?.unidade}</span></span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate"><span className="text-stone-500">{p?.codigo}</span> {p?.nome ?? 'Produto'}</p>
                            <p className="text-xs text-stone-500">
                              {[lote && `Lote ${lote}`, i.lotes?.data_validade && `Validade ${data(i.lotes.data_validade)}`, `Custo ${brl(i.custo_unitario)}`].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                          <span className="shrink-0 text-sm">{brl(i.total)}</span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </section>
          )
        })}
      </main>
    </>
  )
}
