const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const numero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 })

export const brl = (v: number | null | undefined) => moeda.format(Number(v ?? 0))
export const num = (v: number | null | undefined) => numero.format(Number(v ?? 0))

export function data(v: string | null | undefined) {
  if (!v) return ''
  const d = v.length <= 10 ? new Date(v + 'T12:00:00') : new Date(v)
  return d.toLocaleDateString('pt-BR')
}
export function dataHora(v: string | null | undefined) {
  if (!v) return ''
  return new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}
export const hojeISO = () => new Date().toLocaleDateString('en-CA') // AAAA-MM-DD no fuso local

export const soDigitos = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '')

export function docFormatado(v: string | null | undefined) {
  const d = soDigitos(v)
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return v ?? ''
}

export function foneFormatado(v: string | null | undefined) {
  const d = soDigitos(v)
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
  return v ?? ''
}

function digitoVerificador(base: string, pesos: number[]) {
  const soma = base.split('').reduce((s, c, i) => s + Number(c) * pesos[i], 0)
  const r = soma % 11
  return r < 2 ? 0 : 11 - r
}

export function cpfValido(v: string) {
  const d = soDigitos(v)
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false
  const d1 = (d.slice(0, 9).split('').reduce((s, c, i) => s + Number(c) * (10 - i), 0) * 10) % 11 % 10
  const d2 = (d.slice(0, 10).split('').reduce((s, c, i) => s + Number(c) * (11 - i), 0) * 10) % 11 % 10
  return d1 === Number(d[9]) && d2 === Number(d[10])
}

export function cnpjValido(v: string) {
  const d = soDigitos(v)
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  return digitoVerificador(d.slice(0, 12), p1) === Number(d[12]) &&
         digitoVerificador(d.slice(0, 13), p2) === Number(d[13])
}

export const normalizar = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export const uuid = () => crypto.randomUUID()

export const arred = (v: number, casas = 2) => Math.round((v + Number.EPSILON) * 10 ** casas) / 10 ** casas

// Busca de produto: só números = código (002, 2) ou código de barras; texto = descrição.
export function filtrarProdutos<T extends { codigo: string; nome: string; marca?: string | null; gtin?: string | null }>(lista: T[], busca: string): T[] {
  const b = busca.trim()
  if (!b) return lista
  if (/^\d+$/.test(b)) {
    const n = Number(b)
    const exato = lista.filter((p) => p.codigo === b || (/^\d+$/.test(p.codigo) && Number(p.codigo) === n) || p.gtin === b)
    const comeca = lista.filter((p) => !exato.includes(p) && (p.codigo.startsWith(b) || (b.length >= 4 && (p.gtin ?? '').includes(b))))
    return [...exato, ...comeca]
  }
  const termos = normalizar(b).split(/\s+/)
  return lista.filter((p) => { const t = normalizar(`${p.nome} ${p.marca ?? ''} ${p.codigo}`); return termos.every((x) => t.includes(x)) })
}
