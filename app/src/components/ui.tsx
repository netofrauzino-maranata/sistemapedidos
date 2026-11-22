import { useEffect, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'

export function Campo({ rotulo, children, dica, className = '' }: { rotulo: string; children: ReactNode; dica?: string; className?: string }) {
  return (
    <label className={'block ' + className}>
      <span className="rotulo">{rotulo}</span>
      {children}
      {dica && <span className="mt-1 block text-xs text-stone-500">{dica}</span>}
    </label>
  )
}

export function Cabecalho({ titulo, voltar, acao, logo }: { titulo: string; voltar?: boolean | string; acao?: ReactNode; logo?: boolean }) {
  const nav = useNavigate()
  return (
    <header className="sticky top-0 z-20 flex items-center gap-2 bg-marca-700 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] text-white shadow border-b-2 border-destaque">
      {voltar && (
        <button aria-label="Voltar" className="-ml-2 rounded-full p-2 hover:bg-white/10"
          onClick={() => (typeof voltar === 'string' ? nav(voltar) : nav(-1))}>
          <Icone nome="voltar" />
        </button>
      )}
      {logo && <img src="/logo.png" alt="Maranata" className="h-9 w-auto shrink-0" />}
      <h1 className="flex-1 truncate text-lg font-bold">{titulo}</h1>
      {acao}
    </header>
  )
}

export function Busca({ valor, onChange, placeholder = 'Buscar...', autoFocus, onEnter }: {
  valor: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; onEnter?: () => void
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400"><Icone nome="busca" /></span>
      <input className="campo pl-10" type="search" value={valor} placeholder={placeholder} autoFocus={autoFocus} enterKeyHint="search"
        onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter() } }} />
    </div>
  )
}

export function Vazio({ texto, children }: { texto: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center text-stone-500">
      <Icone nome="caixa" className="h-10 w-10 text-stone-300" />
      <p>{texto}</p>
      {children}
    </div>
  )
}

export function BotaoFlutuante({ para, rotulo }: { para: string; rotulo: string }) {
  return (
    <Link to={para} aria-label={rotulo}
      className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-30 flex h-14 items-center gap-2 rounded-full bg-destaque px-5 font-bold text-stone-900 shadow-lg active:scale-95">
      <Icone nome="mais" /> {rotulo}
    </Link>
  )
}

export function Folha({ aberta, onFechar, titulo, children }: { aberta: boolean; onFechar: () => void; titulo: string; children: ReactNode }) {
  useEffect(() => {
    if (!aberta) return
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onFechar()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [aberta, onFechar])
  if (!aberta) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onFechar}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{titulo}</h2>
          <button className="rounded-full p-2 hover:bg-stone-100" onClick={onFechar} aria-label="Fechar"><Icone nome="fechar" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Aviso({ tipo = 'info', children }: { tipo?: 'info' | 'erro' | 'ok' | 'alerta'; children: ReactNode }) {
  const cor = {
    info: 'bg-sky-50 text-sky-800 ring-sky-200',
    erro: 'bg-red-50 text-red-800 ring-red-200',
    ok: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    alerta: 'bg-amber-50 text-amber-900 ring-amber-200',
  }[tipo]
  return <div className={'rounded-xl px-3 py-2 text-sm ring-1 ' + cor}>{children}</div>
}

const caminhos: Record<string, ReactNode> = {
  voltar: <path d="M15 18l-6-6 6-6" />,
  busca: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  mais: <path d="M12 5v14M5 12h14" />,
  menos: <path d="M5 12h14" />,
  fechar: <path d="M18 6L6 18M6 6l12 12" />,
  caixa: <><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></>,
  inicio: <><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></>,
  pedido: <><path d="M6 2h9l5 5v15H6z" /><path d="M14 2v6h6M9 13h8M9 17h6" /></>,
  cliente: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
  produto: <><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  sync: <><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" /><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" /><path d="M21 3v5h-5M3 21v-5h5" /></>,
  nuvemOff: <><path d="M3 3l18 18" /><path d="M7 18h10a4 4 0 0 0 1-7.9A6 6 0 0 0 8.4 7" /></>,
  ok: <path d="M20 6L9 17l-5-5" />,
  pdf: <><path d="M6 2h9l5 5v15H6z" /><path d="M14 2v6h6" /><path d="M9 15h6" /></>,
  whatsapp: <path d="M20.5 3.5A11 11 0 0 0 3.6 17.2L2 22l4.9-1.6A11 11 0 1 0 20.5 3.5zM8.5 7.5c.3-.6.6-.6 1-.6h.6c.2 0 .5 0 .7.6l.9 2.1c.1.3 0 .5-.1.7l-.6.7c-.2.2-.2.4 0 .7a8 8 0 0 0 3.4 3c.3.1.5.1.7-.1l.8-.9c.2-.3.5-.3.8-.2l2 1c.3.1.5.3.5.5 0 .9-.5 1.9-1.3 2.2-.9.4-2.2.4-4.8-.8a11 11 0 0 1-4.6-4.5c-.9-1.6-.7-3.2.0-4.4z" />,
  lixo: <><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15" /></>,
  editar: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  estoque: <><path d="M3 21V8l9-5 9 5v13" /><path d="M7 21v-8h10v8M7 17h10" /></>,
  grafico: <><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></>,
  livro: <><path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z" /><path d="M8 4v16" /></>,
  exportar: <><path d="M12 3v12M7 8l5-5 5 5" /><path d="M5 21h14" /></>,
  empresa: <><path d="M3 21h18M5 21V7l7-4 7 4v14" /><path d="M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4" /></>,
  usuarios: <><circle cx="9" cy="8" r="3.5" /><path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5" /><path d="M16 4a3.5 3.5 0 0 1 0 7M22 20c0-3-2-5-5-5.4" /></>,
  sair: <><path d="M9 21H5V3h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>,
  alerta: <><path d="M12 3l10 18H2z" /><path d="M12 10v4M12 18h.01" /></>,
  impressora: <><path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M7 14h10v7H7z" /></>,
  preco: <><path d="M20.6 13.4L13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.5" /></>,
  caminhao: <><path d="M1 4h13v12H1z" /><path d="M14 8h4l4 4v4h-8z" /><circle cx="5.5" cy="18.5" r="2" /><circle cx="17.5" cy="18.5" r="2" /></>,
  entrada: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></>,
}

export function Icone({ nome, className = 'h-5 w-5' }: { nome: keyof typeof caminhos | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {caminhos[nome]}
    </svg>
  )
}
