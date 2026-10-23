# 03 — Finalidades, bases legais e permissões de comunicação

Correção 2 do plano. Substitui a regra da v1 "não sai de Novo contato sem consentimento".

> Este documento organiza o sistema para registrar as decisões de privacidade. **Ele não é parecer
> jurídico.** A escolha da base legal de cada finalidade, principalmente o uso de legítimo interesse,
> deve ser validada pelo jurídico ou encarregado de dados (DPO) da empresa.

## O erro da v1

A v1 tratava três coisas diferentes como uma só ("consentimento"):

1. **Atender quem pediu.** Responder quem mandou mensagem, enviar orçamento solicitado, tirar dúvida. Para isso não é preciso consentimento de marketing. A LGPD (art. 7º, V) permite tratar dados para *procedimentos preliminares relacionados a contrato, a pedido do titular*.
2. **Ter base legal para guardar e usar o dado**, para uma finalidade definida.
3. **Autorização para comunicação promocional:** ofertas, cupons, campanhas, por canal.

Bloquear o funil inteiro por falta do item 3 impedia atender quem pediu atendimento.

## Finalidades

| Finalidade | Exemplos | Base legal sugerida (validar) | Exige autorização promocional? |
|---|---|---|---|
| `atendimento_solicitado` | Responder DM/WhatsApp de quem procurou, enviar proposta pedida | Procedimentos preliminares a pedido do titular (art. 7º, V) | **Não** |
| `execucao_pedido` | Entrega, troca, nota, suporte de um pedido | Execução de contrato (art. 7º, V); obrigação legal (II) para dados fiscais | Não |
| `relacionamento` | Pós-venda não promocional, pesquisa de satisfação | Legítimo interesse (IX), com teste de balanceamento documentado, ou consentimento | Não, mas respeita oposição |
| `prospeccao_b2b` | Contato comercial com empresa que não pediu | Legítimo interesse (IX), com teste documentado | Não, mas respeita oposição e não envia ofertas em massa |
| `marketing_promocional` | Cupons, campanhas, ofertas, lembrete de recompra com desconto | **Consentimento (art. 7º, I), por canal** | **Sim** |

Recomendação conservadora: **marketing promocional só com consentimento por canal.** Usar legítimo
interesse para marketing é possível, mas exige avaliação documentada e não é o padrão aqui. As
políticas do WhatsApp Business para mensagens iniciadas pela empresa também exigem opt-in, o que reforça
essa escolha para a integração futura.

## Modelo de registro (novas tabelas)

| Tabela | Conteúdo | Regras |
|---|---|---|
| `bases_tratamento` | `cliente_id` ou `lead_id`, `finalidade`, `base_legal`, `evidencia` (ex.: "mensagem recebida no WhatsApp em 22/10"), `registrado_por`, `registrado_em`, `encerrada_em`, `motivo_encerramento` | Uma linha por finalidade ativa. Encerrar não apaga |
| `permissoes_comunicacao` | `cliente_id` ou `lead_id`, `canal` (`whatsapp`/`email`/`telefone`/`instagram`), `finalidade` (`marketing_promocional`), `situacao` (`concedida`/`revogada`/`recusada`), `como_obtida`, `texto_apresentado_versao`, `registrado_por`, `registrado_em` | **Só aceita inclusão** (histórico completo). A situação atual é o registro mais recente, por uma visão |
| `oposicoes` | `cliente_id` ou `lead_id`, `escopo` (`marketing`/`todo_contato_nao_essencial`), `registrada_em`, `registrada_por` | Opt-out geral: bloqueia todo contato que não seja de pedido em andamento |
| `textos_consentimento` | `versao`, `texto`, `vigente_desde` | O texto que a pessoa viu fica guardado; cada permissão aponta para a versão |

A permissão revogada **nunca é apagada** enquanto existir o registro, pois é a prova de que a vontade
da pessoa foi respeitada. Depois de uma anonimização, fica a prova sem identificação (ver [05](05-LGPD-AUDITORIA-RETENCAO.md)).

## Funil: o que libera cada movimento

As 7 etapas são mantidas. Muda o sentido de "Contato autorizado":

| Etapa | Novo significado | Exigência (garantida no banco) |
|---|---|---|
| 1. Novo contato | Registro criado | Origem obrigatória |
| 2. Contato autorizado | **Há base registrada para conversar com a pessoa** | Uma base ativa de `atendimento_solicitado`, `prospeccao_b2b` ou `relacionamento`, com evidência |
| 3 a 5. Atendimento → Interessado → Proposta | Conversa sobre o que a pessoa pediu | A mesma base da etapa 2. **Não exige** autorização promocional |
| 6. Compra realizada | — | Sempre permitido (vincula ao cliente, ver [02](02-MODELO-DE-DADOS-E-IDENTIDADE.md)) |
| 7. Perdido / sem interesse | — | Sempre permitido |

Regras por origem do lead:
- **WhatsApp, Instagram ou anúncio com formulário (a pessoa iniciou o contato):**
  - O operador marca "a pessoa solicitou contato" e informa a evidência, criando a base `atendimento_solicitado`.
  - A autorização promocional só existe se a pessoa a deu de forma explícita (ex.: caixa marcada no formulário do anúncio, com o texto guardado).
- **Indicação:** quem foi indicado não pediu nada. Fica em "Novo contato" até o primeiro contato.
  - O primeiro contato é feito sem oferta, apresentando a origem ("Fulano indicou você").
  - Se a pessoa aceitar conversar, registra-se a base `atendimento_solicitado`.
- **B2B:** pode avançar com base `prospeccao_b2b`, que exige o teste de legítimo interesse documentado pelo administrador **uma vez**, para a atividade como um todo.
- **Importação autorizada:** cada lote importado declara a base e a evidência (ex.: lista de inscritos de um evento, com o termo de aceite). Sem isso, o lote não entra.

## Onde a autorização promocional é exigida

1. **Entrada em público de campanha:** só quem tem permissão `concedida` no canal da campanha, sem oposição e sem supressão.
2. **Marcar envio** (função `marcar_envio`): o banco confere a permissão **de novo no momento da marcação**. Se a pessoa revogou depois de a campanha ser criada, o envio é bloqueado.
3. **Follow-up do funil sem permissão promocional:** aparece com o aviso "somente retomar o assunto solicitado; não enviar oferta".
4. **Revogação:** pode ser feita sempre e vale imediatamente. Revogar marketing **não** bloqueia o atendimento nem os avisos do pedido.

## Efeito nas telas existentes

- **Ficha do cliente:** o bloco "Permissões" passa a ter:
  - uma linha por canal, com a situação, a data, a origem e o histórico;
  - um bloco separado "Bases de tratamento";
  - o botão "Registrar oposição".
- **Funil:** o checkbox único de consentimento é substituído por:
  - "Base para contato" (finalidade + evidência);
  - "Autorização promocional por canal" (opcional).
- **Campanhas:** a contagem de elegíveis passa a explicar os motivos de exclusão (sem permissão no canal, oposição, supressão).
