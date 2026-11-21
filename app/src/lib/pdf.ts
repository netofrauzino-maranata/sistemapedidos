import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { brl, data, dataHora, docFormatado, foneFormatado, num } from './formato'
import type { Categoria, Cliente, CondicaoPagamento, Empresa, FormaPagamento, Pedido, Perfil, Produto } from './tipos'
import { STATUS_LABEL } from './tipos'
import logoPdf from '../assets/logo-pdf.jpg?inline'
import { modulosEan } from './codigobarras'
import { NOME_RELATORIO, porCliente, rotuloCliente, somarItens, totaisCarga, type DadosCarga, type TipoRelatorioCarga } from './carga'

// PDFs gerados no próprio celular (funciona offline).
const AZUL: [number, number, number] = [30, 91, 198] // mesmo azul do app (#1E5BC6)
const AMARELO: [number, number, number] = [255, 210, 0]
const VERMELHO: [number, number, number] = [227, 6, 19]

function enderecoEmpresa(e?: Empresa | null) {
  if (!e) return ''
  return [e.logradouro && `${e.logradouro}, ${e.numero ?? 's/n'}`, e.bairro, e.cidade && `${e.cidade}/${e.uf ?? ''}`]
    .filter(Boolean).join(' · ')
}

function cabecalho(doc: jsPDF, empresa: Empresa | null | undefined, titulo: string, subtitulo?: string) {
  const w = doc.internal.pageSize.getWidth()
  doc.setFillColor(...AZUL)
  doc.rect(0, 0, w, 26, 'F')
  doc.setFillColor(...AMARELO)
  doc.rect(0, 26, w, 1.2, 'F')
  doc.setFillColor(...VERMELHO)
  doc.rect(0, 27.2, w, 0.6, 'F')
  // logo (520x265 px): 21 mm de altura
  const lh = 21, lw = lh * 520 / 265
  doc.addImage(logoPdf, 'JPEG', 6, 2.5, lw, lh)
  const x = 6 + lw + 4
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
  doc.text(empresa?.razao_social || 'Maranata Distribuidora', x, 8.5, { maxWidth: w - x - 58 })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
  const larg = w - x - 58
  const l2 = [empresa?.cnpj && `CNPJ ${docFormatado(empresa.cnpj)}`, empresa?.ie && `IE ${empresa.ie}`].filter(Boolean).join('  ·  ')
  const l3 = [empresa?.telefone && foneFormatado(empresa.telefone), empresa?.email].filter(Boolean).join('  ·  ')
  doc.text(l2, x, 13.5, { maxWidth: larg })
  doc.text(l3, x, 17.5, { maxWidth: larg })
  doc.text(enderecoEmpresa(empresa), x, 21.5, { maxWidth: larg })
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  doc.text(titulo, w - 10, 11, { align: 'right' })
  if (subtitulo) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(subtitulo, w - 10, 17, { align: 'right' }) }
  doc.setTextColor(40, 40, 40)
}

function rodape(doc: jsPDF, texto?: string | null) {
  const n = doc.getNumberOfPages()
  const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    doc.setFontSize(7.5); doc.setTextColor(120, 120, 120)
    if (texto) doc.text(texto, 10, h - 8, { maxWidth: w - 40 })
    doc.text(`Página ${i} de ${n}`, w - 10, h - 8, { align: 'right' })
  }
}

export interface DadosPedidoPdf {
  pedido: Pedido
  cliente?: Cliente | null
  vendedor?: Perfil | null
  empresa?: Empresa | null
  condicao?: CondicaoPagamento | null
  forma?: FormaPagamento | null
  gtins?: Map<string, string | null> // produto_id -> código de barras
}

