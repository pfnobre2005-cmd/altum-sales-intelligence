# 07 — Passo a passo: o que você faz manualmente

Tempo estimado: **45 a 60 minutos**. As partes A a F são **só configuração**: não criam tabelas nem dados e
não mexem em nada existente. A parte G é feita **somente depois** que você aprovar o plano e eu entregar os
arquivos.

> Os nomes dos menus do Supabase e do GitHub mudam de tempos em tempos. Se um nome não bater exatamente,
> procure o equivalente na mesma área. Se ficar em dúvida, me mande um print **sem chaves ou senhas visíveis**.

Antes de começar, tenha à mão um **gerenciador de senhas** (Bitwarden, 1Password ou o do navegador, de
preferência um que aceite anexos) e o **app autenticador** no celular (Google Authenticator, Microsoft
Authenticator ou Authy).

---

## Parte A — Proteger as contas que controlam tudo (agora)

1. **GitHub** → foto (canto superior direito) → *Settings* → *Password and authentication* → **Two-factor authentication** → ativar com o app autenticador. Guarde os códigos de recuperação no gerenciador de senhas.
2. **Supabase** → entre em supabase.com (crie a conta se ainda não tiver).
3. No Supabase → foto (canto superior direito) → *Account preferences* → **Security / Multi-factor authentication** → adicionar o app autenticador.

## Parte B — GitHub: endereço do sistema e repositório de backup (agora)

4. Se ainda não fez na Etapa 1, crie o repositório **`altum-sales-intelligence`** e publique a Etapa 1 no GitHub Pages, conforme o README. Recomendo repositório público (decisão D9); o código não tem segredos.
5. Anote o endereço do Pages, no formato `https://SEU-USUARIO.github.io/altum-sales-intelligence/`.
6. Crie um **segundo repositório, PRIVADO**, chamado **`altum-si-backups`**. Pode deixá-lo vazio; eu entrego o conteúdo depois.
7. No `altum-si-backups` → *Settings* → *Actions* → *General*:
   - **Actions permissions:** "Allow *seu-usuário*, and select non-*seu-usuário*, actions and reusable workflows", marcando **"Allow actions created by GitHub"**. No campo de ações permitidas, escreva `supabase/setup-cli@*`.
   - **Workflow permissions:** "Read repository contents and packages permissions".
   - Salvar.

## Parte C — Supabase: organização e projeto (agora)

8. No Supabase, abra a lista de organizações (seletor no canto superior esquerdo) e veja **quantos projetos ativos** existem na organização onde está o **ALTUM Content Intelligence**, se ele estiver no Supabase.
   - **Não abra, pause, altere ou apague nada desse projeto.**
   - Se a organização já tiver **2 projetos ativos**, crie uma **nova organização**: *New organization* → nome `ALTUM Sales Intelligence` → tipo *Company* → plano **Free**.
9. *New project*, na organização escolhida:
   - **Name:** `altum-sales-intelligence`.
   - **Database password:** clique em **Generate a password**, copie e salve no gerenciador de senhas como "Supabase — senha do banco — Sales Intelligence". Se a senha gerada tiver símbolos como `@`, `#` ou `/`, gere outra até sair só com letras e números: isso evita erro na conexão do backup. **Não me envie essa senha.**
   - **Region:** *South America (São Paulo)*.
   - Opções avançadas ou de segurança, se aparecerem:
     - mantenha o *Data API* ligado;
     - se existir a opção de **ativar RLS automaticamente em tabelas novas**, ligue.
   - *Create new project*. Aguarde 1 a 2 minutos até ficar pronto.

## Parte D — Supabase: autenticação (agora)

10. *Authentication* → *Sign In / Providers* (ou *Providers*):
    - **Allow new users to sign up:** **desligado**.
    - **Allow anonymous sign-ins:** **desligado**.
    - Em **Email**: *Enable email provider* ligado; **Confirm email** ligado.
    - Requisitos de senha, se disponíveis: **mínimo 12 caracteres**, exigindo letras e números.
    - Deixe os demais provedores (Google, Apple etc.) desligados.
    - Salvar.
11. *Authentication* → *URL Configuration*:
    - **Site URL:** o endereço do Pages do passo 5.
    - **Redirect URLs:** adicione `https://SEU-USUARIO.github.io/altum-sales-intelligence/**` e `http://localhost:8080/**` (para testes).
    - Salvar.
