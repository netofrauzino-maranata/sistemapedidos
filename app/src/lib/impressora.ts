// Impressão do pedido em impressora térmica Bluetooth (ESC/POS), cupom 58 ou 80 mm.
// Dois caminhos:
//  1. App RawBT (Android): funciona com qualquer impressora Bluetooth, inclusive as
//     "clássicas" como a MPT-III. O app Maranata manda o cupom pronto para o RawBT imprimir.
//  2. Bluetooth direto pelo Chrome: só para impressoras Bluetooth LE (BLE).
// A configuração fica guardada no próprio celular.
import { data, dataHora, docFormatado, foneFormatado } from './formato'
import type { Cliente, CondicaoPagamento, Empresa, FormaPagamento, Pedido, Perfil } from './tipos'

export interface ConfigImpressora {
  modo: 'rawbt' | 'bluetooth'
  largura: 58 | 80
  logo: boolean
  qr: boolean
  qrTopo: boolean
  qrTexto: string
  rodape: string
  avancar: number
  copias: number
  codigoBarras: boolean
}

const CHAVE = 'maranata-impressora'
const PADRAO: ConfigImpressora = {
  modo: 'rawbt', largura: 80, logo: true, qr: false, qrTopo: false, qrTexto: '', rodape: '', avancar: 4, copias: 1, codigoBarras: false,
}

export function lerConfig(): ConfigImpressora {
  try { return { ...PADRAO, ...JSON.parse(localStorage.getItem(CHAVE) ?? '{}') } } catch { return PADRAO }
}
export function salvarConfig(c: ConfigImpressora) {
  try { localStorage.setItem(CHAVE, JSON.stringify(c)) } catch { /* sem armazenamento */ }
}

// ---------- montagem do cupom ----------
class Cupom {
  private b: number[] = []
  colunas: number
  constructor(colunas: number) { this.colunas = colunas; this.b.push(0x1b, 0x40) } // inicializa
  bytes() { return new Uint8Array(this.b) }
  raw(...x: number[]) { this.b.push(...x); return this }
  texto(s: string) {
    // sem acento: funciona em qualquer impressora, sem depender da tabela de caracteres
    const t = s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e\n]/g, '')
    for (const ch of t) this.b.push(ch.charCodeAt(0))
    return this
  }
  linha(s = '') { return this.texto(s + '\n') }
  centro(on = true) { return this.raw(0x1b, 0x61, on ? 1 : 0) }
  negrito(on = true) { return this.raw(0x1b, 0x45, on ? 1 : 0) }
  grande(on = true) { return this.raw(0x1d, 0x21, on ? 0x11 : 0) }
  alto(on = true) { return this.raw(0x1d, 0x21, on ? 0x01 : 0) } // altura dupla, mesma largura
  separador(c = '-') { return this.linha(c.repeat(this.colunas)) }
  direita(s: string) { return this.linha(s.length >= this.colunas ? s : ' '.repeat(this.colunas - s.length) + s) }
  // texto à esquerda e valor à direita na mesma linha
  par(esq: string, dir: string) {
    const max = this.colunas - dir.length - 1
    const e = esq.length > max ? esq.slice(0, max) : esq
    return this.linha(e + ' '.repeat(this.colunas - e.length - dir.length) + dir)
  }
  quebrado(s: string) {
    const palavras = s.split(/\s+/); let l = ''
    for (const p of palavras) {
      if ((l + ' ' + p).trim().length > this.colunas) { this.linha(l.trim()); l = p } else l += ' ' + p
    }
    if (l.trim()) this.linha(l.trim())
    return this
  }
  qr(conteudo: string) {
    const d = Array.from(new TextEncoder().encode(conteudo))
    const n = d.length + 3
    this.centro()
    this.raw(0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0) // modelo 2
    this.raw(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x43, 6)       // tamanho do módulo
    this.raw(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31)    // correção M
    this.raw(0x1d, 0x28, 0x6b, n & 0xff, n >> 8, 0x31, 0x50, 0x30, ...d)
    this.raw(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30)    // imprime
    return this.linha().centro(false)
  }
  ean(codigo: string) {
    const c = codigo.replace(/\D/g, '')
    if (c.length !== 13 && c.length !== 8) return this
    this.centro().raw(0x1d, 0x68, 50, 0x1d, 0x77, 2, 0x1d, 0x48, 2) // altura, largura, número embaixo
    this.raw(0x1d, 0x6b, c.length === 13 ? 67 : 68, c.length, ...Array.from(c).map((x) => x.charCodeAt(0)))
    return this.linha().centro(false)
  }
  imagem(px: { largura: number; altura: number; bits: Uint8Array }) {
    const bpl = px.largura / 8
    this.centro().raw(0x1d, 0x76, 0x30, 0, bpl & 0xff, bpl >> 8, px.altura & 0xff, px.altura >> 8, ...px.bits)
    return this.linha().centro(false)
  }
}

