# Maranata Pedidos — guia para o Claude que for continuar este sistema

Sistema gerencial da **Maranata Distribuidora** (micro distribuidora de alimentos).
Dono e gestor: Neto. Usuários: gestor e vendedores externos (rua), pelo celular.
Escrito em português. Responda ao Neto em português, de forma prática.

## O que o sistema faz
- Cadastro de produtos (com NCM, CEST, EAN, CFOP, unidade, foto) e controle de **lote e validade**
- Entrada de mercadoria (cria lote, soma estoque, atualiza custo)
- Clientes (CPF/CNPJ, IE, endereço completo, código IBGE), com busca automática por CNPJ (BrasilAPI) e CEP (ViaCEP)
- Pedidos de venda **offline**, com baixa automática de estoque pelo lote que vence primeiro (FEFO)
- PDF do pedido e catálogo em PDF, gerados no próprio celular
- Relatórios (vendas por dia, vendedor, cliente, produto, positivação)
- Exportação das vendas para o emissor de NF-e (CSV ou JSON). **Não emite nota.**

## Estrutura
```
app/                 PWA (React + Vite + TypeScript + Tailwind 4)
  src/lib/db.ts      banco local do celular (Dexie/IndexedDB): as telas leem daqui
  src/lib/sync.ts    sincronização: envia pendentes, baixa o que mudou (atualizado_em)
  src/lib/pdf.ts     PDF do pedido e do catálogo (jsPDF)
  src/lib/auth.tsx   sessão, perfil (gestor/vendedor)
  src/pages/         uma tela por arquivo
supabase/migrations/ SQL do banco, em ordem. Toda mudança de banco vira um arquivo novo aqui
supabase/tests/      teste do fluxo de estoque e permissões (rodar num Postgres local)
netlify.toml         deploy (base app/, SPA redirect)
```

## Regras de negócio que não podem quebrar
1. **Estoque é um livro** (`movimentos_estoque`). Saldo = soma dos movimentos. Nunca grave estoque direto.
   Só estas funções do banco mexem em estoque: `salvar_pedido`, `mudar_status_pedido`, `registrar_entrada`, `ajustar_estoque`.
2. **Pedido é idempotente**: o id (UUID) nasce no celular. `salvar_pedido` pode ser chamado de novo com o mesmo pedido sem duplicar nem baixar duas vezes (ele estorna e refaz).
3. Status que baixam estoque: pendente, confirmado, faturado, entregue. Orçamento não baixa. Cancelado devolve.
4. Venda sem saldo **não trava** (vendedor pode estar offline): gera movimento sem lote e o estoque fica negativo, aparecendo como alerta para o gestor.
5. Nada é apagado: cadastros têm `ativo`. Toda tabela sincronizada precisa de `atualizado_em` com trigger.
6. RLS ligado em tudo. Vendedor vê só os clientes dele (ou sem vendedor, ou que ele cadastrou) e só os pedidos dele. Só gestor altera produto, preço, estoque, empresa e usuários.
7. O primeiro usuário que cria conta vira gestor. Os seguintes entram como vendedor **inativo** e o gestor libera em Mais > Usuários.

## Como funciona o offline
- O celular tem um banco próprio (Dexie/IndexedDB, `lib/db.ts`, nome `maranata`). **As telas sempre leem daqui**, nunca direto do Supabase. Assim o vendedor trabalha na rua sem sinal.
- `lib/sync.ts` faz duas coisas, nesta ordem:
  1. **Envia** o que foi feito no celular e está com `_sync = 'pendente'` ou `'erro'`: clientes novos/editados (upsert) e pedidos (pela função `salvar_pedido`).
  2. **Baixa** só o que mudou desde a última sincronização, comparando `atualizado_em` de cada tabela (marca guardada em `meta`).
- Campos que começam com `_` (`_sync`, `_erro`) existem só no celular e são retirados antes do envio.
- Erro de rede interrompe e tenta depois. Erro de regra (ex.: RLS) marca o registro como `erro` com a mensagem, para o usuário ver.
- Ids são UUID gerados no celular, então nada duplica ao reenviar.
- Ao criar tabela nova que precisa funcionar offline: criar no Supabase com `atualizado_em` + trigger `tg_atualizado_em`, acrescentar uma `version(n)` nova no `db.ts` (nunca editar versões antigas) e incluir a tabela no download do `sync.ts`.

