# Nuvem Marketing — verificação e teste de conexão (app 0.13.2)

Nesta etapa o CRM:
- **Verificar Nuvem Marketing** (desde a 0.13.1): confere se a chave está nos Secrets do Supabase. Não chama a API.
- **Testar conexão com Nuvem Marketing** (novo): o servidor faz **uma única leitura** na API oficial para confirmar que a chave é aceita:
  `GET https://api.myperfit.com/v2/{NUVEM_MARKETING_CONTA}/lists?limit=1` com `Authorization: Bearer <chave>`.
  - A tela mostra só "Autenticação aceita" e o total de listas, quando a API informa `paging.total`. Caso contrário, mostra que a API não informou o total. A quantidade da primeira página nunca é apresentada como total.

**Não** sincroniza contatos, **não** cria nem altera nada no Nuvem Marketing e **não** envia e-mails. Nuvemshop, as sete telas, o banco e as regras de consentimento não mudam.

## Segurança (função `nuvem-marketing`)
- **Acesso:** só sessão de usuário assinada pela chave ECC do projeto, com verificação em 2 etapas (`aal2`) e **administrador ativo segundo o banco**. Operador, sessão sem código ou administrador desativado recebem 403, e a API externa nem é chamada.
- **Endereço:** `https://api.myperfit.com/v2`, **fixo no código**. Não pode ser trocado por variável de ambiente.
- **Chamada à API:** limite de 10 segundos, uma tentativa, sem seguir redirecionamentos (a chave não vai para outro endereço). A resposta da API não é repassada ao navegador.
- **Chave:** a chave nunca aparece em respostas, logs ou no navegador. Os logs registram só o código HTTP.
- **Acesso pelo navegador:** só o site do app (`https://pfnobre2005-cmd.github.io`).

## Ordem exata de publicação
1. **Supabase → Edge Functions → Secrets → Add new secret**:
   - **Name:** `NUVEM_MARKETING_CONTA`.
   - **Value:** o nome da sua conta no Nuvem Marketing. Pelos exemplos oficiais, costuma ser a parte da chave antes do primeiro hífen; confira na sua conta.
   - Não altere `NUVEM_MARKETING_API_KEY`.
2. **Supabase → Edge Functions → `nuvem-marketing` → Code**: substitua todo o código pelo arquivo `supabase/functions/nuvem-marketing/index.ts` do pacote e clique em **Deploy**. Não mude **Verify JWT**.
   - Com a função nova e o app 0.13.1 ainda no ar, o botão "Verificar" continua funcionando.
3. **GitHub → Add file → Upload files**: arraste **as pastas** do `.zip` do app, mantendo a estrutura, e clique em **Commit changes**:
   - `assets/js/repositorio.js`
   - `assets/js/views/configuracoes.js`
   - `assets/js/config.js`
   - `docs/integracoes/NUVEM-MARKETING.md`
4. Abra o site, recarregue com **Ctrl+Shift+R** e entre como administrador (senha + código).
5. Em **Integrações & dados**, cartão "WhatsApp / e-mail":
   - **Verificar Nuvem Marketing** → "Chave encontrada… Envio de e-mail: desligado".
   - **Testar conexão com Nuvem Marketing** → "Autenticação aceita pela API do Nuvem Marketing…".
6. Confira os registros em **Edge Functions → nuvem-marketing → Logs**: só `teste_api status=200`, sem chave, token ou e-mail.

## Se o teste de conexão falhar
| Mensagem | O que fazer |
|---|---|
| "recusou a chave (401)" | Gere ou confira a chave do usuário de integração no Nuvem Marketing e atualize `NUVEM_MARKETING_API_KEY` |
| "não encontrou a conta (404)" | Corrija `NUVEM_MARKETING_CONTA`. Se estiver certa, a conta pode não estar no endereço `api.myperfit.com`: confirme com o suporte do Nuvem Marketing |
| "não tem permissão para ler listas (403)" | Dê ao usuário da chave permissão de leitura de listas no Nuvem Marketing |
| "Falta o nome da conta" | Crie o Secret do passo 1 |
| "Confira se a versão 0.13.2 dela foi publicada" | O app novo está no ar, mas a função ainda é a antiga: refaça o passo 2 |
| "limitando o acesso ou indisponível" / "não respondeu" | Tente de novo em alguns minutos |

## Regras que continuam valendo (próximas etapas)
- **Permissão de e-mail:** e-mail só para cliente com permissão concedida no sistema (`app.marketing_permitido(cliente, null, 'email')`). Recusa, revogação, oposição, "não contatar", anonimização, supressão e dados fictícios ficam de fora.
- **Newsletter:** inscrição na newsletter "pendente" (migração 017) **não** pode receber e-mail.
- **Automação de recompra:** fica **desligada** até ser aprovada. O CRM decide quem entra, há aprovação do administrador e a desinscrição no Nuvem Marketing é irreversível.
