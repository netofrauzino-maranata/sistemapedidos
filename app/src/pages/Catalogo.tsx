import { useState } from 'react'
import { Aviso, Cabecalho, Campo, Icone } from '../components/ui'
import { db } from '../lib/db'
import { useCategorias, useEmpresa } from '../lib/hooks'
import { abrirPdf, compartilharPdf, pdfCatalogo } from '../lib/pdf'
import { fotoDoProduto } from '../lib/fotos'

async function paraDataUrl(url: string): Promise<string | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    // converte para JPEG (o PDF não lê WebP) e reduz para o tamanho do cartão
    const bmp = await createImageBitmap(await r.blob())
    const lado = 480, k = Math.min(1, lado / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    const g = c.getContext('2d')!
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height)
    g.drawImage(bmp, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.85)
  } catch { return null }
}

export default function Catalogo() {
  const categorias = useCategorias()
  const empresa = useEmpresa()
  const [selecionadas, setSelecionadas] = useState<string[]>([])
  const [preco, setPreco] = useState(true)
  const [fotos, setFotos] = useState(true)
  const [soComEstoque, setSoComEstoque] = useState(true)
  const [titulo, setTitulo] = useState('CATÁLOGO DE PRODUTOS')
  const [gerando, setGerando] = useState(false)
  const [msg, setMsg] = useState('')

  async function gerar(acao: 'ver' | 'enviar') {
    setGerando(true); setMsg('')
    try {
      const est = new Map((await db.estoque.toArray()).map((e) => [e.produto_id, e.saldo]))
      const produtos = (await db.produtos.filter((p) => p.ativo && p.mostrar_catalogo).toArray())
        .filter((p) => !selecionadas.length || (p.categoria_id && selecionadas.includes(p.categoria_id)))
        .filter((p) => !soComEstoque || (est.get(p.id) ?? 0) > 0)
      if (!produtos.length) { setMsg('Nenhum produto com esses filtros.'); return }
      let mapa: Map<string, string> | undefined
      if (fotos) {
        mapa = new Map()
        await Promise.all(produtos.filter((p) => fotoDoProduto(p)).map(async (p) => {
          const d = await paraDataUrl(fotoDoProduto(p)!)
          if (d) mapa!.set(p.id, d)
        }))
        if (!mapa.size) mapa.set('__grade__', '') // mantém grade com espaço de foto
      }
      const doc = pdfCatalogo({ produtos, categorias: await db.categorias.toArray(), empresa, mostrarPreco: preco, titulo, fotos: mapa })
      if (acao === 'ver') abrirPdf(doc)
      else await compartilharPdf(doc, `catalogo-maranata-${new Date().toLocaleDateString('en-CA')}.pdf`, 'Catálogo Maranata')
    } finally { setGerando(false) }
  }

  return (
    <>
      <Cabecalho titulo="Catálogo em PDF" voltar />
      <main className="space-y-3 p-4">
        <section className="cartao space-y-3">
          <Campo rotulo="Título"><input className="campo" value={titulo} onChange={(e) => setTitulo(e.target.value)} /></Campo>
          <div>
            <span className="rotulo">Categorias (nenhuma marcada = todas)</span>
            <div className="flex flex-wrap gap-2">
              {categorias.map((c) => {
                const on = selecionadas.includes(c.id)
                return (
                  <button key={c.id} onClick={() => setSelecionadas((s) => (on ? s.filter((x) => x !== c.id) : [...s, c.id]))}
                    className={'etiqueta px-3 py-1.5 text-sm ' + (on ? 'bg-marca-700 text-white' : 'bg-stone-100 text-stone-600')}>{c.nome}</button>
                )
              })}
              {!categorias.length && <span className="text-sm text-stone-500">Nenhuma categoria cadastrada.</span>}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={preco} onChange={(e) => setPreco(e.target.checked)} /> Mostrar preços</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={fotos} onChange={(e) => setFotos(e.target.checked)} /> Com fotos</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={soComEstoque} onChange={(e) => setSoComEstoque(e.target.checked)} /> Só produtos com estoque</label>
        </section>
        {msg && <Aviso tipo="alerta">{msg}</Aviso>}
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-secundario" disabled={gerando} onClick={() => void gerar('ver')}><Icone nome="pdf" /> Ver</button>
          <button className="btn-primario" disabled={gerando} onClick={() => void gerar('enviar')}><Icone nome="whatsapp" /> {gerando ? 'Gerando...' : 'Enviar'}</button>
        </div>
      </main>
    </>
  )
}
