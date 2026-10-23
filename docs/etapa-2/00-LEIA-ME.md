# Etapa 2 — Supabase · índice

| Arquivo | Conteúdo |
|---|---|
| [01-PLANO-CORRIGIDO.md](01-PLANO-CORRIGIDO.md) | Visão geral, as 5 correções, decisões para aprovar, ordem de execução, critérios de conclusão |
| [02-MODELO-DE-DADOS-E-IDENTIDADE.md](02-MODELO-DE-DADOS-E-IDENTIDADE.md) | Tabelas, chaves da Nuvemshop, duplicidade e vinculação de registros (correção 1) |
| [03-CONSENTIMENTO-E-BASES-LEGAIS.md](03-CONSENTIMENTO-E-BASES-LEGAIS.md) | Finalidades, bases legais, permissões por canal, regras do funil (correção 2) |
| [04-SEGURANCA-AUTENTICACAO-MFA-RLS.md](04-SEGURANCA-AUTENTICACAO-MFA-RLS.md) | Login, MFA validado pelo banco (`aal2`), matriz de acesso RLS (correção 4) |
| [05-LGPD-AUDITORIA-RETENCAO.md](05-LGPD-AUDITORIA-RETENCAO.md) | Auditoria sem dados pessoais, anonimização, supressão, retenção, titulares (correção 3) |
| [06-BACKUP-E-RESTAURACAO.md](06-BACKUP-E-RESTAURACAO.md) | Viabilidade, criptografia, credenciais, restauração, testes e critérios de aceite (correção 5) |
| [07-PASSO-A-PASSO-SUPABASE.md](07-PASSO-A-PASSO-SUPABASE.md) | O que você faz manualmente, o que enviar e o que nunca enviar |

## Histórico

| Versão | Data | Situação |
|---|---|---|
| v1 | 22/10/2026 | Arquitetura geral aprovada em 23/10; 5 pontos devolvidos para correção → [historico/PLANO-ETAPA-2-v1.md](../historico/PLANO-ETAPA-2-v1.md) |
| **v2** | 23/10/2026 | **Aguardando aprovação.** Corrige os 5 pontos. Nada executado |

Fontes técnicas consultadas: documentação oficial do Supabase sobre MFA (`aal` e políticas restritivas), backup e
restauração pelo CLI, compatibilidade IPv4/IPv6 e novas chaves de API.
