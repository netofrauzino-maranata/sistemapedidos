import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { brl, data, dataHora, docFormatado, foneFormatado, num } from './formato'
import type { Categoria, Cliente, CondicaoPagamento, Empresa, FormaPagamento, Pedido, Perfil, Produto } from './tipos'
import { STATUS_LABEL } from './tipos'
import logoPdf from '../assets/logo-pdf.jpg?inline'
import { modulosEan } from './codigobarras'

// PDFs gerados no próprio celular (funciona offline).
const AZUL: [number, number, number] = [0, 38, 139]
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
  doc.text(empresa?.razao_social || 'Maranata Distribuidora', x, 10)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
  const linha2 = [empresa?.cnpj && `CNPJ ${docFormatado(empresa.cnpj)}`, empresa?.telefone && foneFormatado(empresa.telefone), empresa?.whatsapp && `WhatsApp ${foneFormatado(empresa.whatsapp)}`].filter(Boolean).join('  ·  ')
  doc.text(linha2, x, 15.5)
  doc.text(enderecoEmpresa(empresa), x, 20, { maxWidth: w - x - 62 })
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
          try { doc.addImage(foto, x + 2, y + 2, cw - 4, 32, undefined, 'FAST') } catch { /* imagem inválida */ }
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
