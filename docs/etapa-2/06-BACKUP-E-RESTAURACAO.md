# 06 — Backup e recuperação

Correção 5 do plano.

**Regra:** o backup só é considerado **confiável** depois que os 4 critérios de aceite do final deste documento
forem cumpridos, incluindo uma restauração completa testada. Até lá, a tela "Integrações & dados"
mostra: **"Backup: não validado"**.

## Viabilidade técnica

Conferido na documentação oficial; **ainda precisa ser provado na prova de conceito**.

| Ponto | Situação | Consequência no plano |
|---|---|---|
| Ferramenta | O Supabase documenta o backup com `supabase db dump` em 3 arquivos (papéis, estrutura, dados) e a restauração com `psql` | Usamos o método oficial, não um script próprio |
| Docker | O `supabase db dump` precisa de Docker. Os servidores Linux do GitHub Actions têm Docker | Viável no GitHub Actions |
| Rede | O GitHub Actions só conecta por **IPv4**. A conexão direta do Supabase é IPv6, e o endereço IPv4 dedicado é um adicional pago (Pro) | Usar a conexão **Session pooler** (porta 5432), que o próprio Supabase indica para redes só-IPv4 |
| O que o dump **não** inclui | Configurações do Auth, chaves de API, gatilhos e políticas criados nos esquemas `auth`/`storage`, segredos de Edge Functions, webhooks, extensões não padrão, senhas de papéis com login | Tudo isso fica em **arquivos versionados** (migrações + checklist de configuração), reaplicados na restauração |
| Conteúdo sensível | O dump inclui o esquema `auth`: e-mails dos usuários, hashes de senha e segredos dos fatores de MFA | **Criptografia obrigatória** antes de qualquer arquivo sair do servidor de execução |
| Custo | Rotina de poucos minutos por dia, num repositório privado, dentro da cota gratuita do GitHub | A cota exata do plano GitHub do usuário será confirmada na prova de conceito |

## Desenho

```
GitHub Actions (repositório PRIVADO "altum-si-backups"), todo dia às 03:17 (horário de Brasília)
 1. supabase db dump  → roles.sql, schema.sql, data.sql   (via Session pooler)
 2. manifesto.json    → contagem de linhas por tabela (sem dados pessoais) + versão do Postgres + SHA-256
 3. verificações      → arquivos não vazios, tabelas esperadas presentes, contagens > 0 onde devem
 4. age -r <CHAVE PÚBLICA>  → backup-AAAA-MM-DD.tar.age   (sem a chave privada, ninguém abre)
 5. upload como artefato do GitHub: diário com retenção de 30 dias; dia 1 de cada mês com 90 dias
 6. falha em qualquer passo → o job falha → o GitHub envia e-mail ao dono do repositório
```

### Criptografia: `age` com chave pública

- Você gera um **par de chaves no seu computador** (passo a passo, parte E).
- A **chave pública** (`age1…`) vai para o GitHub e só serve para trancar.
- A **chave privada** nunca sai do seu controle. Ela fica no gerenciador de senhas, com uma cópia offline (pendrive guardado).
- Se o GitHub ou o repositório forem comprometidos, os backups continuam ilegíveis.
- O arquivo aberto existe só durante a execução, num servidor descartável do GitHub, e nunca é enviado.
- **Risco assumido:** perder a chave privada torna os backups inúteis. Por isso há duas cópias, e o critério de aceite 4 testa a chave.

### Proteção das credenciais

| Credencial | Onde fica | Nunca |
|---|---|---|
| String de conexão do banco (com senha) | *Secret* do repositório **de backup** (`SUPABASE_DB_URL`) | No código, no repositório do app, no chat |
| Chave pública age | Variável do repositório de backup | — (é pública) |
| Chave privada age | Seu gerenciador de senhas + cópia offline | No GitHub, no chat, no computador de outras pessoas |
| Secret key do Supabase | **Não é usada no backup** | — |

Mais proteções:
- O repositório de backup só aceita ações oficiais do GitHub e do Supabase, com **versões fixadas**.
- O workflow tem permissões mínimas (`contents: read`).
- Sem acesso para colaboradores externos.

