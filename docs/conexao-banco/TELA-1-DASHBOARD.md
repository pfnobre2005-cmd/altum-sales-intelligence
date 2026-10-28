# Conexão ao banco — Tela 1: Dashboard comercial

Versão do app: `0.6.0-dashboard`. **Sem mudança no banco** (migrações 001–011 intactas). Nuvemshop não conectada.
Produtos, login, 2 etapas, papéis, bloqueio por inatividade e as outras 6 telas: sem mudança.

## 1. Origem dos dados — real × fictícia (nunca misturadas)
| Visão | Registros (coluna `fonte`) | Quando aparece |
|---|---|---|
| **Dados reais** (padrão) | manual, nuvemshop, importacao | sempre; sem registros reais → **estado vazio informativo**, sem números |
| **Dados fictícios (teste)** | ficticio (carga da 010) | botão "Ver dados fictícios de teste" / seletor no topo, **só enquanto existirem fictícios** no banco; faixa laranja "DADOS FICTÍCIOS DE TESTE" e selo no topo sempre visíveis |

- O filtro por origem é feito **no banco** (clientes, pedidos e leads) e conferido de novo na tela.
- Pedido de uma origem ligado a cliente de outra: **fora** de todos os indicadores, com aviso da quantidade.
- Recompra: só clientes **e** produtos da origem escolhida.
- Para esconder a visão de teste antes da remoção dos fictícios: `assets/js/config.js` → `dashboard.permitirFicticios: false`.

## 2. Indicadores (período escolhido × período anterior de mesmo tamanho; datas em Brasília)
| Indicador | Regra | Sem registros |
|---|---|---|
| Clientes cadastrados | cadastro até o fim do período; mostra **identificáveis · anonimizados** (soma = total, sem contagem dupla) | 0 é fato (há base) |
| Novos | 1º pedido pago dentro do período | — |
| Recorrentes | 2+ pedidos pagos até o fim do período (acumulado) | — |
| Inativos | último pedido pago há mais dias que a regra (padrão 90) | — |
| Faturamento | soma de `total` dos pedidos pagos no período | "nenhum pedido pago no período" |
| Ticket médio | faturamento ÷ pedidos | **"—"** |
| Taxa de recompra | recorrentes ÷ clientes com 1+ pedido pago | **"—"** |
| Oportunidades | clientes na janela (`v_oportunidades_recompra`: produto ativo, sem anonimizados, sem "não contatar") + follow-ups vencidos/hoje | 0 |
| Comparação | só se o período anterior tem base | **"sem base de comparação"** |

Clientes anonimizados: contados no histórico (pedidos mantidos pela 008), **sem nome nem dado pessoal** (o banco guarda nulo); quando entram em novos/recorrentes/inativos, a dica informa quantos.

## 3. Segurança
Leituras somente para usuário ativo com 2 etapas (RLS 003/004/006/008); operador e administrador veem os mesmos números.
Sem 2 etapas o banco devolve vazio: a tela detecta e mostra erro, nunca zeros. Falha de rede/sessão: nenhum número parcial.
Nenhum e-mail, telefone ou custo é pedido ao banco. Dados só na memória da aba (nada no localStorage).

## 4. Publicação
GitHub → **Add file → Upload files** → arraste o conteúdo do .zip (mantendo pastas) → **Commit changes** → Actions verde → **Ctrl+Shift+R**.

## 5. Roteiro de validação (≈10 min)
| # | Faça | Esperado |
|---|---|---|
| 1 | Entre e abra o Dashboard | Abre em **Dados reais**: "Ainda não há dados comerciais reais", sem números; botão "Ver dados fictícios de teste" |
| 2 | Clique o botão | Faixa laranja **DADOS FICTÍCIOS DE TESTE**; selo do topo "Dados FICTÍCIOS de teste"; indicadores aparecem |
| 3 | Rode o SQL abaixo com `'ficticio'` e `30` | Números iguais aos da tela (faturamento arredondado; oportunidades = na_janela_recompra + follow_ups) |
| 4 | Clique 90 / 180 / 12 meses e rode o SQL com `90`, `180`, `365` | Iguais |
| 5 | Clique "Dados reais" | Volta ao estado vazio, sem a faixa laranja |
| 6 | Entre como operador (se houver) | Mesmos números |
| 7 | Abra Produtos | Funciona como antes |

