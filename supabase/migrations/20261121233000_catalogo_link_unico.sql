-- Catálogo online com link único (/loja): qualquer pessoa abre, vê o preço
-- padrão, informa nome e celular e envia. O gestor escolhe o cliente na
-- hora de gerar o pedido (sugestão pelo celular). O link por cliente continua.

alter table public.pedidos_catalogo alter column cliente_id drop not null;
alter table public.pedidos_catalogo add column celular text;

create or replace function public.catalogo_geral()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'cliente', null,
    'empresa', (select jsonb_build_object('nome', coalesce(nullif(e.nome_fantasia, ''), e.razao_social),
                       'telefone', e.telefone, 'whatsapp', e.whatsapp) from public.empresa e where e.id = 1),
    'produtos', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', p.id, 'codigo', p.codigo, 'nome', p.nome, 'unidade', p.unidade,
               'qtd_embalagem', p.qtd_embalagem, 'marca', p.marca, 'foto_url', p.foto_url,
               'categoria', cat.nome, 'preco', p.preco_venda)
             order by cat.nome nulls last, p.nome), '[]'::jsonb)
      from public.produtos p
      left join public.categorias cat on cat.id = p.categoria_id and cat.ativo
      where p.ativo and p.mostrar_catalogo)
  );
$$;

create or replace function public.enviar_pedido_catalogo_geral(p_itens jsonb, p_nome text, p_celular text, p_observacao text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cel    text := regexp_replace(coalesce(p_celular, ''), '\D', '', 'g');
  v_itens  jsonb;
  v_total  numeric;
  v_numero bigint;
begin
  if length(trim(coalesce(p_nome, ''))) < 2 then raise exception 'Informe seu nome.'; end if;
  if length(v_cel) < 10 or length(v_cel) > 13 then raise exception 'Informe um celular com DDD.'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Escolha pelo menos um produto.'; end if;
  if jsonb_array_length(p_itens) > 300 then raise exception 'Itens demais.'; end if;
  if (select count(*) from public.pedidos_catalogo where celular = v_cel and criado_em > now() - interval '1 hour') >= 10
     or (select count(*) from public.pedidos_catalogo where cliente_id is null and criado_em > now() - interval '1 hour') >= 200 then
    raise exception 'Muitos envios seguidos. Tente de novo mais tarde.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('produto_id', p.id, 'quantidade', x.qtd, 'preco', p.preco_venda) order by x.ord), '[]'::jsonb),
         coalesce(sum(x.qtd * p.preco_venda), 0)
    into v_itens, v_total
  from (select (e->>'produto_id')::uuid as pid, (e->>'quantidade')::numeric as qtd, o as ord
        from jsonb_array_elements(p_itens) with ordinality as t(e, o)) x
  join public.produtos p on p.id = x.pid and p.ativo
  where x.qtd > 0 and x.qtd <= 100000;
  if jsonb_array_length(v_itens) = 0 then raise exception 'Nenhum produto válido.'; end if;

  insert into public.pedidos_catalogo (cliente_id, itens, total_estimado, contato, celular, observacao)
  values (null, v_itens, round(v_total, 2), left(trim(p_nome), 120), v_cel, left(nullif(trim(p_observacao), ''), 1000))
  returning numero into v_numero;
  return jsonb_build_object('numero', v_numero, 'itens', jsonb_array_length(v_itens), 'total', round(v_total, 2));
end $$;

-- Pedido do catálogo sem cliente: só o gestor vê e trata (as políticas antigas
-- já exigem cliente do vendedor; aqui o gestor continua vendo tudo).
revoke all on function public.catalogo_geral() from public;
revoke all on function public.enviar_pedido_catalogo_geral(jsonb, text, text, text) from public;
grant execute on function public.catalogo_geral() to anon, authenticated;
grant execute on function public.enviar_pedido_catalogo_geral(jsonb, text, text, text) to anon, authenticated;
