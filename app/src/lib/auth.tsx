import type { Session } from '@supabase/supabase-js'
import { useLiveQuery } from 'dexie-react-hooks'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { db, limparBancoLocal } from './db'
import { supabase } from './supabase'
import { iniciarSincronizacaoAutomatica } from './sync'
import type { Perfil } from './tipos'

interface Ctx {
  session: Session | null
  perfil: Perfil | null
  carregando: boolean
  gestor: boolean
  sair: () => Promise<void>
}
const AuthCtx = createContext<Ctx>({ session: null, perfil: null, carregando: true, gestor: false, sair: async () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setCarregando(false) })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const uid = session?.user.id
  useEffect(() => {
    if (!uid) return
    // perfil direto do servidor na entrada (o resto vem pela sincronização)
    supabase.from('perfis').select('*').eq('id', uid).maybeSingle().then(({ data }) => {
      if (data) void db.perfis.put(data as Perfil)
    })
    return iniciarSincronizacaoAutomatica()
  }, [uid])

  const perfil = useLiveQuery(() => (uid ? db.perfis.get(uid) : undefined), [uid]) ?? null

  const sair = async () => {
    const pendentes = await db.pedidos.where('_sync').notEqual('ok').count()
    if (pendentes && !confirm(`Há ${pendentes} pedido(s) não enviados. Se sair agora eles serão perdidos. Sair mesmo assim?`)) return
    await supabase.auth.signOut()
    await limparBancoLocal()
  }

  return (
    <AuthCtx.Provider value={{ session, perfil, carregando, gestor: perfil?.papel === 'gestor' && perfil.ativo, sair }}>
      {children}
    </AuthCtx.Provider>
  )
}

export const useAuth = () => useContext(AuthCtx)
