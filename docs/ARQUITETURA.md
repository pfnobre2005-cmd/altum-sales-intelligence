# ALTUM Sales Intelligence — Arquitetura técnica (resumo)

## Visão geral

```
┌────────────────────────────┐        ┌──────────────────────────────────────┐
│  GitHub Pages (frontend)   │        │  Supabase                            │
│  HTML + CSS + JS puro      │  HTTPS │  ├─ Auth (login, perfis admin/oper.) │
│  - telas (views)           │ ─────► │  ├─ PostgreSQL + Row Level Security  │
│  - regras de análise       │        │  ├─ Edge Functions (backend seguro)  │
│  - usa só a chave "anon"   │        │  │    └─ guarda o token Nuvemshop    │
└────────────────────────────┘        │  └─ Cron / webhooks (sincronização)  │
                                      └──────────────┬───────────────────────┘
                                                     │ token privado (só aqui)
                                                     ▼
                                      ┌──────────────────────────────────────┐
                                      │  API oficial Nuvemshop               │
                                      │  (clientes, pedidos, produtos,       │
                                      │   cupons, webhooks)                  │
                                      └──────────────────────────────────────┘
```

## Camadas do frontend

| Camada | Arquivo(s) | Responsabilidade | Muda nas próximas etapas? |
|---|---|---|---|
| Configuração | `assets/js/config.js` | Modo de dados, URL/publishable key do Supabase (Etapa 2), listas de domínio | Sim, só valores |
| Dados | `assets/js/store.js` | Lê/grava dados. Hoje: navegador (localStorage). Etapa 2: Supabase | Sim — única troca grande |
| Dados fictícios | `assets/js/mock-data.js` | Gera a base de teste, marcada como `fonte: ficticio` | Some na Etapa 3 |
| Regras de negócio | `assets/js/analytics.js` | KPIs, segmentos, recompra, hipóteses — funções puras | Não (reaproveitadas) |
| Compliance | `assets/js/compliance.js` | Checagem de termos proibidos (RDC 243/2018, IN 28/2018) e LGPD nas mensagens | Ampliável |
| Interface | `assets/js/ui.js`, `assets/js/views/*.js`, `assets/js/app.js` | Componentes, telas e navegação | Não |

O ponto central do desenho: **as telas e as regras de análise não sabem de onde vêm os dados**.
Na Etapa 2 troca-se só o `store.js` (localStorage → Supabase); na Etapa 3 os dados reais chegam
pelas Edge Functions e o gerador fictício é desligado.

## Modelo de dados (rascunho da Etapa 1)

> **Superado** pelo modelo da Etapa 2 v2: [`etapa-2/02-MODELO-DE-DADOS-E-IDENTIDADE.md`](etapa-2/02-MODELO-DE-DADOS-E-IDENTIDADE.md).
> Em especial: e-mail e telefone **não** são únicos; auditoria **não** guarda dados pessoais.

- `clientes` — id, nuvemshop_id (único), nome, email, telefone, cidade, uf, origem, status_comercial, criado_em
- `consentimentos` — cliente_id, canal (whatsapp/email), concedido (bool), fonte, atualizado_em  *(histórico, não sobrescreve)*
- `pedidos` — id, nuvemshop_id (único), cliente_id, data, status, subtotal, desconto, total, cupom
- `pedido_itens` — pedido_id, produto_id, qtd, preco_unit
- `produtos` — id, nuvemshop_id, nome, categoria, preco, ciclo_recompra_dias
- `interacoes` — cliente_id ou lead_id, data, canal, nota, autor
- `leads` — nome, origem, telefone, email, empresa, etapa, consentimento, proximo_contato, valor_potencial
- `campanhas` + `campanha_destinatarios` — público, canal, cupom, mensagem, enviado_em (marcação manual)
- `auditoria` — usuário, ação, detalhe, data
- `sync_execucoes` — início, fim, registros, erros (para reconciliação)

Chaves únicas em `nuvemshop_id` e em e-mail/telefone normalizados evitam duplicidade.

## Segurança (regras que valem desde já)

1. **Nenhum token da Nuvemshop no frontend ou no GitHub.** Ele fica em *secrets* das Edge Functions.
2. No frontend só entra a **publishable key** do Supabase (`sb_publishable_…`, pública por design; substitui a antiga
   anon key, descontinuada até o fim de 2026); quem protege os dados é o **RLS** — sem login válido, nenhuma linha é retornada.
3. A **secret key** (`sb_secret_…`, antiga service_role) **nunca** vai para o repositório.
4. Perfis: **admin** (configurações, exclusão/anonimização, backup) e **operador** (CRM do dia a dia).
5. Consentimento de marketing é separado do dado necessário para atendimento (LGPD).

## O que é real e o que é simulado nesta etapa

| Item | Etapa 1 |
|---|---|
| Telas, navegação, filtros, funil, campanhas, cálculos | Funcionais |
| Dados | **Fictícios**, gerados no navegador, salvos só no seu navegador |
| Login e perfis | Simulados (seletor admin/operador) — real na Etapa 2 |
| Nuvemshop | Não conectada — Etapa 3 |
| Envio de mensagens | Não existe (por regra da V1): mensagem é copiada e o envio é marcado à mão |