### SQL de conferência (SQL Editor → New query → Run). Somente leitura.
```sql
-- Conferência do Dashboard — SOMENTE LEITURA. Troque os 2 valores da linha "par":
--   origem: 'real' ou 'ficticio'   ·   dias: 30, 90, 180 ou 365
with par as (select 'ficticio'::text as origem, 30 as dias, (now() at time zone 'America/Sao_Paulo')::date as hoje),
per as (select hoje - dias + 1 as s, hoje as e from par),
cli as (select c.id, c.cadastrado_em, c.anonimizado_em is not null as anon
          from public.clientes c, par where (c.fonte = 'ficticio') = (par.origem = 'ficticio')),
ped as (select p.cliente_id, p.total, (p.data_pedido at time zone 'America/Sao_Paulo')::date as dia, cli.anon
          from public.pedidos p join cli on cli.id = p.cliente_id, par
         where p.status = 'pago' and (p.fonte = 'ficticio') = (par.origem = 'ficticio')),
ate as (select cliente_id, bool_or(anon) as anon, count(*) n, min(dia) primeira, max(dia) ultima
          from ped, per where dia <= per.e group by cliente_id)
select
  (select origem from par)                                                                    as origem,
  (select count(*) from cli, per where (cli.cadastrado_em at time zone 'America/Sao_Paulo')::date <= per.e) as clientes_cadastrados,
  (select count(*) from cli, per where (cli.cadastrado_em at time zone 'America/Sao_Paulo')::date <= per.e and cli.anon) as dos_quais_anonimizados,
  (select count(*) from ate, per where primeira between per.s and per.e)                      as novos_clientes,
  (select count(*) from ate where n >= 2)                                                     as clientes_recorrentes,
  (select count(*) from ate, per, public.configuracoes cfg where per.e - ultima > cfg.inativo_apos_dias) as clientes_inativos,
  (select round(coalesce(sum(total), 0)) from ped, per where dia between per.s and per.e)      as faturamento,
  (select count(*) from ped, per where dia between per.s and per.e)                           as pedidos,
  (select round(avg(total), 2) from ped, per where dia between per.s and per.e)               as ticket_medio,          -- vazio = "—" na tela
  (select round(100.0 * count(*) filter (where n >= 2) / nullif(count(*), 0), 1) from ate)    as taxa_recompra_pct,     -- vazio = "—" na tela
  (select count(distinct v.cliente_id) from public.v_oportunidades_recompra v
     join public.clientes c on c.id = v.cliente_id join public.produtos pr on pr.id = v.produto_id, par
    where v.situacao = 'janela' and c.status_comercial <> 'nao_contatar' and c.anonimizado_em is null
      and (c.fonte = 'ficticio') = (par.origem = 'ficticio') and (pr.fonte = 'ficticio') = (par.origem = 'ficticio')) as na_janela_recompra,
  (select count(*) from public.leads l, par where l.anonimizado_em is null and l.etapa not in ('comprou', 'perdido')
      and l.proximo_contato <= par.hoje and (l.fonte = 'ficticio') = (par.origem = 'ficticio'))  as follow_ups;
```
Observação: a visão de recompra usa a data do servidor (UTC); entre 21h e 0h (Brasília) "na janela" pode diferir em 1 dia — confira fora desse horário.

## 6. Testes automáticos executados (navegador real → PostgREST real → Postgres com 001–011)
**43 testes do Dashboard**, todos passaram:
- banco sem dados reais: estado vazio, botão, selo, sem NaN/null; visão fictícia nos 4 períodos × 8 indicadores conferida com SQL independente; janela, follow-ups e gráfico mensal;
- banco com **dados reais controlados** (5 clientes, 1 anonimizado; pedidos com valores conhecidos; pedido cancelado; pedido real ligado a cliente fictício; leads vencido/futuro/perdido): valores calculados à mão (30d: 5 clientes = 4 + 1 anonimizado, 1 novo, 2 recorrentes, 1 inativo, R$ 230, R$ 76,67, 50,0 %, 2 oportunidades) e os 4 períodos conferidos com SQL;
- separação: pedido de outra origem fora e informado; visão fictícia inalterada pelos reais;
- real só com cliente sem pedido: "—", "nenhum pedido pago", "sem base de comparação";
- produto desativado sai da recompra; "não contatar" e anonimizado fora; anonimizado sem nome;
- operador = administrador; paginação (40 linhas/resposta); sem 2 etapas → erro; falha de rede → nada parcial;
- `permitirFicticios: false` e banco **sem** fictícios → sem botão de teste;
- outras 6 telas sem consulta ao banco; Produtos lendo o banco; sem violação de CSP; nada no localStorage.
Teste de mutação: removido o filtro de origem → os testes falham (e a conferência da tela recusa exibir números).
Regressão: Produtos (35), 2 etapas (34) e login (35) — todos passaram.
