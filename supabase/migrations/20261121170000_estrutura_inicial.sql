-- =====================================================================
-- Sistema de Pedidos Maranata — estrutura inicial do banco
-- Postgres (Supabase). Todas as tabelas com RLS ligado.
--
-- Ideias centrais:
--  * Estoque é um LIVRO (movimentos_estoque). Saldo = soma dos movimentos.
--    Nada mexe em estoque direto: só as funções registrar_entrada,
--    salvar_pedido e ajustar_estoque gravam movimentos.
--  * Baixa por lote no modelo FEFO (vence primeiro, sai primeiro).
--  * IDs são UUID gerados no celular, para o app funcionar offline e
--    sincronizar depois sem duplicar (salvar_pedido é idempotente).
--  * Nada é apagado: cadastros têm "ativo" e todas as tabelas têm
--    atualizado_em, que o app usa para baixar só o que mudou.
--  * Campos fiscais já existem (NCM, CEST, GTIN, origem, CFOP, CPF/CNPJ,
--    IE, código IBGE) para exportar vendas ao emissor de NF-e.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Funções utilitárias
-- ---------------------------------------------------------------------
create or replace function public.tg_atualizado_em()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Perfis de usuário (gestor ou vendedor)
-- ---------------------------------------------------------------------
create table public.perfis (
  id            uuid primary key references auth.users(id) on delete cascade,
  nome          text not null default '',
  email         text,
  telefone      text,
  papel         text not null default 'vendedor' check (papel in ('gestor','vendedor')),
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create or replace function public.eh_gestor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perfis
    where id = auth.uid() and papel = 'gestor' and ativo
  );
$$;

create or replace function public.eh_usuario_ativo()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and ativo);
$$;

-- Cria o perfil quando alguém se cadastra no Auth.
-- O primeiro usuário do sistema vira gestor; os demais entram como vendedor.
create or replace function public.tg_novo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, nome, email, papel)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    new.email,
    case when exists (select 1 from public.perfis) then 'vendedor' else 'gestor' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.tg_novo_usuario();

-- Vendedor não pode se promover a gestor nem se reativar.
create or replace function public.tg_perfis_protege()
returns trigger language plpgsql as $$
begin
  if not public.eh_gestor() then
    new.papel := old.papel;
    new.ativo := old.ativo;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Dados da empresa (uma linha só; usados no PDF do pedido e catálogo)
-- ---------------------------------------------------------------------
create table public.empresa (
  id            int primary key default 1 check (id = 1),
  razao_social  text not null default 'Maranata Distribuidora',
  nome_fantasia text default 'Maranata',
  cnpj          text,
  ie            text,
  telefone      text,
  whatsapp      text,
  email         text,
  cep           text,
  logradouro    text,
  numero        text,
  complemento   text,
  bairro        text,
  cidade        text,
  uf            char(2),
  codigo_ibge   text,
  logo_url      text,
  rodape_pedido text,
  atualizado_em timestamptz not null default now()
);
insert into public.empresa (id) values (1);