## Modelo de dados (resumo)
| Área | Tabelas | Observação |
|---|---|---|
| Acesso | `perfis` | Um por usuário do Auth. `papel` gestor/vendedor, `ativo`. Trigger `tg_novo_usuario` cria o perfil |
| Empresa | `empresa` | Linha única (id = 1): dados fiscais, logo, rodapé do pedido |
| Produtos | `produtos`, `categorias` | Código interno, unidade, embalagem, preço venda/mínimo/custo, foto, `mostrar_catalogo` |
| Estoque | `lotes`, `movimentos_estoque` | Lote com validade. Saldo = soma dos movimentos. Visões `vw_estoque_produtos` e `vw_estoque_lotes` |
| Compras | `entradas`, `entrada_itens`, `fornecedores` | `registrar_entrada` cria lote e movimento |
| Pessoas | `clientes` | Cliente e/ou fornecedor; vendedor responsável, forma e condição padrão, tabela de preço, `link_token` |
| Venda | `pedidos`, `pedido_itens` | Id do celular, `numero` sequencial do servidor, status, `exportado_nfe_em` |
| Pagamento | `formas_pagamento`, `condicoes_pagamento` | `conta_como_venda = false` para Trocas |
| Preço | `tabelas_preco`, `tabela_preco_itens` | Só exceções ao `preco_venda` |
| Catálogo | `pedidos_catalogo` | Pedidos enviados pelo link público |
| Fiscal externo | `integracao_ve`, `ve_vinculos` | Chaves e vínculos com o VendasExternas |

Funções principais do banco: `salvar_pedido`, `mudar_status_pedido`, `registrar_entrada`, `ajustar_estoque`, `marcar_exportado_nfe`, `catalogo_publico`, `catalogo_geral`, `enviar_pedido_catalogo(_geral)`, `novo_link_catalogo`, `salvar_chaves_ve`, `eh_gestor`.
A fonte da verdade é sempre `supabase/migrations/`. Se esta tabela ficar desatualizada, confie no SQL.

## Campos fiscais já preparados (para NF-e)
- **Produto:** `ncm` (8 dígitos), `cest` (7), `gtin` (EAN), `origem` (0 a 8), `cfop_padrao` (padrão 5102), `unidade`, `peso_kg`.
- **Cliente:** `tipo_pessoa` (F/J), `cpf_cnpj`, `indicador_ie` (1 contribuinte, 2 isento, 9 não contribuinte), `ie`, endereço completo com `codigo_ibge` do município.
- **Empresa:** `cnpj`, `ie`, endereço e `codigo_ibge`.
- Ainda **não existem**: regime tributário, CST/CSOSN, alíquotas de ICMS/PIS/COFINS, natureza da operação. Hoje o emissor (VendasExternas) cuida disso. Só criar se um dia o sistema passar a emitir nota.

## Banco (Supabase)
- Projeto: `pedidosmarantadistribuidora` (ref `ncailnkooaexdlpnqyrn`), região São Paulo, plano grátis.
- Para mudar o banco: crie `supabase/migrations/AAAAMMDDHHMMSS_descricao.sql`, teste local, aplique no Supabase e faça commit.
- Teste local (Postgres 16+):
  ```
  createdb teste
  psql -d teste -f supabase/tests/stub_supabase.sql -f supabase/migrations/*.sql
  psql -d teste -f supabase/tests/fluxo_estoque.sql   # procure "esperado" e "ok:"
  ```
- Visão para NF-e: `vw_exportacao_nfe` (uma linha por item, com dados fiscais de cliente e produto).
  Para levar vendas ao emissor: filtre por período e `exportado_nfe_em is null`, gere o arquivo no formato do emissor e chame `marcar_exportado_nfe(ids)`.