// logo em preto e branco, no tamanho da bobina
async function logoMonocromatico(larguraPontos: number) {
  const img = new Image()
  img.src = '/logo.png'
  await img.decode()
  const larg = Math.floor((larguraPontos * 0.7) / 8) * 8
  const alt = Math.round((img.height * larg) / img.width)
  const cv = document.createElement('canvas'); cv.width = larg; cv.height = alt
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, larg, alt); ctx.drawImage(img, 0, 0, larg, alt)
  const d = ctx.getImageData(0, 0, larg, alt).data
  const bits = new Uint8Array((larg / 8) * alt)
  for (let y = 0; y < alt; y++) for (let x = 0; x < larg; x++) {
    const i = (y * larg + x) * 4
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    // o fundo da logo é azul escuro: imprime o azul em preto e as letras em branco
    if (lum < 150) bits[y * (larg / 8) + (x >> 3)] |= 0x80 >> (x & 7)
  }
  return { largura: larg, altura: alt, bits }
}

export interface DadosCupom {
  pedido: Pedido
  cliente?: Cliente | null
  vendedor?: Perfil | null
  empresa?: Empresa | null
  condicao?: CondicaoPagamento | null
  forma?: FormaPagamento | null
  gtins?: Map<string, string | null>
  tabela?: string | null
}

const reais = (v: number) => Number(v ?? 0).toFixed(2).replace('.', ',')
const qtdTxt = (v: number) => String(Number(v)).replace('.', ',')

export async function montarCupom(d: DadosCupom, cfg: ConfigImpressora): Promise<Uint8Array> {
  const colunas = cfg.largura === 58 ? 32 : 48
  const pontos = cfg.largura === 58 ? 384 : 576
  const c = new Cupom(colunas)
  const { pedido: p, cliente: cl, empresa: e } = d
  const troca = d.forma?.conta_como_venda === false
  const end = (o?: { logradouro?: string | null; numero?: string | null; complemento?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null } | null) =>
    o?.logradouro ? `Endereco:${o.logradouro}, nro.${o.numero || 'SN'}${o.complemento ? ' ' + o.complemento : ''} - Bairro:${o.bairro ?? ''} Cidade:${o.cidade ?? ''} - ${o.uf ?? ''}` : ''

  // ----- empresa (mesmo modelo do app antigo) -----
  if (cfg.qr && cfg.qrTopo && cfg.qrTexto) c.qr(cfg.qrTexto)
  if (cfg.logo) { try { c.imagem(await logoMonocromatico(pontos)) } catch { /* sem logo */ } }
  c.quebrado(e?.razao_social || 'Maranata Distribuidora')
  if (e?.nome_fantasia && e.nome_fantasia !== e.razao_social) c.quebrado(e.nome_fantasia)
  if (e?.cnpj) c.linha('CNPJ ' + e.cnpj)
  if (e?.ie) c.linha('Insc. Estadual ' + e.ie)
  if (e?.email) c.linha('Email:' + e.email)
  if (e?.telefone) c.linha('Fone:' + foneFormatado(e.telefone))
  const endEmp = end(e)
  if (endEmp) { c.linha(); c.quebrado(endEmp) }
  c.linha()
  c.linha('Data:' + dataHora(new Date().toISOString()))
  if (d.vendedor?.nome) c.linha('Vend.:' + d.vendedor.nome)
  c.separador()

  // ----- pedido e cliente -----
  const titulo = p.status === 'orcamento' ? 'ORCAMENTO' : troca ? 'TROCA' : 'PEDIDO'
  c.negrito().alto().linha(`${titulo}:${p.numero ?? 'provisorio'}`).alto(false).negrito(false)
  c.linha('Emissao:' + dataHora(p.data_pedido))
  c.quebrado(`Razao:${cl?.codigo ? cl.codigo + '-' : ''}${cl?.razao_social ?? ''}`)
  if (cl?.nome_fantasia) c.quebrado('Nome fantasia:' + cl.nome_fantasia)
  if (cl?.cpf_cnpj) c.linha('CNPJ/CPF:' + docFormatado(cl.cpf_cnpj))
  if (cl?.ie) c.linha('Insc. Estadual:' + cl.ie)
  if (cl?.telefone) c.linha('Fone:' + foneFormatado(cl.telefone))
  const endCli = end(cl)
  if (endCli) c.quebrado(endCli)
  c.linha('Forma cob.:' + (d.forma?.nome ?? ''))
  c.linha('Cond.pagto.:' + (d.condicao?.nome ?? ''))
  c.linha('Tabela de preco:' + (d.tabela ?? ''))
  if (p.data_entrega) c.linha('Entrega:' + data(p.data_entrega))
  c.separador()

  // ----- itens, na ordem digitada -----
  c.linha('CODIGO DESCRICAO')
  c.par('  QTD. UN. VL UNIT', 'VL ITEM')
  c.separador()
  for (const i of p.itens) {
    c.quebrado(`${i.produto_codigo ?? ''} ${(i.produto_nome ?? '').toUpperCase()}`.trim())
    c.par(`  ${qtdTxt(i.quantidade)} ${(i.unidade ?? '').toLowerCase()} X R$ ${reais(i.preco_unitario)}${i.desconto ? ` -${reais(i.desconto)}` : ''}`, reais(i.total))
    const g = d.gtins?.get(i.produto_id)
    if (cfg.codigoBarras && g) c.ean(g)
  }
  c.separador()

  // ----- totais -----
  const vols = p.itens.reduce((s, i) => s + Number(i.quantidade), 0)
  c.par(`${p.itens.length} itens`, `Subtotal:R$ ${reais(p.subtotal)}`)
  c.linha(`${qtdTxt(vols)} Vols.`)
  const pct = p.subtotal ? Math.round((p.desconto / p.subtotal) * 1000) / 10 : 0
  c.direita(`Desc.(${qtdTxt(pct)}%):R$ ${reais(p.desconto)}`)
  c.direita(`Frete: R$ ${reais(p.frete)}`)
  c.negrito().alto().direita(`Total: R$ ${reais(p.total)}`).alto(false).negrito(false)
  if (p.observacao) { c.linha(); c.quebrado('Obs:' + p.observacao) }
  if (troca) { c.linha(); c.centro().negrito().linha('*** TROCA - NAO E VENDA ***').negrito(false).centro(false) }

  const rodape = cfg.rodape || e?.rodape_pedido
  c.linha()
  if (rodape) { c.centro(); c.quebrado(rodape); c.centro(false) }
  c.centro().linha('APP MARANATA PEDIDOS').centro(false)
  if (cfg.qr && !cfg.qrTopo && cfg.qrTexto) { c.linha(); c.qr(cfg.qrTexto) }
  for (let k = 0; k < Math.max(0, cfg.avancar); k++) c.linha()
  c.raw(0x1d, 0x56, 0x42, 0) // corta o papel (se a impressora tiver guilhotina)
  const um = c.bytes()
  const n = Math.max(1, Math.min(5, cfg.copias))
  const tudo = new Uint8Array(um.length * n)
  for (let k = 0; k < n; k++) tudo.set(um, k * um.length)
  return tudo
}

