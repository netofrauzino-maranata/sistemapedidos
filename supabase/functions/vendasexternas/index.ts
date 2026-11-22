// Edge Function: ponte com a API do VendasExternas (Alkord).
// Documentação deles: https://docs.alkord.com.br  (base https://api.alkord.com.br)
// Autentica com os cabeçalhos application-key e application-secret, que o
// gestor salva pelo app (tabela integracao_ve, que só esta função lê).
//
// A API deles cria/atualiza clientes e produtos. NÃO cria pedido (atendimento),
// por isso os pedidos vão como "espelho" (texto) montado no app.
//
// Ações (POST JSON):
//   { acao: 'testar' }
//   { acao: 'sincronizar', entidade: 'cliente' | 'produto', ids: uuid[] }  (até 25 por chamada)
//   { acao: 'opcoes' }  meios de pagamento, condições e vendedores de lá (para o de/para)
//   { acao: 'enviar_pedidos', ids: uuid[] }  cria os pedidos lá (POST /atendimentos, não documentado)
import { createClient } from 'npm:@supabase/supabase-js@2.49.1'

const API = 'https://api.alkord.com.br'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

type Chaves = { key: string; secret: string; unidade: number | null; tipo: number }

async function ve(ch: Chaves, metodo: string, caminho: string, corpo?: unknown) {
  const r = await fetch(API + caminho, {
    method: metodo,
    headers: {
      'application-key': ch.key,
      'application-secret': ch.secret,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  const texto = await r.text()
  let json: any = null
  try { json = texto ? JSON.parse(texto) : null } catch { /* resposta não JSON */ }
  if (!r.ok) {
    const msg = json?.MENSAGEM || json?.mensagem || json?.message || json?.erro || texto.slice(0, 300) || r.statusText
    throw new Error(`VendasExternas ${r.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`)
  }
  return json
}

// Busca o primeiro registro que bate com o filtro (COLUNA:OPERADOR:VALOR)
async function buscar(ch: Chaves, recurso: string, filtro: string): Promise<number | null> {
  const q = new URLSearchParams({ colunas: 'CODIGO', filtros: filtro, numero_registros: '1', registro_inicial: '0' })
  const j = await ve(ch, 'GET', `/${recurso}?${q}`)
  const cod = j?.REGISTROS?.[0]?.CODIGO
  return cod ? Number(cod) : null
}

const dig = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '')
const str = (v: unknown) => (v === null || v === undefined ? undefined : String(v))
const semVazios = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''))
const seguroParaFiltro = (v: string) => v && !/[,:]/.test(v)

function telefone(v: string | null | undefined) {
  let d = dig(v)
  if (d.startsWith('55') && d.length > 11) d = d.slice(2)
  if (d.length < 10) return null
  const ddd = d.slice(0, 2), num = d.slice(2)
  return { DDI: '55', DDD: ddd, TELEFONE: num, TIPO: num.length === 9 ? 'L' : 'C', PRINCIPAL: 'S' }
}

function payloadCliente(c: any, completo: boolean) {
  const base: Record<string, unknown> = semVazios({
    NOME: c.razao_social,
    APELIDO: c.nome_fantasia,
    TIPO_PESSOA: c.tipo_pessoa,
    SITUACAO: c.ativo ? 'A' : 'I',
    DOCUMENTO: dig(c.cpf_cnpj) || undefined,
    DOCUMENTO2: c.ie,
    REFERENCIA_INTEGRACAO: String(c.codigo),
  })
  if (!completo) return base
  const fones = [telefone(c.telefone), telefone(c.whatsapp)].filter(Boolean) as any[]
  fones.forEach((f, i) => (f.PRINCIPAL = i === 0 ? 'S' : 'N'))
  if (fones.length === 2 && fones[0].TELEFONE === fones[1].TELEFONE) fones.pop()
  if (fones.length) base.TELEFONES = fones
  if (c.email) base.EMAILS = [{ EMAIL: c.email, PRINCIPAL: 'S', EXCLUSIVO: 'N', PADRAO_NFE: 'S' }]
  if (c.logradouro || c.cep) {
    base.ENDERECOS = [semVazios({
      TIPO: 'C', PRINCIPAL: 'S',
      CEP: dig(c.cep) || undefined, ENDERECO: c.logradouro, NUMERO: c.numero, COMPLEMENTO: c.complemento, BAIRRO: c.bairro,
      CIDADE: c.cidade ? semVazios({ NOME: c.cidade, CODIGO_IBGE: c.codigo_ibge ? Number(c.codigo_ibge) : undefined }) : undefined,
      ESTADO: c.uf ? { SIGLA: c.uf } : undefined,
      PAIS: { NOME: 'Brasil' },
    })]
  }
  if (c.limite_credito) base.COMERCIAL_VENDA = { LIMITE_CREDITO: str(c.limite_credito) }
  return base
}

