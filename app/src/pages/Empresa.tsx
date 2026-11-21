import { useEffect, useState, type FormEvent } from 'react'
import { Aviso, Cabecalho, Campo, Icone } from '../components/ui'
import { buscarCep, buscarCnpj } from '../lib/consultas'
import { db } from '../lib/db'
import { soDigitos } from '../lib/formato'
import { useEmpresa } from '../lib/hooks'
import { supabase } from '../lib/supabase'
import type { Empresa as TEmpresa } from '../lib/tipos'

export default function Empresa() {
  const atual = useEmpresa()
  const [e, setE] = useState<TEmpresa | null>(null)
  const [msg, setMsg] = useState<{ tipo: 'erro' | 'ok'; texto: string } | null>(null)
  useEffect(() => { if (atual && !e) setE(atual) }, [atual, e])
  if (!e) return <><Cabecalho titulo="Dados da empresa" voltar /><p className="p-6 text-center text-stone-500">Sincronize para carregar.</p></>
  const txt = (k: keyof TEmpresa) => ({ value: (e[k] as string | null) ?? '', onChange: (ev: { target: { value: string } }) => setE({ ...e, [k]: ev.target.value || null }) })

  async function salvar(ev: FormEvent) {
    ev.preventDefault(); setMsg(null)
    const { atualizado_em, ...dados } = { ...e!, cnpj: soDigitos(e!.cnpj) || null }
    void atualizado_em
    const { data, error } = await supabase.from('empresa').update(dados).eq('id', 1).select().single()
    if (error) return setMsg({ tipo: 'erro', texto: error.message })
    await db.empresa.put(data as TEmpresa)
    setMsg({ tipo: 'ok', texto: 'Dados salvos. Já aparecem nos PDFs.' })
  }

  return (
    <>
      <Cabecalho titulo="Dados da empresa" voltar />
      <form onSubmit={salvar} className="space-y-3 p-4">
        <section className="cartao grid grid-cols-2 gap-3">
          <Campo rotulo="CNPJ" className="col-span-2">
            <div className="flex gap-2"><input className="campo" {...txt('cnpj')} />
              <button type="button" className="btn-secundario shrink-0" onClick={async () => { const r = await buscarCnpj(e.cnpj ?? '').catch(() => null); if (r) setE({ ...e, ...r }) }}>Buscar</button></div>
          </Campo>
          <Campo rotulo="Razão social" className="col-span-2"><input className="campo" required {...txt('razao_social')} /></Campo>
          <Campo rotulo="Nome fantasia" className="col-span-2"><input className="campo" {...txt('nome_fantasia')} /></Campo>
          <Campo rotulo="Inscrição estadual"><input className="campo" {...txt('ie')} /></Campo>
          <Campo rotulo="Telefone"><input className="campo" {...txt('telefone')} /></Campo>
          <Campo rotulo="WhatsApp"><input className="campo" {...txt('whatsapp')} /></Campo>
          <Campo rotulo="E-mail"><input className="campo" {...txt('email')} /></Campo>
          <Campo rotulo="CEP"><input className="campo" {...txt('cep')} onBlur={async () => { const r = await buscarCep(e.cep ?? '').catch(() => null); if (r) setE({ ...e, ...r }) }} /></Campo>
          <Campo rotulo="UF"><input className="campo" maxLength={2} {...txt('uf')} /></Campo>
          <Campo rotulo="Rua" className="col-span-2"><input className="campo" {...txt('logradouro')} /></Campo>
          <Campo rotulo="Número"><input className="campo" {...txt('numero')} /></Campo>
          <Campo rotulo="Bairro"><input className="campo" {...txt('bairro')} /></Campo>
          <Campo rotulo="Cidade" className="col-span-2"><input className="campo" {...txt('cidade')} /></Campo>
          <Campo rotulo="Rodapé do pedido" className="col-span-2" dica="Ex.: chave PIX, horário de entrega"><textarea className="campo" rows={2} {...txt('rodape_pedido')} /></Campo>
        </section>
        {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
        <button className="btn-primario w-full"><Icone nome="ok" /> Salvar</button>
      </form>
    </>
  )
}