12. *Authentication* → *Multi-Factor* (ou *MFA*):
    - **TOTP (App Authenticator):** *Enabled*.
    - **Phone:** desligado (é cobrado).
    - Salvar.
13. Apenas observe, sem mudar nada: em *Authentication* → *Emails* / *SMTP*, veja se aparece um aviso de que o envio de e-mails padrão tem **limite baixo** ou **só entrega para membros da organização**.
    - Se aparecer, convidar outros operadores vai exigir um servidor de e-mail próprio (SMTP).
    - Isso **não** bloqueia a Etapa 2: o seu próprio convite funciona. Trataremos depois, com sua aprovação, porque pode envolver serviço externo.

## Parte E — Chave do backup (agora, no seu computador)

14. Instale o `age`:
    - **Windows:** abra o *Terminal* (ou PowerShell) e rode `winget install --id FiloSottile.age`. Feche e abra o Terminal de novo.
    - **Mac:** `brew install age` (precisa do Homebrew).
15. No Terminal, rode: `age-keygen -o altum-backup-chave-privada.txt`
    - Aparece uma linha **`Public key: age1…`**. Essa é a **chave pública**: copie, porque vai para o GitHub e para mim.
    - O arquivo `altum-backup-chave-privada.txt` é a **chave privada**:
      - guarde no gerenciador de senhas (como anexo ou colando o conteúdo);
      - faça **uma cópia num pendrive** guardado em local seguro;
      - depois **apague** o arquivo da pasta onde ele foi criado.
    - **Sem essa chave, nenhum backup pode ser aberto. Nunca envie a chave privada a ninguém, nem a mim.**

## Parte F — Credenciais do backup no GitHub (agora ou após aprovação)

16. No Supabase, botão **Connect** (topo do projeto) → **Session pooler** → copie a URI (começa com `postgresql://postgres.`). Troque `[YOUR-PASSWORD]` pela senha do passo 9.
17. No GitHub, `altum-si-backups` → *Settings* → *Secrets and variables* → *Actions*:
    - aba **Secrets** → *New repository secret* → nome `SUPABASE_DB_URL`, valor = a URI do passo 16;
    - aba **Variables** → *New repository variable* → nome `AGE_PUBLIC_KEY`, valor = a chave `age1…` do passo 15.
18. Apague a URI de onde você a tiver colado temporariamente (bloco de notas etc.).

## O que me enviar depois das partes A a F

| Envie | Exemplo |
|---|---|
| URL do projeto | `https://abcdefgh.supabase.co` (*Project Settings* → *Data API*, ou botão *Connect*) |
| **Publishable key** | `sb_publishable_…` (*Project Settings* → *API Keys*; se só aparecerem chaves "anon/legacy", clique em criar as novas chaves) |
| Endereço do GitHub Pages | `https://SEU-USUARIO.github.io/altum-sales-intelligence/` |
| Chave **pública** age | `age1…` |
| E-mail que será o primeiro administrador | — |
| Projetos ativos livres na organização | para planejar o teste de restauração |
| Se viu o aviso do passo 13 | sim/não |

**Nunca envie:**
- senha do banco;
- string de conexão;
- **secret key** (`sb_secret_…`) ou `service_role`;
- chave privada age;
- códigos do autenticador;
- códigos de recuperação;
- tokens do GitHub.

Se algum desses aparecer num print, apague o print e troque a credencial.

---

## Parte G — Somente após a aprovação e a entrega dos arquivos (NÃO FAZER AGORA)

19. Supabase → *SQL Editor* → colar e executar as migrações **na ordem** (`001` → `010`), uma de cada vez, conferindo "Success" em cada uma. Se alguma falhar, pare e me mande a mensagem de erro.
20. *Authentication* → *Users* → **Invite user** → seu e-mail. Abra o convite e defina a senha (mínimo 12 caracteres).
21. Entre no sistema, cadastre o app autenticador (QR code) e, de preferência, um **segundo fator** (outro aparelho).
22. *SQL Editor* → executar o comando de promoção a administrador que eu entregar (uma linha, com o seu e-mail).
23. Saia e entre de novo, com senha e código, e confirme que vê as 7 telas.
24. Copiar para o `altum-si-backups` os arquivos de backup que eu entregar e rodar o workflow manualmente uma vez (*Actions* → *Run workflow*).
25. Teste de abertura (critério 4 do arquivo 06): baixar o artefato e abrir com `age -d -i <sua chave privada> backup-….tar.age > backup.tar`.