function payloadProduto(p: any, ch: Chaves, completo: boolean) {
  const base: Record<string, unknown> = semVazios({
    NOME: p.nome,
    CODIGO_BARRAS: p.gtin,
    NCM: p.ncm,
    CEST: p.cest,
    UNIDADE_MEDIDA_VENDA: p.unidade ? { SIGLA: p.unidade } : undefined,
    REFERENCIA_INTEGRACAO: p.codigo,
  })
  if (ch.unidade) base.PRECOS = [{ UNIDADE: ch.unidade, PRECO_VENDA: Number(p.preco_venda).toFixed(2) }]
  if (!completo) return base
  base.ORIGEM = p.origem ?? 0
  base.DISPONIBILIDADE = 'D'
  base.FABRICACAO_PROPRIA = 'N'
  if (p.marca) base.FABRICANTE = { NOME: p.marca }
  if (p.descricao) base.TEXTOS = { DESCRICAO: p.descricao }
  base.INFORMACOES_ADICIONAIS = [semVazios({
    ACESSO_RAPIDO: p.codigo, // o operador digita nosso código lá e acha o produto
    PESO: p.peso_kg ? String(Math.round(Number(p.peso_kg) * 1000)) : undefined,
  })]
  return base
}

// Categoria é obrigatória lá. Usa a nossa (ou "Geral"), achando ou criando lá.
const cacheCategorias = new Map<string, number>()
async function categoriaVe(ch: Chaves, nome: string): Promise<{ CODIGO: number; NOME: string } | null> {
  const n = (nome || 'Geral').trim()
  if (cacheCategorias.has(n)) return { CODIGO: cacheCategorias.get(n)!, NOME: n }
  let cod: number | null = null
  if (seguroParaFiltro(n)) cod = await buscar(ch, 'produtos_cadastro_categorias', `NOME:IGUAL:${n}`).catch(() => null)
  if (!cod) {
    const j = await ve(ch, 'POST', '/produtos_cadastro_categorias', { NOME: n, CATEGORIA_PAI: 0, TIPO: 0 })
    cod = Number(j?.CODIGO ?? j?.REGISTROS?.[0]?.CODIGO) || null
    if (!cod && seguroParaFiltro(n)) cod = await buscar(ch, 'produtos_cadastro_categorias', `NOME:IGUAL:${n}`).catch(() => null)
  }
  if (!cod) return null
  cacheCategorias.set(n, cod)
  return { CODIGO: cod, NOME: n }
}

// Procura o cadastro que já exista lá, para não duplicar
async function procurar(ch: Chaves, entidade: string, r: any): Promise<{ codigo: number; nosso: boolean } | null> {
  const recurso = entidade === 'cliente' ? 'clientes' : 'produtos'
  const ref = String(r.codigo)
  if (seguroParaFiltro(ref)) {
    const c = await buscar(ch, recurso, `REFERENCIAS_INTEGRACAO:IGUAL:${ref}`).catch(() => null)
    if (c) return { codigo: c, nosso: true }
  }
  if (entidade === 'cliente') {
    const doc = dig(r.cpf_cnpj)
    if (doc) {
      const c = await buscar(ch, recurso, `DOCUMENTO:IGUAL:${doc}`).catch(() => null)
      if (c) return { codigo: c, nosso: false }
    }
  } else {
    if (r.gtin && seguroParaFiltro(r.gtin)) {
      const c = await buscar(ch, recurso, `CODIGO_BARRAS:IGUAL:${r.gtin}`).catch(() => null)
      if (c) return { codigo: c, nosso: false }
    }
    if (seguroParaFiltro(r.nome)) {
      const c = await buscar(ch, recurso, `NOME:IGUAL:${r.nome}`).catch(() => null)
      if (c) return { codigo: c, nosso: false }
    }
  }
  return null
}

