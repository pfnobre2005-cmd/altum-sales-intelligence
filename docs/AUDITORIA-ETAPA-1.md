# Auditoria da Etapa 1 — 22/10/2026

Método: testes automatizados num navegador real (Chromium), em desktop (1400 px) e celular (390 px).

- **Indicadores:** cada indicador da tela foi comparado com um **recálculo independente**, escrito em outro programa (Python) a partir da mesma base fictícia. Assim o sistema não confere a si mesmo.
- **Botões:** todos os controles das 7 telas foram clicados, um a um, para encontrar os que não fazem nada.
- **Fluxos:** 21 fluxos de uso foram testados de ponta a ponta.

## Resultado final (após as correções)

| Bloco | Verificações | Resultado |
|---|---|---|
| Dashboard: 8 KPIs × 4 períodos, variação de faturamento, gráfico mensal, follow-ups | 38 | ✅ todos iguais ao recálculo |
| Clientes: filtros de segmento e permissão, busca, ordenação, números da ficha | 12 | ✅ |
| Recompra: contagem dos 6 segmentos | 6 | ✅ |
| Funil: contagem das 7 colunas | 7 | ✅ |
| Campanhas: destinatários, envios, compradores, conversão, receita; permissão dos destinatários | 6 | ✅ |
| Inteligência: tabela de produtos (compradores, recompradores, presença, receita) | 7 | ✅ |
| Sinalização "dados fictícios": 9 rotas × 2 tamanhos de tela, exportações, telefones e e-mails | 22 | ✅ |
| Botões: 197 controles clicados | 197 | ✅ 195 com efeito; os 2 restantes são comportamento esperado (ver abaixo) |
| Fluxos ponta a ponta (gravar, bloquear, auditar, perfis, anonimizar, celular) | 21 | ✅ |

Os 2 controles "sem efeito" são esperados:
- **"Registrar" com o campo vazio:** é barrado pela validação de campo obrigatório.
- **Segmento de recompra já selecionado:** clicar nele de novo não muda nada.

O arrastar e soltar do funil foi conferido com movimento real do mouse. No celular, a etapa é trocada dentro do cartão, porque o arrastar não funciona em tela de toque.

## Problemas encontrados e corrigidos

| # | Problema | Gravidade | Correção |
|---|---|---|---|
| 1 | Telefones fictícios no formato de celular real de SP (`+55 11 90000-xxxx`). Copiar uma mensagem e enviar poderia atingir uma pessoa real | **Alta** | Telefones com DDD 00, que não existe |
| 2 | Campanha fictícia "Clientes fiéis" (WhatsApp) incluía 5 clientes que só autorizaram e-mail | Média | Gerador corrigido: só entra quem autorizou o canal da campanha |
| 3 | Três telas gravavam dados direto na memória, sem passar pela camada de dados: marcar envio, observação do funil, regras e ciclos. Com o Supabase, essas gravações se perderiam | **Alta (arquitetura)** | Novos métodos no `store.js`: `marcarEnvio`, `addObservacaoLead`, `setRegras`, `setCiclos`. Nenhuma tela grava mais diretamente |
| 4 | A tela do funil dependia do gerador fictício para a lista de origens | Média (arquitetura) | Lista movida para `config.js`. Nenhuma tela usa mais o gerador |
| 5 | Hipótese H1 comparava a "recompra do mesmo produto" com a "recompra de qualquer produto", que são indicadores diferentes | Média | Agora compara com a média do mesmo indicador e só aparece se a diferença for de 5 p.p. ou mais. H3 exige 2+ campanhas; H4 exige diferença de 5 p.p. ou mais |
| 6 | "Recorrente" com três sentidos diferentes (dashboard, filtro de clientes, segmento de recompra) | Baixa | Rótulos explícitos: "acumulado" no dashboard, "Recorrentes ativos" em recompra, faixas de pedidos no filtro |
| 7 | No funil, um avanço bloqueado (sem consentimento) gravava a observação mesmo assim, e salvar de novo a duplicava | Baixa | A validação acontece antes de gravar |
| 8 | Trocar o objetivo da campanha apagava o texto já editado | Baixa | Só troca o texto se ele ainda for um modelo |
| 9 | Campo "valor potencial" do funil não aparecia em lugar nenhum | Baixa | Soma do potencial em aberto exibida no funil |

A versão da base fictícia passou para 2. Quem já abriu o protótipo recebe uma base nova automaticamente.

## Prontidão para dados reais

- **Telas e indicadores:** nenhuma tela ou cálculo depende do gerador fictício (conferido por busca no código). Indicadores e telas leem tudo pela camada `store`.
- **Gravações:** todas passam pela `store`, que registra auditoria em cada uma.
- **Ponto ainda aberto (tratado no plano da Etapa 2):** a `store` hoje é **síncrona** e o Supabase é **assíncrono**. Solução planejada: carregar os dados num cache em memória após o login. As telas continuam síncronas e as gravações passam a ser assíncronas, com aviso de erro.
- **Identificação da Nuvemshop:** o modelo já previa `nuvemshop_id` em clientes, pedidos e produtos. A Etapa 2 cria essas colunas já com índice único.
