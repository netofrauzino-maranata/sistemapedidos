import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Aviso, Cabecalho, Campo, Icone } from '../components/ui'
import { useAuth } from '../lib/auth'
import { buscarCep, buscarCnpj } from '../lib/consultas'
import { db } from '../lib/db'
import { brl, cnpjValido, cpfValido, dataHora, soDigitos, uuid } from '../lib/formato'
import { useCondicoes, useFormas, usePerfisMapa } from '../lib/hooks'
import { sincronizar } from '../lib/sync'
import { STATUS_COR, STATUS_LABEL, type Cliente } from '../lib/tipos'

const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ')

function vazio(vendedor: string | null): Cliente {
  return {
    id: uuid(), tipo_pessoa: 'J', razao_social: '', nome_fantasia: null, cpf_cnpj: null, indicador_ie: 9, ie: null,
    email: null, telefone: null, whatsapp: null, contato: null, cep: null, logradouro: null, numero: null,
    complemento: null, bairro: null, cidade: null, uf: null, codigo_ibge: null, vendedor_id: vendedor,
    condicao_pagamento_id: null, forma_pagamento_id: null, limite_credito: null, observacao: null, ativo: true,
  }
}

export default function ClienteForm() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const nav = useNavigate()
  const { perfil, gestor } = useAuth()
  const condicoes = useCondicoes()
  const formas = useFormas()
  const tabelas = useLiveQuery(async () => (await db.tabelasPreco.toArray()).filter((t) => t.ativo).sort((a, b) => a.nome.localeCompare(b.nome)), []) ?? []
  const perfis = usePerfisMapa()
  const [c, setC] = useState<Cliente | null>(null)
  const [msg, setMsg] = useState<{ tipo: 'erro' | 'ok' | 'info'; texto: string } | null>(null)
  const [buscando, setBuscando] = useState(false)

  useEffect(() => {
    if (id) void db.clientes.get(id).then((x) => (x ? setC(x) : nav('/clientes', { replace: true })))
    else setC(vazio(gestor ? null : perfil?.id ?? null))
  }, [id, gestor, perfil?.id, nav])

  const pedidos = useLiveQuery(() => (id ? db.pedidos.where('cliente_id').equals(id).reverse().sortBy('data_pedido') : []), [id]) ?? []

  if (!c) return null
  const set = (p: Partial<Cliente>) => setC({ ...c, ...p })
  const txt = (k: keyof Cliente) => ({
    value: (c[k] as string | null) ?? '',
    onChange: (e: { target: { value: string } }) => set({ [k]: e.target.value || null } as Partial<Cliente>),
  })

  async function consultarCnpj() {
    setBuscando(true); setMsg(null)
    try {
      const r = await buscarCnpj(c!.cpf_cnpj ?? '')
      if (!r) setMsg({ tipo: 'erro', texto: 'CNPJ não encontrado.' })
      else {
        setC({ ...c!, ...r, telefone: c!.telefone || r.telefone, email: c!.email || r.email })
        const ie = r.ie ? ` Inscrição estadual ${r.ie} encontrada.` : r.indicador_ie === 9 ? ' Sem inscrição estadual ativa (não contribuinte).' : ' Inscrição estadual não consultada agora: digite ou tente de novo em 1 minuto.'
        setMsg({ tipo: 'ok', texto: 'Dados preenchidos pela Receita.' + ie + ' Confira.' })
      }
    } catch { setMsg({ tipo: 'erro', texto: 'Sem internet para consultar o CNPJ.' }) }
    setBuscando(false)
  }

  async function consultarCep() {
    try {
      const r = await buscarCep(c!.cep ?? '')
      if (r) setC({ ...c!, ...r })
    } catch { /* offline: segue manual */ }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault(); setMsg(null)
    const doc = soDigitos(c!.cpf_cnpj)
    if (doc && c!.tipo_pessoa === 'J' && !cnpjValido(doc)) return setMsg({ tipo: 'erro', texto: 'CNPJ inválido.' })
    if (doc && c!.tipo_pessoa === 'F' && !cpfValido(doc)) return setMsg({ tipo: 'erro', texto: 'CPF inválido.' })
    if (c!.indicador_ie === 1 && !c!.ie) return setMsg({ tipo: 'erro', texto: 'Contribuinte de ICMS precisa da Inscrição Estadual.' })
    if (doc) {
      const dup = await db.clientes.where('cpf_cnpj').equals(doc).first()
      if (dup && dup.id !== c!.id) return setMsg({ tipo: 'erro', texto: `Já existe cliente com este documento: ${dup.razao_social}` })
    }
    const salvo: Cliente = {
      ...c!, cpf_cnpj: doc || null, cep: soDigitos(c!.cep) || null, telefone: soDigitos(c!.telefone) || null,
      whatsapp: soDigitos(c!.whatsapp) || null, uf: c!.uf?.toUpperCase() ?? null, _sync: 'pendente', _erro: undefined,
    }
    await db.clientes.put(salvo)
    void sincronizar()
    if (params.get('voltar') === 'pedido') {
      try {
        const r = JSON.parse(localStorage.getItem('maranata-rascunho-pedido') ?? 'null')
        if (r) localStorage.setItem('maranata-rascunho-pedido', JSON.stringify({ ...r, cliente_id: salvo.id }))
      } catch { /* ignora */ }
      return nav('/pedidos/novo', { replace: true })
    }
    nav('/clientes', { replace: true })
  }

  return (
    <>
      <Cabecalho titulo={id ? 'Cliente' : 'Novo cliente'} voltar />
      <form onSubmit={salvar} className="space-y-3 p-4">
        {id && (
          <Link to="/pedidos/novo" onClick={() => localStorage.setItem('maranata-rascunho-pedido', JSON.stringify({
            id: uuid(), cliente_id: c.id, status: 'pendente', data_pedido: new Date().toISOString(), data_entrega: null,
            condicao_pagamento_id: c.condicao_pagamento_id, forma_pagamento_id: c.forma_pagamento_id, desconto: 0, frete: 0, observacao: '', itens: [],
          }))} className="btn w-full bg-destaque text-stone-900"><Icone nome="mais" /> Novo pedido para este cliente</Link>
        )}

        <section className="cartao space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {(['J', 'F'] as const).map((t) => (
              <button type="button" key={t} onClick={() => set({ tipo_pessoa: t, indicador_ie: t === 'F' ? 9 : c.indicador_ie })}
                className={'btn ' + (c.tipo_pessoa === t ? 'bg-marca-700 text-white' : 'bg-stone-100 text-stone-600')}>
                {t === 'J' ? 'Empresa (CNPJ)' : 'Pessoa física (CPF)'}
              </button>
            ))}
          </div>
          <Campo rotulo={c.tipo_pessoa === 'J' ? 'CNPJ' : 'CPF'}>
            <div className="flex gap-2">
              <input className="campo" inputMode="numeric" {...txt('cpf_cnpj')} />
              {c.tipo_pessoa === 'J' && <button type="button" className="btn-secundario shrink-0" disabled={buscando} onClick={() => void consultarCnpj()}>{buscando ? '...' : 'Buscar'}</button>}
            </div>
          </Campo>
          <Campo rotulo={c.tipo_pessoa === 'J' ? 'Razão social *' : 'Nome completo *'}><input className="campo" required {...txt('razao_social')} /></Campo>
          {c.tipo_pessoa === 'J' && <Campo rotulo="Nome fantasia"><input className="campo" {...txt('nome_fantasia')} /></Campo>}
          {c.tipo_pessoa === 'J' && (
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Situação no ICMS">
                <select className="campo" value={c.indicador_ie} onChange={(e) => set({ indicador_ie: Number(e.target.value) as 1 | 2 | 9 })}>
                  <option value={1}>Contribuinte</option><option value={2}>Isento</option><option value={9}>Não contribuinte</option>
                </select>
              </Campo>
              <Campo rotulo="Inscrição estadual"><input className="campo" inputMode="numeric" {...txt('ie')} /></Campo>
              <a className="col-span-2 -mt-1 text-xs font-semibold text-marca-700" target="_blank" rel="noreferrer"
                href="https://dfe-portal.svrs.rs.gov.br/NFE/CCC">Consultar inscrição estadual no Cadastro de Contribuintes (SEFAZ)</a>
            </div>
          )}
        </section>

        <section className="cartao grid grid-cols-2 gap-3">
          <h2 className="col-span-2 font-bold">Contato</h2>
          <Campo rotulo="Telefone"><input className="campo" inputMode="tel" {...txt('telefone')} /></Campo>
          <Campo rotulo="WhatsApp"><input className="campo" inputMode="tel" {...txt('whatsapp')} /></Campo>
          <Campo rotulo="Pessoa de contato"><input className="campo" {...txt('contato')} /></Campo>
          <Campo rotulo="E-mail"><input className="campo" type="email" {...txt('email')} /></Campo>
        </section>

        <section className="cartao grid grid-cols-6 gap-3">
          <h2 className="col-span-6 font-bold">Endereço</h2>
          <Campo rotulo="CEP" className="col-span-3"><input className="campo" inputMode="numeric" {...txt('cep')} onBlur={() => void consultarCep()} /></Campo>
          <Campo rotulo="UF" className="col-span-3">
            <select className="campo" value={c.uf ?? ''} onChange={(e) => set({ uf: e.target.value || null })}>
              <option value="" />{UFS.map((u) => <option key={u}>{u}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Rua" className="col-span-4"><input className="campo" {...txt('logradouro')} /></Campo>
          <Campo rotulo="Número" className="col-span-2"><input className="campo" {...txt('numero')} /></Campo>
          <Campo rotulo="Bairro" className="col-span-3"><input className="campo" {...txt('bairro')} /></Campo>
          <Campo rotulo="Complemento" className="col-span-3"><input className="campo" {...txt('complemento')} /></Campo>
          <Campo rotulo="Cidade" className="col-span-4"><input className="campo" {...txt('cidade')} /></Campo>
          <Campo rotulo="Cód. IBGE" className="col-span-2" dica="Preenche pelo CEP"><input className="campo" inputMode="numeric" {...txt('codigo_ibge')} /></Campo>
        </section>

        <section className="cartao grid grid-cols-2 gap-3">
          <h2 className="col-span-2 font-bold">Comercial</h2>
          <Campo rotulo="Condição padrão">
            <select className="campo" value={c.condicao_pagamento_id ?? ''} onChange={(e) => set({ condicao_pagamento_id: e.target.value || null })}>
              <option value="">Nenhuma</option>{condicoes.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Forma padrão">
            <select className="campo" value={c.forma_pagamento_id ?? ''} onChange={(e) => set({ forma_pagamento_id: e.target.value || null })}>
              <option value="">Nenhuma</option>{formas.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
          </Campo>
          {gestor && (
            <>
              <Campo rotulo="Tabela de preço" className="col-span-2">
                <select className="campo" value={c.tabela_preco_id ?? ''} onChange={(e) => set({ tabela_preco_id: e.target.value || null })}>
                  <option value="">Preço normal</option>{tabelas.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Vendedor responsável">
                <select className="campo" value={c.vendedor_id ?? ''} onChange={(e) => set({ vendedor_id: e.target.value || null })}>
                  <option value="">Todos os vendedores</option>
                  {[...perfis.values()].filter((p) => p.ativo).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Limite de crédito (R$)">
                <input className="campo" type="number" step="0.01" value={c.limite_credito ?? ''} onChange={(e) => set({ limite_credito: e.target.value ? Number(e.target.value) : null })} />
              </Campo>
            </>
          )}
          <Campo rotulo="Observações" className="col-span-2"><textarea className="campo" rows={2} {...txt('observacao')} /></Campo>
          {id && (
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={c.ativo} onChange={(e) => set({ ativo: e.target.checked })} /> Cliente ativo
            </label>
          )}
        </section>

        {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
        <button className="btn-primario w-full"><Icone nome="ok" /> Salvar cliente</button>

        {id && pedidos.length > 0 && (
          <section className="cartao">
            <h2 className="mb-2 font-bold">Últimos pedidos</h2>
            <ul className="divide-y divide-stone-100">
              {pedidos.slice(0, 10).map((p) => (
                <li key={p.id}>
                  <Link to={`/pedidos/${p.id}`} className="flex items-center justify-between py-2 text-sm">
                    <span>{p.numero ? `#${p.numero}` : 'Não enviado'} · {dataHora(p.data_pedido)}</span>
                    <span className="flex items-center gap-2"><b>{brl(p.total)}</b><span className={'etiqueta ' + STATUS_COR[p.status]}>{STATUS_LABEL[p.status]}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </form>
    </>
  )
}
