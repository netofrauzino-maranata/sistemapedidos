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
  }
}
