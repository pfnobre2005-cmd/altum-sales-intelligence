# Recompra por e-mail — prévia (app 0.13.3, migração 019)

**Só leitura.** A prévia mostra quantos clientes de um produto (ex.: Juice Protein, todas as variantes) seriam elegíveis para um e-mail de recompra. Ela usa as regras de consentimento que o CRM já aplica.
- **Não** grava nada.
- **Não** envia contatos ao Nuvem Marketing.
- **Não** cria nem altera listas.
- **Não** dispara e-mails. A automação continua **desligada**.

## Onde fica
**Integrações & dados → "Recompra por e-mail — prévia"**, visível só para o **administrador** com 2 etapas.
1. Escolha o produto. O Juice Protein já vem selecionado, com as variantes juntas.
2. Clique em **Calcular prévia**. Aparecem só números, sem nome ou e-mail:
   - **Compraram:** clientes reais com pedido pago do produto.
   - **Bloqueados:** anonimizados, "não contatar", oposição. Esses nunca recebem.
   - **Situação de recompra**, pela compra mais recente do produto (qualquer sabor): na janela, atrasados, antes da janela, inativos, sem ciclo.
   - **Na janela de reposição** (os "próximos da reposição", pelas regras de Configurações):
     - **Elegíveis**: autorização de e-mail comprovada (`app.marketing_permitido`). Em destaque, o número de **e-mails únicos**: dois cadastros da mesma pessoa contam uma vez.
     - **Descadastrados**: revogaram ou recusaram o e-mail.
     - **Sem autorização comprovada**: nunca autorizaram. Inclui a newsletter "pendente" e quem autorizou só o WhatsApp.
     - Recusa em cadastro vinculado; sem e-mail.
3. Clique em **Analisar listas do Nuvem Marketing**. Há uma leitura na API, e a tela mostra o nome de cada lista e os contadores que a API informa (ex.: contatos ativos, descadastrados). Nenhum contato é lido.

## Limites desta etapa
- **Descadastros feitos só no Nuvem Marketing não aparecem na prévia.** Antes de qualquer envio, eles serão conferidos contato a contato numa etapa futura, que depende de confirmar a forma de leitura de contatos na API.
- **Produto sem ciclo de recompra:** as compras dele não entram na janela. A tela avisa; defina o ciclo na Tela Produtos.
- **Clientes atrasados** aparecem só como informação. A prévia considera "próximos da reposição" quem está na janela.

## Ordem exata de publicação
1. **Supabase → SQL Editor**: cole `supabase/verificacoes/antes_019.sql` e clique em **Run**. É somente leitura.
   - Todas as colunas `ok_*` devem ser `true`.
   - **Anote** as colunas `retrato_*`.
   - Confira em `produtos_juice` se cada variante tem ciclo.
2. **SQL Editor**: cole `supabase/migrations/019_recompra_email_previa.sql` e clique em **Run**, uma vez só.
   - O arquivo de produção **não tem autoteste**, não grava dados e não mexe em sequências. Só cria a função e registra a versão.
   - Resultado esperado: "Success".
3. **SQL Editor**: cole `supabase/verificacoes/depois_019.sql` e clique em **Run**. É somente leitura.
   - Todas as `ok_*` devem ser `true`.
   - Os `retrato_*` devem estar **iguais** aos anotados no passo 1.
   - Não pode aparecer "FALHA". A parte 2 confere que, sem login de administrador com 2 etapas, a função recusa.
4. **Edge Functions → `nuvem-marketing` → Code**: cole `supabase/functions/nuvem-marketing/index.ts` (0.13.3) e clique em **Deploy**. Não mude Verify JWT nem os Secrets.
5. **GitHub → Add file → Upload files**: arraste **as pastas** do `.zip` do app, mantendo a estrutura, e clique em **Commit changes**:
   - `assets/js/repositorio.js`
   - `assets/js/views/configuracoes.js`
   - `assets/js/config.js`
   - `docs/integracoes/RECOMPRA-EMAIL-PREVIA.md`
6. Recarregue o site com **Ctrl+Shift+R** e entre como administrador. Em Integrações, clique em **Calcular prévia** e em **Analisar listas**.

**Nunca rode em produção** o arquivo `supabase/testes/019_autoteste_SOMENTE_TESTE.sql`. Ele é só para o ambiente de testes e se recusa a rodar sem a declaração `altum.ambiente = 'teste'` ou num banco chamado `postgres`.

## Próxima etapa (não implementada)
Antes de ligar qualquer automação: conferência contato a contato do descadastro no Nuvem Marketing (só leitura), lista dedicada, aprovação do administrador por lote, chave geral `automacao_ativa = false` gravada no banco e registro de cada envio. A atribuição de vendas continua sendo só por cupom.
