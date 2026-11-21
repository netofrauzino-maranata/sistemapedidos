import { useState, type ReactNode } from 'react'
import { Aviso, Cabecalho, Campo, Icone } from '../components/ui'
import { cupomTeste, imprimir, lerConfig, salvarConfig, type ConfigImpressora } from '../lib/impressora'

// Configuração da impressora térmica Bluetooth (fica salva só neste celular).
export default function Impressora() {
  const [c, setC] = useState<ConfigImpressora>(lerConfig())
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const set = (p: Partial<ConfigImpressora>) => { const n = { ...c, ...p }; setC(n); salvarConfig(n) }

  async function testar() {
    setMsg(null)
    try { await imprimir(await cupomTeste(c), c); if (c.modo === 'bluetooth') setMsg({ tipo: 'ok', texto: 'Teste enviado.' }) }
    catch (e) { setMsg({ tipo: 'erro', texto: (e as Error).message }) }
  }

  return (
    <>
      <Cabecalho titulo="Impressora Bluetooth" voltar="/mais" />
      <main className="space-y-3 p-4">
        <section className="cartao space-y-3">
          <h2 className="font-bold">Como conectar</h2>
          <div className="grid grid-cols-2 gap-2">
            {(['rawbt', 'bluetooth'] as const).map((m) => (
              <button key={m} type="button" onClick={() => set({ modo: m })}
                className={'rounded-xl p-2.5 text-left ring-1 ' + (c.modo === m ? 'bg-marca-700 text-white ring-marca-700' : 'bg-white ring-stone-300')}>
                <span className="block font-bold">{m === 'rawbt' ? 'App RawBT' : 'Bluetooth direto'}</span>
                <span className={'block text-xs ' + (c.modo === m ? 'text-marca-100' : 'text-stone-500')}>
                  {m === 'rawbt' ? 'Recomendado. Funciona com a MPT-III e qualquer térmica.' : 'Só impressoras BLE, pelo Chrome.'}
                </span>
              </button>
            ))}
          </div>
          {c.modo === 'rawbt' && (
            <ol className="list-decimal space-y-1 pl-5 text-sm text-stone-600">
              <li>Instale o app <b>RawBT</b> na Play Store (grátis).</li>
              <li>No RawBT, escolha a impressora pareada (ex.: MPT-III).</li>
              <li>Volte aqui e toque em <b>Teste de impressão</b>.</li>
            </ol>
          )}
        </section>

        <section className="cartao divide-y divide-stone-100 py-1">
          <Linha rotulo="Modelo">
            <div className="flex overflow-hidden rounded-xl ring-1 ring-stone-300">
              {([58, 80] as const).map((l) => (
                <button key={l} type="button" onClick={() => set({ largura: l })}
                  className={'px-3 py-2 text-sm font-bold ' + (c.largura === l ? 'bg-marca-700 text-white' : 'bg-white text-stone-600')}>Cupom {l}mm</button>
              ))}
            </div>
          </Linha>
          <Linha rotulo="Imprimir logo"><SimNao v={c.logo} on={(x) => set({ logo: x })} /></Linha>
          <Linha rotulo="Código de barras dos produtos"><SimNao v={c.codigoBarras} on={(x) => set({ codigoBarras: x })} /></Linha>
          <Linha rotulo="Imprimir QR Code"><SimNao v={c.qr} on={(x) => set({ qr: x })} /></Linha>
          {c.qr && <>
            <Linha rotulo="QR Code no topo"><SimNao v={c.qrTopo} on={(x) => set({ qrTopo: x })} /></Linha>
            <div className="py-2.5">
              <Campo rotulo="Conteúdo do QR Code (chave PIX, link, WhatsApp...)">
                <input className="campo" value={c.qrTexto} onChange={(e) => set({ qrTexto: e.target.value })} />
              </Campo>
            </div>
          </>}
          <div className="py-2.5">
            <Campo rotulo="Texto do rodapé (ex.: PIX: sua chave)">
              <input className="campo" value={c.rodape} onChange={(e) => set({ rodape: e.target.value })} />
            </Campo>
          </div>
          <Linha rotulo="Avançar linhas após imprimir">
            <input className="campo w-20 text-center" inputMode="numeric" value={c.avancar} onChange={(e) => set({ avancar: Math.min(15, Number(e.target.value) || 0) })} />
          </Linha>
          <Linha rotulo="Número de cópias">
            <input className="campo w-20 text-center" inputMode="numeric" value={c.copias} onChange={(e) => set({ copias: Math.min(5, Math.max(1, Number(e.target.value) || 1)) })} />
          </Linha>
        </section>

        {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
        <button className="btn-primario w-full" onClick={() => void testar()}><Icone nome="impressora" /> Teste de impressão</button>
        <p className="text-center text-xs text-stone-500">Essas opções ficam salvas só neste celular.</p>
      </main>
    </>
  )
}

function SimNao({ v, on }: { v: boolean; on: (x: boolean) => void }) {
  return (
    <div className="flex overflow-hidden rounded-xl ring-1 ring-stone-300">
      {[true, false].map((x) => (
        <button key={String(x)} type="button" onClick={() => on(x)}
          className={'w-14 py-2 text-sm font-bold ' + (v === x ? 'bg-marca-700 text-white' : 'bg-white text-stone-600')}>{x ? 'Sim' : 'Não'}</button>
      ))}
    </div>
  )
}
function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return <div className="flex items-center justify-between gap-3 py-2.5"><span className="font-medium">{rotulo}</span>{children}</div>
}