**Papel do banco usado no backup.** O ideal é um papel exclusivo, só de leitura (`backup_leitura`), em
vez do usuário `postgres`. Mas o dump precisa ler todas as tabelas, inclusive as protegidas por RLS e o
esquema `auth`. **A prova de conceito testa se o Supabase permite esse papel com as permissões
necessárias.** Se não permitir:
- usa-se `postgres`, com senha exclusiva e longa;
- a senha é trocada em qualquer suspeita e a cada 6 meses;
- esse risco fica registrado.

## Restauração (roteiro)

1. **Escolher o destino.** Um projeto Supabase novo (vazio) ou o mesmo projeto, se o problema for só nos dados. Restaurar por cima de dados existentes nunca é feito sem uma cópia antes.
2. **Baixar** o artefato do dia desejado no GitHub.
3. **Abrir no seu computador:** `age -d -i chave-privada.txt backup-AAAA-MM-DD.tar.age > backup.tar`.
4. **Conferir** o SHA-256 dos arquivos com o manifesto.
5. **Restaurar** com o comando oficial do Supabase (Session pooler):
   ```
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql --dbname "<CONEXÃO DO PROJETO DE DESTINO>"
   ```
6. **Reaplicar o que o dump não leva:** a migração de gatilhos do esquema `auth` e o checklist de configuração (Auth, URLs, MFA, `pg_cron`, Vault).
7. **Reaplicar anonimizações** posteriores à data do backup (ver [05](05-LGPD-AUDITORIA-RETENCAO.md#backups-e-anonimização)).
8. **Validar:**
   - contagens iguais às do manifesto;
   - login de um administrador com MFA;
   - teste automatizado de RLS;
   - auditoria automatizada das 7 telas apontando para o projeto restaurado.
9. Se o projeto mudou, **atualizar** a URL e a publishable key em `config.js`.

**Metas:** perda máxima de dados de 24 horas (backup diário). Volta ao ar em até 4 horas.

## Testes de recuperação

| Teste | Frequência | Como |
|---|---|---|
| Restauração automática de verificação | Semanal, no próprio GitHub Actions | Sobe um Postgres temporário (imagem `supabase/postgres`, mesma versão), restaura e compara as contagens com o manifesto. O servidor descartável é apagado ao final |
| Restauração completa | Uma vez nesta etapa (aceite), depois a cada trimestre e na Etapa 5 | Roteiro completo, num **projeto Supabase temporário**, criado e apagado depois |
| Abertura com a chave privada | Nesta etapa e a cada trimestre | **Você** abre um backup no seu computador, com a sua chave |

> O teste completo precisa de uma vaga de projeto livre no plano gratuito (2 por organização). Se não houver,
> as alternativas são:
> - uma organização separada só para testes;
> - pausar temporariamente o projeto de testes;
> - fazer o teste no plano Pro.
>
> **O projeto do ALTUM Content Intelligence nunca é usado nem pausado para isso.**

## Prova de conceito

É a primeira tarefa técnica da Etapa 2, feita depois da sua aprovação, só com dados fictícios. Ela confirma ou derruba:

1. o dump via Session pooler a partir do GitHub Actions;
2. o papel `backup_leitura` com permissões suficientes;
3. a criptografia e a abertura com a chave privada;
4. a restauração automática no Postgres temporário;
5. o campo `amr` do token com o horário do TOTP (regra M4 do arquivo 04);
6. a cota do GitHub suficiente para a rotina.

Cada item vira **"confirmado"** ou **"alternativa adotada"** no relatório da prova de conceito, antes de seguir.

## Critérios de aceite: quando o backup passa a ser "confiável"

1. **7 execuções diárias seguidas** com sucesso.
2. **Restauração automática semanal** aprovada, com contagens idênticas ao manifesto.
3. **Restauração completa** num projeto novo, com login + MFA, testes de RLS e auditoria das telas aprovados.
4. **Você abriu um backup** com a sua chave privada, no seu computador.

Antes disso: status "não validado" na tela, e nenhum dado real entra (Etapa 3 bloqueada).

## No plano Pro

O Supabase passa a fazer backups diários próprios (retenção de 7 dias no Pro). Eles **não substituem** este
backup: viram a primeira linha de recuperação, e o backup criptografado no GitHub continua como cópia
independente, fora do Supabase.
