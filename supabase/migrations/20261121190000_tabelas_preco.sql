-- Tabelas de preço por cliente (vindas do sistema antigo do Neto).
-- A tabela guarda só as EXCEÇÕES: produto sem item na tabela usa o preco_venda normal.
-- O cliente aponta para a tabela dele; o pedido no celular puxa o preço certo.

create table public.tabelas_preco (
  id            uuid primary key default gen_random_uuid(),
  codigo        text unique,                      -- código no sistema antigo
  nome          text not null,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.tabela_preco_itens (
  id            uuid primary key default gen_random_uuid(),
  tabela_id     uuid not null references public.tabelas_preco(id),
  produto_id    uuid not null references public.produtos(id),
  preco         numeric(12,2) not null check (preco >= 0),
  ativo         boolean not null default true,    -- "apagar" item = ativo false (sincroniza)
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (tabela_id, produto_id)
);
create index tabela_preco_itens_atualizado_idx on public.tabela_preco_itens (atualizado_em);

alter table public.clientes add column tabela_preco_id uuid references public.tabelas_preco(id);

create trigger tg_tabelas_preco_atualizado before update on public.tabelas_preco
  for each row execute function public.tg_atualizado_em();
create trigger tg_tabela_preco_itens_atualizado before update on public.tabela_preco_itens
  for each row execute function public.tg_atualizado_em();

alter table public.tabelas_preco enable row level security;
alter table public.tabela_preco_itens enable row level security;

create policy tabelas_preco_select on public.tabelas_preco for select to authenticated
  using (public.eh_usuario_ativo());
create policy tabelas_preco_gestor on public.tabelas_preco for all to authenticated
  using (public.eh_gestor()) with check (public.eh_gestor());
create policy tabela_preco_itens_select on public.tabela_preco_itens for select to authenticated
  using (public.eh_usuario_ativo());
create policy tabela_preco_itens_gestor on public.tabela_preco_itens for all to authenticated
  using (public.eh_gestor()) with check (public.eh_gestor());

-- Só o gestor escolhe a tabela de preço do cliente. Vendedor que edita o
-- cliente não consegue trocar (o valor antigo é mantido).
create or replace function public.tg_clientes_tabela_preco()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and not public.eh_gestor() then
    if tg_op = 'INSERT' then
      new.tabela_preco_id := null;
    else
      new.tabela_preco_id := old.tabela_preco_id;
    end if;
  end if;
  return new;
end $$;
create trigger tg_clientes_tabela_preco before insert or update on public.clientes
  for each row execute function public.tg_clientes_tabela_preco();
revoke all on function public.tg_clientes_tabela_preco() from public, anon, authenticated;
