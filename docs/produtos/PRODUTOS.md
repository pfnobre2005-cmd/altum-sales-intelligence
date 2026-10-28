# Módulo Produtos — revisão, publicação e testes

Versão do app: `0.5.0-produtos` · Banco: migração `011_produtos_gestao.sql`.
Dashboard continua com a base local (conexão ao Supabase já preparada, aguardando sua confirmação).

## 1. O que a tela faz
| Quem | Pode |
|---|---|
| Administrador (senha + 2 etapas) | ver lista com custo e margem; **Novo produto**; **Editar** (nome, SKU, categoria, preço, custo, ciclo, imagem); **Desativar/Reativar**; ver detalhes |
| Operador | ver lista e detalhes **sem custo** (o banco nem envia o custo) |

- Toda gravação passa por uma **tela de confirmação** com "antes → depois".
- Validação na tela e de novo no banco: nome 2–200; SKU sem espaços (letras, números, `. - _ /`) e **único**;
  preço obrigatório (ex.: `59,90`); custo opcional; ciclo 1–365 dias ou em branco (sem recompra);
  imagem JPG/PNG/WebP até 1 MB (o conteúdo do arquivo é conferido, não só o nome).
- Duas pessoas editando o mesmo produto: a segunda recebe "alterado por outra pessoa" e nada é sobrescrito.
- Desativar não apaga nada: o produto fica nos pedidos e campanhas antigos, mas sai da recompra e de campanhas novas.
- Produtos **Fictício** (seed 010): somente leitura. Produtos **Nuvemshop** (futuro): nome/SKU/preço/imagem vêm da loja.
- Filtros: busca (nome, SKU, categoria), status (Ativos/Inativos/Todos) e origem.

## 2. Ordem de publicação (não inverter)
1. **Criar o bucket pelo painel** (a migração não grava nas tabelas internas do Storage; ela só confere a configuração):
   Supabase → menu lateral **Storage** → **New bucket**
   - **Name:** `produtos` (exatamente assim, minúsculo)
   - **Public bucket:** **ligado** (as fotos de produto aparecem na tela; nenhum dado pessoal)
   - **Additional configuration → Restrict file upload size:** ligado, **1 MB**
   - **Additional configuration → Allowed MIME types:** `image/jpeg`, `image/png`, `image/webp` (somente estes três)
   - **Create bucket.** Não crie regras ("Policies") pelo painel: a migração cria as três regras certas.
   *(Os nomes dos campos podem variar um pouco conforme a versão do painel.)*
2. **SQL Editor** → cole `supabase/verificacoes/antes_011.sql` → **Run**. Todas as colunas `ok_*` devem ser `true`.
   `ok_bucket_configurado` = false → revise o passo 1 (a coluna `bucket_produtos` mostra o que foi gravado).
   Qualquer outra `false`: pare e me envie o resultado.
3. **SQL Editor** → cole `supabase/migrations/011_produtos_gestao.sql` → **Run** (uma vez).
   Se o bucket estiver diferente do passo 1, a migração para com a instrução e nada é alterado.
   Confira a última tabela com o "Resultado esperado da 011" no `supabase/migrations/README.md`.
4. **Storage → produtos → Policies**: devem aparecer 3 regras `altum_produtos_admin_*` (enviar, ler, excluir).
5. **GitHub** → Add file → Upload files → arraste o conteúdo do `.zip` do app (mantendo pastas) → Commit.
   Aguarde Actions verde e abra com **Ctrl+Shift+R**.

> Se publicar o app antes da migração, a tela Produtos mostra erro (as demais funcionam). Basta rodar a 011.

**Correção de segurança incluída na 011:** a função que identifica administradores (`app.e_admin`, da 002) deixava
passar usuário **desativado** que ainda tivesse sessão aberta. A 011 corrige isso para todo o sistema.

## 3. Roteiro de teste (≈15 min)
| # | Faça | Esperado |
|---|---|---|
| 1 | Entre como administrador e abra **Produtos** | Lista com 7 produtos "Fictício" (somente leitura); selo "Supabase · cadastro real" |
| 2 | **Novo produto**: cadastre o **Magnésio Inositol** com seus dados reais e uma imagem | Tela de confirmação com todos os campos → salvar → aparece na lista com a imagem |
| 3 | Cadastre os outros 7 (NAC 600mg, Colágeno Tipo II, 5 MAG + L-Treonina, Vitamina D3 + K2 MK-7, Vitamina B12 + B9 + Ferro Quelato, Juice Protein 600 g, Cabelo, Pele e Unhas) | 8 produtos "Manual" ativos |
| 4 | Tente um novo produto com o SKU de um já cadastrado (mude maiúsculas) | "SKU já usado por …"; nada salvo |
| 5 | Tente preço `abc`, ciclo `400`, SKU com espaço | Mensagens nos campos; nada enviado |
| 6 | Edite o preço de um produto | Confirmação mostra só o preço (antes riscado → depois) |
| 7 | Abra o mesmo produto em **duas abas**, salve numa, depois tente salvar na outra | Segunda aba: "alterado por outra pessoa" |
| 8 | Desative um produto | Some de "Ativos"; aparece em "Inativos"; reative em seguida |
| 9 | Troque e depois remova a imagem de um produto | Lista atualiza; **Storage → produtos**: a pasta do produto não guarda o arquivo antigo (é aqui que o envio, o vínculo e a exclusão REAIS de imagem são testados, pela API oficial do Storage) |
| 10 | Tente enviar um arquivo `.svg` ou maior que 1 MB | Recusado antes do envio |
| 11 | Entre como **operador** (se houver) | Sem botões de editar, sem coluna Custo |
| 12 | SQL Editor (somente leitura): `select nome, sku, preco, ativo from public.produtos where fonte = 'manual' order by nome;` e `select count(*) from public.produto_custos;` | Os 8 produtos; custos = quantos você preencheu |

## 4. Arquivos
| Arquivo | Mudança |
|---|---|
| `assets/js/views/produtos.js` | **novo** — tela Produtos |
| `assets/js/repositorio.js` | **novo** — leituras e gravações no Supabase (Produtos; Dashboard preparado) |
| `assets/js/app.js` | entrega o cliente da sessão ao repositório; selo de fonte por tela |
| `assets/js/auth.js` | passa o cliente da sessão (após aal2) ao abrir as telas |
| `index.html` | item "Produtos" no menu; CSP permite imagens do Storage do projeto; faixa do topo |
| `assets/js/config.js` | versão 0.5.0 |
| `assets/css/styles.css` | estilos da tela |
| `assets/js/views/dashboard.js` | **igual ao publicado** (base local) — incluído só para manter o conjunto coerente |

Banco (fora do GitHub): `supabase/verificacoes/antes_011.sql`, `supabase/migrations/011_produtos_gestao.sql`,
`supabase/migrations/REVISAO-011.md`, `supabase/migrations/README.md`.

## 5. Fora deste passo
- As telas Recompra, Campanhas, Inteligência e Integrações ainda usam os produtos de exemplo **locais**;
  passam a usar este cadastro quando forem conectadas ao banco.
- Nuvemshop: não conectada. Dashboard: aguardando sua confirmação.