export function pdfPedido({ pedido: p, cliente: c, vendedor, empresa, condicao, forma, gtins }: DadosPedidoPdf) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const w = doc.internal.pageSize.getWidth()
  const titulo = p.status === 'orcamento' ? 'ORÇAMENTO' : 'PEDIDO DE VENDA'
  cabecalho(doc, empresa, titulo, `${p.numero ? 'Nº ' + p.numero : 'Provisório'}  ·  ${dataHora(p.data_pedido)}`)

  // bloco cliente
  let y = 34
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...AZUL)
  doc.text('CLIENTE', 10, y)
  doc.setTextColor(40, 40, 40); doc.setFontSize(10)
  doc.text(c?.razao_social ?? '—', 10, y + 5)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  const linhasCli = [
    [c?.nome_fantasia && `Fantasia: ${c.nome_fantasia}`, c?.cpf_cnpj && `${c.tipo_pessoa === 'F' ? 'CPF' : 'CNPJ'}: ${docFormatado(c.cpf_cnpj)}`, c?.ie && `IE: ${c.ie}`].filter(Boolean).join('   '),
    [c?.logradouro && `${c.logradouro}, ${c.numero ?? 's/n'}${c.complemento ? ' ' + c.complemento : ''}`, c?.bairro, c?.cidade && `${c.cidade}/${c.uf ?? ''}`, c?.cep && `CEP ${c.cep}`].filter(Boolean).join(' · '),
    [c?.telefone && `Tel: ${foneFormatado(c.telefone)}`, c?.whatsapp && `WhatsApp: ${foneFormatado(c.whatsapp)}`, c?.contato && `Contato: ${c.contato}`].filter(Boolean).join('   '),
  ].filter(Boolean)
  linhasCli.forEach((l, i) => doc.text(l, 10, y + 10 + i * 4.2, { maxWidth: w - 20 }))
  y = y + 10 + linhasCli.length * 4.2 + 2

  // condições
  doc.setDrawColor(220, 220, 220); doc.line(10, y, w - 10, y)
  doc.setFontSize(8.5)
  const info = [
    `Vendedor: ${vendedor?.nome ?? '—'}`,
    `Pagamento: ${[condicao?.nome, forma?.nome].filter(Boolean).join(' / ') || '—'}`,
    p.data_entrega ? `Entrega: ${data(p.data_entrega)}` : '',
    `Situação: ${STATUS_LABEL[p.status]}`,
  ].filter(Boolean)
  doc.text(info.join('     '), 10, y + 5)
  y += 9

  autoTable(doc, {
    startY: y,
    head: [['#', 'Código', 'Produto', 'Código de barras', 'Un', 'Qtd', 'Preço', 'Desc.', 'Total']],
    body: p.itens.map((i, n) => [
      n + 1, i.produto_codigo ?? '', i.produto_nome ?? '', gtins?.get(i.produto_id) ?? '', i.unidade ?? '', num(i.quantidade),
      brl(i.preco_unitario), i.desconto ? brl(i.desconto) : '', brl(i.total),
    ]),
    theme: 'striped',
    headStyles: { fillColor: AZUL, fontSize: 8 },
    bodyStyles: { fontSize: 8, minCellHeight: 13, valign: 'middle' },
    alternateRowStyles: { fillColor: [243, 246, 252] },
    columnStyles: {
      0: { cellWidth: 6, halign: 'center' }, 1: { cellWidth: 13 }, 3: { cellWidth: 34, fontSize: 6.5, halign: 'center', valign: 'bottom', cellPadding: { top: 1, bottom: 0.8, left: 1, right: 1 } },
      4: { cellWidth: 9, halign: 'center' }, 5: { halign: 'right', cellWidth: 11 }, 6: { halign: 'right', cellWidth: 19 },
      7: { halign: 'right', cellWidth: 16 }, 8: { halign: 'right', cellWidth: 21, fontStyle: 'bold' },
    },
    margin: { left: 10, right: 10 },
    // desenha as barras em cima do número
    didDrawCell: (d) => {
      if (d.section !== 'body' || d.column.index !== 3) return
      const mod = modulosEan(String(d.cell.raw ?? ''))
      if (!mod) return
      const larg = d.cell.width - 4, x0 = d.cell.x + 2, mw = larg / mod.length
      const alt = d.cell.height - 6.5
      doc.setFillColor(0, 0, 0)
      for (let k = 0; k < mod.length; k++) if (mod[k] === '1') doc.rect(x0 + k * mw, d.cell.y + 1, mw, alt, 'F')
    },
  })

  // totais
  let ty = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
  if (ty > doc.internal.pageSize.getHeight() - 50) { doc.addPage(); ty = 20 }
  const linhas: [string, string][] = [['Subtotal', brl(p.subtotal)]]
  if (p.desconto) linhas.push(['Desconto', '- ' + brl(p.desconto)])
  if (p.frete) linhas.push(['Frete', brl(p.frete)])
  doc.setFontSize(9)
  linhas.forEach(([a, b], i) => { doc.text(a, w - 60, ty + i * 5); doc.text(b, w - 10, ty + i * 5, { align: 'right' }) })
  const yt = ty + linhas.length * 5 + 2
  doc.setFillColor(...AZUL); doc.roundedRect(w - 72, yt - 4.5, 62, 9, 2, 2, 'F')
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
  doc.text('TOTAL', w - 68, yt + 1.6); doc.text(brl(p.total), w - 13, yt + 1.6, { align: 'right' })
  doc.setTextColor(40, 40, 40); doc.setFont('helvetica', 'normal')
  const qtdItens = p.itens.reduce((s, i) => s + i.quantidade, 0)
  doc.setFontSize(8.5); doc.text(`${p.itens.length} produto(s) · ${num(qtdItens)} volume(s)`, 10, ty)

  if (p.observacao) {
    doc.setFont('helvetica', 'bold'); doc.text('Observações', 10, ty + 7)
    doc.setFont('helvetica', 'normal'); doc.text(p.observacao, 10, ty + 11.5, { maxWidth: w - 90 })
  }

  // assinatura
  const ya = Math.max(yt + 28, ty + 30)
  doc.setDrawColor(150, 150, 150); doc.line(10, ya, 90, ya)
  doc.setFontSize(8); doc.text('Assinatura do cliente', 10, ya + 4)
  doc.text('Documento sem valor fiscal.', w - 10, ya + 4, { align: 'right' })

  rodape(doc, empresa?.rodape_pedido)
  return doc
}

