import type { Produto } from './tipos'

// Fotos dos produtos que vêm junto com o app, em public/produtos/<codigo>.webp (800x800 WebP).
// Fonte: pasta do Drive com as artes do catálogo, um PNG por código. Atualizadas em 22/11/2026 e 25/11/2026 (pasta "Novo Itens catalogo"; o 059 não veio e manteve a foto anterior).
// Para incluir um produto novo: salve a foto (800x800 WebP) com o código como nome e acrescente o código aqui.
// Ao trocar fotos existentes, suba o nome do cache em vite.config.ts para os celulares baixarem as novas.
// Se o gestor enviar uma foto pelo cadastro (foto_url), ela tem prioridade.
const CODIGOS_COM_FOTO = new Set<string>(['001','002','003','004','005','006','007','008','009','010','011','012','013','014','015','016','017','018','019','020','021','022','023','024','025','026','027','028','029','030','031','032','033','034','035','036','037','038','039','040','041','042','043','044','045','046','047','048','049','050','051','052','053','054','055','056','057','058','059','060','061','062','063','064','065','066','067','068','069','070','071','072','073','074','075','076','077','078','079','080','081','082','083','084','085','086','087','088','089','090','091'])

export function fotoDoProduto(p: Pick<Produto, 'codigo' | 'foto_url'>): string | null {
  if (p.foto_url) return p.foto_url
  return p.codigo && CODIGOS_COM_FOTO.has(p.codigo) ? `/produtos/${p.codigo}.webp` : null
}

// Converte a foto para JPEG em dataURL (o PDF não lê WebP), reduzida para no máximo `lado` px.
export async function paraDataUrl(url: string, lado = 480): Promise<string | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const bmp = await createImageBitmap(await r.blob())
    const k = Math.min(1, lado / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    const g = c.getContext('2d')!
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height)
    g.drawImage(bmp, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.85)
  } catch { return null }
}