async function sincronizar(ch: Chaves, entidade: 'cliente' | 'produto', ids: string[]) {
  const tabela = entidade === 'cliente' ? 'clientes' : 'produtos'
  const recurso = entidade === 'cliente' ? 'clientes' : 'produtos'
  const { data: regs, error } = await admin.from(tabela)
    .select(entidade === 'produto' ? '*, categorias(nome)' : '*').in('id', ids)
  if (error) throw error
  const { data: vincs } = await admin.from('ve_vinculos').select('*').eq('entidade', entidade).in('registro_id', ids)
  const mapa = new Map((vincs ?? []).map((v: any) => [v.registro_id, v]))
  const resultado = { criados: 0, atualizados: 0, vinculados: 0, sem_mudanca: 0, erros: [] as { id: string; nome: string; erro: string }[] }

  for (const r of regs ?? []) {
    const nome = entidade === 'cliente' ? r.razao_social : r.nome
    const v: any = mapa.get(r.id)
    try {
      let codigo: number | null = v?.ve_codigo ?? null
      let origem: string | null = v?.origem ?? null
      if (codigo && origem === 'criado') {
        // Fomos nós que cadastramos: atualiza os dados básicos
        await ve(ch, 'PUT', `/${recurso}/${codigo}`,
          entidade === 'cliente' ? payloadCliente(r, false) : payloadProduto(r, ch, false))
        resultado.atualizados++
      } else if (codigo) {
        // Já existia lá: só vinculado, não mexe no cadastro fiscal deles
        resultado.sem_mudanca++
      } else {
        const achado = await procurar(ch, entidade, r)
        if (achado) {
          codigo = achado.codigo
          origem = achado.nosso ? 'criado' : 'vinculado'
          resultado.vinculados++
        } else {
          const corpo = entidade === 'cliente' ? payloadCliente(r, true) : payloadProduto(r, ch, true)
          if (entidade === 'produto') {
            const cat = await categoriaVe(ch, r.categorias?.nome)
            if (cat) corpo.CATEGORIA = cat
          }
          const j = await ve(ch, 'POST', `/${recurso}`, corpo)
          codigo = Number(j?.CODIGO ?? j?.REGISTROS?.[0]?.CODIGO) || null
          if (!codigo) codigo = await buscar(ch, recurso, `REFERENCIAS_INTEGRACAO:IGUAL:${r.codigo}`).catch(() => null)
          origem = 'criado'
          resultado.criados++
        }
      }
      await admin.from('ve_vinculos').upsert({
        entidade, registro_id: r.id, ve_codigo: codigo, origem, enviado_em: new Date().toISOString(), erro: null,
      })
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e)
      resultado.erros.push({ id: r.id, nome, erro })
      await admin.from('ve_vinculos').upsert({
        entidade, registro_id: r.id, ve_codigo: v?.ve_codigo ?? null, origem: v?.origem ?? null,
        enviado_em: v?.enviado_em ?? null, erro,
      })
    }
  }
  return resultado
}

async function testar(ch: Chaves) {
  try {
    await ve(ch, 'GET', '/clientes?' + new URLSearchParams({ colunas: 'CODIGO', numero_registros: '1', registro_inicial: '0' }))
    // Descobre a unidade de negócio pelos preços de um produto que já exista lá
    let unidade: number | null = ch.unidade
    try {
      const j = await ve(ch, 'GET', '/produtos?' + new URLSearchParams({ colunas: 'CODIGO,PRECOS', numero_registros: '5', registro_inicial: '0' }))
      for (const p of j?.REGISTROS ?? []) {
        const u = p?.PRECOS?.[0]?.UNIDADE
        if (u) { unidade = Number(u); break }
      }
    } catch { /* sem produtos lá ainda */ }
    if (!unidade) {
      try {
        const j = await ve(ch, 'GET', '/atendimentos?' + new URLSearchParams({ colunas: 'CODIGO,UNIDADE', numero_registros: '1', registro_inicial: '0' }))
        const u = j?.REGISTROS?.[0]?.UNIDADE
        if (u) unidade = Number(u)
      } catch { /* sem atendimentos */ }
    }
    const msg = unidade ? 'Conectado.' : 'Conectado. Unidade de negócio não encontrada: produtos novos irão sem preço.'
    await admin.from('integracao_ve').update({ testado_em: new Date().toISOString(), teste_ok: true, teste_msg: msg, unidade_negocio: unidade }).eq('id', 1)
    return { ok: true, mensagem: msg, unidade }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await admin.from('integracao_ve').update({ testado_em: new Date().toISOString(), teste_ok: false, teste_msg: msg }).eq('id', 1)
    return { ok: false, mensagem: msg }
  }
}