export interface OpcoesCatalogo {
  produtos: Produto[]
  categorias: Categoria[]
  empresa?: Empresa | null
  mostrarPreco: boolean
  titulo?: string
  fotos?: Map<string, string> // produto_id -> dataURL
}

export function pdfCatalogo({ produtos, categorias, empresa, mostrarPreco, titulo = 'CATÁLOGO', fotos }: OpcoesCatalogo) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight()
  cabecalho(doc, empresa, titulo, `Atualizado em ${new Date().toLocaleDateString('pt-BR')}`)
  const nomeCat = new Map(categorias.map((c) => [c.id, c.nome]))
  const grupos = new Map<string, Produto[]>()
  for (const p of produtos) {
    const k = p.categoria_id ? nomeCat.get(p.categoria_id) ?? 'Outros' : 'Outros'
    grupos.set(k, [...(grupos.get(k) ?? []), p])
  }
  const ordem = [...grupos.keys()].sort((a, b) => (a === 'Outros' ? 1 : b === 'Outros' ? -1 : a.localeCompare(b)))

  // grade de cartões: 3 colunas
  const col = 3, gap = 4, mx = 10
  const cw = (w - mx * 2 - gap * (col - 1)) / col
  const ch = fotos?.size ? 62 : 30
  let y = 34

  for (const cat of ordem) {
    if (y + 10 + ch > h - 14) { doc.addPage(); y = 14 }
    doc.setFillColor(...AMARELO); doc.rect(mx, y, 2, 6, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...AZUL)
    doc.text(cat.toUpperCase(), mx + 4, y + 4.6)
    doc.setTextColor(40, 40, 40)
    y += 9
    const itens = grupos.get(cat)!.sort((a, b) => a.nome.localeCompare(b.nome))
    itens.forEach((p, i) => {
      const c = i % col
      if (c === 0 && i > 0) y += ch + gap
      if (y + ch > h - 14) { doc.addPage(); y = 14 }
      const x = mx + c * (cw + gap)
      doc.setDrawColor(225, 225, 225); doc.setFillColor(255, 255, 255)
      doc.roundedRect(x, y, cw, ch, 2, 2, 'FD')
      let ty = y + 5
      const foto = fotos?.get(p.id)
      if (fotos?.size) {
        if (foto) {
          try {
            // mantém a proporção da foto, centralizada no espaço do cartão
            const ip = doc.getImageProperties(foto), bw = cw - 4, bh = 32
            const k = Math.min(bw / ip.width, bh / ip.height), iw = ip.width * k, ih = ip.height * k
            doc.addImage(foto, x + 2 + (bw - iw) / 2, y + 2 + (bh - ih) / 2, iw, ih, undefined, 'FAST')
          } catch { /* imagem inválida */ }
        } else {
          doc.setFillColor(244, 248, 245); doc.rect(x + 2, y + 2, cw - 4, 32, 'F')
        }
        ty = y + 39
      }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5)
      const nome = doc.splitTextToSize(p.nome, cw - 4).slice(0, 2)
      doc.text(nome, x + 2, ty)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(110, 110, 110)
      doc.text(`Cód. ${p.codigo} · ${p.unidade}${p.qtd_embalagem > 1 ? ` c/ ${num(p.qtd_embalagem)}` : ''}${p.marca ? ' · ' + p.marca : ''}`, x + 2, ty + nome.length * 3.6 + 1, { maxWidth: cw - 4 })
      doc.setTextColor(40, 40, 40)
      if (mostrarPreco) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...AZUL)
        doc.text(brl(p.preco_venda), x + cw - 2, y + ch - 3, { align: 'right' })
        doc.setTextColor(40, 40, 40)
      }
    })
    y += ch + gap + 4
  }
  rodape(doc, mostrarPreco ? 'Preços sujeitos a alteração sem aviso prévio.' : null)
  return doc
}

