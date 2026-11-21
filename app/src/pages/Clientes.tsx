import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BotaoFlutuante, Busca, Cabecalho, Vazio } from '../components/ui'
import { IndicadorSync } from '../components/Layout'
import { db } from '../lib/db'
import { docFormatado, normalizar } from '../lib/formato'
import { nomeCliente } from '../lib/hooks'

export default function Clientes() {
  const [busca, setBusca] = useState('')
  const [inativos, setInativos] = useState(false)
  const lista = useLiveQuery(async () => {
    const t = normalizar(busca)
    const todos = await db.clientes.toArray()
    return todos
      .filter((c) => (inativos ? true : c.ativo))
      .filter((c) => !t || normalizar(`${c.codigo} ${c.razao_social} ${c.nome_fantasia} ${c.cpf_cnpj} ${c.cidade} ${c.bairro}`).includes(t))
      .sort((a, b) => nomeCliente(a).localeCompare(nomeCliente(b)))
  }, [busca, inativos]) ?? []

  return (
    <>
      <Cabecalho titulo="Clientes" acao={<IndicadorSync />} />
      <div className="space-y-2 p-4 pb-2">
        <Busca valor={busca} onChange={setBusca} placeholder="Nome, CNPJ/CPF, cidade ou bairro" />
        <label className="flex items-center gap-2 text-xs text-stone-500">
          <input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> Mostrar inativos · {lista.length} cliente(s)
        </label>
      </div>
      <main className="space-y-2 px-4">
        {!lista.length && <Vazio texto="Nenhum cliente encontrado." />}
        {lista.map((c) => (
          <Link key={c.id} to={`/clientes/${c.id}`} className={'cartao block p-3 ' + (c.ativo ? '' : 'opacity-60')}>
            <p className="truncate font-semibold">{nomeCliente(c)}</p>
            <p className="truncate text-xs text-stone-500">
              {c.codigo ? `Cód. ${c.codigo} · ` : ''}{docFormatado(c.cpf_cnpj) || 'Sem documento'} · {[c.bairro, c.cidade].filter(Boolean).join(', ')}
            </p>
            {c._sync === 'pendente' && <p className="text-xs font-semibold text-amber-700">Aguardando envio</p>}
            {c._sync === 'erro' && <p className="text-xs font-semibold text-red-700">Erro: {c._erro}</p>}
          </Link>
        ))}
      </main>
      <BotaoFlutuante para="/clientes/novo" rotulo="Novo cliente" />
    </>
  )
}
