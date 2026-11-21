import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useOnline } from '../components/Layout'
import { Aviso, Busca, Cabecalho, Campo, Folha, Icone } from '../components/ui'
import { db } from '../lib/db'
import { arred, brl, hojeISO, normalizar, num, uuid } from '../lib/formato'
import { supabase } from '../lib/supabase'
import { sincronizar } from '../lib/sync'
import type { Fornecedor, Produto } from '../lib/tipos'

interface ItemEntrada { chave: string; produto: Produto; lote: string; data_validade: string; data_fabricacao: string; quantidade: string; custo_unitario: string }

export default function Entrada() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const online = useOnline()
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [fornecedor, setFornecedor] = useState('')
  const [novoForn, setNovoForn] = useState('')
  const [tipo, setTipo] = useState('compra')
  const [dataEntrada, setDataEntrada] = useState(hojeISO())
  const [nota, setNota] = useState('')
  const [obs, setObs] = useState('')
  const [itens, setItens] = useState<ItemEntrada[]>([])
  const [escolher, setEscolher] = useState(false)
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState<{ tipo: 'erro' | 'ok'; texto: string } | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [idEntrada] = useState(uuid())

  useEffect(() => {
    void supabase.from('fornecedores').select('*').eq('ativo', true).order('nome').then(({ data }) => setFornecedores((data ?? []) as Fornecedor[]))
  }, [])

  // entrada aberta a partir da tela do produto
  useEffect(() => {
    const pid = params.get('produto')
    if (pid) void db.produtos.get(pid).then((p) => p && adicionar(p))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const produtos = useLiveQuery(async () => {
    const t = normalizar(q)
    return (await db.produtos.filter((p) => p.ativo).toArray())
      .filter((p) => !t || normalizar(`${p.codigo} ${p.nome} ${p.gtin}`).includes(t))
      .sort((a, b) => a.nome.localeCompare(b.nome)).slice(0, 60)
  }, [q]) ?? []

  function adicionar(p: Produto) {
    setItens((x) => [...x, { chave: uuid(), produto: p, lote: '', data_validade: '', data_fabricacao: '', quantidade: '', custo_unitario: p.preco_custo ? String(p.preco_custo) : '' }])
    setEscolher(false); setQ('')
  }
  const atualizar = (chave: string, parcial: Partial<ItemEntrada>) => setItens((x) => x.map((i) => (i.chave === chave ? { ...i, ...parcial } : i)))
  const n = (s: string) => Number(s.replace(',', '.')) || 0
  const total = arred(itens.reduce((s, i) => s + n(i.quantidade) * n(i.custo_unitario), 0))

  async function criarFornecedor() {
    if (!novoForn.trim()) return
    const { data, error } = await supabase.from('fornecedores').insert({ nome: novoForn.trim() }).select().single()
    if (error) return setMsg({ tipo: 'erro', texto: error.message })
    setFornecedores((f) => [...f, data as Fornecedor].sort((a, b) => a.nome.localeCompare(b.nome)))
    setFornecedor((data as Fornecedor).id); setNovoForn('')
  }

  async function salvar() {
    setMsg(null)
    if (!itens.length) return setMsg({ tipo: 'erro', texto: 'Adicione os produtos da entrada.' })
    for (const i of itens) {
      if (n(i.quantidade) <= 0) return setMsg({ tipo: 'erro', texto: `Informe a quantidade de ${i.produto.nome}.` })
      if (i.produto.controla_validade && !i.data_validade) return setMsg({ tipo: 'erro', texto: `Informe a validade de ${i.produto.nome}.` })
    }
    setEnviando(true)
    const { error } = await supabase.rpc('registrar_entrada', {
      p_entrada: {
        id: idEntrada, data_entrada: dataEntrada, tipo, fornecedor_id: fornecedor || null, numero_nota: nota || null, observacao: obs || null,
        itens: itens.map((i) => ({
          produto_id: i.produto.id, lote: i.lote.trim() || (i.data_validade ? 'VAL-' + i.data_validade : 'SEM-LOTE'),
          data_validade: i.data_validade || null, data_fabricacao: i.data_fabricacao || null,
          quantidade: n(i.quantidade), custo_unitario: i.custo_unitario ? n(i.custo_unitario) : null,
        })),
      },
    })
    setEnviando(false)
    if (error) return setMsg({ tipo: 'erro', texto: error.message })
    await sincronizar()
    nav(`/estoque/entradas?nova=${idEntrada}`, { replace: true })
  }

  return (
    <>
      <Cabecalho titulo="Entrada de mercadoria" voltar
        acao={<Link to="/estoque/entradas" className="rounded-full px-3 py-1.5 text-sm font-semibold hover:bg-white/10">Histórico</Link>} />
      <main className="space-y-3 p-4">
        {!online && <Aviso tipo="alerta">Sem internet. A entrada precisa de conexão para atualizar o estoque de todos.</Aviso>}
        <section className="cartao grid grid-cols-2 gap-3">
          <Campo rotulo="Tipo">
            <select className="campo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="compra">Compra</option><option value="bonificacao">Bonificação</option>
              <option value="devolucao">Devolução de cliente</option><option value="outros">Outros</option>
            </select>
          </Campo>
          <Campo rotulo="Data"><input type="date" className="campo" value={dataEntrada} onChange={(e) => setDataEntrada(e.target.value)} /></Campo>
          <Campo rotulo="Fornecedor" className="col-span-2">
            <select className="campo" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)}>
              <option value="">Não informado</option>{fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </Campo>
          <div className="col-span-2 flex gap-2">
            <input className="campo" placeholder="Novo fornecedor" value={novoForn} onChange={(e) => setNovoForn(e.target.value)} />
            <button type="button" className="btn-secundario shrink-0" onClick={() => void criarFornecedor()}>Criar</button>
          </div>
          <Campo rotulo="Nº da nota"><input className="campo" value={nota} onChange={(e) => setNota(e.target.value)} /></Campo>
          <Campo rotulo="Observação"><input className="campo" value={obs} onChange={(e) => setObs(e.target.value)} /></Campo>
        </section>

        {itens.map((i) => (
          <section key={i.chave} className="cartao grid grid-cols-2 gap-3">
            <div className="col-span-2 flex items-center justify-between">
              <p className="font-bold">{i.produto.nome} <span className="text-xs font-normal text-stone-500">{i.produto.unidade}</span></p>
              <button className="text-stone-400 hover:text-red-600" onClick={() => setItens((x) => x.filter((y) => y.chave !== i.chave))} aria-label="Remover"><Icone nome="fechar" /></button>
            </div>
            <Campo rotulo="Quantidade *"><input className="campo" inputMode="decimal" value={i.quantidade} onChange={(e) => atualizar(i.chave, { quantidade: e.target.value })} /></Campo>
            <Campo rotulo="Custo unitário"><input className="campo" inputMode="decimal" value={i.custo_unitario} onChange={(e) => atualizar(i.chave, { custo_unitario: e.target.value })} /></Campo>
            <Campo rotulo="Lote"><input className="campo" value={i.lote} onChange={(e) => atualizar(i.chave, { lote: e.target.value })} placeholder="Nº do lote" /></Campo>
            <Campo rotulo={'Validade' + (i.produto.controla_validade ? ' *' : '')}><input type="date" className="campo" value={i.data_validade} onChange={(e) => atualizar(i.chave, { data_validade: e.target.value })} /></Campo>
            <p className="col-span-2 text-right text-sm text-stone-500">Subtotal {brl(n(i.quantidade) * n(i.custo_unitario))}</p>
          </section>
        ))}

        <button className="btn-secundario w-full" onClick={() => setEscolher(true)}><Icone nome="mais" /> Adicionar produto</button>

        <div className="cartao flex items-center justify-between">
          <span>{itens.length} produto(s) · {num(itens.reduce((s, i) => s + n(i.quantidade), 0))} un.</span>
          <b className="text-lg text-marca-700">{brl(total)}</b>
        </div>
        {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
        <button className="btn-primario w-full" disabled={enviando || !online} onClick={() => void salvar()}><Icone nome="ok" /> {enviando ? 'Registrando...' : 'Registrar entrada'}</button>
      </main>

      <Folha aberta={escolher} onFechar={() => setEscolher(false)} titulo="Produto">
        <Busca valor={q} onChange={setQ} placeholder="Nome, código ou código de barras" />
        <ul className="mt-2 divide-y divide-stone-100">
          {produtos.map((p) => (
            <li key={p.id}><button className="w-full py-2.5 text-left" onClick={() => adicionar(p)}><b>{p.nome}</b> <span className="text-xs text-stone-500">{p.codigo} · {p.unidade}</span></button></li>
          ))}
        </ul>
      </Folha>
    </>
  )
}
