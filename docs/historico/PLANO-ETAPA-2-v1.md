# Plano da Etapa 2 — v1 (SUBSTITUÍDO pela v2 em docs/etapa-2/, 23/10/2026)

**Status: aguardando aprovação. Nada aqui foi implementado.**

Objetivo: tirar os dados do navegador e colocá-los num banco PostgreSQL protegido, com login real, perfis
administrador/operador, regras de acesso no próprio banco, registro de alterações e backup. Continuam
sendo dados **fictícios**; os dados reais chegam só na Etapa 3, com a Nuvemshop.

---

## 0. Decisões que preciso que você aprove

| # | Decisão | Recomendação | Alternativa |
|---|---|---|---|
| D1 | Onde criar o banco | **Projeto Supabase novo, exclusivo do Sales Intelligence**, sem nada em comum com o sistema de conteúdos e influenciadores. Repositório GitHub também separado | Usar um `schema` próprio dentro de um projeto existente. Não recomendo: mistura usuários e regras de acesso dos dois sistemas |
| D2 | Plano do Supabase | **Gratuito nas Etapas 2 e 3 (testes)**, com o backup próprio descrito na seção 6. **Pro (US$ 25/mês) antes de usar com clientes reais no dia a dia**: tem backup diário automático e não pausa | Ficar no gratuito em produção. Risco: o projeto pausa após 7 dias sem uso e não tem backup automático |
| D3 | Login | **E-mail e senha, cadastro público desligado.** Só entra quem o administrador convidar. Verificação em 2 etapas (app autenticador) **obrigatória para administradores** | Link mágico por e-mail (sem senha) |
| D4 | Dados no banco durante a Etapa 2 | **Carregar a mesma base fictícia**, com cada linha marcada `fonte = 'ficticio'`. Antes da Etapa 3, um comando apaga tudo o que for fictício | Banco vazio (você testaria cadastrando à mão) |
| D5 | Prazos de retenção (LGPD) | Proposta na seção 7. **Na Etapa 2 nada é apagado automaticamente**: o sistema só mostra ao administrador o que já passou do prazo | Definir outros prazos com seu jurídico/contador |
| D6 | Região do servidor | **São Paulo (sa-east-1)**: menor latência e dados no Brasil | Outra região |

> Sobre o limite do plano gratuito: são **2 projetos ativos por organização**. Se o sistema de conteúdos
> e influenciadores já usa Supabase na mesma conta, verifique quantos projetos ativos existem. Se já
> forem 2, o novo projeto precisa ser criado numa organização separada. Nada do projeto existente será
> tocado em nenhum caso.

---

## 1. Como o sistema muda (visão do usuário)

1. Ao abrir o endereço, aparece a **tela de login**. Sem login não se vê nenhum dado; isso é garantido pelo banco, não pela tela.
2. Depois do login, o sistema carrega os dados e as 7 telas funcionam como hoje.
3. Toda gravação vai para o banco. Se falhar (internet, permissão), aparece um aviso e nada fica "salvo pela metade".
4. O seletor "Perfil (simulado)" some: o perfil passa a vir do usuário logado.
5. Nova tela **Usuários** (só administrador): convidar, mudar perfil, desativar acesso.
6. A faixa "dados fictícios" passa a ser **controlada pelos próprios dados**: aparece enquanto existir qualquer registro com `fonte = 'ficticio'` no banco e some sozinha quando os dados forem só reais.

## 2. Mudanças técnicas no frontend

| Peça | Mudança |
|---|---|
| `config.js` | Recebe `supabase.url` e `supabase.publishableKey` (`sb_publishable_…`). A chave antiga "anon" está sendo descontinuada pelo Supabase até o fim de 2026, por isso já começamos com a nova |
| Biblioteca | `supabase-js` v2, com versão fixa, carregada por CDN. Continua sem build e sem instalação |
| `store.js` | Passa a ser assíncrono. `load()` busca as tabelas após o login, em páginas de 1.000 linhas (limite padrão da API), e monta um **cache em memória**. Leituras continuam síncronas sobre o cache, então **telas e indicadores não mudam**. Gravações viram `async`: gravam no banco e, só se der certo, atualizam o cache |
| `app.js` | Verifica a sessão. Sem sessão mostra o login; com sessão mostra "carregando…" e depois a tela |
| Telas novas | Login, redefinição de senha, Usuários (admin) |
| Indicadores | Continuam calculados no navegador. Isso funciona bem até algumas dezenas de milhares de pedidos. Se o volume crescer, a Etapa 4 move os cálculos pesados para dentro do banco |

