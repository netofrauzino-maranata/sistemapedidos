// CSV no padrão do Excel brasileiro: separador ";" e vírgula decimal.
export function gerarCsv(linhas: Record<string, unknown>[], colunas?: string[]) {
  if (!linhas.length) return ''
  const cols = colunas ?? Object.keys(linhas[0])
  const fmt = (v: unknown) => {
    if (v === null || v === undefined) return ''
    if (typeof v === 'number') return String(v).replace('.', ',')
    const s = String(v)
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.join(';'), ...linhas.map((l) => cols.map((c) => fmt(l[c])).join(';'))].join('\r\n')
}

export function baixarArquivo(conteudo: string, nome: string, tipo = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + conteudo], { type: tipo })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = nome; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
