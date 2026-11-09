# Automação de recompra por e-mail (app 0.14.1, migração 020)

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

## Se algo não sair como esperado (0.14.1)

| O que aparece | Causa | O que fazer |
|---|---|---|
| "A função … não é a do ALTUM (resposta sem identificação)" | Em Edge Functions → `recompra-automacao` está publicado outro código, como o modelo "Hello" que o painel cria | Em **Code**, apague tudo, cole o `index.ts` da 0.14.1 e clique em **Deploy** |
| "O Supabase recusou a sessão antes de chegar à função" | "Verify JWT" ligado na função | Em **Details**, desligue "Verify JWT" |
| "Para simular: incompleto" (chave ou conta com "Falta") | Os Secrets `NUVEM_MARKETING_API_KEY` / `NUVEM_MARKETING_CONTA` não estão visíveis para a função | Confira em Edge Functions → **Secrets** (eles valem para todas as funções do projeto) |
| "Não necessário agora" | Secrets do envio real ou do agendamento | Normal: só são criados na ativação |
| "Simulação — Falhou (faltam os Secrets…)" | A função certa rodou, mas sem chave ou conta | Mesmo caso de "Para simular: incompleto"; a execução fica no histórico |

