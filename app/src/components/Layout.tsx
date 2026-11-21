import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { db } from '../lib/db'
import { estadoSync, ouvirSync, sincronizar } from '../lib/sync'
import { Icone } from './ui'

export function useEstadoSync() {
  const [e, setE] = useState(estadoSync())
  useEffect(() => ouvirSync(setE), [])
  return e
}

export function useOnline() {
  const [on, setOn] = useState(navigator.onLine)
  useEffect(() => {
    const a = () => setOn(true), b = () => setOn(false)
    window.addEventListener('online', a); window.addEventListener('offline', b)
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b) }
  }, [])
  return on
}

export function IndicadorSync() {
  const e = useEstadoSync()
  const online = useOnline()
  const pendentes = useLiveQuery(async () =>
    (await db.pedidos.where('_sync').notEqual('ok').count()) + (await db.clientes.where('_sync').anyOf('pendente', 'erro').count()), []) ?? 0
  return (
    <button onClick={() => void sincronizar()} aria-label="Sincronizar"
      className="relative flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold">
      {online ? <Icone nome="sync" className={'h-4 w-4 ' + (e.sincronizando ? 'animate-spin' : '')} /> : <Icone nome="nuvemOff" className="h-4 w-4" />}
      {online ? (pendentes ? `${pendentes} a enviar` : 'Em dia') : 'Offline'}
      {pendentes > 0 && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-destaque" />}
    </button>
  )
}

const abas = [
  { para: '/', nome: 'Início', icone: 'inicio' },
  { para: '/pedidos', nome: 'Pedidos', icone: 'pedido' },
  { para: '/clientes', nome: 'Clientes', icone: 'cliente' },
  { para: '/produtos', nome: 'Produtos', icone: 'produto' },
  { para: '/mais', nome: 'Mais', icone: 'menu' },
]

export function Layout() {
  return (
    <div className="mx-auto min-h-full max-w-3xl pb-nav">
      <Outlet />
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto grid max-w-3xl grid-cols-5">
          {abas.map((a) => (
            <NavLink key={a.para} to={a.para} end={a.para === '/'}
              className={({ isActive }) => 'flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ' +
                (isActive ? 'text-marca-700' : 'text-stone-500')}>
              {({ isActive }) => (<>
                <span className={'rounded-full px-4 py-1 ' + (isActive ? 'bg-marca-100' : '')}><Icone nome={a.icone} /></span>
                {a.nome}
              </>)}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
