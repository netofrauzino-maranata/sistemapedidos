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

type Chaves = { key: string; secret: string; unidade: number | null }

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
    const msg = unidade ? 'Conectado.' : 'Conectado. Unidade de negócio não encontrada: produtos novos irão sem preço.'
    await admin.from('integracao_ve').update({ testado_em: new Date().toISOString(), teste_ok: true, teste_msg: msg, unidade_negocio: unidade }).eq('id', 1)
    return { ok: true, mensagem: msg, unidade }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await admin.from('integracao_ve').update({ testado_em: new Date().toISOString(), teste_ok: false, teste_msg: msg }).eq('id', 1)
    return { ok: false, mensagem: msg }
  }
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
    const ch: Chaves = { key: cfg.application_key, secret: cfg.application_secret, unidade: cfg.unidade_negocio }

    const corpo = await req.json().catch(() => ({}))
    if (corpo.acao === 'testar') return resposta(await testar(ch))
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
