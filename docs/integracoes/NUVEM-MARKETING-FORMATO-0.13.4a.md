# Nuvem Marketing — descoberta do formato da API (0.13.4a)

**Objetivo:** confirmar, com a API real, os **nomes e formatos dos campos** de um contato e da atividade de descadastro, antes de construir a auditoria de consentimento. A auditoria completa (0.13.4b) **só começa depois** que você enviar o resultado desta etapa.

## O que faz (somente leitura)
- **Onde:** Integrações → "Recompra por e-mail — prévia" → botão **Descobrir formato da API (somente leitura)**, só para administrador com 2 etapas.
- **Amostras:** a função escolhe no servidor **até 3 clientes de amostra**, com as permissões do próprio administrador no banco. Sempre clientes **reais**, **não anonimizados**, **com e-mail**. Prioridade, uma de cada:
  - cliente com e-mail **concedido** no CRM;
  - cliente com e-mail **revogado ou recusado** no CRM;
  - **comprador do Juice Protein** sem registro de e-mail.

  Ficam de fora: dados fictícios, quem só tem WhatsApp, comprador de outro produto e pedido cancelado.
- **Leituras:** para cada amostra, no máximo **2 leituras**, com pausa entre elas. Total máximo: **6**.
  - `GET https://api.myperfit.com/v2/{conta}/contacts/{e-mail}`
  - `GET https://api.myperfit.com/v2/{conta}/activity?q={e-mail}&filters.track_type=track.mail.unsubscribed&view=simple`
  - Se a API responder 401, 403, 429 ou 503, ou não responder, a descoberta **para** e mostra o resultado parcial.
- **O que volta ao navegador:** só o **formato**: o caminho de cada campo (ex.: `data.state`), o tipo (texto, inteiro, lista, data, e-mail) e, **apenas em campos de situação** (state, status, reason, track_type…), o valor quando é uma palavra curta (ex.: `active`, `unsubscribed`, `not_interested`).
  - **Nunca** voltam e-mail, nome, telefone, documento, endereço, IDs ou datas; eles aparecem só como tipo.
  - Nada fica gravado.
- **"Ativo" não é autorização:** esta etapa apenas observa o formato. Nenhuma conclusão sobre consentimento é tirada aqui.
- **Não faz:** não cria nem altera contatos, listas ou interesses, não envia e-mails, não grava nada no CRM.

## Ordem de publicação (não inverter)
Não há migração SQL nesta etapa. A 019 e as demais não mudam.
1. **Supabase → Edge Functions → `nuvem-marketing` → Code**: substitua todo o código pelo arquivo `supabase/functions/nuvem-marketing/index.ts` (0.13.4a) e clique em **Deploy**.
   - Não mude **Verify JWT** nem os **Secrets** (`NUVEM_MARKETING_API_KEY` e `NUVEM_MARKETING_CONTA` continuam).
   - Os botões já existentes (Verificar, Testar conexão, Calcular prévia, Analisar listas) continuam funcionando com o app 0.13.3.
2. **GitHub → Add file → Upload files**: arraste **as pastas** do `.zip` do app, mantendo a estrutura, e clique em **Commit changes**:
   - `assets/js/repositorio.js`
   - `assets/js/views/configuracoes.js`
   - `assets/js/config.js`
   - `docs/integracoes/NUVEM-MARKETING-FORMATO-0.13.4a.md`
3. Abra o site, recarregue com **Ctrl+Shift+R** e entre como administrador (senha + código).
4. **Integrações → Recompra por e-mail — prévia**: deixe o **Juice Protein** escolhido e clique em **Descobrir formato da API (somente leitura)**.
5. Confira:
   - o cabeçalho mostra "N amostra(s) · até 6 leituras";
   - as tabelas mostram campos e tipos, **sem nenhum e-mail ou nome**.
6. Clique em **Copiar resultado (sem dados pessoais)** e **me envie o texto copiado**. Com ele eu confirmo o mapeamento (qual campo indica descadastro, rebote etc.) e preparo a auditoria completa.
7. Em **Edge Functions → nuvem-marketing → Logs**, devem aparecer só linhas como `formato_contato status=200`, sem e-mail nem chave.

## Se algo não sair como esperado
| O que aparece | O que significa |
|---|---|
| "A função publicada não tem esta ação" | A função ainda é a 0.13.3: refaça o passo 1 |
| Contato com HTTP 404 em todas as amostras | A API não achou os e-mails (ou não aceita o e-mail no caminho). Envie o resultado assim mesmo |
| Atividade com HTTP 401 | O endereço de atividade usa outra forma de autenticação. Envie o resultado |
| "A API pediu para parar (status_429)" | Limite de chamadas: espere alguns minutos e tente uma vez só |
| "Nenhum cliente … para usar como amostra" | Não há cliente real com registro de e-mail nem comprador do produto |
