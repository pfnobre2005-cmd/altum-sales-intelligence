# Carrinhos abandonados (app 0.15.1, migração 021)

**Onde:** menu **Carrinhos abandonados**. Todos os perfis com 2 etapas veem o painel; só o administrador lê a loja e muda a configuração.

**Fonte:** carrinhos abandonados da Nuvemshop (API oficial, **somente leitura**).
- A loja só disponibiliza os **últimos 30 dias**; o CRM guarda por até 180 dias.
- O carrinho aparece cerca de 6 h após o abandono.
- Nada é enviado a clientes. As automações do Nuvem Marketing não são criadas nem alteradas.

**Recuperação atribuída (vínculo documental):** só nestes dois casos.
- O pedido tem o **mesmo número** do carrinho, com e-mail, data e produto coerentes.
- O pedido usou um **cupom exclusivo da recuperação** e existe **um único** carrinho candidato do mesmo cliente, com produto em comum.

E-mail, compra posterior ou "concluído" sozinhos não bastam: esses casos aparecem como **compra posterior sem atribuição** e não entram na receita recuperada. Cada pedido é contado **uma única vez**.

**Nuvem Marketing:** a API oficial não oferece métricas das automações (envios, aberturas, cliques). A tela não as estima. Veja no painel do Nuvem Marketing.

**Oportunidades:** carrinhos sem compra dos últimos 7 dias, com o nome do cliente cadastrado e a permissão por canal.
- Nunca mostram e-mail.
- **Não repita o e-mail** da automação; contato humano só pelo canal autorizado.

**Atualização automática:** consulta periódica (a Nuvemshop não tem evento de "carrinho abandonado"; `checkout/created` e `checkout/updated` avisam criação e alteração de checkout, não abandono), de hora em hora pelo Supabase, depois de ligar `supabase/agendamento/ligar_carrinhos.sql`. Para desligar: `supabase/reversao/desligar_carrinhos.sql`.

**Se algo não sair como esperado**

| O que aparece | O que fazer |
|---|---|
| "…não é a do ALTUM (resposta sem identificação)" | Em Edge Functions → `nuvemshop-carrinhos` → Code, apague o código-modelo, cole o `index.ts` da 0.15.0 e clique em **Deploy** |
| "sem permissão read_orders (403)" | O app da loja precisa da permissão de leitura de pedidos (que também cobre carrinhos) |
| "O Supabase recusou a sessão antes de chegar à função" | Desligue "Verify JWT" em Details |
