# Tela 3 — Recompra: revisão, publicação e testes

Versão do app: `0.8.0-recompra` · Banco: migração `013_recompra_operacional.sql` (requer a 012 revisão 2).
Dashboard, Clientes, Produtos e Recompra leem o Supabase. Funil, Campanhas, Inteligência e Integrações continuam na base local.
**A Nuvemshop não está conectada e a tela não envia mensagem nenhuma.**

## 1. O que a tela faz
- **Lista de oportunidades por cliente × produto:** cliente, produto (SKU), última compra paga daquele produto (quantidade e nº de compras), ciclo de reposição, data estimada, dias restantes ("em 5 dias" / "há 3 dias"), situação, canais permitidos e acompanhamento.
- **Data estimada** = última compra paga do produto + ciclo do produto (Tela Produtos) × quantidade comprada.
- **Situação** (regras de Integrações & dados): *Na janela* (de N dias antes a M dias depois da data estimada), *Atrasada*, *Antes da janela*, *Cliente inativo* (sem nenhuma compra há mais que o limite de inatividade).
- **Contadores** por situação + *Ações vencidas*; clicar filtra. Os contadores respeitam os demais filtros.
- **Filtros (no servidor):** busca por nome do cliente, situação, acompanhamento (padrão: *Abertas*), produto, possibilidade de contato (WhatsApp, e-mail, algum canal, nenhum), período da data estimada, ordenação. 25 por página.
- **Ficam fora automaticamente:** produtos desativados ou sem ciclo, clientes anonimizados, com qualquer oposição ativa ou em "não contatar", pedidos não pagos (cancelado, pendente, reembolsado) e qualquer mistura de origem (pedido fictício de cliente real, produto fictício em pedido real, etc.).
- **Real × fictício:** "Dados reais" é o padrão; "Dados fictícios (teste)" mostra a carga da 010 com aviso — **somente leitura**.
- **Detalhe da oportunidade:** resumo, canais permitidos, botão *Mostrar contato permitido* (lê **só** o dado do canal permitido: telefone se WhatsApp permitido, e-mail se e-mail permitido), histórico de acompanhamento deste produto (todos os ciclos) e últimas interações do cliente — tudo **somente leitura**.
- **Registrar acompanhamento** (operador e administrador com 2 etapas): quem iniciou (empresa/cliente), canal, resultado, próxima ação + data (até 180 dias) quando o resultado deixa a oportunidade aberta, anotação opcional.
  - Contato **feito pela empresa**: só aparecem os canais com permissão atual; sem canal permitido, a empresa não pode registrar contato iniciado por ela.
  - **Pediu para não ser contatado** → o banco registra a oposição; o cliente vai para "não contatar" e sai da recompra e das campanhas (só o admin encerra a oposição, na ficha).
  - Se outra pessoa registrou antes, ou a oportunidade mudou (nova compra, produto desativado…), o registro é recusado com mensagem e a lista é atualizada — nada é sobrescrito.
  - Cada registro também aparece como **interação** na ficha do cliente.
- **Nuvemshop (preparado, não conectado):** a lista mostra a origem do cliente quando não for cadastro manual; pedidos da loja entrarão sozinhos quando a integração for ativada. O estado vazio explica isso.

## 2. Decisões que dependem de aprovação comercial (implementadas do jeito mais conservador)
| # | Decisão | Alternativa, se preferir |
|---|---|---|
| 1 | Contato iniciado pela empresa só em canal com **consentimento** registrado (WhatsApp/e-mail). Telefone e Instagram ficam bloqueados para contato da empresa enquanto não houver consentimento nesses canais. Legítimo interesse **não** é usado para recompra | Usar legítimo interesse (teste da 005) para algum canal — exige decisão jurídica |
| 2 | Qualquer oposição ativa (inclusive "só marketing") e "não contatar" tiram o cliente da recompra | Manter na lista com contato bloqueado |
| 3 | A lista abre em **Abertas** (oportunidades encerradas — "comprou", "sem interesse" — ficam ocultas até a próxima compra) | Abrir em "Todas" |
| 4 | "Pediu para não ser contatado" registra oposição a **todo contato não essencial** | Registrar só oposição a marketing |
| 5 | Próxima ação: de hoje até 180 dias | Outro limite |
| 6 | Ciclo × quantidade (regra já existente desde a 006): 2 unidades de um produto de 30 dias → 60 dias | Ignorar a quantidade |

