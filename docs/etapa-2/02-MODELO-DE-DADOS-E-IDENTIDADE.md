# 02 — Modelo de dados, identificação e vinculação de registros

Correção 1 do plano. Substitui a seção 3 da v1.

## O que mudou em relação à v1

| v1 | v2 |
|---|---|
| E-mail e telefone com **índice único** em clientes e leads | **Sem unicidade** em e-mail e telefone. Viram índices comuns, só para busca e para sugerir possíveis duplicidades |
| O banco recusava contato "duplicado" | O sistema **avisa** que existe um registro parecido e uma **pessoa decide** |
| Vinculação implícita por e-mail/telefone | **Vinculação automática somente pelo ID da Nuvemshop.** Qualquer outra vinculação é sugestão, confirmada por uma pessoa, registrada e reversível |

Motivo: família, casal, empresa e funcionários dividem e-mail ou telefone, e uma mesma pessoa pode ter
duas contas na loja. Bloquear por isso impede clientes legítimos. Juntar registros automaticamente mistura
o histórico e as permissões de pessoas diferentes, o que é pior.

## Hierarquia de identificação

| Nível | Chave | Uso | Automático? |
|---|---|---|---|
| 1 | `(nuvemshop_loja_id, nuvemshop_cliente_id)` | Sincronização com a Nuvemshop (Etapa 3) | **Sim**. É a única chave usada sem confirmação humana |
| 2 | `(nuvemshop_loja_id, nuvemshop_pedido_id)` | Pedido único; a sincronização é idempotente (rodar duas vezes não duplica) | Sim |
| 3 | `email_norm` (minúsculas, sem espaços) e `telefone_norm` (só dígitos, com DDI) | Busca e **sugestão** de possível mesma pessoa | Não. Só sugere |
| 4 | Nome + cidade | Sugestão fraca, mostrada com aviso | Não |

O ID da loja entra na chave para não haver colisão caso um dia exista uma segunda loja. Isso não custa nada agora.

> O formato exato dos IDs e o comportamento de compras sem cadastro na Nuvemshop serão confirmados na
> documentação oficial da API **na Etapa 3**, antes de qualquer sincronização. Nesta etapa só criamos as
> colunas e as regras de unicidade.

## Regras de vinculação

1. **Mesmo ID da Nuvemshop:** é o mesmo cliente. A sincronização atualiza o registro existente.
2. **IDs da Nuvemshop diferentes:** **nunca** são fundidos, mesmo com e-mail e telefone iguais. Se uma pessoa confirmar que é a mesma pessoa (ex.: duas contas na loja), os registros são **associados** num grupo (`grupos_pessoa`). Cada registro continua com o próprio histórico, e a associação pode ser desfeita.
3. **Lead × cliente:** quando um lead compra, o sistema mostra os clientes com e-mail ou telefone parecidos. O operador confirma qual é (ou nenhum). Fica gravado `lead.cliente_id`, com quem confirmou e quando.
4. **Lead novo parecido com um existente:** o sistema mostra os parecidos e o operador escolhe:
   - abrir o existente;
   - ou criar mesmo assim, informando o motivo (ex.: "telefone da empresa, contato diferente").
5. **Permissões em registros associados:** vale a mais restritiva. Se qualquer registro do grupo revogou marketing num canal, nenhum é contatado por marketing naquele canal.
6. **Quem pode fazer o quê:**
   - Vincular lead a cliente: operador ou administrador.
   - Associar dois clientes: só administrador.
   - Desfazer uma associação: só administrador.
   - Todas essas ações vão para a auditoria.

## Tabelas (v2)

Padrões em todas as tabelas:
- RLS ligado;
- `id uuid`;
- `criado_em` e `atualizado_em`;
- `fonte` (`ficticio` | `nuvemshop` | `manual` | `importacao`).

| Tabela | Colunas principais | Unicidade / integridade |
|---|---|---|
| `perfis` | `id` (= usuário do Auth), `nome`, `papel` (`admin`/`operador`), `ativo` | Criado por trigger no convite, sempre como `operador` |
| `configuracoes` | regras de segmentação | Linha única (`id = 1`), limites por `check` |
| `produtos` | `nuvemshop_loja_id`, `nuvemshop_produto_id`, `sku`, `nome`, `categoria`, `preco`, `ciclo_recompra_dias`, `ativo` | Único: (loja, produto) |
| `clientes` | `nuvemshop_loja_id`, `nuvemshop_cliente_id`, `nome`, `email`, `email_norm`, `telefone`, `telefone_norm`, `cidade`, `uf`, `origem`, `status_comercial`, `cadastrado_em`, `anonimizado_em`, `grupo_pessoa_id` | Único: (loja, cliente_id) quando preenchido. E-mail e telefone **não** são únicos |
| `grupos_pessoa` | `id`, `criado_por`, `motivo` | Associação reversível de clientes |
| `pedidos` | `nuvemshop_loja_id`, `nuvemshop_pedido_id`, `numero`, `cliente_id`, `data_pedido`, `status`, `subtotal`, `desconto`, `frete`, `total`, `cupom_codigo` | Único: (loja, pedido_id). `cliente_id` com `on delete restrict` |
| `pedido_itens` | `pedido_id`, `produto_id`, `nome_produto` (cópia do nome na data), `qtd`, `preco_unit` | Apagado junto com o pedido |
| `cupons` | `nuvemshop_cupom_id`, `codigo`, `tipo`, `valor`, `ativo` | Único: `codigo`. **Somente leitura** pelo sistema |
| `leads` | `nome`, `origem`, `email`/`email_norm`, `telefone`/`telefone_norm`, `empresa`, `etapa`, `proximo_contato`, `valor_potencial`, `responsavel_id`, `cliente_id`, `cliente_vinculado_por`, `cliente_vinculado_em`, `motivo_duplicidade`, `anonimizado_em` | Sem unicidade de contato |
| `sugestoes_vinculo` | `tipo` (`lead_cliente`/`cliente_cliente`), `registro_a`, `registro_b`, `motivo` (`mesmo_email`/`mesmo_telefone`/`nome_cidade`), `status` (`pendente`/`aceita`/`rejeitada`), `decidido_por`, `decidido_em` | Único: (tipo, a, b). Uma sugestão rejeitada não volta |
| `interacoes` | `cliente_id` ou `lead_id`, `data`, `canal`, `nota`, `autor_id` | Exatamente um dos dois. Autor preenchido pelo banco |
| `campanhas` | `nome`, `objetivo`, `canal`, `publico`, `cupom_codigo`, `mensagem` (modelo, nunca a mensagem já personalizada), `status`, `criado_por`, `concluida_em` | — |
| `campanha_destinatarios` | `campanha_id`, `cliente_id`, `enviado_em`, `enviado_por` | Chave (campanha, cliente) |
| Bases legais, permissões de comunicação, opt-out | ver [03](03-CONSENTIMENTO-E-BASES-LEGAIS.md) | — |
| Auditoria, supressões, retenção, solicitações de titulares | ver [05](05-LGPD-AUDITORIA-RETENCAO.md) | — |
| `sync_execucoes` | Fica para a Etapa 3 | — |

## Efeito nas telas existentes (preservadas, com comportamento ajustado)

- **Funil, "Novo contato":** o bloqueio de duplicado (Etapa 1) vira um **aviso com a lista de parecidos**.
- **Ficha do cliente:** novo bloco "Registros associados" (grupo e leads vinculados).
- **Indicadores:** continuam por registro de cliente nesta etapa. A contagem por pessoa (grupo) pode ser avaliada na Etapa 4.
