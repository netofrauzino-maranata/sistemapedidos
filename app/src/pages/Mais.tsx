import { Link } from 'react-router-dom'
import { Cabecalho, Icone } from '../components/ui'
import { IndicadorSync, useEstadoSync } from '../components/Layout'
import { useAuth } from '../lib/auth'
import { dataHora } from '../lib/formato'
import { sincronizar } from '../lib/sync'

export default function Mais() {
  const { perfil, gestor, sair } = useAuth()
  const sync = useEstadoSync()
  const itens: [string, string, string, boolean][] = [
    ['/carga', 'Carga do dia', 'caminhao', true],
    ['/estoque', 'Estoque e validades', 'estoque', true],
    ['/estoque/entrada', 'Entrada de mercadoria', 'entrada', true],
    ['/estoque/entradas', 'Histórico de entradas', 'livro', true],
    ['/catalogo-pedidos', 'Catálogo online (link e pedidos)', 'pedido', false],
    ['/catalogo', 'Catálogo em PDF', 'livro', false],
    ['/config/impressora', 'Impressora Bluetooth', 'impressora', false],
    ['/relatorios', 'Relatórios', 'grafico', false],
    ['/exportar-nfe', 'Exportar vendas para NF-e', 'exportar', true],
    ['/config/categorias', 'Categorias de produtos', 'caixa', true],
    ['/config/tabelas', 'Tabelas de preço', 'preco', true],
    ['/config/empresa', 'Dados da empresa', 'empresa', true],
    ['/config/usuarios', 'Usuários e vendedores', 'usuarios', true],
  ]
  return (
    <>
      <Cabecalho titulo="Mais" acao={<IndicadorSync />} />
      <main className="space-y-3 p-4">
        <div className="cartao flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-marca-100 text-lg font-bold text-marca-700">{perfil?.nome?.[0]?.toUpperCase()}</span>
          <div>
            <p className="font-bold">{perfil?.nome}</p>
            <p className="text-sm text-stone-500">{perfil?.email} · {gestor ? 'Gestor' : 'Vendedor'}</p>
          </div>
        </div>
        <nav className="cartao divide-y divide-stone-100 p-0">
          {itens.filter(([, , , g]) => !g || gestor).map(([para, nome, icone]) => (
            <Link key={para} to={para} className="flex items-center gap-3 px-4 py-3.5 font-medium">
              <Icone nome={icone} className="h-5 w-5 text-marca-600" />{nome}
            </Link>
          ))}
        </nav>
        <div className="cartao space-y-2 text-sm">
          <p>{sync.ultimo ? `Última sincronização: ${dataHora(sync.ultimo)}` : 'Ainda não sincronizado.'}</p>
          {sync.erro && <p className="text-red-700">{sync.erro}</p>}
          <button className="btn-secundario w-full" disabled={sync.sincronizando} onClick={() => void sincronizar()}>
            <Icone nome="sync" className={sync.sincronizando ? 'h-5 w-5 animate-spin' : 'h-5 w-5'} /> Sincronizar agora
          </button>
        </div>
        <button className="btn-perigo w-full" onClick={() => void sair()}><Icone nome="sair" /> Sair</button>
        <p className="text-center text-xs text-stone-400">Maranata Pedidos · versão {__VERSAO__}</p>
      </main>
    </>
  )
}
