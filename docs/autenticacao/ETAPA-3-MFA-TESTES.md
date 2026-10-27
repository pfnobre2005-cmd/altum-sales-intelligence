# Etapa 3 — Verificação em 2 etapas (TOTP), perfil real e sessão

Versão do app: `0.3.0-auth-mfa`. Nenhuma migração alterada; Nuvemshop não conectada;
as 7 telas continuam com dados FICTÍCIOS (conexão ao banco é a próxima etapa).

## O que mudou
| Situação | Comportamento |
|---|---|
| Login sem autenticador cadastrado | Tela **"Ative a verificação em 2 etapas"**: QR Code + chave manual + código de 6 dígitos |
| Login com autenticador | Tela **"Verificação em 2 etapas"** pedindo o código (sem novo QR) |
| Código certo (sessão **aal2**) + perfil **ativo** no banco | As 7 telas abrem. Barra lateral: nome, e-mail, papel e **Sair** |
| Perfil desativado ou inexistente | Sai e mostra "conta desativada ou sem acesso" |
| Papel | Lido de `public.perfis` (admin/operador). Não há seletor; não dá para trocar pelo console |
| Recuperação de senha em conta com 2 etapas | Pede o código **antes** do formulário de nova senha |
| 30 min sem uso | Aviso 1 min antes; depois a sessão é encerrada (vale também com a aba recarregada) |
| Fechar a aba | Sessão termina (sessionStorage) |

## Antes de testar (painel Supabase)
1. **Authentication → Multi-Factor** (ou "MFA"): **TOTP (App Authenticator)** = *Enabled*.
2. Para testar como administrador, confirme o papel no **SQL Editor**:
   ```sql
   select u.email, p.papel, p.ativo from public.perfis p join auth.users u on u.id = p.id;
   ```
   Se aparecer `operador` e você quiser ser `admin`, rode o SQL do passo **D** do guia da Etapa 0.

## Publicação
GitHub → repositório → **Add file → Upload files** → arraste o conteúdo do .zip mantendo as pastas → **Commit changes**.
Aguarde a aba **Actions** ficar verde (1–2 min) e abra o site com **Ctrl+Shift+R** (ou janela anônima).

## Roteiro de teste (≈10 min, celular com app autenticador à mão)
Use **uma aba só** durante o cadastro (abrir em outra aba gera outro QR e invalida o anterior).

| # | Faça | Resultado esperado |
|---|---|---|
| 1 | Abra o site e entre com e-mail e senha | Tela "Ative a verificação em 2 etapas" com QR Code |
| 2 | No app autenticador: adicionar → ler QR Code | Aparece **ALTUM Sales Intelligence** com 6 dígitos |
| 3 | Digite um código **errado** (ex.: 000000) → Ativar | "Código incorreto…"; nada abre |
| 4 | Digite o código **atual** → Ativar e entrar | As 7 telas abrem; barra lateral mostra seu nome, e-mail e papel |
| 5 | Confira o papel na barra lateral | Igual ao do SQL acima (Administrador ou Operador) |
| 6 | Em Integrações & dados, veja "Recriar base fictícia" | Admin: habilitado · Operador: desabilitado |
| 7 | Recarregue a página (F5) | Continua dentro, sem pedir código |
| 8 | Clique **Sair** | Volta ao login |
| 9 | Entre de novo com e-mail e senha | Agora pede **só o código** (sem QR) → digite → telas abrem |
| 10 | Feche a aba, abra o site numa aba nova | Pede login de novo |
| 11 | Opcional: entre (senha + código) e deixe parado **30 min** | Aos 29 min aparece aviso; aos 30, volta ao login com "sessão encerrada… sem atividade" |
| 12 | Opcional: Users → seu usuário → "Send password recovery" → abrir link | Pede o **código** antes da nova senha |
| 13 | SQL Editor: confirme o fator ativo | `select factor_type, status from auth.mfa_factors where user_id = (select id from auth.users where email = 'contato@altumnutrition.com.br');` → `totp | verified` |


## Se der errado
- **"Código incorreto" com o código certo:** ative data/hora automática no celular.
- **"A verificação em 2 etapas (TOTP) não está habilitada"**: passo 1 de "Antes de testar".
- **Perdeu o celular/app autenticador (emergência, só pelo administrador no SQL Editor):**
  ```sql
  delete from auth.mfa_factors
   where user_id = (select id from auth.users where email = 'EMAIL-DO-USUARIO');
  ```
  No próximo login o usuário cadastra um novo QR Code. Use só após confirmar a identidade da pessoa.

## Testes automáticos executados (navegador real, Supabase simulado)
- 34 testes desta etapa: cadastro com QR (descarta QR não confirmado), código incompleto/errado/certo,
  liberação só com aal2 + perfil ativo, operador × admin, perfil desativado/inexistente/erro de rede,
  tentativa de abrir telas ou virar admin pelo console, recuperação com 2 etapas, aviso e encerramento
  por inatividade (com as telas abertas, na tela de código e com a aba reaberta), nome com HTML exibido
  como texto, nenhuma violação de CSP.
- 35 testes da etapa anterior repetidos (links, limpeza do token, regras de senha, login, sessão na aba).

## Limites conhecidos
- As telas ainda usam dados fictícios do navegador; a proteção real dos dados de clientes é o RLS (aal2), que entra em uso na conexão das telas ao banco.
- O bloqueio pelo console é proteção de interface; quem garante as permissões é o banco.
- Não há códigos de recuperação do autenticador; a recuperação é pelo administrador (SQL acima).
