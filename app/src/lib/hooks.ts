import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'

export function useMapa<T extends { id: string }>(consulta: () => Promise<T[]>, deps: unknown[] = []) {
  return useLiveQuery(async () => new Map((await consulta()).map((x) => [x.id, x])), deps) ?? new Map<string, T>()
}

export const useClientesMapa = () => useMapa(() => db.clientes.toArray())
export const useProdutosMapa = () => useMapa(() => db.produtos.toArray())
export const usePerfisMapa = () => useMapa(() => db.perfis.toArray())
export const useCondicoes = () => useLiveQuery(() => db.condicoes.filter((c) => c.ativo).toArray(), []) ?? []
export const useFormas = () => useLiveQuery(() => db.formas.filter((c) => c.ativo).toArray(), []) ?? []
export const useCategorias = () => useLiveQuery(() => db.categorias.orderBy('nome').filter((c) => c.ativo).toArray(), []) ?? []
export const useEmpresa = () => useLiveQuery(() => db.empresa.get(1), [])
export const useEstoqueMapa = () =>
  useLiveQuery(async () => new Map((await db.estoque.toArray()).map((e) => [e.produto_id, e])), []) ?? new Map()

// Cadastro que compra (não é só fornecedor).
export const ehCliente = (c?: { eh_cliente?: boolean } | null) => !!c && c.eh_cliente !== false

export function nomeCliente(c?: { razao_social: string; nome_fantasia: string | null } | null) {
  if (!c) return 'Cliente não encontrado'
  return c.nome_fantasia || c.razao_social
}