async function opcoes(ch: Chaves) {
  const lista = async (rec: string) => {
    const j = await ve(ch, 'GET', `/${rec}?` + new URLSearchParams({ numero_registros: '100', registro_inicial: '0' }))
    return (j?.REGISTROS ?? []).map((r: any) => ({ codigo: Number(r.CODIGO), nome: String(r.NOME ?? r.CODIGO) }))
  }
  const [meios, condicoes, vendedores] = await Promise.all([lista('meios_pagamento'), lista('condicoes_pagamento'), lista('vendedores')])
  return { meios, condicoes, vendedores }
}

const n2 = (v: unknown) => Number(v ?? 0).toFixed(2)

async function enviarPedidos(ch: Chaves, ids: string[]) {
  const resultado = { enviados: [] as { id: string; numero: number; ve_codigo: number }[], ja_enviados: 0, erros: [] as { id: string; numero: number; erro: string }[] }
  const { data: peds, error } = await admin.from('pedidos')
    .select('*, pedido_itens(*), formas_pagamento(nome)').in('id', ids)
  if (error) throw error
  const { data: jaFoi } = await admin.from('ve_pedidos').select('*').in('pedido_id', ids)
  const enviados = new Map((jaFoi ?? []).map((x: any) => [x.pedido_id, x]))
  const { data: mapa } = await admin.from('ve_mapa').select('*')
  const m = (tipo: string, id: string | null) => (mapa ?? []).find((x: any) => x.tipo === tipo && x.registro_id === id)?.ve_codigo ?? null
  const prodIds = [...new Set((peds ?? []).flatMap((p: any) => p.pedido_itens.map((i: any) => i.produto_id)))]
  const cliIds = [...new Set((peds ?? []).map((p: any) => p.cliente_id))]
  const { data: vincs } = await admin.from('ve_vinculos').select('*').in('registro_id', [...prodIds, ...cliIds])
  const cod = (ent: string, id: string) => (vincs ?? []).find((v: any) => v.entidade === ent && v.registro_id === id)?.ve_codigo ?? null
  const { data: prods } = await admin.from('produtos').select('id, codigo, nome').in('id', prodIds)
  const nomeProd = (id: string) => (prods ?? []).find((p: any) => p.id === id)?.nome ?? id

  for (const p of (peds ?? []).sort((a: any, b: any) => a.numero - b.numero)) {
    try {
      if (enviados.get(p.id)?.ve_codigo) { resultado.ja_enviados++; continue }
      if (['orcamento', 'cancelado'].includes(p.status)) throw new Error(`Pedido ${p.status} não vai para nota`)
      if (/troca/i.test(p.formas_pagamento?.nome ?? '')) throw new Error('Troca não vai para nota')
      const cliente = cod('cliente', p.cliente_id)
      if (!cliente) throw new Error('Cliente ainda não ligado ao VendasExternas (envie os cadastros)')
      const faltando = p.pedido_itens.filter((i: any) => !cod('produto', i.produto_id)).map((i: any) => nomeProd(i.produto_id))
      if (faltando.length) throw new Error('Produto não ligado ao VendasExternas: ' + faltando.join(', '))
      const meio = m('forma', p.forma_pagamento_id)
      const cond = m('condicao', p.condicao_pagamento_id)
      if (!meio || !cond) throw new Error('Forma ou condição de pagamento sem correspondência (aba Conexão)')
      const vendedor = m('vendedor', p.vendedor_id)
      const itens = [...p.pedido_itens].sort((a: any, b: any) => a.item - b.item).map((i: any) => semVazios({
        PRODUTO: { CODIGO: cod('produto', i.produto_id) },
        QUANTIDADE: String(Number(i.quantidade)),
        VALOR_UNITARIO: Number(i.preco_unitario).toFixed(4),
        DESCONTO_VALOR: Number(i.desconto) ? n2(i.desconto) : undefined,
        VALOR_TOTAL: n2(i.total),
        RESERVAR: 'N',
      }))
      const corpo: Record<string, unknown> = semVazios({
        TIPO_ATENDIMENTO: { CODIGO: ch.tipo || 1 },
        SITUACAO: '1',
        TIPO_OPERACAO: '1',
        CONSUMIDOR_FINAL: 'N',
        CLIENTE: { CODIGO: cliente },
        VENDEDOR: vendedor ? { CODIGO: vendedor } : undefined,
        REFERENCIA: `APP-${p.numero}`,
        TOTAL_PRODUTOS: n2(p.subtotal),
        TOTAL_DESCONTO_VALOR: Number(p.desconto) ? n2(p.desconto) : undefined,
        FRETE_VALOR: Number(p.frete) ? n2(p.frete) : undefined,
        TOTAL: n2(p.total),
        ITENS: itens,
        PAGAMENTOS: [{ VALOR: n2(p.total), MEIO_PAGAMENTO: { CODIGO: meio }, CONDICAO_PAGAMENTO: { CODIGO: cond } }],
        TEXTOS: semVazios({ OBSERVACAO: [`Pedido ${p.numero} do app Maranata`, p.observacao].filter(Boolean).join(' · ') }),
      })
      const j = await ve(ch, 'POST', '/atendimentos', corpo)
      const codigo = Number(j?.CODIGO) || null
      await admin.from('ve_pedidos').upsert({ pedido_id: p.id, ve_codigo: codigo, enviado_em: new Date().toISOString(), erro: null })
      await admin.from('pedidos').update({ exportado_nfe_em: new Date().toISOString() }).eq('id', p.id)
      resultado.enviados.push({ id: p.id, numero: p.numero, ve_codigo: codigo ?? 0 })
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e)
      await admin.from('ve_pedidos').upsert({ pedido_id: p.id, ve_codigo: null, enviado_em: null, erro })
      resultado.erros.push({ id: p.id, numero: p.numero, erro })
    }
  }
  return resultado
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return resposta({ erro: 'Use POST' }, 405)
  try {
    // Só gestor ativo
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: u } = await admin.auth.getUser(jwt)
    if (!u?.user) return resposta({ erro: 'Faça login novamente.' }, 401)
    const { data: perfil } = await admin.from('perfis').select('papel, ativo').eq('id', u.user.id).maybeSingle()
    if (!perfil || perfil.papel !== 'gestor' || !perfil.ativo) return resposta({ erro: 'Só o gestor usa a integração.' }, 403)

    const { data: cfg } = await admin.from('integracao_ve').select('*').eq('id', 1).maybeSingle()
    if (!cfg?.application_key || !cfg?.application_secret) {
      return resposta({ erro: 'Integração sem chaves. Cole as chaves do VendasExternas e salve.' }, 400)
    }
    const ch: Chaves = { key: cfg.application_key, secret: cfg.application_secret, unidade: cfg.unidade_negocio, tipo: cfg.tipo_atendimento ?? 1 }

    const corpo = await req.json().catch(() => ({}))
    if (corpo.acao === 'testar') return resposta(await testar(ch))
    if (corpo.acao === 'opcoes') return resposta(await opcoes(ch))
    if (corpo.acao === 'enviar_pedidos') {
      const ids: string[] = Array.isArray(corpo.ids) ? corpo.ids.slice(0, 20) : []
      if (!ids.length) return resposta({ erro: 'Nenhum pedido selecionado' }, 400)
      return resposta(await enviarPedidos(ch, ids))
    }
    if (corpo.acao === 'sincronizar') {
      const entidade = corpo.entidade
      const ids: string[] = Array.isArray(corpo.ids) ? corpo.ids.slice(0, 25) : []
      if (entidade !== 'cliente' && entidade !== 'produto') return resposta({ erro: 'entidade inválida' }, 400)
      if (!ids.length) return resposta({ erro: 'Nenhum cadastro selecionado' }, 400)
      return resposta(await sincronizar(ch, entidade, ids))
    }
    return resposta({ erro: 'Ação desconhecida' }, 400)
  } catch (e) {
    return resposta({ erro: e instanceof Error ? e.message : String(e) }, 500)
  }
})