export async function compartilharPdf(doc: jsPDF, nomeArquivo: string, texto?: string) {
  const blob = doc.output('blob')
  const arquivo = new File([blob], nomeArquivo, { type: 'application/pdf' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.canShare?.({ files: [arquivo] })) {
    try { await navigator.share({ files: [arquivo], title: nomeArquivo, text: texto }); return } catch (e) {
      if ((e as Error).name === 'AbortError') return
    }
  }
  doc.save(nomeArquivo)
}

export function abrirPdf(doc: jsPDF) {
  const url = URL.createObjectURL(doc.output('blob'))
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// ---------- Carga do dia ----------
export function pdfCarga(tipo: TipoRelatorioCarga, d: DadosCarga) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const w = doc.internal.pageSize.getWidth()
  cabecalho(doc, d.empresa, d.titulo.toUpperCase(), NOME_RELATORIO[tipo])
  const t = totaisCarga(d)
  const fim = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  const base = {
    theme: 'striped' as const,
    headStyles: { fillColor: AZUL, fontSize: 8.5 },
    bodyStyles: { fontSize: 8.5 },
    alternateRowStyles: { fillColor: [243, 246, 252] as [number, number, number] },
    margin: { left: 10, right: 10 },
  }

  if (tipo === 'resumo') {
    autoTable(doc, {
      ...base, startY: 33,
      head: [['Qtd', 'Un', 'Código', 'Produto', '']],
      body: somarItens(d.pedidos).map((i) => [num(i.quantidade), i.unidade, i.codigo, i.nome, '']),
      columnStyles: { 0: { cellWidth: 16, halign: 'right', fontStyle: 'bold' }, 1: { cellWidth: 12, halign: 'center' }, 2: { cellWidth: 18 }, 4: { cellWidth: 12 } },
      // quadradinho para ticar na hora de carregar
      didDrawCell: (c) => {
        if (c.section !== 'body' || c.column.index !== 4) return
        doc.setDrawColor(120, 120, 120); doc.rect(c.cell.x + c.cell.width / 2 - 2, c.cell.y + c.cell.height / 2 - 2, 4, 4)
      },
    })
  } else if (tipo === 'vendas') {
    autoTable(doc, {
      ...base, startY: 33,
      head: [['Nº', 'Cliente', 'Cidade', 'Forma', 'Volumes', 'Valor']],
      body: d.pedidos.map((p) => {
        const c = d.clientes.get(p.cliente_id)
        const f = p.forma_pagamento_id ? d.formas.get(p.forma_pagamento_id)?.nome ?? '' : ''
        return [p.numero ?? '-', rotuloCliente(c), c?.cidade ?? '', f, num(p.itens.reduce((s, i) => s + Number(i.quantidade), 0)), brl(p.total)]
      }),
      columnStyles: { 0: { cellWidth: 14 }, 3: { cellWidth: 24 }, 4: { cellWidth: 18, halign: 'right' }, 5: { cellWidth: 26, halign: 'right', fontStyle: 'bold' } },
    })
  } else {
    let y = 33
    for (const g of porCliente(d)) {
      const c = g.cliente
      const itens = g.pedidos.flatMap((p) => p.itens.map((i) => ({ ...i, numero: p.numero })))
      const total = g.pedidos.reduce((s, p) => s + Number(p.total), 0)
      const formas = [...new Set(g.pedidos.map((p) => (p.forma_pagamento_id ? d.formas.get(p.forma_pagamento_id)?.nome : '') || ''))].filter(Boolean).join(', ')
      if (y > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 14 }
      doc.setFillColor(...AMARELO); doc.rect(10, y, 2, 10, 'F')
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...AZUL)
      doc.text(rotuloCliente(c), 14, y + 4, { maxWidth: w - 70 })
      doc.text(brl(total), w - 10, y + 4, { align: 'right' })
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(90, 90, 90)
      const end = [c?.logradouro && `${c.logradouro}, ${c.numero ?? 's/n'}`, c?.bairro, c?.cidade].filter(Boolean).join(' · ')
      doc.text([`Pedido(s) ${g.pedidos.map((p) => '#' + (p.numero ?? '-')).join(', ')}${formas ? ' · ' + formas : ''}`, end].filter(Boolean).join('   '), 14, y + 8.5, { maxWidth: w - 24 })
      doc.setTextColor(40, 40, 40)
      autoTable(doc, {
        ...base, startY: y + 11,
        head: [['Qtd', 'Un', 'Código', 'Produto', 'Preço', 'Total']],
        body: itens.map((i) => [num(i.quantidade), i.unidade ?? '', i.produto_codigo ?? '', i.produto_nome ?? '', brl(i.preco_unitario), brl(i.total)]),
        headStyles: { ...base.headStyles, fontSize: 7.5 },
        bodyStyles: { fontSize: 8 },
        columnStyles: { 0: { cellWidth: 14, halign: 'right', fontStyle: 'bold' }, 1: { cellWidth: 10, halign: 'center' }, 2: { cellWidth: 16 }, 4: { cellWidth: 22, halign: 'right' }, 5: { cellWidth: 24, halign: 'right' } },
        margin: { left: 14, right: 10 },
      })
      y = fim() + 6
    }
  }

  // quadro de totais
  let y = d.pedidos.length ? fim() + 6 : 36
  if (y > doc.internal.pageSize.getHeight() - 30) { doc.addPage(); y = 14 }
  const caixas: [string, string][] = [
    ['Vendas', String(t.vendas)], ...(t.trocas ? [['Trocas', String(t.trocas)] as [string, string]] : []),
    ['Clientes', String(t.clientes)], ['Itens', String(t.itens)], ['Volumes', num(t.volumes)], ['Valor das vendas', brl(t.valor)],
  ]
  const larg = (w - 20 - (caixas.length - 1) * 2) / caixas.length
  caixas.forEach(([rot, val], k) => {
    const x = 10 + k * (larg + 2)
    const ultimo = k === caixas.length - 1
    if (ultimo) doc.setFillColor(...AZUL); else doc.setFillColor(239, 245, 255)
    doc.roundedRect(x, y, larg, 13, 2, 2, 'F')
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(ultimo ? 255 : 90, ultimo ? 255 : 90, ultimo ? 255 : 90)
    doc.text(rot, x + larg / 2, y + 4.5, { align: 'center' })
    doc.setFont('helvetica', 'bold'); doc.setFontSize(ultimo ? 10 : 11); doc.setTextColor(ultimo ? 255 : 30, ultimo ? 255 : 30, ultimo ? 255 : 30)
    doc.text(val, x + larg / 2, y + 10.5, { align: 'center' })
  })
  doc.setTextColor(40, 40, 40)
  if (t.trocas) { doc.setFontSize(7.5); doc.text(`Trocas (${brl(t.valorTrocas)}) entram na carga mas não somam no valor das vendas.`, 10, y + 18) }
  rodape(doc, `Gerado em ${dataHora(new Date().toISOString())}`)
  return doc
}

