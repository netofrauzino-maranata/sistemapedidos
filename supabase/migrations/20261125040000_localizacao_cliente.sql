-- Localização (GPS) do cliente/fornecedor para entrega.
-- latitude/longitude já existiam em clientes; aqui guardamos quando e quem salvou
-- e uma função para salvar só a localização.
-- Qualquer usuário ativo que ENXERGA o cliente (mesma regra do select) pode salvar
-- a localização, inclusive cliente "sem vendedor", sem poder mexer nos outros campos.

alter table public.clientes
  add column if not exists localizacao_em        timestamptz,
  add column if not exists localizacao_por       uuid references public.perfis(id),
  add column if not exists localizacao_precisao  integer; -- metros (precisão do GPS)

create or replace function public.salvar_localizacao_cliente(
  p_cliente uuid, p_latitude numeric, p_longitude numeric, p_precisao integer default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  if not public.eh_usuario_ativo() then raise exception 'Usuário sem permissão'; end if;
  if (p_latitude is null) <> (p_longitude is null) then raise exception 'Localização incompleta'; end if;
  if p_latitude is not null and (p_latitude not between -90 and 90 or p_longitude not between -180 and 180) then
    raise exception 'Localização inválida';
  end if;
  select true into v_ok from public.clientes c
   where c.id = p_cliente
     and (public.eh_gestor() or c.vendedor_id = auth.uid() or c.vendedor_id is null or c.criado_por = auth.uid());
  if v_ok is null then return false; end if; -- ainda não sincronizado ou sem acesso
  update public.clientes set
    latitude = round(p_latitude, 7), longitude = round(p_longitude, 7),
    localizacao_precisao = case when p_latitude is null then null else p_precisao end,
    localizacao_em = case when p_latitude is null then null else now() end,
    localizacao_por = case when p_latitude is null then null else auth.uid() end
   where id = p_cliente;
  return true;
end $$;

revoke all on function public.salvar_localizacao_cliente(uuid, numeric, numeric, integer) from public, anon;
grant execute on function public.salvar_localizacao_cliente(uuid, numeric, numeric, integer) to authenticated;
