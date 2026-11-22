import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useOnline } from '../components/Layout'
import { Aviso, Cabecalho, Campo, Icone } from '../components/ui'
import { useAuth } from '../lib/auth'
import { db } from '../lib/db'
import { brl, data, num, soDigitos, uuid } from '../lib/formato'
import { useCategorias } from '../lib/hooks'
import { supabase } from '../lib/supabase'
import { sincronizar } from '../lib/sync'
import { UNIDADES, type Produto } from '../lib/tipos'
import { fotoDoProduto } from '../lib/fotos'

function vazio(): Produto {
  return {
    id: uuid(), codigo: '', nome: '', descricao: null, categoria_id: null, marca: null, unidade: 'UN', qtd_embalagem: 1,
    peso_kg: null, gtin: null, ncm: null, cest: null, origem: 0, cfop_padrao: '5102', preco_venda: 0, preco_minimo: null,
    preco_custo: null, estoque_minimo: 0, controla_validade: false, foto_url: null, mostrar_catalogo: true, ativo: true, atualizado_em: '',
  }
}

// reduz a foto no celular antes de enviar (catálogo fica leve)
async function reduzirImagem(arquivo: File, max = 800): Promise<Blob> {
  const img = await createImageBitmap(arquivo)
  const escala = Math.min(1, max / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * escala); canvas.height = Math.round(img.height * escala)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return new Promise((ok) => canvas.toBlob((b) => ok(b!), 'image/jpeg', 0.82))
}

