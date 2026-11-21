// Código de barras EAN-13 / EAN-8 desenhado no PDF (sem biblioteca).
// Devolve a sequência de módulos: '1' = barra preta, '0' = espaço.
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100']
const PARIDADE = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

function digitoOk(cod: string) {
  const d = cod.split('').map(Number)
  const ultimo = d.pop()!
  const soma = d.reverse().reduce((s, x, i) => s + x * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (soma % 10)) % 10 === ultimo
}

export function modulosEan(codigo?: string | null): string | null {
  const c = (codigo ?? '').replace(/\D/g, '')
  if (c.length === 13 && digitoOk(c)) {
    const par = PARIDADE[Number(c[0])]
    let m = '101'
    for (let i = 1; i <= 6; i++) m += (par[i - 1] === 'L' ? L : G)[Number(c[i])]
    m += '01010'
    for (let i = 7; i <= 12; i++) m += R[Number(c[i])]
    return m + '101'
  }
  if (c.length === 8 && digitoOk(c)) {
    let m = '101'
    for (let i = 0; i < 4; i++) m += L[Number(c[i])]
    m += '01010'
    for (let i = 4; i < 8; i++) m += R[Number(c[i])]
    return m + '101'
  }
  return null
}