export async function cupomTeste(cfg: ConfigImpressora) {
  const c = new Cupom(cfg.largura === 58 ? 32 : 48)
  if (cfg.logo) { try { c.imagem(await logoMonocromatico(cfg.largura === 58 ? 384 : 576)) } catch { /* sem logo */ } }
  c.centro().negrito().linha('TESTE DE IMPRESSAO').negrito(false).linha('Maranata Pedidos').centro(false).separador()
  c.par('Bobina', `${cfg.largura} mm`).par('Colunas', String(cfg.largura === 58 ? 32 : 48))
  if (cfg.qr && cfg.qrTexto) c.qr(cfg.qrTexto)
  if (cfg.rodape) c.centro().quebrado(cfg.rodape).centro(false)
  for (let k = 0; k < cfg.avancar; k++) c.linha()
  return c.bytes()
}

// ---------- envio ----------
function base64(b: Uint8Array) {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}

type Caracteristica = { writeValueWithoutResponse?: (v: BufferSource) => Promise<void>; writeValue: (v: BufferSource) => Promise<void>; properties: { write: boolean; writeWithoutResponse: boolean } }
let caracteristica: Caracteristica | null = null

// serviços usados pela maioria das impressoras térmicas BLE
const SERVICOS = [
  '000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', '0000ff00-0000-1000-8000-00805f9b34fb', '0000fee7-0000-1000-8000-00805f9b34fb',
]

async function conectarBle(): Promise<Caracteristica> {
  if (caracteristica) return caracteristica
  const bt = (navigator as unknown as { bluetooth?: { requestDevice: (o: unknown) => Promise<{ gatt: { connect: () => Promise<{ getPrimaryServices: () => Promise<{ getCharacteristics: () => Promise<Caracteristica[]> }[]> }> } }> } }).bluetooth
  if (!bt) throw new Error('Este navegador não tem Bluetooth. Use o Chrome no Android ou o modo RawBT.')
  const dev = await bt.requestDevice({ acceptAllDevices: true, optionalServices: SERVICOS })
  const srv = await dev.gatt.connect()
  for (const s of await srv.getPrimaryServices()) {
    for (const ch of await s.getCharacteristics()) {
      if (ch.properties.write || ch.properties.writeWithoutResponse) { caracteristica = ch; return ch }
    }
  }
  throw new Error('Impressora conectada, mas não aceitou dados. Use o modo RawBT.')
}

export async function imprimir(bytes: Uint8Array, cfg: ConfigImpressora) {
  if (cfg.modo === 'rawbt') {
    const b64 = base64(bytes)
    // abre o app RawBT; se não estiver instalado, o Android leva para a Play Store
    location.href = `intent:base64,${b64}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`
    return
  }
  const ch = await conectarBle()
  for (let i = 0; i < bytes.length; i += 180) {
    const parte = bytes.slice(i, i + 180)
    try {
      if (ch.properties.writeWithoutResponse && ch.writeValueWithoutResponse) await ch.writeValueWithoutResponse(parte)
      else await ch.writeValue(parte)
    } catch (e) { caracteristica = null; throw e }
    await new Promise((r) => setTimeout(r, 20))
  }
}
