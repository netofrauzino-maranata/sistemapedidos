-- Teste de ponta a ponta do fluxo de estoque e permissões.
-- Rode num banco local com stub_supabase.sql + migrations aplicadas.
\set ON_ERROR_STOP 1
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','neto@maranata.com','{"nome":"Neto"}'),
 ('00000000-0000-0000-0000-00000000000b','joao@maranata.com','{"nome":"João"}'),
 ('00000000-0000-0000-0000-00000000000c','ana@maranata.com','{"nome":"Ana"}');
select nome, papel from public.perfis order by nome;

-- ===== como GESTOR
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
insert into public.produtos (id, codigo, nome, unidade, ncm, preco_venda) values
 ('11111111-0000-0000-0000-000000000001','001','Arroz 5kg','FD','10063021',25.90);
insert into public.clientes (id, razao_social, cpf_cnpj, vendedor_id) values
 ('22222222-0000-0000-0000-000000000001','Mercado Bom Preço','12345678000199','00000000-0000-0000-0000-00000000000b'),
 ('22222222-0000-0000-0000-000000000002','Padaria da Ana','98765432000199','00000000-0000-0000-0000-00000000000c');
select numero from public.registrar_entrada('{"id":"33333333-0000-0000-0000-000000000001","numero_nota":"555","itens":[
 {"produto_id":"11111111-0000-0000-0000-000000000001","lote":"L-JAN","data_validade":"2027-01-31","quantidade":10,"custo_unitario":18},
 {"produto_id":"11111111-0000-0000-0000-000000000001","lote":"L-MAR","data_validade":"2027-03-31","quantidade":20,"custo_unitario":19}]}');
-- reenvio não duplica
select numero from public.registrar_entrada('{"id":"33333333-0000-0000-0000-000000000001","itens":[{"produto_id":"11111111-0000-0000-0000-000000000001","lote":"X","quantidade":99}]}');
select 'saldo após entrada (esperado 30)' t, saldo from public.vw_estoque_produtos;

-- ===== como VENDEDOR João
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
select 'clientes que João vê (esperado 1)' t, count(*) from public.clientes;
select numero, total, status from public.salvar_pedido('{"id":"44444444-0000-0000-0000-000000000001","cliente_id":"22222222-0000-0000-0000-000000000001",
 "itens":[{"produto_id":"11111111-0000-0000-0000-000000000001","quantidade":12,"preco_unitario":25.90}]}');
-- reenvio (sincronização dupla) não baixa duas vezes
select numero, total from public.salvar_pedido('{"id":"44444444-0000-0000-0000-000000000001","cliente_id":"22222222-0000-0000-0000-000000000001",
 "itens":[{"produto_id":"11111111-0000-0000-0000-000000000001","quantidade":12,"preco_unitario":25.90}]}');
select 'lotes após venda de 12 (esperado L-JAN 0, L-MAR 18)' t, numero, saldo from public.vw_estoque_lotes order by numero;
-- João não pode vender para cliente da Ana
do $$ begin
  perform public.salvar_pedido('{"id":"44444444-0000-0000-0000-000000000002","cliente_id":"22222222-0000-0000-0000-000000000002","itens":[{"produto_id":"11111111-0000-0000-0000-000000000001","quantidade":1,"preco_unitario":1}]}');
  raise exception 'FALHOU: deixou vender para cliente de outro';
exception when insufficient_privilege then raise notice 'ok: bloqueou cliente de outro vendedor';
end $$;
-- João não mexe em estoque nem cria produto
do $$ begin
  perform public.ajustar_estoque('11111111-0000-0000-0000-000000000001', null, 100, 'teste');
  raise exception 'FALHOU';
exception when insufficient_privilege then raise notice 'ok: vendedor não ajusta estoque';
end $$;
do $$ begin
  insert into public.produtos (codigo, nome) values ('X','X');
  raise exception 'FALHOU';
exception when insufficient_privilege then raise notice 'ok: vendedor não cria produto';
end $$;
do $$ begin
  update public.perfis set papel='gestor' where id = auth.uid();
  if public.eh_gestor() then raise exception 'FALHOU: virou gestor'; end if;
  raise notice 'ok: vendedor não se promove';
end $$;
-- vende mais do que tem: estoque fica negativo sem travar
select numero from public.salvar_pedido('{"id":"44444444-0000-0000-0000-000000000003","cliente_id":"22222222-0000-0000-0000-000000000001",
 "itens":[{"produto_id":"11111111-0000-0000-0000-000000000001","quantidade":25,"preco_unitario":25}]}');
select 'saldo após vender 25 com 18 (esperado -7)' t, saldo from public.vw_estoque_produtos;

-- ===== Ana não vê pedidos do João
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
select 'pedidos que Ana vê (esperado 0)' t, count(*) from public.pedidos;

-- ===== GESTOR cancela o pedido 3 e confirma o 1
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
select status from public.mudar_status_pedido('44444444-0000-0000-0000-000000000003','cancelado');
select 'saldo após cancelar (esperado 18)' t, saldo from public.vw_estoque_produtos;
select status from public.mudar_status_pedido('44444444-0000-0000-0000-000000000001','faturado','1234');
select 'saldo após faturar (esperado 18)' t, saldo from public.vw_estoque_produtos;
select pedido_numero, razao_social, cpf_cnpj, ncm, unidade, quantidade, item_total from public.vw_exportacao_nfe where status='faturado';
