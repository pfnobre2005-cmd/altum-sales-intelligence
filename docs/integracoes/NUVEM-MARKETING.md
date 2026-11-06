# Nuvem Marketing — verificação da integração (app 0.13.1)

Nesta etapa o CRM só **confere se a chave do Nuvem Marketing está nos Secrets do Supabase**.
**Nenhum e-mail é enviado** e nenhum dado de cliente é lido ou enviado ao Nuvem Marketing.
Nuvemshop (teste de conexão, importação, newsletter, agendamento), as sete telas, o banco e as regras de consentimento **não mudam**.

## Como funciona
- Em **Integrações & dados → cartão "WhatsApp / e-mail"**, o **administrador** vê o botão **Verificar Nuvem Marketing**. O operador não vê.
- O botão chama a Edge Function `nuvem-marketing` com a **sessão já autenticada** (senha + código do autenticador). O supabase-js envia sozinho o token da sessão; o app não lê, monta nem guarda token ou chave.
- A função confere, nesta ordem:
  1. o token da sessão, assinado pela chave ECC atual do projeto (chave pública, token antigo ou vencido → 401);
  2. a verificação em 2 etapas nesta sessão (`aal2`), senão 403;
  3. **administrador ativo segundo o banco** (`perfis`), lido com as permissões do próprio usuário, senão 403. O perfil escolhido no navegador não vale;
  4. só então, se o segredo `NUVEM_MARKETING_API_KEY` existe. O valor **nunca** é devolvido nem registrado em log.
- Resultado na tela: "Chave encontrada no Supabase. Envio de e-mail: desligado."
- O botão "Test" do painel do Supabase continua recebendo `UNUSABLE_CREDENTIAL`, porque manda só a chave pública. Isso é o esperado: a função exige a sessão de um usuário.

## Ordem de publicação (não inverter)
1. **Supabase → Edge Functions → `nuvem-marketing` → Code**: substitua todo o código pelo arquivo `supabase/functions/nuvem-marketing/index.ts` do pacote e clique em **Deploy**.
   - Não crie função nova; atualize a mesma.
   - Não mude **Verify JWT** nem os **Secrets**. `NUVEM_MARKETING_API_KEY` continua lá.
   - Opcional: o Secret `ALTUM_ORIGEM_PERMITIDA`, só se o endereço do site mudar. O padrão é `https://pfnobre2005-cmd.github.io`.
2. **GitHub → Add file → Upload files**: arraste **as pastas** do `.zip` do app, mantendo a estrutura, e clique em **Commit changes**:
   - `assets/js/repositorio.js`
   - `assets/js/views/configuracoes.js`
   - `assets/js/config.js`
   - `docs/integracoes/NUVEM-MARKETING.md`

   O app novo depende da função atualizada: com a função antiga, o botão mostra "Resposta inesperada".
3. Abra o site, recarregue com **Ctrl+Shift+R**, **saia e entre de novo** (senha + código). A sessão nova já sai assinada pela chave ECC.

## Validação
1. Como **administrador**: Integrações → **Verificar Nuvem Marketing** → "Chave encontrada… Envio de e-mail: desligado".
2. Como **operador**: o botão não aparece.
3. Em **Edge Functions → nuvem-marketing → Logs**, aparece só `verificacao ok configurada=true`, sem chave, token ou e-mail.
4. Se aparecer "A função recusou o token da sessão", saia e entre de novo. Sessões abertas antes da troca para a chave ECC ainda podem estar com a assinatura antiga.

## Regras que continuam valendo (para a próxima etapa, de envio)
- E-mail só para cliente com permissão de e-mail concedida no sistema (`app.marketing_permitido(cliente, null, 'email')`). Recusa, revogação, oposição, "não contatar", anonimização, supressão e dados fictícios ficam de fora.
- A inscrição na newsletter da loja só vira permissão com data e texto comprovados (migração 017). Inscrições "pendentes" **não** podem receber e-mail.
- Nunca enviar para a lista de assinantes da própria loja sem passar por essas regras. Nenhum envio automático sem aprovação do administrador.
