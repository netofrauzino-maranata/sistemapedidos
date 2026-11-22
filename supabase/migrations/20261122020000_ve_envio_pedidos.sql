-- =====================================================================
-- VendasExternas: envio de pedidos pela API (POST /atendimentos, que existe
-- embora não esteja na documentação pública; testado em 22/11/2026).
-- =====================================================================

-- Tipo de atendimento usado lá: 1 = Pedido/Pré-venda, 5 = Pronta entrega
alter table public.integracao_ve add column if not exists tipo_atendimento int not null default 1;

-- De/para: nossa forma, condição e vendedor -> código no VendasExternas
create table if not exists public.ve_mapa (
  tipo         text not null check (tipo in ('forma','condicao','vendedor')),
  registro_id  uuid not null,
  ve_codigo    int,
  primary key (tipo, registro_id)
);
alter table public.ve_mapa enable row level security;
revoke all on public.ve_mapa from anon;
drop policy if exists ve_mapa_gestor_sel on public.ve_mapa;
create policy ve_mapa_gestor_sel on public.ve_mapa for select to authenticated using (public.eh_gestor());
drop policy if exists ve_mapa_gestor_ins on public.ve_mapa;
create policy ve_mapa_gestor_ins on public.ve_mapa for insert to authenticated with check (public.eh_gestor());
drop policy if exists ve_mapa_gestor_upd on public.ve_mapa;
create policy ve_mapa_gestor_upd on public.ve_mapa for update to authenticated using (public.eh_gestor()) with check (public.eh_gestor());
grant select, insert, update on public.ve_mapa to authenticated;

-- Pedidos já enviados (evita mandar duas vezes)
create table if not exists public.ve_pedidos (
  pedido_id   uuid primary key references public.pedidos(id),
  ve_codigo   bigint,
  enviado_em  timestamptz,
  erro        text
);
alter table public.ve_pedidos enable row level security;
revoke all on public.ve_pedidos from anon;
drop policy if exists ve_pedidos_gestor on public.ve_pedidos;
create policy ve_pedidos_gestor on public.ve_pedidos for select to authenticated using (public.eh_gestor());
grant select on public.ve_pedidos to authenticated;

-- Tipo de atendimento: o gestor escolhe
create or replace function public.definir_tipo_atendimento_ve(p_tipo int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_gestor() then
    raise exception 'Só o gestor configura a integração' using errcode = '42501';
  end if;
  if p_tipo not in (1, 5) then raise exception 'Tipo inválido'; end if;
  insert into public.integracao_ve (id, tipo_atendimento) values (1, p_tipo)
  on conflict (id) do update set tipo_atendimento = excluded.tipo_atendimento, atualizado_em = now();
end $$;
revoke all on function public.definir_tipo_atendimento_ve(int) from public, anon;
grant execute on function public.definir_tipo_atendimento_ve(int) to authenticated;

-- Status passa a informar o tipo
create or replace function public.status_integracao_ve()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.integracao_ve;
begin
  if not public.eh_gestor() then
    raise exception 'Só o gestor vê a integração' using errcode = '42501';
  end if;
  select * into r from public.integracao_ve where id = 1;
  return jsonb_build_object(
    'configurada', r.application_key is not null and r.application_secret is not null,
    'final_chave', right(coalesce(r.application_key, ''), 4),
    'unidade_negocio', r.unidade_negocio,
    'tipo_atendimento', coalesce(r.tipo_atendimento, 1),
    'testado_em', r.testado_em,
    'teste_ok', r.teste_ok,
    'teste_msg', r.teste_msg);
end $$;
