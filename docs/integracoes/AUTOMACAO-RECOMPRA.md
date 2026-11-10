# Automação de recompra por e-mail (app 0.16.0, migrações 020 e 022)

**Onde:** Integrações & dados → "Automação de recompra por e-mail". Só o administrador com 2 etapas vê.

**Começa tudo desligado:** envio real desligado, nenhuma automação e nenhum agendamento.

## Quem pode receber

1. **CRM (decide primeiro).** O cliente precisa ter:
   - comprado o produto (pedido pago, dados reais) e estar na janela de reposição;
   - autorização de e-mail comprovada;
   - nenhum descadastro, recusa, oposição ou "não contatar", nem no mesmo e-mail em outro cadastro;
   - nenhum envio recente da mesma automação.
2. **Nuvem Marketing (auditoria, só leitura).** Só é autorizado se:
   - o contato estiver `active` ou ainda não existir; **e**
   - a consulta de descadastros responder 200 sem evento.

   **HTTP 202, estado desconhecido, erro ou limite = não autorizado.** "Ativo" sozinho nunca é consentimento.

## Como usar

1. **Nova automação**: escolha o produto (o Juice Protein já vem sugerido) e salve.
2. **Simular agora**: faz a auditoria completa, com leituras apenas, e **não envia nada**.
   - O histórico mostra quantos passaram em cada etapa.
   - **Clientes** mostra o resultado por cliente, sem e-mail.
3. Com a lista dedicada e o Custom Trigger prontos no Nuvem Marketing, use **Editar** e informe o número da lista e o `trigger_key`. Depois, **Simular agora** de novo.
4. **Aprovar a última simulação**: só é aceita uma simulação **sem avisos** em que a consulta de descadastros respondeu 200.
5. **Passar para modo real** → **Ligar envio real (chave geral)** → criar no Supabase o Secret `RECOMPRA_ENVIO_REAL` = `ativado`. As três travas são independentes.
6. **Executar envio real agora**: os autorizados entram na lista dedicada (só o e-mail), e o Custom Trigger dispara o e-mail da automação da Perfit. Cada e-mail × compra é enviado no máximo uma vez.
7. **Ligar agendamento**: roda sozinho uma vez por dia, no modo da automação, depois que o pg_cron for ligado (`supabase/agendamento/ligar_automacao_recompra.sql`).

## Parar

- **Desligar envio real (chave geral)**: efeito imediato.
- Para desligar tudo, inclusive o agendamento: `supabase/reversao/desligar_automacao_recompra.sql`.

Roteiro completo, investigação do HTTP 202 e reversão: `supabase/ETAPA-AUTOMACAO-RECOMPRA.md` (pacote do Supabase).

## Todos os produtos (0.16.0)

Em cada automação, **Abrangência**:
- **Produtos escolhidos (um gatilho):** como sempre. As automações existentes continuam assim.
- **Todos os produtos com ciclo (gatilho por produto):** entram todos os produtos reais e ativos com **ciclo de recompra** cadastrado; as variantes de um produto contam juntas. Cada produto usa o próprio ciclo.

Regras:
- **Produto sem gatilho nunca recebe envio real.** A tabela de produtos mostra "Sem gatilho: não envia" até você informar o `trigger_key` e salvar.
- No envio, o evento leva `produto` no contexto. O e-mail só mostra o nome se o template do Nuvem Marketing usar `${produto}`. **Antes de ligar um produto a um gatilho já existente** (ex.: `altum_recompra_juice`, cujo texto é do Juice), confira o template e teste com um contato seu.
- **No máximo 1 e-mail de recompra por pessoa** por execução e a cada N dias ("1 e-mail por pessoa a cada", padrão 7). A mesma compra nunca recebe dois e-mails, nem por automações diferentes.
- Mudar a abrangência, o intervalo ou um gatilho **desfaz a aprovação** e volta a automação para simulação.
- O detalhe **Clientes** mostra o produto e o gatilho de cada linha.

Roteiro de instalação e validação: `supabase/ETAPA-RECOMPRA-TODOS-PRODUTOS.md` (pacote do Supabase).

## Se algo não sair como esperado

| O que aparece | Causa | O que fazer |
|---|---|---|
| "A função … não é a do ALTUM (resposta sem identificação)" | Em Edge Functions → `recompra-automacao` está publicado outro código, como o modelo "Hello" que o painel cria | Em **Code**, apague tudo, cole o `index.ts` da 0.16.0 e clique em **Deploy** |
| "O Supabase recusou a sessão antes de chegar à função" | "Verify JWT" ligado na função | Em **Details**, desligue "Verify JWT" |
| "Para simular: incompleto" (chave ou conta com "Falta") | Os Secrets `NUVEM_MARKETING_API_KEY` / `NUVEM_MARKETING_CONTA` não estão visíveis para a função | Confira em Edge Functions → **Secrets** (eles valem para todas as funções do projeto) |
| "Não necessário agora" | Secrets do envio real ou do agendamento | Normal: só são criados na ativação |
| "Simulação — Falhou (faltam os Secrets…)" | A função certa rodou, mas sem chave ou conta | Mesmo caso de "Para simular: incompleto"; a execução fica no histórico |
| "A função publicada é anterior à 0.16.0" / "função desatualizada: publique a 0.16.0" | O banco tem a 022, mas a função ainda é a 0.14.x | Publique o `index.ts` da 0.16.0. Até lá, a abrangência "todos" não envia nada |
| "Produto sem gatilho (não enviado)" | Abrangência "todos" e o produto não tem `trigger_key` | Informe o gatilho só depois de conferir o template no Nuvem Marketing |

