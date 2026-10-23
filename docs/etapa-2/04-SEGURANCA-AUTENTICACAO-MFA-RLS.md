# 04 — Autenticação, 2 etapas (MFA) e regras de acesso (RLS)

Correção 4 do plano. Na v1, a verificação em 2 etapas era "obrigatória" só na tela. Na v2 ela é
**validada pelo banco** em toda operação administrativa.

## Como o Supabase informa a verificação em 2 etapas

Todo usuário logado carrega um token (JWT) com o campo `aal`:
- `aal1`: entrou só com senha;
- `aal2`: entrou com senha e confirmou o código do app autenticador (TOTP).

As regras de acesso do banco leem esse campo com `auth.jwt()->>'aal'`. Esse é o mecanismo documentado
pelo Supabase para exigir MFA nas políticas RLS, inclusive com políticas `as restrictive`, que se
aplicam por cima de qualquer outra regra.

## Regras de MFA

| # | Regra | Onde é garantida |
|---|---|---|
| M1 | **Administrador só existe em `aal2`.** Com papel `admin` e sessão `aal1`, o usuário **não acessa nenhuma tabela**, nem como operador | Política `restrictive` em todas as tabelas |
| M2 | Funções administrativas exigem `papel = admin`, `ativo = true` **e** `aal = aal2`: anonimizar, exportar, mudar papéis, regras, retenção, associar clientes e apagar dados fictícios | Função `app.e_admin()`, chamada nas políticas e **dentro** de cada função `security definer` |
| M3 | Quem tem fator verificado (inclusive operador) precisa estar em `aal2`. Uma sessão só com senha não "rebaixa" a conta | Política `restrictive`, no modelo da documentação do Supabase |
| M4 | **Confirmação recente** para ações irreversíveis (anonimizar, exportar tudo, apagar dados fictícios): o código precisa ter sido digitado nos últimos 15 minutos. Senão, a tela pede o código de novo | Função confere o horário do método `totp` no campo `amr` do token. **Será validado na prova de conceito (ver [06](06-BACKUP-E-RESTAURACAO.md#prova-de-conceito)). Se o campo não trouxer o horário, a alternativa é registrar a verificação numa tabela pelo servidor** |
| M5 | Não é possível remover nem desativar o **último administrador ativo** | Trigger em `perfis` |
| M6 | Promover alguém a administrador exige `aal2` de quem promove. A pessoa promovida só consegue agir como administrador depois de cadastrar o próprio fator (M1) | `alterar_papel()` |
| M7 | MFA dos operadores: **opcional nesta etapa**, recomendado. Uma vez cadastrado, passa a ser exigido (M3) | Decisão D7 do plano |

Esboço (especificação, **não executado**):

```sql
-- schema privado, não exposto pela API
create function app.e_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.perfis p
    where p.id = (select auth.uid())
      and p.papel = 'admin' and p.ativo
  ) and coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2';
$$;

-- M1 + M3, repetida em cada tabela
create policy exige_aal2 on public.clientes as restrictive to authenticated
using (
  coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2'
  or (
    not exists (select 1 from public.perfis where id = (select auth.uid()) and papel = 'admin')
    and not exists (select 1 from auth.mfa_factors
                    where user_id = (select auth.uid()) and status = 'verified')
  )
);
```

## Fluxo de login

1. E-mail e senha.
2. Se o usuário é administrador **ou** tem fator cadastrado, a tela pede o código de 6 dígitos (desafio TOTP).
3. Administrador sem fator cadastrado vai direto para a tela de cadastro do fator (QR code). Até concluir, não vê dados.
4. Na tela (`getAuthenticatorAssuranceLevel`), o sistema mostra o que falta. Mas **a proteção real é o banco**: se alguém pular a tela, o banco devolve zero linhas.

## Recuperação de acesso

- **Cadastrar 2 fatores** por administrador (ex.: celular e um segundo aparelho), ou ter **2 administradores**. Recomendo os dois.
- **Se perder tudo:** o dono da conta Supabase remove o fator pelo painel (Authentication → Users). Essa conta também é protegida por MFA (passo a passo, parte A).

## Fora do sistema: as contas que mandam em tudo

As contas **Supabase** (dono da organização) e **GitHub** estão acima de qualquer regra do sistema: quem
entra nelas pode tudo. Por isso o passo a passo começa ativando 2 etapas nas duas. O Supabase também
registra os eventos de login no log de auditoria do Auth.

## Ajustes do Auth no painel

- Cadastro público **desligado**.
- Confirmação de e-mail **ligada**.
- Login anônimo **desligado**.
- Senha com mínimo de 12 caracteres, exigindo letras e números.
- MFA TOTP **ligado**; MFA por SMS desligado (é cobrado).
- URLs permitidas: apenas o endereço do GitHub Pages (e `localhost`, para testes).
- Recursos de sessão do plano Pro (encerrar sessão por inatividade, proteção contra senhas vazadas) entram quando o plano mudar (D2).

## Futuras Edge Functions (Etapa 3+)

Toda Edge Function chamada por usuário vai:
- validar o token no servidor;
- ler `aal` e papel no banco (**nunca** confiar em parâmetros enviados pela tela);
- recusar operação administrativa sem `aal2`.

Rotinas automáticas (sincronização com a Nuvemshop) usam a secret key no servidor e não passam pela tela.

## Matriz de acesso (v2)

Visitante não logado: **nada**. Administrador sempre em `aal2` (M1).

| Tabela / ação | Operador | Administrador |
|---|---|---|
| `perfis` | vê o próprio | vê todos; papel e ativo via `alterar_papel()` |
| `configuracoes`, `produtos.ciclo_recompra_dias` | lê | lê e altera |
| `clientes` | lê; altera só `status_comercial` (permissão por coluna) | idem |
| `pedidos`, `pedido_itens`, `cupons` | lê | lê. Gravação só pela sincronização (Etapa 3) |
| `leads`, `interacoes`, `bases_tratamento` | lê, inclui, altera (interações: só inclui) | idem |
| `permissoes_comunicacao`, `oposicoes` | lê e inclui. Ninguém altera nem apaga | idem |
| `sugestoes_vinculo` | lead→cliente: decide | decide todas; associa e desassocia clientes |
| `campanhas`, `campanha_destinatarios` | cria, edita, marca envio (`marcar_envio()`) | idem + exclui rascunho |
| `auditoria` | — | lê (registros sem dados pessoais, ver 05) |
| Exportar, anonimizar, retenção, solicitações de titular | — | ✅ com confirmação recente (M4) |
| Apagar dados fictícios | — | ✅ com confirmação recente (M4) |

**Testes automatizados de RLS** (entregáveis): para visitante, operador `aal1`, operador `aal2`,
administrador `aal1` e administrador `aal2`, cada permissão negada na matriz precisa falhar. Cada
permitida precisa funcionar.
