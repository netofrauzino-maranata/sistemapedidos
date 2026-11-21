import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { useAuth } from './lib/auth'
import { supabaseConfigurado } from './lib/supabase'
import Catalogo from './pages/Catalogo'
import ClienteForm from './pages/ClienteForm'
import Clientes from './pages/Clientes'
import Empresa from './pages/Empresa'
import Entrada from './pages/Entrada'
import Estoque from './pages/Estoque'
import ExportarNfe from './pages/ExportarNfe'
import Inicio from './pages/Inicio'
import Login, { AguardandoLiberacao } from './pages/Login'
import Mais from './pages/Mais'
import PedidoDetalhe from './pages/PedidoDetalhe'
import PedidoForm from './pages/PedidoForm'
import Pedidos from './pages/Pedidos'
import ProdutoForm from './pages/ProdutoForm'
import Produtos from './pages/Produtos'
import Relatorios from './pages/Relatorios'
import Usuarios from './pages/Usuarios'
import TabelasPreco from './pages/TabelasPreco'
import Impressora from './pages/Impressora'
import Carga from './pages/Carga'

function SoGestor({ children }: { children: ReactNode }) {
  const { gestor } = useAuth()
  return gestor ? <>{children}</> : <Navigate to="/" replace />
}

export default function App() {
  const { session, perfil, carregando } = useAuth()

  if (!supabaseConfigurado) {
    return (
      <div className="p-6 text-center">
        <h1 className="text-xl font-bold">Configuração pendente</h1>
        <p className="mt-2 text-stone-600">Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (veja .env.example).</p>
      </div>
    )
  }
  if (carregando) return <div className="flex h-full items-center justify-center text-marca-700">Carregando...</div>
  if (!session) return <Login />
  if (perfil && !perfil.ativo) return <AguardandoLiberacao />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Inicio />} />
        <Route path="pedidos" element={<Pedidos />} />
        <Route path="pedidos/novo" element={<PedidoForm />} />
        <Route path="pedidos/:id" element={<PedidoDetalhe />} />
        <Route path="pedidos/:id/editar" element={<PedidoForm />} />
        <Route path="clientes" element={<Clientes />} />
        <Route path="clientes/novo" element={<ClienteForm />} />
        <Route path="clientes/:id" element={<ClienteForm />} />
        <Route path="produtos" element={<Produtos />} />
        <Route path="produtos/novo" element={<SoGestor><ProdutoForm /></SoGestor>} />
        <Route path="produtos/:id" element={<ProdutoForm />} />
        <Route path="catalogo" element={<Catalogo />} />
        <Route path="relatorios" element={<Relatorios />} />
        <Route path="mais" element={<Mais />} />
        <Route path="estoque" element={<SoGestor><Estoque /></SoGestor>} />
        <Route path="estoque/entrada" element={<SoGestor><Entrada /></SoGestor>} />
        <Route path="carga" element={<SoGestor><Carga /></SoGestor>} />
        <Route path="exportar-nfe" element={<SoGestor><ExportarNfe /></SoGestor>} />
        <Route path="config/empresa" element={<SoGestor><Empresa /></SoGestor>} />
        <Route path="config/usuarios" element={<SoGestor><Usuarios /></SoGestor>} />
        <Route path="config/impressora" element={<Impressora />} />
        <Route path="config/tabelas" element={<SoGestor><TabelasPreco /></SoGestor>} />
        <Route path="config/tabelas/:id" element={<SoGestor><TabelasPreco /></SoGestor>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