## 3. Ordem de publicação (não inverter)
1. **SQL Editor** → cole `supabase/verificacoes/antes_013.sql` → **Run**. Todas as colunas `ok_*` devem ser `true`. Qualquer `false`: pare e me envie o resultado.
2. **SQL Editor** → cole `supabase/migrations/013_recompra_operacional.sql` → **Run** (uma vez). Compare a última tabela com o "Resultado esperado da 013" no `supabase/migrations/README.md`.
3. **GitHub** → Add file → Upload files → arraste o conteúdo do `.zip` do app (mantendo pastas) → Commit.
4. Abra o site, saia e entre de novo (senha + código) e siga o roteiro abaixo.

> Se publicar o app **antes** da 013, a tela Recompra mostra erro e não lista nada; as demais telas seguem funcionando.

## 4. Roteiro de teste (≈ 15 min)
1. **Recompra** abre em "Dados reais". Sem pedidos reais de produtos com ciclo, aparece o estado vazio explicando o que falta.
2. "Ver dados fictícios de teste": aviso amarelo, contadores, lista paginada; abra uma oportunidade → sem "Registrar" nem contato.
3. Teste os filtros (situação, produto, contato, período) e os cartões.
4. *(Com dados reais)* Cadastre um produto com ciclo na Tela Produtos; para ter pedido real, só pela integração futura ou cadastro pelo SQL — **combine comigo antes** se quiser testar com pedido real agora.
5. Abra uma oportunidade real com WhatsApp permitido → *Mostrar contato permitido* mostra só o telefone.
6. Registre "Interessado" com próxima ação → a linha mostra "Próxima ação agendada"; o histórico aparece no detalhe e na ficha do cliente.
7. Abra a mesma oportunidade em duas abas, registre numa e depois na outra → a segunda é recusada.
8. Num cliente sem canal permitido, "Contato feito pela empresa" não deixa escolher canal; "Cliente entrou em contato" deixa.
9. *(Opcional, use cliente de teste)* "Pediu para não ser contatado" → cliente vai para "não contatar" e sai da lista.
10. Dashboard → quadro "Na janela de recompra" → *Ver todas as oportunidades na Tela Recompra*.

## 5. Testes executados (ambiente local equivalente)
55 testes de tela e API da Recompra (navegador real → PostgREST 12 → PostgreSQL 16 com 001–013):
- admin e operador com 2 etapas; sem 2 etapas no banco; sem login; usuário desativado (autoteste);
- separação real × fictício (contadores, lista, produtos do filtro, detalhe somente leitura);
- ciclo e limites de datas; desativado; anonimizado; oposição; "não contatar"; só cancelado; origem misturada;
- consentimento concedido, recusado, revogado, supressão (autoteste) e na tela (canais oferecidos, contato exibido só do canal permitido, e-mail nunca pedido sem permissão);
- múltiplas compras do mesmo produto; quantidade 2;
- paginação e ordem conferidas com SQL; filtros conferidos com SQL; período inválido; estados vazios; erro de conexão com "Tentar de novo";
- gravação, validações, concorrência, encerrada, ação vencida, pedido de não contato → oposição;
- API direta: visões sem contato (400), histórico não pode ser incluído/alterado/apagado (401/403), fictício recusado, e-mail sem consentimento recusado pelo banco;
- sem erros de CSP/JS e nada no `localStorage`.

Regressão: Dashboard (bancos até 011 e com 012+013), Clientes, Produtos, 2 etapas e login — todos passando.
**Não testado aqui:** o Supabase hospedado (login e código foram simulados; banco, RLS e API são reais), volume grande de dados e pedidos da Nuvemshop (não conectada).

## 6. Arquivos alterados no app
`index.html` · `assets/js/config.js` · `assets/js/repositorio.js` · `assets/js/views/recompra.js` · `assets/js/views/dashboard.js` (atalho para a Recompra) · `assets/css/styles.css` · `docs/recompra/TELA-3-RECOMPRA.md`.
Somente Project URL + chave publishable; nenhuma chave secreta; nada gravado no `localStorage`.
