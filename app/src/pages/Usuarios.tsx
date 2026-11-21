import { useEffect, useState } from 'react'
import { Aviso, Cabecalho } from '../components/ui'
import { useAuth } from '../lib/auth'
import { db } from '../lib/db'
import { supabase } from '../lib/supabase'
import type { Perfil } from '../lib/tipos'

export default function Usuarios() {
  const { perfil: eu } = useAuth()
  const [lista, setLista] = useState<Perfil[]>([])
  const [erro, setErro] = useState('')

  async function carregar() {
    const { data, error } = await supabase.from('perfis').select('*').order('ativo').order('nome')
    if (error) return setErro(error.message)
    setLista(data as Perfil[]); await db.perfis.bulkPut(data as Perfil[])
  }
  useEffect(() => { void carregar() }, [])

  async function alterar(p: Perfil, mud: Partial<Perfil>) {
    if (p.id === eu?.id && (mud.ativo === false || mud.papel === 'vendedor')) return setErro('Você não pode tirar seu próprio acesso de gestor.')
    const { error } = await supabase.from('perfis').update(mud).eq('id', p.id)
    if (error) setErro(error.message); else void carregar()
  }

  return (
    <>
      <Cabecalho titulo="Usuários" voltar />
      <main className="space-y-3 p-4">
        <Aviso>Para incluir um vendedor: ele abre o app, toca em <b>Criar conta</b> e você libera aqui.</Aviso>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {lista.map((p) => (
          <div key={p.id} className="cartao space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold">{p.nome} {p.id === eu?.id && <span className="text-xs text-stone-500">(você)</span>}</p>
                <p className="text-xs text-stone-500">{p.email}</p>
              </div>
              {!p.ativo && <span className="etiqueta bg-amber-100 text-amber-800">Aguardando</span>}
            </div>
            <div className="flex gap-2">
              <select className="campo" value={p.papel} onChange={(e) => void alterar(p, { papel: e.target.value as Perfil['papel'] })}>
                <option value="vendedor">Vendedor</option><option value="gestor">Gestor</option>
              </select>
              <button className={p.ativo ? 'btn-perigo shrink-0' : 'btn-primario shrink-0'} onClick={() => void alterar(p, { ativo: !p.ativo })}>
                {p.ativo ? 'Bloquear' : 'Liberar'}
              </button>
            </div>
          </div>
        ))}
      </main>
    </>
  )
}
