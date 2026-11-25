import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Aviso, Cabecalho, Campo, Icone } from '../components/ui'
import { useAuth } from '../lib/auth'
import { buscarCep, buscarCnpj } from '../lib/consultas'
import { db } from '../lib/db'
import { brl, cnpjValido, cpfValido, dataHora, soDigitos, uuid } from '../lib/formato'
import { linkGoogleMaps, linkWaze, pegarPosicao, temLocalizacao } from '../lib/mapa'
import { nomeCliente, useCondicoes, useFormas, usePerfisMapa } from '../lib/hooks'
import { CHAVE_COPIA, CHAVE_RASCUNHO, repetirPedido } from '../lib/repetir'
import { supabase } from '../lib/supabase'
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
    else setC({ ...vazio(gestor ? null : perfil?.id ?? null), razao_social: params.get('nome') ?? '', whatsapp: params.get('fone') || null, eh_cliente: params.get('tipo') !== 'fornecedor', eh_fornecedor: params.get('tipo') === 'fornecedor' })
  }, [id, gestor, perfil?.id, nav, params])

  const pedidos = useLiveQuery(() => (id ? db.pedidos.where('cliente_id').equals(id).reverse().sortBy('data_pedido') : []), [id]) ?? []

  const ultima = pedidos.find((p) => p.status !== 'cancelado' && p.status !== 'orcamento') ?? pedidos.find((p) => p.status !== 'cancelado')

  if (!c) return null
  const cli = c.eh_cliente !== false
  const forn = !!c.eh_fornecedor
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
        const r = JSON.parse(localStorage.getItem(CHAVE_RASCUNHO) ?? 'null')
        if (r) localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({ ...r, cliente_id: salvo.id }))
      } catch { /* ignora */ }
      return nav('/pedidos/novo', { replace: true })
    }
    nav('/clientes', { replace: true })
  }

  return (
    <>
      <Cabecalho titulo={id ? (cli ? (forn ? 'Cliente e fornecedor' : 'Cliente') : 'Fornecedor') : 'Novo cadastro'} voltar />
      <form onSubmit={salvar} className="space-y-3 p-4">
        {gestor && (
          <section className="cartao space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Este cadastro é</p>
            <div className="grid grid-cols-3 overflow-hidden rounded-xl ring-1 ring-stone-300">
              {([['cliente', 'Cliente', true, false], ['fornecedor', 'Fornecedor', false, true], ['ambos', 'Os dois', true, true]] as const).map(([k, n, ec, ef]) => (
                <button type="button" key={k} onClick={() => set({ eh_cliente: ec, eh_fornecedor: ef })}
                  className={'py-2 text-sm font-bold ' + (cli === ec && forn === ef ? 'bg-marca-700 text-white' : 'bg-white text-stone-600')}>{n}</button>
              ))}
            </div>
            {forn && <p className="text-xs text-stone-500">Como fornecedor, aparece na Entrada de mercadoria e no relatório de fornecedores.{cli ? '' : ' Fica fora das vendas e do catálogo.'}</p>}
          </section>
        )}
        {id && cli && ultima && (
          <section className="cartao space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Última venda</p>
                <Link to={`/pedidos/${ultima.id}`} className="block truncate font-bold text-marca-700">
                  {ultima.numero ? `#${ultima.numero}` : 'Não enviada'} · {dataHora(ultima.data_pedido)}
                </Link>
                <p className="text-xs text-stone-500">{ultima.itens.length} produto(s)</p>
              </div>
              <p className="shrink-0 text-lg font-extrabold">{brl(ultima.total)}</p>
            </div>
            <button type="button" className="btn-primario w-full" onClick={() => void repetirPedido(ultima).then((ok) => ok && nav('/pedidos/novo'))}>
              <Icone nome="mais" /> Duplicar esta venda
            </button>
          </section>
        )}
        {id && cli && <CatalogoOnline c={c} onToken={(t) => setC({ ...c, link_token: t })} />}
        {id && cli && (
          <Link to="/pedidos/novo" onClick={() => { localStorage.removeItem(CHAVE_COPIA); localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({
            id: uuid(), cliente_id: c.id, status: 'pendente', data_pedido: new Date().toISOString(), data_entrega: null,
            condicao_pagamento_id: c.condicao_pagamento_id, forma_pagamento_id: c.forma_pagamento_id, desconto: 0, frete: 0, observacao: '', itens: [],
          })) }} className="btn w-full bg-destaque text-stone-900"><Icone nome="mais" /> Novo pedido para este cliente</Link>
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

        <Localizacao c={c} novo={!id} quem={perfil?.id ?? null} nomeQuem={(uid) => perfis.get(uid)?.nome ?? ''}
          onMudar={(p) => setC((x) => (x ? { ...x, ...p } : x))} />

        <section className="cartao grid grid-cols-2 gap-3">
          <h2 className="col-span-2 font-bold">{cli ? 'Comercial' : 'Observações'}</h2>
          {cli && <>
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
          </>}
          {gestor && cli && (
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
              <input type="checkbox" checked={c.ativo} onChange={(e) => set({ ativo: e.target.checked })} /> Cadastro ativo
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

// Link do catálogo online deste cliente: ele escolhe os itens e manda o pedido.
function CatalogoOnline({ c, onToken }: { c: Cliente; onToken: (t: string) => void }) {
  const [token, setToken] = useState(c.link_token ?? '')
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (token) return
    void supabase.from('clientes').select('link_token').eq('id', c.id).maybeSingle().then(({ data }) => {
      const t = (data as { link_token?: string } | null)?.link_token
      if (t) { setToken(t); void db.clientes.update(c.id, { link_token: t }) }
    })
  }, [c.id, token])
  const link = token ? `${location.origin}/c/${token}` : ''
  const texto = `Olá! Segue o catálogo da Maranata Distribuidora com os seus preços. Escolha os produtos e as quantidades e toque em Enviar pedido: ${link}`
  const fone = soDigitos(c.whatsapp || c.telefone).replace(/^55/, '')

  async function enviar() {
    if (fone) return window.open(`https://wa.me/55${fone}?text=${encodeURIComponent(texto)}`, '_blank')
    if (navigator.share) { try { await navigator.share({ text: texto }); return } catch { return } }
    await copiar()
  }
  async function copiar() {
    try { await navigator.clipboard.writeText(link); setMsg('Link copiado.') } catch { setMsg(link) }
  }
  async function novo() {
    if (!confirm('Gerar um link novo? O link antigo para de funcionar.')) return
    const { data, error } = await supabase.rpc('novo_link_catalogo', { p_cliente: c.id })
    if (error || !data) return setMsg(error?.message ?? 'Não foi possível gerar. Confira a internet.')
    setToken(data as string); onToken(data as string); await db.clientes.update(c.id, { link_token: data as string }); setMsg('Link novo gerado.')
  }

  return (
    <section className="cartao space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Link exclusivo deste cliente</p>
      <p className="text-sm text-stone-600">Opcional: já abre com os preços da tabela dele e o pedido chega vinculado. O link geral, para todos, fica em Mais &gt; Catálogo online.</p>
      {!token ? <p className="text-sm text-stone-500">Precisa de internet para buscar o link.</p> : (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-primario col-span-2" onClick={() => void enviar()}><Icone nome="whatsapp" /> Enviar link exclusivo{fone ? ' no WhatsApp' : ''}</button>
          <button type="button" className="btn-secundario" onClick={() => void copiar()}>Copiar link</button>
          <a className="btn-secundario" href={link} target="_blank" rel="noreferrer">Ver como cliente</a>
          <button type="button" className="col-span-2 text-xs text-stone-500 underline" onClick={() => void novo()}>Gerar link novo (desativa o antigo)</button>
        </div>
      )}
      {msg && <p className="break-all text-xs text-marca-700">{msg}</p>}
    </section>
  )
}

// Localização para entrega: o vendedor salva no cliente (GPS do celular, funciona
// sem internet) e qualquer um abre depois no Google Maps ou no Waze.
function Localizacao({ c, novo, quem, nomeQuem, onMudar }: {
  c: Cliente; novo: boolean; quem: string | null; nomeQuem: (uid: string) => string; onMudar: (p: Partial<Cliente>) => void
}) {
  const [pegando, setPegando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'erro' | 'ok' | 'alerta'; texto: string } | null>(null)
  const tem = temLocalizacao(c)

  async function gravar(p: Partial<Cliente>) {
    onMudar(novo ? p : { ...p, _loc_pendente: true })
    // cadastro já existente: salva na hora (não precisa apertar "Salvar cliente")
    if (!novo) {
      await db.clientes.update(c.id, { ...p, _loc_pendente: true })
      void sincronizar()
    }
  }

  async function salvarAqui() {
    if (tem && !confirm('Trocar a localização salva pela localização de agora?')) return
    setPegando(true); setMsg(null)
    try {
      const pos = await pegarPosicao()
      await gravar({
        latitude: pos.latitude, longitude: pos.longitude, localizacao_precisao: pos.precisao,
        localizacao_em: new Date().toISOString(), localizacao_por: quem,
      })
      const ruim = pos.precisao != null && pos.precisao > 100
      setMsg(ruim
        ? { tipo: 'alerta', texto: `Salva, mas o GPS está impreciso (uns ${pos.precisao} m). Se puder, tente de novo na porta do cliente, em lugar aberto.` }
        : { tipo: 'ok', texto: `Localização salva${pos.precisao ? ` (precisão de uns ${pos.precisao} m)` : ''}.${novo ? ' Aperte "Salvar cliente" para gravar o cadastro.' : navigator.onLine ? '' : ' Sem internet agora: envia sozinha quando voltar.'}` })
    } catch (e) { setMsg({ tipo: 'erro', texto: (e as Error).message }) }
    setPegando(false)
  }

  async function remover() {
    if (!confirm('Remover a localização deste cadastro?')) return
    await gravar({ latitude: null, longitude: null, localizacao_precisao: null, localizacao_em: null, localizacao_por: null })
    setMsg(null)
  }

  async function compartilhar() {
    if (!tem) return
    const texto = `${nomeCliente(c)}\nGoogle Maps: ${linkGoogleMaps(c.latitude, c.longitude)}\nWaze: ${linkWaze(c.latitude, c.longitude)}`
    if (navigator.share) { try { await navigator.share({ text: texto }); return } catch (e) { if ((e as Error).name === 'AbortError') return } }
    try { await navigator.clipboard.writeText(texto); setMsg({ tipo: 'ok', texto: 'Links copiados. Cole no WhatsApp.' }) } catch { /* sem área de transferência */ }
  }

  return (
    <section className="cartao space-y-3">
      <div className="flex items-center gap-2">
        <Icone nome="mapa" className="h-5 w-5 text-marca-700" />
        <h2 className="flex-1 font-bold">Localização para entrega</h2>
        {c._loc_pendente && <span className="etiqueta bg-amber-100 text-amber-800">Falta enviar</span>}
      </div>
      {tem ? (
        <>
          <p className="text-xs text-stone-500">
            Salva{c.localizacao_em ? ` em ${dataHora(c.localizacao_em)}` : ''}
            {c.localizacao_por && nomeQuem(c.localizacao_por) ? ` por ${nomeQuem(c.localizacao_por)}` : ''}
            {c.localizacao_precisao ? ` · precisão de uns ${c.localizacao_precisao} m` : ''}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <a className="btn-primario" href={linkGoogleMaps(c.latitude, c.longitude)} target="_blank" rel="noreferrer"><Icone nome="mapa" /> Google Maps</a>
            <a className="btn bg-sky-500 text-white" href={linkWaze(c.latitude, c.longitude)} target="_blank" rel="noreferrer"><Icone nome="caminhao" /> Waze</a>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" className="btn-secundario text-sm" disabled={pegando} onClick={() => void salvarAqui()}>{pegando ? 'Pegando...' : 'Atualizar'}</button>
            <button type="button" className="btn-secundario text-sm" onClick={() => void compartilhar()}><Icone nome="whatsapp" /> Enviar</button>
            <button type="button" className="btn-secundario text-sm text-red-700" onClick={() => void remover()}>Remover</button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-stone-500">Estando no cliente, aperte o botão. O celular guarda onde ele fica (funciona sem internet) e o motorista abre depois no Google Maps ou no Waze.</p>
          <button type="button" className="btn-primario w-full" disabled={pegando} onClick={() => void salvarAqui()}>
            <Icone nome="mapa" /> {pegando ? 'Pegando o GPS...' : 'Salvar localização atual'}
          </button>
        </>
      )}
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
    </section>
  )
}
