import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Aviso, Busca, Cabecalho, Icone, Vazio } from '../components/ui'
import { db } from '../lib/db'
import { brl, normalizar } from '../lib/formato'
import { supabase } from '../lib/supabase'
import type { TabelaPreco, TabelaPrecoItem } from '../lib/tipos'

// Tabelas de preço (só gestor). Cada tabela guarda apenas os produtos com
// preço diferente do normal. Cliente ligado à tabela compra por esse preço.
// Alterações aqui precisam de internet (gravam direto no servidor).

export default function TabelasPreco() {
  const { id } = useParams()
  return id ? <EditarTabela id={id} /> : <ListaTabelas />
}

function ListaTabelas() {
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState('')
  const dados = useLiveQuery(async () => {
    const tabelas = (await db.tabelasPreco.toArray()).filter((t) => t.ativo).sort((a, b) => a.nome.localeCompare(b.nome))
    const clientes = await db.clientes.toArray()
    const itens = await db.tabelaItens.filter((i) => i.ativo).toArray()
    return tabelas.map((t) => ({
      t,
      clientes: clientes.filter((c) => c.tabela_preco_id === t.id && c.ativo).length,
      itens: itens.filter((i) => i.tabela_id === t.id).length,
    }))
  }, []) ?? []

  async function criar() {
    setErro('')
    if (!nome.trim()) return
    const { data, error } = await supabase.from('tabelas_preco').insert({ nome: nome.trim() }).select().single()
    if (error) return setErro(error.message)
    await db.tabelasPreco.put(data as TabelaPreco)
    setNome('')
  }

  return (
    <>
      <Cabecalho titulo="Tabelas de preço" voltar="/mais" />
      <main className="space-y-3 p-4">
        <p className="text-sm text-stone-600">Cada tabela guarda só os produtos com preço diferente do normal. Escolha a tabela de cada cliente no cadastro dele.</p>
        <ul className="cartao divide-y divide-stone-100 p-0">
          {dados.map(({ t, clientes, itens }) => (
            <li key={t.id}>
              <Link to={`/config/tabelas/${t.id}`} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{t.nome}</p>
                  <p className="text-xs text-stone-500">{itens} preço(s) especial(is) · {clientes} cliente(s)</p>
                </div>
                <Icone nome="editar" className="h-5 w-5 text-marca-600" />
              </Link>
            </li>
          ))}
          {!dados.length && <li><Vazio texto="Nenhuma tabela ainda." /></li>}
        </ul>
        <div className="cartao flex gap-2">
          <input className="campo" placeholder="Nome da nova tabela" value={nome} onChange={(e) => setNome(e.target.value)} />
          <button className="btn-primario shrink-0" onClick={() => void criar()}><Icone nome="mais" /> Criar</button>
        </div>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
      </main>
    </>
  )
}

function EditarTabela({ id }: { id: string }) {
  const [q, setQ] = useState('')
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState<string | null>(null)
  const tabela = useLiveQuery(() => db.tabelasPreco.get(id), [id])
  const itens = useLiveQuery(async () => new Map((await db.tabelaItens.where('tabela_id').equals(id).toArray()).map((i) => [i.produto_id, i])), [id]) ?? new Map<string, TabelaPrecoItem>()
  const produtos = useLiveQuery(async () => {
    const t = normalizar(q)
    return (await db.produtos.filter((p) => p.ativo).toArray())
      .filter((p) => !t || normalizar(`${p.codigo} ${p.nome} ${p.marca}`).includes(t))
      .sort((a, b) => a.nome.localeCompare(b.nome))
  }, [q]) ?? []

  async function gravar(produtoId: string, valor: string) {
    setErro('')
    const atual = itens.get(produtoId)
    const preco = valor.trim() ? Number(valor.replace(',', '.')) : null
    if (preco !== null && (isNaN(preco) || preco < 0)) return setErro('Preço inválido.')
    if (preco === null && (!atual || !atual.ativo)) return
    if (preco !== null && atual?.ativo && Number(atual.preco) === preco) return
    setSalvando(produtoId)
    const linha = preco === null
      ? { tabela_id: id, produto_id: produtoId, preco: atual!.preco, ativo: false }
      : { tabela_id: id, produto_id: produtoId, preco, ativo: true }
    const { data, error } = await supabase.from('tabela_preco_itens').upsert(linha, { onConflict: 'tabela_id,produto_id' }).select().single()
    setSalvando(null)
    if (error) return setErro(error.message)
    await db.tabelaItens.put(data as TabelaPrecoItem)
  }

  async function renomear() {
    const novo = prompt('Nome da tabela', tabela?.nome)?.trim()
    if (!novo || novo === tabela?.nome) return
    const { data, error } = await supabase.from('tabelas_preco').update({ nome: novo }).eq('id', id).select().single()
    if (error) return setErro(error.message)
    await db.tabelasPreco.put(data as TabelaPreco)
  }

  return (
    <>
      <Cabecalho titulo={tabela?.nome ?? 'Tabela'} voltar="/config/tabelas"
        acao={<button className="rounded-full p-2 hover:bg-white/10" aria-label="Renomear" onClick={() => void renomear()}><Icone nome="editar" /></button>} />
      <main className="space-y-3 p-4">
        <p className="text-sm text-stone-600">Deixe em branco para usar o preço normal. O valor é salvo ao sair do campo.</p>
        <Busca valor={q} onChange={setQ} placeholder="Buscar produto" />
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <ul className="cartao divide-y divide-stone-100 p-0">
          {produtos.map((p) => {
            const it = itens.get(p.id)
            const especial = it?.ativo ? String(it.preco) : ''
            return (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{p.nome}</p>
                  <p className="text-xs text-stone-500">{p.codigo} · normal {brl(p.preco_venda)}</p>
                </div>
                <input key={especial} className={'campo w-28 text-right ' + (especial ? 'border-marca-500 font-bold text-marca-700' : '')}
                  inputMode="decimal" placeholder="normal" defaultValue={especial} disabled={salvando === p.id}
                  onBlur={(e) => void gravar(p.id, e.target.value)} />
              </li>
            )
          })}
        </ul>
      </main>
    </>
  )
}
