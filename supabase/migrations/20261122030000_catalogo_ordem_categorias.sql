-- Catálogo online segue a ordem das categorias (categorias.ordem) em vez da ordem alfabética.
create or replace function public.catalogo_publico(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'cliente', coalesce(nullif(c.nome_fantasia, ''), c.razao_social),
    'empresa', (select jsonb_build_object('nome', coalesce(nullif(e.nome_fantasia, ''), e.razao_social),
                       'telefone', e.telefone, 'whatsapp', e.whatsapp) from public.empresa e where e.id = 1),
    'produtos', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', p.id, 'codigo', p.codigo, 'nome', p.nome, 'unidade', p.unidade,
               'qtd_embalagem', p.qtd_embalagem, 'marca', p.marca, 'foto_url', p.foto_url,
               'categoria', cat.nome, 'preco', coalesce(ti.preco, p.preco_venda))
             order by cat.ordem nulls last, cat.nome nulls last, p.nome), '[]'::jsonb)
      from public.produtos p
      left join public.categorias cat on cat.id = p.categoria_id and cat.ativo
      left join public.tabela_preco_itens ti on ti.produto_id = p.id and ti.tabela_id = c.tabela_preco_id and ti.ativo
        and exists (select 1 from public.tabelas_preco tp where tp.id = ti.tabela_id and tp.ativo)
      where p.ativo and p.mostrar_catalogo)
  )
  from public.clientes c
  where c.link_token = p_token and c.ativo and length(p_token) >= 20;
$$;

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
             order by cat.ordem nulls last, cat.nome nulls last, p.nome), '[]'::jsonb)
      from public.produtos p
      left join public.categorias cat on cat.id = p.categoria_id and cat.ativo
      where p.ativo and p.mostrar_catalogo)
  );
$$;