## Rodar e publicar o app
```
cd app
cp .env.example .env.local   # URL e chave pública (anon) do Supabase
npm install
npm run dev                  # http://localhost:5173
npm run build                # gera app/dist
```
Deploy: Netlify conectado ao GitHub, lê `netlify.toml`. O repositório é público de propósito: o Netlify grátis bloqueia build de repo privado quando o autor do commit não é membro da conta (commits do Claude). Não há segredo no código; a chave em `app/.env.production` é a pública. Variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` ficam no painel do Netlify.
Endereço: `pedidos.maranatadistribuidora.com.br` (CNAME no Registro.br apontando para o site do Netlify). [A PREENCHER: confirmar quando o domínio estiver ligado]

**Fluxo de publicação (importante, custa dinheiro):**
- Branch `main` = produção. Cada publicação gasta cerca de 15 créditos do Netlify grátis (300 por mês). Junte ajustes e publique no máximo 1 ou 2 vezes por dia.
- Trabalho novo vai primeiro para um branch de prévia (o Netlify gera um endereço de teste grátis por branch). Só depois de testado no celular vai para `main`.
- A prévia usa **o mesmo Supabase da produção**: dados criados na prévia são reais. Mudança de banco aplicada vale para os dois na hora, então ela precisa ser compatível com o app que já está em produção.
- Alternativa futura sem limite de créditos e com uso comercial liberado: Cloudflare Pages.
Play Store (futuro): empacotar a PWA como TWA com Bubblewrap; precisa do arquivo `/.well-known/assetlinks.json` em `app/public`.

## Pendências conhecidas
- Vendedor consegue ler `preco_custo` (vem junto no select de produtos). Se o Neto quiser esconder custo, mover para tabela só do gestor.
- Cadastros importados do sistema antigo ainda incompletos: CNPJ de parte dos clientes, NCM dos produtos, conferência dos códigos IBGE, CEP da empresa, categorias dos produtos.
- Pedido não sobe sozinho para o VendasExternas (a API da Alkord não cria atendimento). Hoje é espelho em texto lançado à mão.
- Comissão de vendedor não existe ainda.
- Domínio próprio ainda não ligado no Netlify.
- Play Store ainda não publicada (precisa conta de organização com CNPJ e D-U-N-S).

## Próximos passos sugeridos
1. **Virada oficial**: apagar movimentos de teste (pedidos, entradas, cargas, solicitações do catálogo), manter cadastros, importar saldo de estoque real, zerar numeração de pedidos, publicar em `main` e trocar links do catálogo para o endereço oficial.
2. Completar cadastros fiscais (NCM, CNPJ, IBGE) para o espelho do VendasExternas sair sem ajuste.
3. Ligar `pedidos.maranatadistribuidora.com.br`.
4. Esconder custo do vendedor, se o Neto quiser.
5. Comissão por vendedor.
6. Empacotar para Play Store (TWA).
7. [A PREENCHER: novos pedidos do Neto conforme o uso real]

## Como pedir mudanças ao Claude (para o Neto)
- Abra uma conversa no Claude Code apontando para este repositório e diga em português o que quer, com um exemplo real ("quero que o relatório X mostre também Y").
- Peça para ele trabalhar num branch de prévia e te mandar o link para testar no celular antes de ir para produção.
- Se a mudança mexer no banco, ele cria um arquivo novo em `supabase/migrations/`, testa local e te passa o SQL para colar numa consulta nova do SQL Editor do Supabase (ou aplica pelo conector, se estiver ligado).
- Ao final, peça para ele atualizar este arquivo com o que mudou.

## Tabelas de preço
`tabelas_preco` + `tabela_preco_itens` (só exceções: produto sem item usa `preco_venda`). Cliente tem `tabela_preco_id`, que só o gestor muda (trigger).
O pedido no celular usa `mapaPrecos()` de `db.ts`. Tela do gestor: Mais > Tabelas de preço.

## Carga do dia
Tela `/carga` (gestor, `pages/Carga.tsx`): pedidos pendente/confirmado/faturado do dia; o gestor desmarca o que não vai (fica salvo só no celular, localStorage por dia). Relatórios em `lib/carga.ts`: resumo das vendas, itens somados e detalhado por cliente, em PDF (`pdfCarga`), térmica (`cupomCarga`) ou texto. Trocas entram na carga mas não somam no valor.

## Relatórios extras
`pages/RelatoriosExtras.tsx` (abas em Relatórios): menu no modelo do sistema antigo (Relatório de vendas, Produtos vendidos detalhe e resumo, Necessidade de compra, Mov. estoque, Estoque, Itens zerados, por categoria, vendedor, cliente, sem compra), aberto por `?r=`. Necessidade de compra (média diária x dias + mínimo - saldo; inclui trocas). PDF genérico `pdfRelatorio` em `pdf.ts`. Categorias se organizam em Mais > Categorias de produtos (`pages/Categorias.tsx`, mover produtos em lote). Validade é opcional na entrada.

## Catálogo online
Cada cliente tem `link_token`; `/c/<token>` é página pública (`pages/CatalogoCliente.tsx`, rota tratada em `App.tsx` antes do login). Lê `catalogo_publico(token)` (preço da tabela do cliente, sem custo/estoque) e envia por `enviar_pedido_catalogo` (security definer, limite de 10 envios/hora). Envios ficam em `pedidos_catalogo` (status nova/aprovada/recusada). Tela `Pedidos do catálogo` gera rascunho (`rascunhoDoCatalogo` em `lib/repetir.ts`); ao salvar o pedido marca aprovada e liga `pedido_id`. Principal: link único `/loja` (`catalogo_geral`, preço padrão; `enviar_pedido_catalogo_geral` exige nome e celular, `cliente_id` nulo). Na aprovação o gestor escolhe o cliente (sugestão pelo celular) ou cadastra novo; o pedido usa a tabela do escolhido. Link exclusivo por cliente continua como opção no cadastro.

## Cliente e fornecedor no mesmo cadastro
`clientes.eh_cliente` / `eh_fornecedor` (pelo menos um). Trigger `tg_clientes_fornecedor` cria/atualiza `fornecedores` com o mesmo id, que é o que a Entrada e o relatório usam. Listas de venda filtram `eh_cliente !== false` (`ehCliente` em `hooks.ts`).

## Integração VendasExternas (emissor fiscal do Neto)
VendasExternas é da Alkord; API em https://api.alkord.com.br, documentação em docs.alkord.com.br (Postman, abrir no navegador).
A API cria/atualiza clientes e produtos, mas **não cria pedido (atendimento) nem emite nota**. Por isso:
- Cadastros: Edge Function `supabase/functions/vendasexternas` (ações `testar` e `sincronizar`). Antes de criar procura lá (REFERENCIA_INTEGRACAO, CPF/CNPJ, código de barras, nome). Se já existia, só vincula (origem `vinculado`) e não sobrescreve. O que criamos (`criado`) é atualizado. Vínculos em `ve_vinculos`, visão `vw_ve_codigos`.
- Chaves (`application-key`/`application-secret`) ficam em `integracao_ve` (RLS sem política, só a função lê). Gestor salva por `salvar_chaves_ve`. Nunca no repositório.
- Pedidos: tela `pages/IntegracaoVE.tsx` (Mais > Integrar com VendasExternas) gera espelho em texto com os códigos [VE] para lançar lá, e marca lançado com `marcar_exportado_nfe`.
- Se a Alkord liberar criação de atendimento, acrescentar ação `pedidos` na função usando os códigos de `ve_vinculos`.

## Dados de clientes
O repositório é público: nunca coloque aqui planilhas, scripts de importação ou qualquer dado de clientes.

## Identidade visual
Azul da logo `#00268B` (marca), amarelo `#FFD200` (destaque), vermelho `#E30613` (apoio), fundo `#F4F6FB`.
Logo e mascote em `app/public/logo.png` e `app/public/mascote.png` (login, topo do Início). Logo do PDF em `app/src/assets/logo-pdf.jpg`. Ícones do app em `app/public/icon-*.png`.
Fluxos inspirados no app que o Neto usava, mas visual próprio da Maranata.
