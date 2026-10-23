# 01 — Plano da Etapa 2 (v2, corrigido)

**Status: aguardando aprovação. Nenhuma migração executada, nenhum dado criado, aplicação inalterada.**

## Já aprovado (23/10/2026)

- Projeto Supabase exclusivo, PostgreSQL, autenticação real, RLS.
- Integração futura com a Nuvemshop (Etapa 3).
- Preservação das 7 telas existentes.

## Condições desta etapa

- Preservar as 7 telas.
- Não recriar o projeto.
- **Não alterar o ALTUM Content Intelligence** (outro projeto Supabase, outra organização se necessário, outro repositório, outras chaves; nada compartilhado).
- Só dados fictícios.
- Nuvemshop desconectada.
- Nenhuma credencial privada no código.
- Estrutura pronta para a integração.
- Tudo documentado nesta pasta.

## As 5 correções

| # | Ponto | v1 | v2 | Detalhe |
|---|---|---|---|---|
| 1 | Duplicidade | E-mail e telefone únicos | Únicos só os IDs da Nuvemshop. E-mail e telefone sugerem; uma pessoa decide; associação reversível | [02](02-MODELO-DE-DADOS-E-IDENTIDADE.md) |
| 2 | Consentimento | "Consentimento" único bloqueava o funil | Finalidade, base legal e autorização promocional separadas, por canal. O funil exige base para **atender**; campanha exige autorização **promocional** | [03](03-CONSENTIMENTO-E-BASES-LEGAIS.md) |
| 3 | Auditoria e LGPD | Auditoria com cópia "antes/depois" (dados pessoais eternos) | Auditoria sem dados pessoais (lista permitida); anonimização com supressão; retenção revisada pelo admin; solicitações de titular; reaplicação após restauração | [05](05-LGPD-AUDITORIA-RETENCAO.md) |
| 4 | MFA | Exigido só na tela | `aal2` validado pelo banco em toda política e função administrativa; admin sem `aal2` não acessa nada; confirmação recente para ações irreversíveis | [04](04-SEGURANCA-AUTENTICACAO-MFA-RLS.md) |
| 5 | Backup | "pg_dump + gpg", sem prova | Método oficial do Supabase via Session pooler; chave pública `age`; manifesto; restauração automática semanal; 4 critérios de aceite; prova de conceito antes | [06](06-BACKUP-E-RESTAURACAO.md) |

## Mantido da v1

- Login por e-mail e senha, cadastro público desligado, convite pelo painel do Supabase.
- Perfis administrador/operador.
- `store.js` com cache em memória:
  - as leituras continuam síncronas, então telas e indicadores não mudam;
  - as gravações passam a ser assíncronas, com aviso de erro;
  - o carregamento é feito em páginas de 1.000 linhas.
- `supabase-js` v2 com versão fixa via CDN; sem build.
- Publishable key no `config.js`.
- Faixa "dados fictícios" controlada pelos dados (`fonte = 'ficticio'`) e função para apagar só o fictício antes da Etapa 3.
- Migrações SQL numeradas, nunca editadas depois de aplicadas.
- Região São Paulo.

## Decisões para aprovar

| # | Decisão | Recomendação |
|---|---|---|
| D1 | Projeto | Novo, exclusivo. Organização separada se a atual já tiver 2 projetos ativos |
| D2 | Plano | Gratuito na Etapa 2 (dados fictícios). Pro (US$ 25/mês) antes de dados reais. Não altera nada agora |
| D3 | MFA dos administradores | Obrigatório, validado pelo banco (regras M1 a M6) |
| D4 | Dados no banco | Base fictícia marcada; apagada antes da Etapa 3 |
| D5 | Retenção | Prazos do arquivo 05; nesta etapa só lista, admin aprova a execução |
| D6 | Região | São Paulo |
| **D7** (nova) | MFA dos operadores | Opcional agora, exigido se cadastrado. *Alternativa mais segura:* obrigatório para todos |
| **D8** (nova) | Marketing promocional | Somente com consentimento por canal (não usar legítimo interesse para marketing) |
| **D9** (nova) | Repositório do app | **Público** é aceitável: não contém segredos nem dados; Pages em repositório privado exige plano pago do GitHub. **O repositório de backup é sempre privado** |

## Ordem de execução (após aprovação)

1. Você executa as partes A a F do [passo a passo](07-PASSO-A-PASSO-SUPABASE.md) (só configuração, sem dados).
2. **Prova de conceito** do backup e do MFA (arquivo 06), com tabelas e dados fictícios mínimos. Relatório: confirmado ou alternativa.
3. Migrações `001` a `009`, entregues como arquivos para você colar no editor SQL, na ordem:

   | Migração | Conteúdo |
   |---|---|
   | 001 | Extensões e schema `app` |
   | 002 | Perfis, configurações, gatilho de convite |
   | 003 | Catálogo, clientes, pedidos, grupos |
   | 004 | Leads, interações, sugestões de vínculo |
   | 005 | Bases de tratamento, permissões, oposições, textos |
   | 006 | Campanhas |
   | 007 | Auditoria, supressões, retenção, solicitações |
   | 008 | Funções (`marcar_envio`, `anonimizar_titular`, `alterar_papel`, …) e RLS completa |
   | 009 | `pg_cron` de retenção |

4. Carga fictícia (`010_seed_ficticio.sql`), marcada `fonte = 'ficticio'`.
5. Aplicação:
   - `store.js` conectado;
   - login, MFA e usuários;
   - ajustes nas telas descritos nos arquivos 02, 03 e 05 (as 7 telas continuam).
6. Testes:
   - RLS (5 tipos de acesso × matriz);
   - auditoria automatizada das 7 telas (101 verificações da Etapa 1, adaptadas);
   - fluxos de consentimento, vínculo e anonimização;
   - **teste de que a auditoria não contém dados pessoais** (busca por nomes e e-mails fictícios dentro da tabela de auditoria: precisa dar zero).
7. Backup:
   - 7 dias de execução;
   - restauração automática;
   - restauração completa;
   - abertura com a sua chave.

## Critérios de conclusão da Etapa 2

- [ ] Todas as migrações aplicadas sem erro; RLS ativo em 100% das tabelas (verificado por consulta).
- [ ] Testes de RLS aprovados para visitante, operador `aal1`/`aal2` e admin `aal1`/`aal2`.
- [ ] Auditoria das 7 telas aprovada com dados vindos do Supabase.
- [ ] Zero dado pessoal na tabela de auditoria.
- [ ] Anonimização testada, inclusive a reaplicação após restauração.
- [ ] Os 4 critérios de aceite do backup.
- [ ] Nenhum segredo no repositório do app (varredura automática por padrões de chave).

## Estrutura de arquivos que será criada (organização)

```
supabase/migrations/001_…sql … 010_seed_ficticio.sql
supabase/testes/rls.sql e testes de anonimização
supabase/CHECKLIST-CONFIGURACAO.md     (tudo que o dump não leva)
backup/.github/workflows/backup.yml     (vai para o repositório PRIVADO de backup)
backup/RESTAURACAO.md
docs/etapa-2/                           (este planejamento)
docs/etapa-2/RELATORIO-POC.md           (após a prova de conceito)
```
