import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/auth'
import './index.css'

// Fotos dos produtos trocadas em 22/11 e 25/11/2026: apaga os caches antigos para o celular baixar as novas.
if ('caches' in window) for (const c of ['fotos-padrao', 'fotos-padrao-v2']) caches.delete(c).catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
