-- O Túlio decidiu manter "A prazo" (como no sistema antigo): formas ativas = À vista, Boleto, A prazo e Trocas.
update public.formas_pagamento set nome = 'A prazo', ativo = true where nome = 'Fiado / a prazo';
-- (Os clientes que eram "A prazo" no sistema antigo foram religados direto no banco, fora do git.)
