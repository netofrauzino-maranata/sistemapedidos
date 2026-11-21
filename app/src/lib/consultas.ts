import { soDigitos } from './formato'

// Consultas públicas gratuitas para agilizar o cadastro (precisam de internet).

export async function buscarCep(cep: string) {
  const d = soDigitos(cep)
  if (d.length !== 8) return null
  const r = await fetch(`https://viacep.com.br/ws/${d}/json/`)
  if (!r.ok) return null
  const j = await r.json()
  if (j.erro) return null
  return {
    logradouro: j.logradouro as string, bairro: j.bairro as string, cidade: j.localidade as string,
    uf: j.uf as string, codigo_ibge: j.ibge as string,
  }
}

export async function buscarCnpj(cnpj: string) {
  const d = soDigitos(cnpj)
  if (d.length !== 14) return null
  const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`)
  if (!r.ok) return null
  const j = await r.json()
  const tel = soDigitos(j.ddd_telefone_1)
  return {
    razao_social: j.razao_social as string,
    nome_fantasia: (j.nome_fantasia as string) || null,
    cep: soDigitos(j.cep),
    logradouro: [j.descricao_tipo_de_logradouro, j.logradouro].filter(Boolean).join(' '),
    numero: j.numero as string,
    complemento: (j.complemento as string) || null,
    bairro: j.bairro as string,
    cidade: j.municipio as string,
    uf: j.uf as string,
    codigo_ibge: j.codigo_municipio_ibge ? String(j.codigo_municipio_ibge) : null,
    telefone: tel || null,
    email: (j.email as string)?.toLowerCase() || null,
    ...(await buscarIe(d, j.uf as string)),
  }
}

// Inscrição estadual: a Receita (BrasilAPI) não informa. Vem da API pública do CNPJ.ws,
// que traz a IE do cadastro das SEFAZ (cobre Goiás). Grátis, com limite de 3 consultas
// por minuto. Se falhar, o cadastro segue e a IE é digitada à mão.
type IeWs = { inscricao_estadual?: string; ativo?: boolean; estado?: { sigla?: string } }
export async function buscarIe(cnpj: string, uf?: string): Promise<{ ie?: string; indicador_ie?: 1 | 9 }> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 10000)
    const r = await fetch(`https://publica.cnpj.ws/cnpj/${soDigitos(cnpj)}`, { signal: ctrl.signal })
    clearTimeout(t)
    if (!r.ok) return {}
    const j = await r.json()
    const lista = (j?.estabelecimento?.inscricoes_estaduais ?? j?.inscricoes_estaduais) as IeWs[] | undefined
    if (!Array.isArray(lista)) return {}
    const ativas = lista.filter((x) => x.ativo !== false && x.inscricao_estadual)
    const ie = ativas.find((x) => !uf || x.estado?.sigla === uf) ?? ativas[0]
    return ie ? { ie: soDigitos(ie.inscricao_estadual), indicador_ie: 1 } : { indicador_ie: 9 }
  } catch {
    return {}
  }
}
