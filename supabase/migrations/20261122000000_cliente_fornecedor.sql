-- Um cadastro pode ser cliente, fornecedor ou os dois.
-- Quem é fornecedor ganha (pelo trigger) uma linha em public.fornecedores com
-- o MESMO id, e é essa tabela que a Entrada de mercadoria e os relatórios usam.

alter table public.clientes add column eh_cliente boolean not null default true;
alter table public.clientes add column eh_fornecedor boolean not null default false;
alter table public.clientes add constraint clientes_tipo_ck check (eh_cliente or eh_fornecedor);

create or replace function public.tg_clientes_fornecedor()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.eh_fornecedor then
    insert into public.fornecedores (id, nome, cpf_cnpj, ie, telefone, email, cidade, uf, observacao, ativo)
    values (new.id, coalesce(nullif(new.nome_fantasia, ''), new.razao_social), new.cpf_cnpj, new.ie,
            coalesce(new.whatsapp, new.telefone), new.email, new.cidade, new.uf, new.observacao, new.ativo)
    on conflict (id) do update set nome = excluded.nome, cpf_cnpj = excluded.cpf_cnpj, ie = excluded.ie,
      telefone = excluded.telefone, email = excluded.email, cidade = excluded.cidade, uf = excluded.uf,
      observacao = excluded.observacao, ativo = excluded.ativo;
  elsif tg_op = 'UPDATE' and old.eh_fornecedor then
    update public.fornecedores set ativo = false where id = new.id;
  end if;
  return new;
end $$;

create trigger clientes_fornecedor after insert or update on public.clientes
  for each row execute function public.tg_clientes_fornecedor();
