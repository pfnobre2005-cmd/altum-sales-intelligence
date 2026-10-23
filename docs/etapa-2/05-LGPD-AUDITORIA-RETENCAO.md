# 05 — Auditoria sem dados pessoais, anonimização, retenção e exclusão

Correção 3 do plano.

## O problema da v1

A auditoria da v1 guardava o "antes" e o "depois" de cada registro. Isso criaria **uma cópia permanente dos
dados pessoais**, que sobreviveria à anonimização e não poderia ser apagada (a auditoria é imutável).
Seria a falha mais grave do plano.

## Auditoria v2: registra o fato, não o conteúdo

| Campo | Exemplo |
|---|---|
| `ocorrido_em`, `ator_id`, `ator_papel`, `ator_aal` | 23/10 15:40, usuário X, admin, aal2 |
| `acao`, `tabela`, `registro_id` | `update`, `clientes`, uuid |
| `campos_alterados` | `{email, telefone}`: **só os nomes** |
| `valores` | Somente campos de uma **lista permitida** de dados não pessoais: `etapa`, `status_comercial`, `papel`, `ativo`, `situacao` da permissão, `canal`, `status` da campanha, valores das regras |
| `motivo` | Obrigatório em ações sensíveis (anonimização, exportação, associação de clientes) |

- A lista permitida fica numa tabela (`auditoria_campos_permitidos`). **Por padrão, nenhum campo é copiado.** Um campo novo só aparece com valor na auditoria se for incluído de propósito.
- **Nunca** entram na auditoria: nome, e-mail, telefone, cidade, empresa, notas, evidências em texto livre ou mensagens.
- Também ficam registrados: exportações (quem, quando, quantos registros), anonimizações, mudanças de papel, retenções executadas e solicitações de titular.
- A auditoria é gravada só por triggers e funções do banco. Ninguém altera nem apaga pela API.
- Os registros têm prazo (ver retenção) e são apagados por rotina do banco, que também é auditada.

## Dados sensíveis em texto livre

Clientes de suplemento podem relatar condições de saúde, que são **dado sensível** (LGPD, art. 11). Medidas:
- Aviso fixo nos campos de nota e interação: "Não registre informações de saúde, diagnósticos ou medicamentos."
- O verificador de termos (já usado nas campanhas) também analisa as notas e **alerta** antes de salvar quando detecta termos de saúde.
- As notas são apagadas na anonimização.

## Anonimização: o que acontece com cada dado

Função `anonimizar_titular(registro, motivo)`: só administrador, `aal2` e confirmação recente. É executada numa única transação.

| Dado | Tratamento |
|---|---|
| `clientes` / `leads` | Nome, e-mail, telefone, cidade, empresa e campos normalizados → apagados. `anonimizado_em` preenchido. **UF, origem e datas são mantidos** para os indicadores |
| ID da Nuvemshop do cliente e dos pedidos | Removidos do registro. Em seu lugar fica um **código irreversível** (HMAC com chave secreta guardada no Vault do Supabase) na tabela `supressoes` |
| `pedidos` / `pedido_itens` | Mantidos sem identificação (valores, produtos, datas, cupom) |
| `interacoes` | **Apagadas** |
| `bases_tratamento`, `permissoes_comunicacao` | Mantidas sem texto livre (evidência apagada). Prova de que a revogação foi respeitada |
| `campanha_destinatarios` | Mantidos (o registro já não identifica ninguém). Preserva as métricas |
| `sugestoes_vinculo`, `grupos_pessoa` | Apagadas ou desfeitas |
| `auditoria` | Nada a fazer: não contém dados pessoais |
| Backups | Ver "Backups e anonimização" abaixo |

### Por que a tabela de supressões

A Nuvemshop continua com o cadastro da pessoa. Sem a supressão, a sincronização da Etapa 3 **recriaria**
o cliente anonimizado.

Com a supressão, a sincronização calcula o mesmo código e:
- não recria a pessoa;
- liga pedidos novos dela a um registro anônimo.

O código é irreversível sem a chave e não contém o dado em si. Mesmo assim, ele é tratado como dado
pseudonimizado (só serve para cumprir o pedido da pessoa) e fica protegido como qualquer dado pessoal.

### Anonimização × exclusão

- Para o titular, o efeito é o mesmo: o sistema deixa de ter dados que o identifiquem.
- O que fica são números de vendas sem identificação, que a LGPD não considera dado pessoal (art. 12), e o código de supressão.
- Obrigações fiscais sobre pedidos são atendidas na Nuvemshop e na contabilidade, não neste CRM.

## Retenção

| Dado | Prazo proposto | Ação ao vencer |
|---|---|---|
| Lead sem compra e sem interação | 12 meses | Anonimizar |
| Cliente sem compra | 5 anos após a última compra | Anonimizar |
| Interações / notas | Enquanto o titular existir; apagadas na anonimização | — |
| Permissões e oposições | Enquanto o titular existir; depois, sem identificação | — |
| Auditoria | 5 anos | Excluir |
| Supressões | Enquanto existir a integração com a loja | — |
| Backups | 30 dias (diário) e 90 dias (mensal) | Expiração automática |
| Arquivos exportados | Fora do sistema. Ficam registrados e o sistema avisa para apagar após o uso | — |

**Nesta etapa a retenção não age sozinha.** Uma rotina diária do banco (`pg_cron`) só **lista** o que
venceu em `pendencias_retencao`. O administrador revisa e aprova a execução em lote, com `aal2` e
confirmação recente. Depois que os prazos forem validados com o jurídico, a execução pode ser
automatizada, mediante aprovação.

## Solicitações de titulares (LGPD, art. 18)

Nova tabela `solicitacoes_titular`, controlada pelo administrador:
- tipos: confirmação, acesso, correção, eliminação/anonimização, revogação, oposição, portabilidade, informação;
- campos: data de recebimento, prazo, status, data de atendimento, responsável.

O pedido de acesso gera um relatório do titular (exportação auditada). O art. 19 prevê formato simplificado
imediato ou declaração completa em até 15 dias. O sistema mostra o prazo.

## Backups e anonimização

1. Um backup feito antes da anonimização ainda contém a pessoa. Ele expira em no máximo 90 dias. Isso deve constar na política de privacidade.
2. A tabela `registro_anonimizacoes` guarda **apenas IDs internos e datas, sem dados pessoais**. Ela vai em todo backup.
3. **Toda restauração termina reaplicando as anonimizações** registradas depois da data do backup restaurado. Esse passo é obrigatório no roteiro do arquivo [06](06-BACKUP-E-RESTAURACAO.md) e é verificado no teste de restauração.

## Exportações

- Só o administrador exporta, com `aal2` e confirmação recente.
- Cada exportação é registrada (quem, quando, o quê, quantos registros).
- O arquivo é gerado com o aviso "contém dados pessoais — apague após o uso".
- A exportação completa (backup manual em JSON) **não inclui** notas de interação, a menos que o administrador escolha incluir.