## 3. Tabelas

Todas ficam no projeto exclusivo, com **RLS ligado em 100% delas**. Padrões aplicados a todas:

- Chave `id uuid`.
- `criado_em` e `atualizado_em` (atualizados por trigger).
- `fonte` ∈ `ficticio | nuvemshop | manual`, para separar o que é teste do que é real.

| Tabela | Para quê | Colunas principais | Proteções contra duplicidade e erro |
|---|---|---|---|
| `perfis` | Quem usa o sistema | `id` (= usuário do Auth), `nome`, `papel` (`admin`/`operador`), `ativo` | Criado automaticamente quando um usuário é convidado, sempre como **operador** |
| `configuracoes` | Regras de segmentação | `inativo_apos_dias`, `fidelidade_min_pedidos`, `janela_antes_dias`, `janela_depois_dias` | Uma única linha (`check id = 1`); valores com limites mínimos e máximos |
| `produtos` | Catálogo e ciclo de recompra | `nuvemshop_id`, `sku`, `nome`, `categoria`, `preco`, `ciclo_recompra_dias`, `ativo` | `nuvemshop_id` único |
| `clientes` | Central de clientes | `nuvemshop_id`, `nome`, `email`, `email_norm`, `telefone`, `telefone_norm` (só dígitos), `cidade`, `uf`, `origem`, `status_comercial`, `cadastrado_em`, `anonimizado_em` | Únicos: `nuvemshop_id`, `email_norm` e `telefone_norm` (ignorando anonimizados) |
| `pedidos` | Histórico de compras | `nuvemshop_id`, `numero`, `cliente_id`, `data_pedido`, `status` (`pago`/`pendente`/`cancelado`/`reembolsado`), `subtotal`, `desconto`, `frete`, `total`, `cupom_codigo` | `nuvemshop_id` único. Cliente com pedidos **não pode ser apagado** (`on delete restrict`) |
| `pedido_itens` | Produtos de cada pedido | `pedido_id`, `produto_id`, `nome_produto` (cópia do nome na data da compra), `qtd`, `preco_unit` | Apagado junto com o pedido |
| `cupons` | Cupons existentes | `nuvemshop_id`, `codigo`, `tipo`, `valor`, `ativo` | `codigo` único. O sistema **só lê**; nunca cria cupom na loja |
| `consentimentos` | Permissões de marketing (LGPD) | `cliente_id` ou `lead_id`, `canal` (`whatsapp`/`email`), `concedido`, `como_obtido`, `registrado_por`, `registrado_em` | **Só aceita inclusões**: cada mudança é uma linha nova e nada é sobrescrito. A permissão atual vem de uma visão que pega o registro mais recente |
| `leads` | Funil de prospecção | `nome`, `origem`, `email`/`email_norm`, `telefone`/`telefone_norm`, `empresa`, `etapa`, `proximo_contato`, `valor_potencial`, `responsavel_id`, `cliente_id` (preenchido quando vira cliente) | Únicos: `email_norm` e `telefone_norm` |
| `interacoes` | Histórico de contatos e observações do funil | `cliente_id` ou `lead_id` (exatamente um), `data`, `canal`, `nota`, `autor_id` | Autor preenchido pelo banco com o usuário logado |
| `campanhas` | Campanhas | `nome`, `objetivo`, `canal`, `publico`, `cupom_codigo`, `mensagem`, `status`, `criado_por`, `concluida_em` | — |
| `campanha_destinatarios` | Quem recebeu | `campanha_id`, `cliente_id`, `enviado_em`, `enviado_por` | Chave (`campanha_id`, `cliente_id`): ninguém entra duas vezes |
| `auditoria` | Registro de alterações | `ocorrido_em`, `usuario_id`, `acao`, `tabela`, `registro_id`, `antes` e `depois` (JSON) | Escrita **somente por triggers do banco**. Ninguém, nem o administrador, edita ou apaga pelo sistema |