// ---------- Relatório genérico em tabela (categoria, zerados, sugestão de compra) ----------
export type LinhaRelatorio = string[] | { grupo: string[] }
export interface OpcoesRelatorio {
  empresa?: Empresa | null
  titulo: string
  subtitulo?: string
  cabecalho: string[]
  linhas: LinhaRelatorio[]
  direita?: number[] // colunas alinhadas à direita
  larguras?: Record<number, number>
  totais?: [string, string][]
  nota?: string
  info?: [string, string][] // bloco de dados (rótulo: valor) antes da tabela
}

export function pdfRelatorio(o: OpcoesRelatorio) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const w = doc.internal.pageSize.getWidth()
  cabecalho(doc, o.empresa, o.titulo.toUpperCase(), o.subtitulo)
  const grupos = new Set<number>()
  const body = o.linhas.map((l, k) => { if (!Array.isArray(l)) { grupos.add(k); return l.grupo } return l })
  const colunas: Record<number, { halign?: 'right'; cellWidth?: number }> = {}
  o.direita?.forEach((c) => (colunas[c] = { ...colunas[c], halign: 'right' }))
  Object.entries(o.larguras ?? {}).forEach(([c, v]) => (colunas[Number(c)] = { ...colunas[Number(c)], cellWidth: v }))
  let inicio = 33
  if (o.info?.length) {
    const col = (w - 20) / 2
    doc.setFontSize(8.5)
    o.info.forEach(([rot, val], k) => {
      const x = 10 + (k % 2) * col, yy = 35 + Math.floor(k / 2) * 5.2
      doc.setFont('helvetica', 'bold'); doc.setTextColor(90, 90, 90); doc.text(rot + ':', x, yy)
      const lw = doc.getTextWidth(rot + ':') + 1.5
      doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 30)
      doc.text(doc.splitTextToSize(String(val || '-'), col - lw - 3)[0], x + lw, yy)
    })
    inicio = 35 + Math.ceil(o.info.length / 2) * 5.2 + 2
    doc.setDrawColor(220, 220, 220); doc.line(10, inicio - 2, w - 10, inicio - 2)
  }
  autoTable(doc, {
    startY: inicio, head: [o.cabecalho], body,
    theme: 'striped',
    headStyles: { fillColor: AZUL, fontSize: 8.5 },
    bodyStyles: { fontSize: 8.5 },
    alternateRowStyles: { fillColor: [243, 246, 252] },
    columnStyles: colunas,
    margin: { left: 10, right: 10 },
    didParseCell: (d) => {
      if (d.section === 'head' && o.direita?.includes(d.column.index)) d.cell.styles.halign = 'right'
      if (d.section === 'body' && grupos.has(d.row.index)) {
        d.cell.styles.fillColor = [220, 232, 253]; d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = [24, 74, 159]
      }
    },
  })
  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
  if (o.totais?.length) {
    if (y > doc.internal.pageSize.getHeight() - 30) { doc.addPage(); y = 14 }
    const larg = (w - 20 - (o.totais.length - 1) * 2) / o.totais.length
    o.totais.forEach(([rot, val], k) => {
      const x = 10 + k * (larg + 2), ultimo = k === o.totais!.length - 1
      if (ultimo) doc.setFillColor(...AZUL); else doc.setFillColor(239, 245, 255)
      doc.roundedRect(x, y, larg, 13, 2, 2, 'F')
      const cor = ultimo ? 255 : 90
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(cor, cor, cor)
      doc.text(rot, x + larg / 2, y + 4.5, { align: 'center' })
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(ultimo ? 255 : 30, ultimo ? 255 : 30, ultimo ? 255 : 30)
      doc.text(val, x + larg / 2, y + 10.5, { align: 'center' })
    })
    y += 18
  }
  doc.setTextColor(40, 40, 40)
  if (o.nota) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.text(o.nota, 10, y, { maxWidth: w - 20 }) }
  rodape(doc, `Gerado em ${dataHora(new Date().toISOString())}`)
  return doc
}
