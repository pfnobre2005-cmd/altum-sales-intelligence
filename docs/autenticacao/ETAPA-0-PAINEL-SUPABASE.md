# Etapa 0 — Configuração do painel Supabase (autenticação)

Projeto: `abjnmqzzhsqirlsogwwd` · App: https://pfnobre2005-cmd.github.io/altum-sales-intelligence/

> Faça os passos **na ordem**. Nenhum passo pede senha do banco, chave secreta ou service_role.
> Os passos A e B podem ser feitos já. O passo E (subir arquivos) vem antes do teste F.

## A. Endereços permitidos — Authentication › URL Configuration
1. Painel do Supabase → projeto ALTUM → menu lateral **Authentication** → **URL Configuration**.
2. **Site URL**: `https://pfnobre2005-cmd.github.io/altum-sales-intelligence/` (com a barra final) → **Save**.
3. **Redirect URLs** → **Add URL** → mesmo endereço acima → **Save URLs**.
   Remova qualquer `http://localhost…` que não esteja em uso.

## B. Regras de acesso — Authentication › Sign In / Providers (e Policies)
1. **Authentication** → **Sign In / Providers**:
   - **Allow new users to sign up**: **desligado** (só entra quem for convidado).
   - Provider **Email**: ligado. **Confirm email**: ligado.
2. Requisitos de senha (mesma tela, seção de senha / "Password requirements"):
   - **Minimum password length**: `12`
   - **Password requirements**: *Lowercase, uppercase letters and digits* (ou a opção com letras e dígitos).
   - O app também valida: 12+ caracteres, letra, número, não conter o e-mail.
3. **Authentication** → **Multi-Factor** (ou "MFA"): **TOTP (App Authenticator)** = *Enabled*.
   (Será usado na Etapa 3; deixar ligado agora não bloqueia nada.)

## C. Modelos de e-mail — Authentication › Emails
Caminho: **Authentication** → **Emails** → aba **Templates** → **Invite user** / **Reset password**.

**Atenção — restrição do Supabase:** projetos do plano Free criados a partir de 03/06/2026 que usam o
SMTP padrão **não podem editar os modelos**. Se os campos aparecerem bloqueados, este é o motivo.
Opções para liberar:
- **Recomendado:** SMTP próprio — **Project Settings** → **Authentication** → **SMTP Settings** →
  **Enable Custom SMTP** (provedor como Resend ou Brevo, com domínio verificado, ex. `altumnutrition.com.br`).
  Também resolve o limite do SMTP padrão (2 e-mails/hora e só para membros da organização).
- Ou plano Pro.

**Enquanto estiver bloqueado, não é preciso fazer nada:** o app já aceita o link padrão do Supabase
(`#access_token=…&type=invite|recovery`) e apaga o token do endereço imediatamente.

Quando liberar, troque **apenas o link** de cada modelo:

- **Invite user** — Subject: `Convite — ALTUM Sales Intelligence`
  ```html
  <h2>Você foi convidado para o ALTUM Sales Intelligence</h2>
  <p>Clique para definir sua senha (link de uso único, válido por tempo limitado):</p>
  <p><a href="{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=invite">Definir minha senha</a></p>
  <p>Se você não esperava este convite, ignore este e-mail.</p>
  ```
- **Reset password** — Subject: `Redefinição de senha — ALTUM Sales Intelligence`
  ```html
  <h2>Redefinição de senha</h2>
  <p>Clique para definir uma nova senha (link de uso único, válido por tempo limitado):</p>
  <p><a href="{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=recovery">Definir nova senha</a></p>
  <p>Se você não pediu isso, ignore este e-mail. Sua senha atual continua valendo.</p>
  ```
Por que `token_hash`: filtros de e-mail corporativo que "abrem" links antes do usuário não queimam o token;
quem confirma é o app, no momento do clique.

## D. Primeiro administrador — SQL Editor
O gatilho de convite sempre cria o perfil como `operador`. Para promover **só o seu usuário**:
**SQL Editor** → **New query** → cole, troque o e-mail e **Run**:
```sql
update public.perfis
   set papel = 'admin'
 where id = (select id from auth.users where email = 'SEU-EMAIL@dominio');
-- conferir:
select p.id, u.email, p.papel from public.perfis p join auth.users u on u.id = p.id;
```
Esperado: 1 linha atualizada; seu e-mail com `admin`. (Não altera nenhuma migração.)
O papel `admin` só passa a valer nas telas na Etapa 4; o banco já o respeita (RLS + aal2).

## E. Subir os arquivos no GitHub (manual)
Repositório `altum-sales-intelligence` → **Add file → Upload files**, mantendo as pastas:
`index.html`, `assets/js/{config,store,app,auth,link-auth}.js`, `assets/css/styles.css`,
`assets/vendor/supabase-js-2.117.3.js`, `assets/vendor/LICENSE-supabase-js.txt`,
`docs/autenticacao/ETAPA-0-PAINEL-SUPABASE.md` → **Commit changes**. Aguarde ~1–2 min (aba **Actions** verde).

## F. Teste
1. **Authentication** → **Users** → seu usuário → menu **⋯** → **Send password recovery**.
   (Seu convite antigo já foi consumido; este é o caminho para definir a senha.)
2. Abra o e-mail **no mesmo navegador** e clique no link.
3. Esperado: tela **"Defina uma nova senha"**, com seu e-mail, e o endereço **sem** `#access_token`.
4. Defina a senha → volta ao login com "Senha definida com sucesso" → entre.
5. Esperado: **"Verificação em 2 etapas pendente"**. As 7 telas continuam bloqueadas — correto nesta etapa.
6. Se aparecer "Link expirado": peça outro (o SMTP padrão permite ~2 e-mails/hora).