Fica para a Etapa 3: `sync_execucoes` (log das sincronizações com a Nuvemshop). As colunas `nuvemshop_id` já
nascem agora, então a Etapa 3 não precisa reestruturar nenhuma tabela.

### Regras de negócio garantidas pelo banco (não só pela tela)

- **Funil:** um lead não sai de "Novo contato" (exceto para "Perdido") sem consentimento atual registrado (trigger).
- **Campanhas:** marcar envio só funciona se o cliente **ainda** tiver permissão naquele canal no momento da marcação, e só uma vez por destinatário (função `marcar_envio`).
- **Anonimização:** função `anonimizar_cliente`, só para administradores. Apaga nome, contatos e interações, mantém os pedidos sem identificação e registra na auditoria.
- **Duplicidade:** telefone e e-mail normalizados com índice único. Um mesmo contato não pode ser cadastrado duas vezes nem como lead e cliente ao mesmo tempo sem ser vinculado.

## 4. Autenticação

- Supabase Auth com e-mail e senha. **Cadastro público desligado** no painel.
- **Convite:** na Etapa 2, o administrador convida pelo painel do Supabase (é um passo que você faz uma vez, com o meu passo a passo). Convidar pela própria tela exige a chave secreta, que nunca vai para o navegador. Se quiser essa função, ela vira uma Edge Function só para admin, em uma etapa posterior.
- Ao aceitar o convite, um trigger cria o `perfil` como **operador**. Só um administrador promove alguém a administrador.
- **Desativar um usuário** (`ativo = false`) corta o acesso a todos os dados na hora, mesmo com a sessão ainda aberta, porque todas as regras de acesso conferem esse campo.
- **2 etapas (TOTP)** obrigatória para administradores (função gratuita do Supabase Auth).
- **Redefinição de senha** por e-mail, voltando para o endereço do GitHub Pages (configurado como URL permitida no painel).
- **Primeiro administrador:** depois de convidado e logado, você é promovido com um único comando SQL que eu entrego pronto.

## 5. Regras de acesso (RLS) e permissões

Funções auxiliares ficam num schema privado, que não é exposto pela API:

- `app.papel_atual()` devolve o papel do usuário logado, **somente se `ativo = true`**.
- `app.e_admin()` e `app.e_usuario_ativo()`.

As políticas usam o formato recomendado pelo Supabase, `(select app.papel_atual())`, por desempenho.

**Visitante não logado: nenhuma linha em nenhuma tabela.**

| Tabela | Operador | Administrador |
|---|---|---|
| `perfis` | vê o próprio | vê e edita todos (papel, ativo) |
| `configuracoes` | lê | lê e altera |
| `produtos` | lê | lê e altera o ciclo de recompra |
| `clientes` | lê; altera **apenas** `status_comercial` (permissão por coluna) | idem + anonimizar (função) |
| `pedidos`, `pedido_itens`, `cupons` | lê | lê. **Ninguém grava pelo sistema**: só a sincronização com a Nuvemshop (Etapa 3, pelo backend) |
| `consentimentos` | lê e inclui | lê e inclui. Ninguém altera nem apaga |
| `leads` | lê, inclui, altera | idem + excluir (pedido LGPD do titular) |
| `interacoes` | lê e inclui (como autor) | idem |
| `campanhas` | lê, cria, edita, conclui | idem + excluir rascunho |
| `campanha_destinatarios` | lê, inclui, marca envio (função) | idem |
| `auditoria` | — | só lê |
| Exportar backup completo | — | ✅ |
| Recriar/apagar base fictícia | — | ✅ (função que apaga apenas `fonte = 'ficticio'`) |

As regras de acesso são testadas por um **script automatizado** que entra como visitante, operador e
administrador e tenta tudo o que **não** deveria conseguir. Cada uma dessas tentativas precisa ser recusada.

## 6. Estratégia para preservar os dados

1. **O banco é a fonte única.** O navegador guarda só a sessão de login e preferências de tela.
2. **Nada se apaga de verdade no uso normal:**
   - Lead perdido muda de etapa.
   - Cliente é anonimizado.
   - Campanha é concluída.
   - Pedidos nunca são apagados pelo sistema.
