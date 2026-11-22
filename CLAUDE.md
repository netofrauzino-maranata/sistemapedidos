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
Netlify: Production branch = `main` (cada deploy de produção gasta créditos; sem créditos, produção pausa). A prévia é branch deploy do ramo de trabalho e não gasta crédito. Se a prévia não atualizar, confira em Build & deploy > Branches and deploy contexts se o ramo de trabalho não virou Production.
Endereço: `pedidos.maranatadistribuidora.com.br` (CNAME no Registro.br apontando para o site do Netlify).
Play Store (futuro): empacotar a PWA como TWA com Bubblewrap; precisa do arquivo `/.well-known/assetlinks.json` em `app/public`.

## Pendências conhecidas
- Vendedor consegue ler `preco_custo` (vem junto no select de produtos). Se o Neto quiser esconder custo, mover para tabela só do gestor.
- Formato exato de importação do emissor de NF-e do Neto ainda não definido (hoje exporta CSV genérico e JSON).
- Relatórios do app antigo (vendasmobile) ainda serão enviados para replicar.
- Comissão de vendedor não existe ainda.

## Tabelas de preço
`tabelas_preco` + `tabela_preco_itens` (só exceções: produto sem item usa `preco_venda`). Cliente tem `tabela_preco_id`, que só o gestor muda (trigger).
O pedido no celular usa `mapaPrecos()` de `db.ts`. Tela do gestor: Mais > Tabelas de preço.

## Carga do dia
Tela `/carga` (gestor, `pages/Carga.tsx`): pedidos pendente/confirmado/faturado do dia; o gestor desmarca o que não vai (fica salvo só no celular, localStorage por dia). Relatórios em `lib/carga.ts`: resumo das vendas, itens somados e detalhado por cliente, em PDF (`pdfCarga`), térmica (`cupomCarga`) ou texto. Trocas entram na carga mas não somam no valor.

## Relatórios extras
`pages/RelatoriosExtras.tsx` (abas em Relatórios): menu no modelo do sistema antigo (Relatório de vendas, Produtos vendidos detalhe e resumo, Necessidade de compra, Mov. estoque, Estoque, Itens zerados, por categoria, vendedor, cliente, sem compra), aberto por `?r=`. Necessidade de compra (média diária x dias + mínimo - saldo; inclui trocas). PDF genérico `pdfRelatorio` em `pdf.ts`. Categorias (11 grupos criados em 22/11/2026, ordem em `categorias.ordem`, que o catálogo online e o PDF seguem) se organizam em Mais > Categorias de produtos (`pages/Categorias.tsx`, mover produtos em lote). Validade é opcional na entrada.

## Catálogo online
Cada cliente tem `link_token`; `/c/<token>` é página pública (`pages/CatalogoCliente.tsx`, rota tratada em `App.tsx` antes do login). Lê `catalogo_publico(token)` (preço da tabela do cliente, sem custo/estoque) e envia por `enviar_pedido_catalogo` (security definer, limite de 10 envios/hora). Envios ficam em `pedidos_catalogo` (status nova/aprovada/recusada). Tela `Pedidos do catálogo` gera rascunho (`rascunhoDoCatalogo` em `lib/repetir.ts`); ao salvar o pedido marca aprovada e liga `pedido_id`. Principal: link único `/loja` (`catalogo_geral`, preço padrão; `enviar_pedido_catalogo_geral` exige nome e celular, `cliente_id` nulo). Na aprovação o gestor escolhe o cliente (sugestão pelo celular) ou cadastra novo; o pedido usa a tabela do escolhido. Link exclusivo por cliente continua como opção no cadastro.

## Cliente e fornecedor no mesmo cadastro
`clientes.eh_cliente` / `eh_fornecedor` (pelo menos um). Trigger `tg_clientes_fornecedor` cria/atualiza `fornecedores` com o mesmo id, que é o que a Entrada e o relatório usam. Listas de venda filtram `eh_cliente !== false` (`ehCliente` em `hooks.ts`).

## Integração VendasExternas (emissor fiscal do Neto)
VendasExternas é da Alkord; API em https://api.alkord.com.br, documentação em docs.alkord.com.br (Postman, abrir no navegador).
A API documentada cria/atualiza clientes e produtos. **POST /atendimentos existe sem estar documentado** (testado 22/11/2026) e é usado para enviar pedidos em aberto; a nota continua sendo emitida no painel deles. Leituras não documentadas usadas: /meios_pagamento, /condicoes_pagamento, /vendedores. A API recusa item sem estoque lá (erro 130) mesmo com RESERVAR N; venda sem estoque pela API depende de liberação da Alkord.
- Cadastros: Edge Function `supabase/functions/vendasexternas` (ações `testar` e `sincronizar`). Antes de criar procura lá (REFERENCIA_INTEGRACAO, CPF/CNPJ, código de barras, nome). Se já existia, só vincula (origem `vinculado`) e não sobrescreve. O que criamos (`criado`) é atualizado. Vínculos em `ve_vinculos`, visão `vw_ve_codigos`.
- Chaves (`application-key`/`application-secret`) ficam em `integracao_ve` (RLS sem política, só a função lê). Gestor salva por `salvar_chaves_ve`. Nunca no repositório.
- Pedidos: tela `pages/IntegracaoVE.tsx` (Mais > Integrar com VendasExternas), aba Pedidos: botão Enviar (ação `enviar_pedidos`, grava `ve_pedidos` e `exportado_nfe_em`) ou espelho em texto. De/para de forma, condição e vendedor em `ve_mapa` (aba Conexão), tipo de atendimento em `integracao_ve.tipo_atendimento` (1 pré-venda, 5 pronta entrega).

## Dados de clientes
O repositório é público: nunca coloque aqui planilhas, scripts de importação ou qualquer dado de clientes.

## Identidade visual
Azul da logo `#00268B` (marca), amarelo `#FFD200` (destaque), vermelho `#E30613` (apoio), fundo `#F4F6FB`.
Fotos dos produtos: `app/public/produtos/<codigo>.webp` (800x800), lidas por `fotoDoProduto` em `lib/fotos.ts`; `foto_url` enviada pelo cadastro tem prioridade. Ao trocar fotos, suba o nome do cache `fotos-padrao-vN` em `vite.config.ts` e apague o antigo em `main.tsx`.
Logo e mascote em `app/public/logo.png` e `app/public/mascote.png` (login, topo do Início). Logo do PDF em `app/src/assets/logo-pdf.jpg`. Ícones do app em `app/public/icon-*.png`.
Fluxos inspirados no app que o Neto usava, mas visual próprio da Maranata.