-- ---------------------------------------------------------------------
-- Cadastros de apoio
-- ---------------------------------------------------------------------
create table public.categorias (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null unique,
  ordem         int not null default 0,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.condicoes_pagamento (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null unique,          -- ex.: "À vista", "7/14/21 dias"
  parcelas_dias int[] not null default '{0}',  -- ex.: {7,14,21}
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.formas_pagamento (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null unique,          -- Dinheiro, PIX, Boleto, Cartão
  codigo_nfe    text,                          -- tPag da NF-e (01, 15, 17...)
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.fornecedores (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  cpf_cnpj      text,
  ie            text,
  telefone      text,
  email         text,
  cidade        text,
  uf            char(2),
  observacao    text,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Produtos
-- ---------------------------------------------------------------------
create table public.produtos (
  id                uuid primary key default gen_random_uuid(),
  codigo            text not null unique,              -- código interno
  nome              text not null,
  descricao         text,
  categoria_id      uuid references public.categorias(id),
  marca             text,
  unidade           text not null default 'UN',        -- UN, CX, FD, PCT, KG, LT...
  qtd_embalagem     numeric(12,3) not null default 1,  -- ex.: caixa com 12
  peso_kg           numeric(12,3),
  gtin              text,                              -- código de barras (EAN)
  ncm               text check (ncm is null or ncm ~ '^[0-9]{8}$'),
  cest              text check (cest is null or cest ~ '^[0-9]{7}$'),
  origem            smallint not null default 0 check (origem between 0 and 8),
  cfop_padrao       text default '5102',
  preco_venda       numeric(12,2) not null default 0 check (preco_venda >= 0),
  preco_minimo      numeric(12,2) check (preco_minimo is null or preco_minimo >= 0),
  preco_custo       numeric(12,4),
  estoque_minimo    numeric(12,3) not null default 0,
  controla_validade boolean not null default true,
  foto_url          text,
  mostrar_catalogo  boolean not null default true,
  ativo             boolean not null default true,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
create index produtos_categoria_idx on public.produtos (categoria_id);
create index produtos_nome_idx on public.produtos (lower(nome));

create table public.lotes (
  id              uuid primary key default gen_random_uuid(),
  produto_id      uuid not null references public.produtos(id),
  numero          text not null,                 -- número do lote do fabricante
  data_fabricacao date,
  data_validade   date,
  custo_unitario  numeric(12,4),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  unique (produto_id, numero)
);
create index lotes_validade_idx on public.lotes (produto_id, data_validade);

-- ---------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------
create table public.clientes (
  id                      uuid primary key default gen_random_uuid(),
  codigo                  bigint generated by default as identity unique,
  tipo_pessoa             char(1) not null default 'J' check (tipo_pessoa in ('F','J')),
  razao_social            text not null,              -- ou nome completo (PF)
  nome_fantasia           text,
  cpf_cnpj                text,
  indicador_ie            smallint not null default 9 check (indicador_ie in (1,2,9)),
                          -- 1 contribuinte, 2 isento, 9 não contribuinte (padrão NF-e)
  ie                      text,
  email                   text,
  telefone                text,
  whatsapp                text,
  contato                 text,
  cep                     text,
  logradouro              text,
  numero                  text,
  complemento             text,
  bairro                  text,
  cidade                  text,
  uf                      char(2),
  codigo_ibge             text,                       -- código do município (NF-e)
  latitude                numeric(10,7),
  longitude               numeric(10,7),
  vendedor_id             uuid references public.perfis(id),
  condicao_pagamento_id   uuid references public.condicoes_pagamento(id),
  forma_pagamento_id      uuid references public.formas_pagamento(id),
  limite_credito          numeric(12,2),
  observacao              text,
  ativo                   boolean not null default true,
  criado_por              uuid references public.perfis(id) default auth.uid(),
  criado_em               timestamptz not null default now(),
  atualizado_em           timestamptz not null default now()
);
create unique index clientes_cpf_cnpj_uk on public.clientes (cpf_cnpj) where cpf_cnpj is not null and cpf_cnpj <> '';
create index clientes_vendedor_idx on public.clientes (vendedor_id);
create index clientes_nome_idx on public.clientes (lower(razao_social));

-- ---------------------------------------------------------------------
-- Entradas de mercadoria (compra, bonificação, devolução)
-- ---------------------------------------------------------------------
create table public.entradas (
  id             uuid primary key default gen_random_uuid(),
  numero         bigint generated by default as identity unique,
  data_entrada   date not null default current_date,
  tipo           text not null default 'compra' check (tipo in ('compra','bonificacao','devolucao','outros')),
  fornecedor_id  uuid references public.fornecedores(id),
  numero_nota    text,
  observacao     text,
  total          numeric(14,2) not null default 0,
  usuario_id     uuid references public.perfis(id) default auth.uid(),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

create table public.entrada_itens (
  id              uuid primary key default gen_random_uuid(),
  entrada_id      uuid not null references public.entradas(id) on delete cascade,
  produto_id      uuid not null references public.produtos(id),
  lote_id         uuid references public.lotes(id),
  quantidade      numeric(12,3) not null check (quantidade > 0),
  custo_unitario  numeric(12,4) not null default 0,
  total           numeric(14,2) generated always as (round(quantidade * custo_unitario, 2)) stored
);
create index entrada_itens_entrada_idx on public.entrada_itens (entrada_id);

-- ---------------------------------------------------------------------
-- Pedidos de venda
-- ---------------------------------------------------------------------
create table public.pedidos (
  id                     uuid primary key,              -- gerado no celular
  numero                 bigint generated by default as identity unique,
  cliente_id             uuid not null references public.clientes(id),
  vendedor_id            uuid not null references public.perfis(id) default auth.uid(),
  status                 text not null default 'pendente'
                         check (status in ('orcamento','pendente','confirmado','faturado','entregue','cancelado')),
  data_pedido            timestamptz not null default now(),
  data_entrega           date,
  condicao_pagamento_id  uuid references public.condicoes_pagamento(id),
  forma_pagamento_id     uuid references public.formas_pagamento(id),
  subtotal               numeric(14,2) not null default 0,
  desconto               numeric(14,2) not null default 0,
  frete                  numeric(14,2) not null default 0,
  total                  numeric(14,2) not null default 0,
  observacao             text,
  observacao_interna     text,
  latitude               numeric(10,7),
  longitude              numeric(10,7),
  nfe_numero             text,
  nfe_chave              text,
  exportado_nfe_em       timestamptz,
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now()
);
create index pedidos_cliente_idx on public.pedidos (cliente_id);
create index pedidos_vendedor_idx on public.pedidos (vendedor_id, data_pedido desc);
create index pedidos_status_idx on public.pedidos (status, data_pedido desc);
create index pedidos_atualizado_idx on public.pedidos (atualizado_em);

create table public.pedido_itens (
  id              uuid primary key default gen_random_uuid(),
  pedido_id       uuid not null references public.pedidos(id) on delete cascade,
  item            int not null,
  produto_id      uuid not null references public.produtos(id),
  quantidade      numeric(12,3) not null check (quantidade > 0),
  preco_unitario  numeric(12,4) not null check (preco_unitario >= 0),
  desconto        numeric(12,2) not null default 0 check (desconto >= 0),
  total           numeric(14,2) not null,
  unique (pedido_id, item)
);
create index pedido_itens_pedido_idx on public.pedido_itens (pedido_id);
create index pedido_itens_produto_idx on public.pedido_itens (produto_id);

-- ---------------------------------------------------------------------
-- Livro de estoque
-- ---------------------------------------------------------------------
create table public.movimentos_estoque (
  id              uuid primary key default gen_random_uuid(),
  produto_id      uuid not null references public.produtos(id),
  lote_id         uuid references public.lotes(id),  -- nulo = saída sem lote disponível (estoque negativo)
  tipo            text not null check (tipo in ('entrada','venda','estorno_venda','ajuste')),
  quantidade      numeric(12,3) not null check (quantidade <> 0), -- + entra, - sai
  entrada_id      uuid references public.entradas(id),
  pedido_id       uuid references public.pedidos(id),
  pedido_item_id  uuid references public.pedido_itens(id) on delete set null,
  motivo          text,
  usuario_id      uuid default auth.uid(),
  criado_em       timestamptz not null default now()
);
create index movimentos_produto_idx on public.movimentos_estoque (produto_id, lote_id);
create index movimentos_pedido_idx on public.movimentos_estoque (pedido_id);
create index movimentos_entrada_idx on public.movimentos_estoque (entrada_id);
create index movimentos_data_idx on public.movimentos_estoque (criado_em);

-- ---------------------------------------------------------------------
-- Triggers de atualizado_em
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['perfis','empresa','categorias','condicoes_pagamento','formas_pagamento',
                           'fornecedores','produtos','lotes','clientes','entradas','pedidos']
  loop
    execute format('create trigger %I before update on public.%I
                    for each row execute function public.tg_atualizado_em()', 'tg_' || t || '_atualizado', t);
  end loop;
end $$;

create trigger tg_perfis_protege before update on public.perfis
  for each row execute function public.tg_perfis_protege();

-- Quem cadastrou o cliente é sempre o usuário logado (não dá para forjar).
create or replace function public.tg_clientes_criado_por()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    new.criado_por := auth.uid();
  end if;
  return new;
end $$;
create trigger tg_clientes_criado_por before insert on public.clientes
  for each row execute function public.tg_clientes_criado_por();

-- ---------------------------------------------------------------------
-- Visões de estoque
-- ---------------------------------------------------------------------
create view public.vw_estoque_lotes with (security_invoker = true) as
select l.id as lote_id, l.produto_id, l.numero, l.data_fabricacao, l.data_validade,
       coalesce(sum(m.quantidade), 0)::numeric(12,3) as saldo,
       (l.data_validade - current_date) as dias_para_vencer
from public.lotes l
left join public.movimentos_estoque m on m.lote_id = l.id
group by l.id;

create view public.vw_estoque_produtos with (security_invoker = true) as
select p.id as produto_id, p.codigo, p.nome, p.unidade, p.estoque_minimo,
       coalesce(sum(m.quantidade), 0)::numeric(12,3) as saldo,
       (select min(vl.data_validade) from public.vw_estoque_lotes vl
         where vl.produto_id = p.id and vl.saldo > 0) as proxima_validade
from public.produtos p
left join public.movimentos_estoque m on m.produto_id = p.id
group by p.id;

-- ---------------------------------------------------------------------
-- Funções de negócio (únicas que gravam estoque)
-- ---------------------------------------------------------------------

-- Baixa FEFO de um item: consome lotes com saldo, do que vence primeiro.
-- O que faltar vira saída sem lote (estoque negativo), para não travar
-- vendedor que vendeu offline. O gestor vê isso como alerta.
create or replace function public._baixar_item(p_pedido uuid, p_item uuid, p_produto uuid, p_qtd numeric)
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_resta numeric := p_qtd;
  v_tira numeric;
begin
  -- trava o produto para duas baixas simultâneas não usarem o mesmo saldo
  perform 1 from public.produtos where id = p_produto for update;

  for r in
    select l.id, coalesce(sum(m.quantidade), 0) as saldo
    from public.lotes l
    left join public.movimentos_estoque m on m.lote_id = l.id
    where l.produto_id = p_produto
    group by l.id, l.data_validade, l.criado_em
    having coalesce(sum(m.quantidade), 0) > 0
    order by l.data_validade nulls last, l.criado_em
  loop
    exit when v_resta <= 0;
    v_tira := least(v_resta, r.saldo);
    insert into public.movimentos_estoque (produto_id, lote_id, tipo, quantidade, pedido_id, pedido_item_id)
    values (p_produto, r.id, 'venda', -v_tira, p_pedido, p_item);
    v_resta := v_resta - v_tira;
  end loop;

  if v_resta > 0 then
    insert into public.movimentos_estoque (produto_id, lote_id, tipo, quantidade, pedido_id, pedido_item_id, motivo)
    values (p_produto, null, 'venda', -v_resta, p_pedido, p_item, 'sem saldo em lote');
  end if;
end $$;

-- Devolve ao estoque tudo o que um pedido baixou (líquido), lote a lote.
create or replace function public._estornar_pedido(p_pedido uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.movimentos_estoque (produto_id, lote_id, tipo, quantidade, pedido_id, motivo)
  select produto_id, lote_id, 'estorno_venda', -sum(quantidade), p_pedido, 'estorno do pedido'
  from public.movimentos_estoque
  where pedido_id = p_pedido
  group by produto_id, lote_id
  having sum(quantidade) <> 0;
end $$;

-- Salva (cria ou altera) um pedido vindo do app. Idempotente pelo id:
-- reenviar o mesmo pedido na sincronização não duplica nada.
-- Status que baixam estoque: pendente, confirmado, faturado, entregue.
-- Orçamento não baixa. Cancelado devolve.
--
-- Formato de p_pedido:
-- { "id": uuid, "cliente_id": uuid, "status": "pendente", "data_pedido": "...",
--   "data_entrega": "2026-11-25", "condicao_pagamento_id": uuid, "forma_pagamento_id": uuid,
--   "desconto": 0, "frete": 0, "observacao": "", "latitude": .., "longitude": ..,
--   "itens": [ { "id": uuid, "produto_id": uuid, "quantidade": 2, "preco_unitario": 10.5, "desconto": 0 } ] }
create or replace function public.salvar_pedido(p_pedido jsonb)
returns public.pedidos language plpgsql security definer set search_path = public as $$
declare
  v_id        uuid := (p_pedido->>'id')::uuid;
  v_atual     public.pedidos;
  v_status    text := coalesce(p_pedido->>'status', 'pendente');
  v_gestor    boolean := public.eh_gestor();
  v_vendedor  uuid;
  v_subtotal  numeric := 0;
  v_result    public.pedidos;
  it          jsonb;
  v_n         int := 0;
  v_item_id   uuid;
  v_total_it  numeric;
  v_baixa     boolean;
begin
  if auth.uid() is null or not public.eh_usuario_ativo() then
    raise exception 'Usuário sem acesso' using errcode = '42501';
  end if;
  if v_id is null then
    raise exception 'Pedido sem id';
  end if;
  if v_status not in ('orcamento','pendente','confirmado','faturado','entregue','cancelado') then
    raise exception 'Status inválido: %', v_status;
  end if;
  if not v_gestor and v_status not in ('orcamento','pendente','cancelado') then
    raise exception 'Vendedor só pode salvar orçamento, pendente ou cancelado' using errcode = '42501';
  end if;

  select * into v_atual from public.pedidos where id = v_id for update;

  if found then
    if not v_gestor and (v_atual.vendedor_id <> auth.uid() or v_atual.status not in ('orcamento','pendente')) then
      raise exception 'Pedido % não pode mais ser alterado por você', v_atual.numero using errcode = '42501';
    end if;
    v_vendedor := v_atual.vendedor_id;
    -- desfaz a baixa anterior e recria os itens
    perform public._estornar_pedido(v_id);
    delete from public.pedido_itens where pedido_id = v_id;
  else
    v_vendedor := case when v_gestor and p_pedido ? 'vendedor_id'
                       then (p_pedido->>'vendedor_id')::uuid else auth.uid() end;
  end if;

  -- vendedor só vende para cliente que enxerga
  if not v_gestor and not exists (
    select 1 from public.clientes c
    where c.id = (p_pedido->>'cliente_id')::uuid
      and (c.vendedor_id = auth.uid() or c.vendedor_id is null or c.criado_por = auth.uid())
  ) then
    raise exception 'Cliente não encontrado para este vendedor' using errcode = '42501';
  end if;

  insert into public.pedidos as p (id, cliente_id, vendedor_id, status, data_pedido, data_entrega,
                       condicao_pagamento_id, forma_pagamento_id, desconto, frete,
                       observacao, observacao_interna, latitude, longitude)
  values (v_id,
          (p_pedido->>'cliente_id')::uuid,
          v_vendedor,
          v_status,
          coalesce((p_pedido->>'data_pedido')::timestamptz, now()),
          (p_pedido->>'data_entrega')::date,
          (p_pedido->>'condicao_pagamento_id')::uuid,
          (p_pedido->>'forma_pagamento_id')::uuid,
          coalesce((p_pedido->>'desconto')::numeric, 0),
          coalesce((p_pedido->>'frete')::numeric, 0),
          p_pedido->>'observacao',
          case when v_gestor then p_pedido->>'observacao_interna' end,
          (p_pedido->>'latitude')::numeric,
          (p_pedido->>'longitude')::numeric)
  on conflict (id) do update set
    cliente_id = excluded.cliente_id,
    status = excluded.status,
    data_pedido = excluded.data_pedido,
    data_entrega = excluded.data_entrega,
    condicao_pagamento_id = excluded.condicao_pagamento_id,
    forma_pagamento_id = excluded.forma_pagamento_id,
    desconto = excluded.desconto,
    frete = excluded.frete,
    observacao = excluded.observacao,
    observacao_interna = coalesce(excluded.observacao_interna, p.observacao_interna),
    latitude = coalesce(excluded.latitude, p.latitude),
    longitude = coalesce(excluded.longitude, p.longitude);

  v_baixa := v_status in ('pendente','confirmado','faturado','entregue');

  for it in select * from jsonb_array_elements(coalesce(p_pedido->'itens', '[]'::jsonb))
  loop
    v_n := v_n + 1;
    v_item_id := coalesce((it->>'id')::uuid, gen_random_uuid());
    v_total_it := round((it->>'quantidade')::numeric * (it->>'preco_unitario')::numeric
                        - coalesce((it->>'desconto')::numeric, 0), 2);
    insert into public.pedido_itens (id, pedido_id, item, produto_id, quantidade, preco_unitario, desconto, total)
    values (v_item_id, v_id, v_n, (it->>'produto_id')::uuid, (it->>'quantidade')::numeric,
            (it->>'preco_unitario')::numeric, coalesce((it->>'desconto')::numeric, 0), v_total_it);
    v_subtotal := v_subtotal + v_total_it;
    if v_baixa then
      perform public._baixar_item(v_id, v_item_id, (it->>'produto_id')::uuid, (it->>'quantidade')::numeric);
    end if;
  end loop;

  if v_n = 0 and v_status <> 'cancelado' then
    raise exception 'Pedido sem itens';
  end if;

  update public.pedidos
     set subtotal = v_subtotal,
         total = v_subtotal - desconto + frete
   where id = v_id
  returning * into v_result;

  return v_result;
end $$;

-- Gestor muda só o status (confirmar, faturar, entregar, cancelar),
-- sem reenviar itens. Cancelar devolve o estoque; reabrir baixa de novo.
create or replace function public.mudar_status_pedido(p_id uuid, p_status text, p_nfe_numero text default null)
returns public.pedidos language plpgsql security definer set search_path = public as $$
declare
  v_atual public.pedidos;
  v_result public.pedidos;
  v_baixava boolean;
  v_baixa boolean;
  r record;
begin
  select * into v_atual from public.pedidos where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;

  if not public.eh_gestor() then
    -- vendedor só pode cancelar o próprio pedido ainda pendente/orçamento
    if not (public.eh_usuario_ativo() and v_atual.vendedor_id = auth.uid()
            and v_atual.status in ('orcamento','pendente') and p_status = 'cancelado') then
      raise exception 'Sem permissão para mudar este pedido' using errcode = '42501';
    end if;
  end if;
  if p_status not in ('orcamento','pendente','confirmado','faturado','entregue','cancelado') then
    raise exception 'Status inválido: %', p_status;
  end if;

  v_baixava := v_atual.status in ('pendente','confirmado','faturado','entregue');
  v_baixa   := p_status in ('pendente','confirmado','faturado','entregue');

  if v_baixava and not v_baixa then
    perform public._estornar_pedido(p_id);
  elsif v_baixa and not v_baixava then
    for r in select id, produto_id, quantidade from public.pedido_itens where pedido_id = p_id order by item loop
      perform public._baixar_item(p_id, r.id, r.produto_id, r.quantidade);
    end loop;
  end if;

  update public.pedidos
     set status = p_status,
         nfe_numero = coalesce(p_nfe_numero, nfe_numero)
   where id = p_id
  returning * into v_result;
  return v_result;
end $$;

-- Registra uma entrada de mercadoria (só gestor). Cria os lotes se não existirem.
-- { "id": uuid?, "data_entrada": "2026-11-21", "tipo": "compra", "fornecedor_id": uuid,
--   "numero_nota": "123", "observacao": "",
--   "itens": [ { "produto_id": uuid, "lote": "L123", "data_fabricacao": "...",
--                "data_validade": "2027-03-01", "quantidade": 10, "custo_unitario": 5.2 } ] }
create or replace function public.registrar_entrada(p_entrada jsonb)
returns public.entradas language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := coalesce((p_entrada->>'id')::uuid, gen_random_uuid());
  v_result public.entradas;
  it jsonb;
  v_lote uuid;
  v_total numeric := 0;
begin
  if not public.eh_gestor() then
    raise exception 'Só o gestor registra entrada' using errcode = '42501';
  end if;
  if exists (select 1 from public.entradas where id = v_id) then
    select * into v_result from public.entradas where id = v_id;
    return v_result;  -- já registrada (reenvio da sincronização)
  end if;

  insert into public.entradas (id, data_entrada, tipo, fornecedor_id, numero_nota, observacao)
  values (v_id,
          coalesce((p_entrada->>'data_entrada')::date, current_date),
          coalesce(p_entrada->>'tipo', 'compra'),
          (p_entrada->>'fornecedor_id')::uuid,
          p_entrada->>'numero_nota',
          p_entrada->>'observacao');

  for it in select * from jsonb_array_elements(coalesce(p_entrada->'itens', '[]'::jsonb))
  loop
    insert into public.lotes (produto_id, numero, data_fabricacao, data_validade, custo_unitario)
    values ((it->>'produto_id')::uuid,
            coalesce(nullif(trim(it->>'lote'), ''), 'SEM-LOTE'),
            (it->>'data_fabricacao')::date,
            (it->>'data_validade')::date,
            (it->>'custo_unitario')::numeric)
    on conflict (produto_id, numero) do update set
      data_validade   = coalesce(excluded.data_validade, lotes.data_validade),
      data_fabricacao = coalesce(excluded.data_fabricacao, lotes.data_fabricacao),
      custo_unitario  = coalesce(excluded.custo_unitario, lotes.custo_unitario)
    returning id into v_lote;

    insert into public.entrada_itens (entrada_id, produto_id, lote_id, quantidade, custo_unitario)
    values (v_id, (it->>'produto_id')::uuid, v_lote, (it->>'quantidade')::numeric,
            coalesce((it->>'custo_unitario')::numeric, 0));

    insert into public.movimentos_estoque (produto_id, lote_id, tipo, quantidade, entrada_id)
    values ((it->>'produto_id')::uuid, v_lote, 'entrada', (it->>'quantidade')::numeric, v_id);

    v_total := v_total + round((it->>'quantidade')::numeric * coalesce((it->>'custo_unitario')::numeric, 0), 2);

    if (it->>'custo_unitario') is not null then
      update public.produtos set preco_custo = (it->>'custo_unitario')::numeric
       where id = (it->>'produto_id')::uuid;
    end if;
  end loop;

  update public.entradas set total = v_total where id = v_id returning * into v_result;
  return v_result;
end $$;

-- Ajuste manual (inventário, perda, vencido). Só gestor.
-- Informe a quantidade a somar (positiva) ou tirar (negativa).
create or replace function public.ajustar_estoque(p_produto uuid, p_lote uuid, p_quantidade numeric, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_gestor() then
    raise exception 'Só o gestor ajusta estoque' using errcode = '42501';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo do ajuste';
  end if;
  if p_lote is not null and not exists (select 1 from public.lotes where id = p_lote and produto_id = p_produto) then
    raise exception 'Lote não pertence ao produto';
  end if;
  insert into public.movimentos_estoque (produto_id, lote_id, tipo, quantidade, motivo)
  values (p_produto, p_lote, 'ajuste', p_quantidade, p_motivo);
end $$;

-- Marca pedidos como exportados para o emissor de NF-e.
create or replace function public.marcar_exportado_nfe(p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not public.eh_gestor() then
    raise exception 'Só o gestor exporta' using errcode = '42501';
  end if;
  update public.pedidos set exportado_nfe_em = now() where id = any(p_ids);
  get diagnostics v = row_count;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Visão para exportar vendas ao emissor de NF-e (uma linha por item)
-- ---------------------------------------------------------------------
create view public.vw_exportacao_nfe with (security_invoker = true) as
select
  pe.id as pedido_id, pe.numero as pedido_numero, pe.data_pedido, pe.status,
  pe.exportado_nfe_em, pe.subtotal as pedido_subtotal, pe.desconto as pedido_desconto,
  pe.frete as pedido_frete, pe.total as pedido_total,
  fp.nome as forma_pagamento, fp.codigo_nfe as forma_pagamento_codigo, cp.nome as condicao_pagamento,
  v.nome as vendedor,
  c.codigo as cliente_codigo, c.tipo_pessoa, c.razao_social, c.nome_fantasia, c.cpf_cnpj,
  c.indicador_ie, c.ie, c.email as cliente_email, c.telefone as cliente_telefone,
  c.cep, c.logradouro, c.numero as endereco_numero, c.complemento, c.bairro, c.cidade, c.uf, c.codigo_ibge,
  i.item, pr.codigo as produto_codigo, pr.nome as produto_nome, pr.gtin, pr.ncm, pr.cest,
  pr.origem, pr.cfop_padrao as cfop, pr.unidade,
  i.quantidade, i.preco_unitario, i.desconto as item_desconto, i.total as item_total
from public.pedidos pe
join public.clientes c on c.id = pe.cliente_id
join public.pedido_itens i on i.pedido_id = pe.id
join public.produtos pr on pr.id = i.produto_id
left join public.perfis v on v.id = pe.vendedor_id
left join public.formas_pagamento fp on fp.id = pe.forma_pagamento_id
left join public.condicoes_pagamento cp on cp.id = pe.condicao_pagamento_id;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.perfis              enable row level security;
alter table public.empresa             enable row level security;
alter table public.categorias          enable row level security;
alter table public.condicoes_pagamento enable row level security;
alter table public.formas_pagamento    enable row level security;
alter table public.fornecedores        enable row level security;
alter table public.produtos            enable row level security;
alter table public.lotes               enable row level security;
alter table public.clientes            enable row level security;
alter table public.entradas            enable row level security;
alter table public.entrada_itens       enable row level security;
alter table public.pedidos             enable row level security;
alter table public.pedido_itens        enable row level security;
alter table public.movimentos_estoque  enable row level security;

-- Perfis: cada um vê o seu; gestor vê e edita todos. Todos ativos veem nomes (para relatórios).
create policy perfis_select on public.perfis for select to authenticated
  using (id = auth.uid() or public.eh_usuario_ativo());
create policy perfis_update_proprio on public.perfis for update to authenticated
  using (id = auth.uid() or public.eh_gestor())
  with check (id = auth.uid() or public.eh_gestor());

-- Cadastros que todo usuário ativo lê e só gestor altera
do $$
declare t text;
begin
  foreach t in array array['empresa','categorias','condicoes_pagamento','formas_pagamento','produtos','lotes']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.eh_usuario_ativo())',
                   t || '_select', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.eh_gestor()) with check (public.eh_gestor())',
                   t || '_gestor', t);
  end loop;
end $$;

-- Só gestor
create policy fornecedores_gestor on public.fornecedores for all to authenticated
  using (public.eh_gestor()) with check (public.eh_gestor());
create policy entradas_gestor on public.entradas for select to authenticated using (public.eh_gestor());
create policy entrada_itens_gestor on public.entrada_itens for select to authenticated using (public.eh_gestor());

-- Movimentos: gestor lê tudo; vendedor lê (para ver saldo). Escrita só via funções.
create policy movimentos_select on public.movimentos_estoque for select to authenticated
  using (public.eh_usuario_ativo());

-- Clientes: gestor tudo; vendedor vê os dele, os sem vendedor e os que cadastrou.
create policy clientes_select on public.clientes for select to authenticated
  using (public.eh_gestor() or (public.eh_usuario_ativo()
         and (vendedor_id = auth.uid() or vendedor_id is null or criado_por = auth.uid())));
create policy clientes_insert on public.clientes for insert to authenticated
  with check (public.eh_gestor() or (public.eh_usuario_ativo()
              and (vendedor_id = auth.uid() or vendedor_id is null)));
create policy clientes_update on public.clientes for update to authenticated
  using (public.eh_gestor() or (public.eh_usuario_ativo()
         and (vendedor_id = auth.uid() or criado_por = auth.uid())))
  with check (public.eh_gestor() or (public.eh_usuario_ativo()
              and (vendedor_id = auth.uid() or vendedor_id is null)));

-- Pedidos: leitura direta; escrita só por salvar_pedido / mudar_status_pedido.
create policy pedidos_select on public.pedidos for select to authenticated
  using (public.eh_gestor() or (public.eh_usuario_ativo() and vendedor_id = auth.uid()));
create policy pedido_itens_select on public.pedido_itens for select to authenticated
  using (exists (select 1 from public.pedidos p where p.id = pedido_id
                 and (public.eh_gestor() or (public.eh_usuario_ativo() and p.vendedor_id = auth.uid()))));

-- Funções internas não ficam expostas na API
revoke all on function public._baixar_item(uuid, uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function public._estornar_pedido(uuid) from public, anon, authenticated;
revoke all on function public.salvar_pedido(jsonb) from public, anon;
revoke all on function public.mudar_status_pedido(uuid, text, text) from public, anon;
revoke all on function public.registrar_entrada(jsonb) from public, anon;
revoke all on function public.ajustar_estoque(uuid, uuid, numeric, text) from public, anon;
revoke all on function public.marcar_exportado_nfe(uuid[]) from public, anon;
grant execute on function public.salvar_pedido(jsonb) to authenticated;
grant execute on function public.mudar_status_pedido(uuid, text, text) to authenticated;
grant execute on function public.registrar_entrada(jsonb) to authenticated;
grant execute on function public.ajustar_estoque(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.marcar_exportado_nfe(uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- Dados iniciais
-- ---------------------------------------------------------------------
insert into public.formas_pagamento (nome, codigo_nfe) values
  ('Dinheiro','01'), ('PIX','17'), ('Boleto','15'), ('Cartão de crédito','03'),
  ('Cartão de débito','04'), ('Fiado / a prazo','99');

insert into public.condicoes_pagamento (nome, parcelas_dias) values
  ('À vista', '{0}'), ('7 dias', '{7}'), ('14 dias', '{14}'), ('21 dias', '{21}'),
  ('28 dias', '{28}'), ('7/14/21 dias', '{7,14,21}');
