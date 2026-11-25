import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BotaoFlutuante, Busca, Cabecalho, Icone, Vazio } from '../components/ui'
import { IndicadorSync } from '../components/Layout'
import { db } from '../lib/db'
import { docFormatado, normalizar } from '../lib/formato'
import { ehCliente, nomeCliente } from '../lib/hooks'

export default function Clientes() {
  const [busca, setBusca] = useState('')
  const [inativos, setInativos] = useState(false)
  const [tipo, setTipo] = useState<'clientes' | 'fornecedores' | 'todos'>('clientes')
  const lista = useLiveQuery(async () => {
    const t = normalizar(busca)
    const todos = await db.clientes.toArray()
    return todos
      .filter((c) => (inativos ? true : c.ativo))
      .filter((c) => tipo === 'todos' || (tipo === 'clientes' ? ehCliente(c) : c.eh_fornecedor))
      .filter((c) => !t || normalizar(`${c.codigo} ${c.razao_social} ${c.nome_fantasia} ${c.cpf_cnpj} ${c.cidade} ${c.bairro}`).includes(t))
      .sort((a, b) => nomeCliente(a).localeCompare(nomeCliente(b)))
  }, [busca, inativos, tipo]) ?? []

  return (
    <>
      <Cabecalho titulo="Clientes" acao={<IndicadorSync />} />
      <div className="space-y-2 p-4 pb-2">
        <Busca valor={busca} onChange={setBusca} placeholder="Nome, CNPJ/CPF, cidade ou bairro" />
        <div className="grid grid-cols-3 overflow-hidden rounded-xl ring-1 ring-stone-300">
          {([['clientes', 'Clientes'], ['fornecedores', 'Fornecedores'], ['todos', 'Todos']] as const).map(([k, n]) => (
            <button key={k} onClick={() => setTipo(k)} className={'py-1.5 text-sm font-bold ' + (tipo === k ? 'bg-marca-700 text-white' : 'bg-white text-stone-600')}>{n}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-stone-500">
          <input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> Mostrar inativos · {lista.length} cadastro(s)
        </label>
      </div>
      <main className="space-y-2 px-4">
        {!lista.length && <Vazio texto="Nenhum cliente encontrado." />}
        {lista.map((c) => (
          <Link key={c.id} to={`/clientes/${c.id}`} className={'cartao block p-3 ' + (c.ativo ? '' : 'opacity-60')}>
            <p className="flex items-center gap-2 font-semibold"><span className="truncate">{nomeCliente(c)}</span>
              {c.latitude != null && <span title="Localização salva"><Icone nome="mapa" className="h-4 w-4 shrink-0 text-marca-700" /></span>}
              {c.eh_fornecedor && <span className="etiqueta shrink-0 bg-violet-100 text-violet-800">{ehCliente(c) ? 'Cliente e fornecedor' : 'Fornecedor'}</span>}</p>
            <p className="truncate text-xs text-stone-500">
              {c.codigo ? `Cód. ${c.codigo} · ` : ''}{docFormatado(c.cpf_cnpj) || 'Sem documento'} · {[c.bairro, c.cidade].filter(Boolean).join(', ')}
            </p>
            {c._sync === 'pendente' && <p className="text-xs font-semibold text-amber-700">Aguardando envio</p>}
            {c._sync === 'erro' && <p className="text-xs font-semibold text-red-700">Erro: {c._erro}</p>}
          </Link>
        ))}
      </main>
      <BotaoFlutuante para="/clientes/novo" rotulo="Novo cadastro" />
    </>
  )
}