3. **Auditoria à prova de edição.** Toda inclusão, alteração ou exclusão em clientes, leads, consentimentos, campanhas, perfis e configurações grava o "antes" e o "depois", por trigger.
4. **Backup diário próprio**, porque o plano gratuito não tem backup automático:
   - Uma rotina no GitHub Actions, num **repositório privado**, roda `pg_dump` todo dia.
   - O arquivo é **criptografado**, porque contém dados pessoais, e guardado por 30 dias.
   - Senha do banco e chave de criptografia ficam em *secrets* do GitHub, nunca no código.
   - No plano Pro esse backup continua como segunda cópia.
5. **Exportação manual em JSON** (administrador), como já existe hoje.
6. **Teste de restauração.** Na Etapa 5 restauramos um backup num projeto de teste, para provar que o backup funciona.
7. **Mudanças de estrutura versionadas:**
   - Arquivos SQL numerados (`supabase/migrations/001_….sql`, `002_…`), executados em ordem.
   - Um arquivo já aplicado nunca é editado; mudanças entram como um arquivo novo.
8. **Separação total dos dados fictícios.** Coluna `fonte`, mais a função `limpar_dados_ficticios()` antes da Etapa 3. A faixa de aviso depende dos dados, então nunca fica errada.
9. **Pausa do plano gratuito:** após 7 dias sem uso, o projeto pausa. Os dados não se perdem, mas o sistema fica fora do ar até ser reativado no painel. Mais um motivo para o Pro (D2) quando houver uso real.
10. **Os dados de teste salvos hoje no seu navegador não são migrados.** São fictícios e serão recriados no banco.

## 7. Retenção e LGPD (proposta — precisa da sua validação)

| Dado | Proposta | Observação |
|---|---|---|
| Lead perdido / sem resposta | Anonimizar após 12 meses sem interação | Sem base para guardar contato de quem não virou cliente |
| Consentimento revogado | Manter o registro da revogação | Prova de que a vontade da pessoa foi respeitada |
| Cliente sem compra há 5 anos | Anonimizar | Pedidos permanecem sem identificação |
| Pedidos | Manter | Também existem na Nuvemshop e servem a obrigações fiscais; confirmar o prazo com o contador |
| Auditoria | Manter 5 anos | — |
| Backups | 30 dias | — |

Na Etapa 2 o sistema apenas **lista** o que passou do prazo, para o administrador decidir. Nada é apagado
automaticamente sem a sua aprovação. Esta proposta não substitui orientação jurídica.

## 8. O que você precisará fazer (≈ 40 min, com meu passo a passo)

1. Criar conta e projeto no Supabase (região São Paulo, nome `altum-sales-intelligence`).
2. Desligar o cadastro público e cadastrar o endereço do GitHub Pages como URL permitida.
3. Copiar e colar os arquivos SQL no editor do Supabase, na ordem.
4. Me enviar **só** a URL do projeto e a **publishable key**. A secret key e a senha do banco não devem ser enviadas.
5. Convidar o seu e-mail, aceitar o convite e rodar o comando que o torna administrador.
6. Criar o repositório privado de backup e cadastrar 2 *secrets* (conexão do banco e chave de criptografia).

## 9. O que eu entregarei na Etapa 2

- `supabase/migrations/001…006`: tabelas, índices, triggers de auditoria, funções, RLS e carga fictícia.
- `store.js` conectado ao Supabase, telas de login/senha/usuários e a faixa de aviso controlada pelos dados.
- Script de testes de RLS e repetição da auditoria automatizada completa.
- Rotina de backup (GitHub Actions) e instruções de restauração.
- Guia passo a passo das configurações manuais.

## 10. Riscos conhecidos

| Risco | Tratamento |
|---|---|
| Endereço do GitHub Pages é público | Sem login não sai nenhum dado (RLS). Cadastro público desligado. Página marcada `noindex` |
| Alguém abrir o código e ver a publishable key | É pública por design; sem login ela não acessa nada |
| Volume de dados cresce | Carregamento em páginas; cálculos movidos para o banco na Etapa 4, se necessário |
| Projeto gratuito pausar | Pro antes do uso real (D2) |
| Erro em regra de acesso | Teste automatizado de RLS a cada mudança |
