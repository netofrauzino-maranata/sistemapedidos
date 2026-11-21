-- Ajustes apontados pelo Security Advisor do Supabase.
alter function public.tg_atualizado_em() set search_path = public;
alter function public.tg_perfis_protege() set search_path = public;
alter function public.tg_clientes_criado_por() set search_path = public;

-- Funções de checagem: só usuário logado (as regras de RLS usam).
revoke execute on function public.eh_gestor() from public, anon;
revoke execute on function public.eh_usuario_ativo() from public, anon;
grant execute on function public.eh_gestor() to authenticated;
grant execute on function public.eh_usuario_ativo() to authenticated;

-- Função de trigger não precisa ser chamável pela API.
revoke execute on function public.tg_novo_usuario() from public, anon, authenticated;