export default function ProdutoForm() {
  const { id } = useParams()
  const nav = useNavigate()
  const { gestor } = useAuth()
  const online = useOnline()
  const categorias = useCategorias()
  const [p, setP] = useState<Produto | null>(null)
  const [msg, setMsg] = useState<{ tipo: 'erro' | 'ok'; texto: string } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [novaCat, setNovaCat] = useState('')

  useEffect(() => {
    if (id) void db.produtos.get(id).then((x) => (x ? setP(x) : nav('/produtos', { replace: true })))
    else void db.produtos.toArray().then((todos) => {
      // sugere o próximo código numérico
      const maior = todos.map((x) => Number(x.codigo)).filter((n) => Number.isFinite(n)).reduce((a, b) => Math.max(a, b), 0)
      setP({ ...vazio(), codigo: String(maior + 1).padStart(4, '0') })
    })
  }, [id, nav])

  const lotes = useLiveQuery(() => (id ? db.estoqueLotes.where('produto_id').equals(id).toArray() : []), [id]) ?? []
  const saldo = useLiveQuery(() => (id ? db.estoque.get(id) : undefined), [id])

  if (!p) return null
  const ro = !gestor
  const set = (x: Partial<Produto>) => setP({ ...p, ...x })
  const txt = (k: keyof Produto) => ({
    value: (p[k] as string | null) ?? '', disabled: ro,
    onChange: (e: { target: { value: string } }) => set({ [k]: e.target.value || null } as Partial<Produto>),
  })
  const numero = (k: keyof Produto, nulo = false) => ({
    value: p[k] === null || p[k] === undefined ? '' : String(p[k]), disabled: ro, type: 'number', step: 'any', inputMode: 'decimal' as const,
    onChange: (e: { target: { value: string } }) => set({ [k]: e.target.value === '' ? (nulo ? null : 0) : Number(e.target.value) } as Partial<Produto>),
  })

  async function enviarFoto(arq?: File) {
    if (!arq) return
    setMsg(null)
    try {
      const blob = await reduzirImagem(arq)
      const caminho = `${p!.id}/${Date.now()}.jpg`
      const { error } = await supabase.storage.from('produtos').upload(caminho, blob, { contentType: 'image/jpeg', upsert: true })
      if (error) throw error
      set({ foto_url: supabase.storage.from('produtos').getPublicUrl(caminho).data.publicUrl })
    } catch (e) { setMsg({ tipo: 'erro', texto: 'Falha ao enviar foto: ' + (e as Error).message }) }
  }

  async function criarCategoria() {
    if (!novaCat.trim()) return
    const { data: c, error } = await supabase.from('categorias').insert({ nome: novaCat.trim() }).select().single()
    if (error) return setMsg({ tipo: 'erro', texto: error.message })
    await db.categorias.put(c)
    set({ categoria_id: c.id }); setNovaCat('')
  }

  async function salvar(e: FormEvent) {
    e.preventDefault(); setMsg(null)
    const ncm = soDigitos(p!.ncm)
    if (ncm && ncm.length !== 8) return setMsg({ tipo: 'erro', texto: 'NCM precisa ter 8 dígitos.' })
    const cest = soDigitos(p!.cest)
    if (cest && cest.length !== 7) return setMsg({ tipo: 'erro', texto: 'CEST precisa ter 7 dígitos.' })
    setSalvando(true)
    const { atualizado_em, ...dados } = { ...p!, ncm: ncm || null, cest: cest || null, gtin: soDigitos(p!.gtin) || null }
    void atualizado_em
    const { data: r, error } = await supabase.from('produtos').upsert(dados).select().single()
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: error.code === '23505' ? 'Já existe produto com este código.' : error.message })
    await db.produtos.put(r as Produto)
    void sincronizar()
    nav('/produtos', { replace: true })
  }

  return (
    <>
      <Cabecalho titulo={id ? p.nome || 'Produto' : 'Novo produto'} voltar />
      <form onSubmit={salvar} className="space-y-3 p-4">
        {gestor && !online && <Aviso tipo="alerta">Sem internet. Cadastro de produto precisa de conexão.</Aviso>}

        <section className="cartao flex gap-3">
          <label className={'relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-marca-50 ' + (gestor ? 'cursor-pointer' : '')}>
            {fotoDoProduto(p) ? <img src={fotoDoProduto(p)!} alt="" className="h-full w-full object-cover" /> : <Icone nome="produto" className="h-8 w-8 text-marca-200" />}
            {gestor && <input type="file" accept="image/*" className="hidden" onChange={(e) => void enviarFoto(e.target.files?.[0])} />}
            {gestor && <span className="absolute bottom-0 inset-x-0 bg-black/40 text-center text-[10px] text-white">Foto</span>}
          </label>
          <div className="flex-1 space-y-2">
            <Campo rotulo="Nome *"><input className="campo" required {...txt('nome')} /></Campo>
            {id && <p className="text-sm">Estoque: <b>{num(saldo?.saldo ?? 0)} {p.unidade}</b></p>}
          </div>
        </section>

        <section className="cartao grid grid-cols-2 gap-3">
          <Campo rotulo="Código *"><input className="campo" required {...txt('codigo')} /></Campo>
          <Campo rotulo="Código de barras (EAN)"><input className="campo" inputMode="numeric" {...txt('gtin')} /></Campo>
          <Campo rotulo="Marca"><input className="campo" {...txt('marca')} /></Campo>
          <Campo rotulo="Categoria">
            <select className="campo" disabled={ro} value={p.categoria_id ?? ''} onChange={(e) => set({ categoria_id: e.target.value || null })}>
              <option value="">Sem categoria</option>{categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Campo>
          {gestor && (
            <div className="col-span-2 flex gap-2">
              <input className="campo" placeholder="Nova categoria" value={novaCat} onChange={(e) => setNovaCat(e.target.value)} />
              <button type="button" className="btn-secundario shrink-0" onClick={() => void criarCategoria()}>Criar</button>
            </div>
          )}
          <Campo rotulo="Unidade de venda">
            <select className="campo" disabled={ro} value={p.unidade} onChange={(e) => set({ unidade: e.target.value })}>
              {UNIDADES.map((u) => <option key={u}>{u}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Qtd. por embalagem"><input className="campo" {...numero('qtd_embalagem')} /></Campo>
          <Campo rotulo="Descrição" className="col-span-2"><textarea className="campo" rows={2} {...txt('descricao')} /></Campo>
        </section>

        <section className="cartao grid grid-cols-2 gap-3">
          <h2 className="col-span-2 font-bold">Preço e estoque</h2>
          <Campo rotulo="Preço de venda (R$) *"><input className="campo" required {...numero('preco_venda')} /></Campo>
          <Campo rotulo="Preço mínimo (R$)" dica="Vendedor não vende abaixo"><input className="campo" {...numero('preco_minimo', true)} /></Campo>
          {gestor && <Campo rotulo="Custo (R$)" dica="Atualiza na entrada"><input className="campo" {...numero('preco_custo', true)} /></Campo>}
          <Campo rotulo="Estoque mínimo"><input className="campo" {...numero('estoque_minimo')} /></Campo>
          {gestor && p.preco_custo ? <p className="col-span-2 text-xs text-stone-500">Margem: {(((p.preco_venda - p.preco_custo) / p.preco_venda) * 100 || 0).toFixed(1)}%</p> : null}
        </section>

        <section className="cartao grid grid-cols-2 gap-3">
          <h2 className="col-span-2 font-bold">Dados fiscais (para NF-e)</h2>
          <Campo rotulo="NCM (8 dígitos)"><input className="campo" inputMode="numeric" {...txt('ncm')} /></Campo>
          <Campo rotulo="CEST"><input className="campo" inputMode="numeric" {...txt('cest')} /></Campo>
          <Campo rotulo="CFOP padrão"><input className="campo" inputMode="numeric" {...txt('cfop_padrao')} /></Campo>
          <Campo rotulo="Origem">
            <select className="campo" disabled={ro} value={p.origem} onChange={(e) => set({ origem: Number(e.target.value) })}>
              <option value={0}>0 · Nacional</option><option value={1}>1 · Importação direta</option><option value={2}>2 · Importado no mercado interno</option>
              <option value={3}>3 · Nacional, import. 40% a 70%</option><option value={4}>4 · Nacional, processo básico</option>
              <option value={5}>5 · Nacional, import. até 40%</option><option value={6}>6 · Importação direta sem similar</option>
              <option value={7}>7 · Mercado interno sem similar</option><option value={8}>8 · Nacional, import. acima de 70%</option>
            </select>
          </Campo>
          <Campo rotulo="Peso (kg)"><input className="campo" {...numero('peso_kg', true)} /></Campo>
        </section>

        {gestor && (
          <section className="cartao space-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={p.controla_validade} onChange={(e) => set({ controla_validade: e.target.checked })} /> Controla lote e validade</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={p.mostrar_catalogo} onChange={(e) => set({ mostrar_catalogo: e.target.checked })} /> Aparece no catálogo</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={p.ativo} onChange={(e) => set({ ativo: e.target.checked })} /> Produto ativo</label>
          </section>
        )}

        {id && (
          <section className="cartao">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-bold">Lotes em estoque</h2>
              {gestor && <Link to={`/estoque/entrada?produto=${p.id}`} className="text-sm font-semibold text-marca-700">+ Entrada</Link>}
            </div>
            {!lotes.length && <p className="text-sm text-stone-500">Sem lotes com saldo.</p>}
            <ul className="divide-y divide-stone-100 text-sm">
              {lotes.sort((a, b) => (a.data_validade ?? '9').localeCompare(b.data_validade ?? '9')).map((l) => (
                <li key={l.lote_id} className="flex justify-between py-1.5">
                  <span>Lote <b>{l.numero}</b>{l.data_validade ? ` · vence ${data(l.data_validade)}` : ''}</span>
                  <span className={l.saldo < 0 ? 'text-red-600' : ''}>{num(l.saldo)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
        {gestor && <button className="btn-primario w-full" disabled={salvando || !online}><Icone nome="ok" /> {salvando ? 'Salvando...' : 'Salvar produto'}</button>}
        {!gestor && <p className="text-center text-sm text-stone-500">Preço: <b>{brl(p.preco_venda)}</b></p>}
      </form>
    </>
  )
}
