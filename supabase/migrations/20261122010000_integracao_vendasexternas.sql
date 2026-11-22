-- =====================================================================
-- Integração com o VendasExternas (emissor fiscal do Neto, Alkord)
-- A API deles cria e altera clientes e produtos, mas NÃO cria pedido.
-- Aqui: chaves guardadas no banco (ninguém lê pelo app) e o vínculo
-- entre nossos cadastros e os códigos do VendasExternas.
-- Quem conversa com a API é a Edge Function "vendasexternas".
-- =====================================================================

-- Chaves da integração. RLS ligado e SEM política: nem gestor lê pelo app.
-- Só a Edge Function (service role) lê.
create table if not exists public.integracao_ve (
  id                 int primary key default 1 check (id = 1),
  application_key    text,
  application_secret text,
  unidade_negocio    int,          -- código da unidade de negócio (preços), descoberto no teste
  testado_em         timestamptz,
  teste_ok           boolean,
  teste_msg          text,
  atualizado_em      timestamptz not null default now()
);
alter table public.integracao_ve enable row level security;
revoke all on public.integracao_ve from anon, authenticated;

-- Gestor grava as chaves por aqui (nunca volta o segredo)
create or replace function public.salvar_chaves_ve(p_key text, p_secret text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_gestor() then
    raise exception 'Só o gestor configura a integração' using errcode = '42501';
  end if;
  insert into public.integracao_ve (id, application_key, application_secret, testado_em, teste_ok, teste_msg, atualizado_em)
  values (1, nullif(trim(p_key), ''), nullif(trim(p_secret), ''), null, null, null, now())
  on conflict (id) do update set
    application_key = excluded.application_key,
    application_secret = excluded.application_secret,
    testado_em = null, teste_ok = null, teste_msg = null, atualizado_em = now();
end $$;

-- Situação da integração, sem expor as chaves
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
    'testado_em', r.testado_em,
    'teste_ok', r.teste_ok,
    'teste_msg', r.teste_msg);
end $$;

revoke all on function public.salvar_chaves_ve(text, text) from public, anon;
revoke all on function public.status_integracao_ve() from public, anon;
grant execute on function public.salvar_chaves_ve(text, text) to authenticated;
grant execute on function public.status_integracao_ve() to authenticated;

-- Vínculo: nosso cadastro <-> código no VendasExternas
-- origem: 'criado' = nós cadastramos lá (podemos atualizar);
--         'vinculado' = já existia lá (não sobrescrevemos os dados fiscais deles).
create table if not exists public.ve_vinculos (
  entidade     text not null check (entidade in ('cliente','produto')),
  registro_id  uuid not null,
  ve_codigo    bigint,
  origem       text check (origem in ('criado','vinculado')),
  enviado_em   timestamptz,
  erro         text,
  primary key (entidade, registro_id)
);
alter table public.ve_vinculos enable row level security;
revoke all on public.ve_vinculos from anon;
drop policy if exists ve_vinculos_gestor on public.ve_vinculos;
create policy ve_vinculos_gestor on public.ve_vinculos for select to authenticated
  using (public.eh_gestor());
grant select on public.ve_vinculos to authenticated;

-- Para o espelho do pedido: nosso código -> código VE
create or replace view public.vw_ve_codigos with (security_invoker = true) as
select 'cliente'::text as entidade, c.codigo::text as codigo, v.ve_codigo
from public.ve_vinculos v join public.clientes c on c.id = v.registro_id
where v.entidade = 'cliente' and v.ve_codigo is not null
union all
select 'produto', p.codigo, v.ve_codigo
from public.ve_vinculos v join public.produtos p on p.id = v.registro_id
where v.entidade = 'produto' and v.ve_codigo is not null;
grant select on public.vw_ve_codigos to authenticated;
