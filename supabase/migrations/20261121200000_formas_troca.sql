-- Formas de pagamento da Maranata: só À vista, Boleto e Trocas.
-- "Trocas" baixa estoque normalmente, mas NÃO conta como venda nos relatórios.

alter table public.formas_pagamento add column conta_como_venda boolean not null default true;

update public.formas_pagamento set conta_como_venda = false where nome = 'Trocas';
update public.formas_pagamento set ativo = false where nome not in ('À vista', 'Boleto', 'Trocas');

-- Clientes que estavam com uma forma desativada (ex.: "A prazo") ficam sem forma padrão;
-- o vendedor escolhe no pedido.
update public.clientes c set forma_pagamento_id = null
where forma_pagamento_id in (select id from public.formas_pagamento where not ativo);
