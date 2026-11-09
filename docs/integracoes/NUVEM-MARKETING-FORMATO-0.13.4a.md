# Nuvem Marketing — descoberta do formato da API (0.13.4a, revisão 3: diagnóstico de /activity)

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
  - `GET https://api.myperfit.com/v2/{conta}/activity?q={e-mail}&filters.track_type=track.mail.unsubscribed&view=default`
    - `view=default`: a documentação diz que `view=simple` devolve só o e-mail, sem o tipo e a data do evento.
  - Autenticação: só `Authorization: Bearer <chave>`, no servidor. A documentação da Contacts API exige esse cabeçalho, e a de atividade diz usar a mesma autenticação.
  - Se `/activity` responder **HTTP 202**, a função faz **uma** nova leitura após o `Retry-After` informado (entre 1 e 5 s; 2 s se não houver), dentro do mesmo limite de 6 leituras. Um endereço `Location` **nunca** é seguido.
  - Se a API responder 401, 403, 429 ou 503, ou não responder, a descoberta **para** e mostra o resultado parcial.
- **O que volta ao navegador:** só o **formato**: o caminho de cada campo (ex.: `data.state`), o tipo (texto, inteiro, lista, data, e-mail) e o valor **apenas** quando o campo é de situação técnica e o valor está numa lista fechada (ex.: `active`, `unsubscribed`, `track.mail.unsubscribed`, `hard`).
  - `reason`, `source`, `origin`, `type` e qualquer outro campo: só caminho e tipo.
  - Para cada leitura de `/activity`: código HTTP, tipo de conteúdo, tamanho, `Retry-After` numérico, se há `Location` (caminho mascarado, ex.: `/v2/{conta}/activity/{x}`) e os **nomes** dos cabeçalhos da resposta.
  - **Conclusão** por amostra:
    | Conclusão | Significado |
    |---|---|
    | `descadastro_encontrado` | A API devolveu um evento `track.mail.unsubscribed` |
    | `nenhum_evento_retornado` | HTTP 200 sem eventos. O período coberto não é documentado: **não prova** ausência de descadastro |
    | `inconclusivo_processando` | HTTP 202 (aceito, sem resultado). **Nunca** quer dizer "sem descadastro" |
    | `inconclusivo_formato` / `inconclusivo_filtro_ignorado` / `erro` | Resposta inesperada: inconclusivo |
  - **Nunca** voltam e-mail, nome, telefone, documento, endereço, IDs ou datas; eles aparecem só como tipo.
  - Nada fica gravado.
- **"Ativo" não é autorização:** `data.state = active` e `data.interests[].subscribed` (uma data de inscrição no interesse) **não** provam consentimento. O consentimento continua sendo o registrado no CRM.
- **Não faz:** não cria nem altera contatos, listas ou interesses, não envia e-mails, não grava nada no CRM.

## Ordem de publicação (não inverter)
Não há migração SQL nesta etapa. A 019 e as demais não mudam.
1. **Supabase → Edge Functions → `nuvem-marketing` → Code**: substitua todo o código pelo arquivo `supabase/functions/nuvem-marketing/index.ts` (0.13.4a, revisão 3) e clique em **Deploy**.
   - A função nova funciona também com o app 0.13.4a já publicado; ele só não mostra a conclusão e os metadados de `/activity`.
   - Não mude **Verify JWT** nem os **Secrets** (`NUVEM_MARKETING_API_KEY` e `NUVEM_MARKETING_CONTA` continuam).
   - Os botões já existentes (Verificar, Testar conexão, Calcular prévia, Analisar listas) continuam funcionando com o app 0.13.3.
2. **GitHub → Add file → Upload files**: arraste **as pastas** do `.zip` do app, mantendo a estrutura, e clique em **Commit changes**:
   - `assets/js/repositorio.js`
   - `assets/js/views/configuracoes.js`
   - `assets/js/config.js`
   - `docs/integracoes/NUVEM-MARKETING-FORMATO-0.13.4a.md`
   - Versão no rodapé: `0.13.4a.3-diagnostico-atividade`.
3. Abra o site, recarregue com **Ctrl+Shift+R** e entre como administrador (senha + código).
4. **Integrações → Recompra por e-mail — prévia**: deixe o **Juice Protein** escolhido e clique em **Descobrir formato da API (somente leitura)**.
5. Confira:
   - o cabeçalho mostra "N amostra(s) · até 6 leituras";
   - as tabelas mostram campos e tipos, **sem nenhum e-mail ou nome**;
   - em cada amostra, "GET /activity" mostra a **conclusão** e a linha "Leitura 1: HTTP …" (e "Leitura 2" se houve 202).
6. Clique em **Copiar resultado (sem dados pessoais)** e **me envie o texto copiado**. Com ele eu confirmo o mapeamento (qual campo indica descadastro, rebote etc.) e preparo a auditoria completa.
7. Em **Edge Functions → nuvem-marketing → Logs**, devem aparecer só linhas como `formato_contato status=200`, `formato_atividade status=202` e `formato_atividade_repeticao status=…`, sem e-mail nem chave.

## Se algo não sair como esperado
| O que aparece | O que significa |
|---|---|
| "A função publicada não tem esta ação" | A função ainda é a 0.13.3: refaça o passo 1 |
| Contato com HTTP 404 em todas as amostras | A API não achou os e-mails (ou não aceita o e-mail no caminho). Envie o resultado assim mesmo |
| Atividade com HTTP 401 | O endereço de atividade usa outra forma de autenticação. Envie o resultado |
| Atividade `inconclusivo_processando` nas duas leituras | A API processa a consulta de forma assíncrona. Envie o resultado (metadados, `Location`, cabeçalhos); a próxima etapa decide como buscar o resultado |
| "Limite de 6 leituras atingido" | Houve repetição após 202; a última amostra pode não ter sido lida. Resultado parcial normal |
| "A API pediu para parar (status_429)" | Limite de chamadas: espere alguns minutos e tente uma vez só |
| "Nenhum cliente … para usar como amostra" | Não há cliente real com registro de e-mail nem comprador do produto |
