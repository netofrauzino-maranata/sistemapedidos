import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { Aviso, Campo } from '../components/ui'

function Marca() {
  return (
    <div className="mb-6 flex flex-col items-center text-center">
      <img src="/mascote.png" alt="Mascote Maranata" className="-mb-6 h-40 w-auto drop-shadow-md" />
      <img src="/logo.png" alt="Maranata Distribuidora" className="relative w-64 max-w-full drop-shadow" />
      <p className="mt-2 text-xs font-bold tracking-[0.25em] text-marca-700">APP DE PEDIDOS</p>
    </div>
  )
}

export default function Login() {
  const [modo, setModo] = useState<'entrar' | 'criar' | 'esqueci'>('entrar')
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [msg, setMsg] = useState<{ tipo: 'erro' | 'ok'; texto: string } | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setMsg(null); setEnviando(true)
    try {
      if (modo === 'entrar') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
        if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message)
      } else if (modo === 'criar') {
        const { error } = await supabase.auth.signUp({ email, password: senha, options: { data: { nome } } })
        if (error) throw error
        setMsg({ tipo: 'ok', texto: 'Conta criada. Se pedir confirmação, veja seu e-mail. Depois o gestor libera seu acesso.' })
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin })
        if (error) throw error
        setMsg({ tipo: 'ok', texto: 'Enviamos um link para redefinir a senha.' })
      }
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message })
    } finally { setEnviando(false) }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-b from-marca-50 to-fundo p-6">
      <form onSubmit={enviar} className="w-full max-w-sm space-y-4">
        <Marca />
        {modo === 'criar' && (
          <Campo rotulo="Seu nome"><input className="campo" required value={nome} onChange={(e) => setNome(e.target.value)} /></Campo>
        )}
        <Campo rotulo="E-mail"><input className="campo" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Campo>
        {modo !== 'esqueci' && (
          <Campo rotulo="Senha"><input className="campo" type="password" required minLength={6} autoComplete={modo === 'criar' ? 'new-password' : 'current-password'} value={senha} onChange={(e) => setSenha(e.target.value)} /></Campo>
        )}
        {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
        <button className="btn-primario w-full" disabled={enviando}>
          {enviando ? 'Aguarde...' : modo === 'entrar' ? 'Entrar' : modo === 'criar' ? 'Criar conta' : 'Enviar link'}
        </button>
        <div className="flex justify-between text-sm font-medium text-marca-700">
          {modo !== 'entrar' ? <button type="button" onClick={() => setModo('entrar')}>Já tenho conta</button>
            : <button type="button" onClick={() => setModo('criar')}>Criar conta</button>}
          {modo === 'entrar' && <button type="button" onClick={() => setModo('esqueci')}>Esqueci a senha</button>}
        </div>
      </form>
    </div>
  )
}

export function AguardandoLiberacao() {
  const { sair, perfil } = useAuth()
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm text-center">
        <Marca />
        <Aviso tipo="alerta">Olá, {perfil?.nome}. Seu acesso está aguardando liberação do gestor.</Aviso>
        <div className="mt-4 flex gap-2">
          <button className="btn-secundario flex-1" onClick={() => location.reload()}>Verificar de novo</button>
          <button className="btn-perigo flex-1" onClick={() => void sair()}>Sair</button>
        </div>
      </div>
    </div>
  )
}
