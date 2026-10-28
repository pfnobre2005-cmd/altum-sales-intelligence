# Tela 2 — Clientes: revisão, publicação e testes

Versão do app: `0.7.0-clientes` · Banco: migração `012_clientes_gestao.sql` (requer a 011).
Dashboard, Clientes e Produtos leem o Supabase. Recompra, Funil, Campanhas, Inteligência e Integrações continuam na base local.
**A Nuvemshop não está conectada e a tela não envia mensagem nenhuma.**

## 1. O que a tela faz
| Quem | Pode |
|---|---|
| Operador (senha + 2 etapas) | lista, busca, filtros; ficha completa; **Novo cliente**; editar; mudar status; registrar consentimento (concessão com texto vigente + evidência, recusa, revogação), oposição, interação e solicitação LGPD |
| Administrador (senha + 2 etapas) | tudo do operador + cadastrar texto de consentimento, encerrar oposição, iniciar atendimento LGPD e **anonimizar** |

- **Dados reais** é o padrão. "Ver dados fictícios de teste" abre a carga 010 com aviso — fictícios são **somente leitura**.
- Lista: busca por nome ou cidade (trecho), **e-mail completo** ou **telefone com pelo menos 8 dígitos** (com ou sem DDD). E-mail/telefone não aparecem na lista nem na visão do banco; a busca por contato é feita por uma função que devolve só os IDs encontrados. Filtros de status, segmento, permissão de contato e anonimizados, ordenação, 25 por página.
- Ficha: dados, indicadores, pedidos com itens, produtos comprados, permissões por canal + histórico, oposições, interações, sugestões de vínculo, solicitações LGPD.
- **Duplicados:** mesmo e-mail/telefone ou nome parecido na mesma cidade → a tela mostra os possíveis duplicados e pede confirmação ("Voltar e editar" mantém o que você digitou). Confirmado, o cadastro é criado e fica uma **sugestão de vínculo** para decisão humana. **Nada é unido automaticamente.**
- Toda gravação mostra "antes → depois" e pede confirmação. Duas pessoas editando o mesmo cliente: a segunda recebe "alterado por outra pessoa".
- **Oposição total** coloca o cliente em "não contatar" e o banco impede tirar desse status enquanto ela estiver ativa. **Encerrar a oposição mantém "não contatar"** — reativar é uma decisão separada, pelo seletor de status.
- **Anonimizar** (só admin): exige solicitação LGPD **em andamento** (eliminação, oposição ou revogação) → simulação (não altera nada) → digitar `ANONIMIZAR` + **novo código do autenticador**. Os contatos ficam suprimidos e não podem ser recadastrados.
- Links antigos de clientes da base local (`#/clientes/c001` etc.) mostram que aquele cliente não existe no Supabase.

## 2. Ordem de publicação (não inverter)
1. **SQL Editor** → cole `supabase/verificacoes/antes_012.sql` → **Run**. Todas as colunas `ok_*` devem ser `true`. Qualquer `false`: pare e me envie o resultado.
2. **SQL Editor** → cole `supabase/migrations/012_clientes_gestao.sql` → **Run** (uma vez). Compare a última tabela com o "Resultado esperado da 012" no `supabase/migrations/README.md` (os segmentos variam com a data).
3. **GitHub** → Add file → Upload files → arraste o conteúdo do `.zip` do app (mantendo pastas) → Commit.
4. Abra o site, saia e entre de novo (senha + código) e siga o roteiro abaixo.

> Se publicar o app **antes** da 012, a tela Clientes mostra erro e não lista nada — os demais módulos continuam funcionando.

## 3. Roteiro de teste (≈ 15 min)
1. **Clientes** abre em "Dados reais" vazio (ou com os reais já existentes) e com **Novo cliente**.
2. "Ver dados fictícios de teste": aviso amarelo, 160 clientes, sem botões de gravação; abra uma ficha e um pedido.
3. Volte a dados reais → **Novo cliente** com nome, cidade/UF e e-mail de teste seu → confirmar → abre a ficha.
4. Na busca, digite o e-mail completo do cliente em maiúsculas → ele aparece; digite só o começo do e-mail → não aparece (a não ser que o nome/cidade contenham o texto).
5. Cadastre outro com o **mesmo e-mail em maiúsculas** → aviso de possível duplicado → "Voltar e editar" (dados mantidos) → confirmar → a ficha mostra a sugestão de vínculo pendente.
6. Mude o status e cancele (volta ao anterior); mude e confirme.
7. **Admin:** "Cadastrar texto de consentimento" (versão real, ex. `EMAIL-2026-10`). Depois registre uma concessão de e-mail com meio e evidência → "E-mail: permitido".
8. Registre oposição total → status "não contatar", e-mail bloqueado. Tente mudar o status → recusado.
9. **Admin:** encerre a oposição → continua "não contatar" até você reativar pelo status.
10. Registre uma interação e uma solicitação LGPD (anote o protocolo).
11. *(Opcional, irreversível — use só o cliente de teste)* Admin: iniciar atendimento → Anonimizar → Simular → `ANONIMIZAR` + código novo. A ficha fica sem nome/contato; tente recadastrar o mesmo e-mail → recusado.
12. Entre como **operador**: não aparecem encerrar oposição, iniciar atendimento nem anonimizar.

## 4. Arquivos alterados no app
`index.html` · `assets/js/config.js` · `assets/js/repositorio.js` · `assets/js/views/clientes.js` · `assets/css/styles.css` · `docs/clientes/TELA-2-CLIENTES.md`.
Somente Project URL + chave publishable; nenhuma chave secreta; nada gravado no `localStorage`.

**Revisão 2 (28/10):** a busca por e-mail/telefone usa `clientes_buscar_por_contato` (só IDs). Buscar por **trecho** de e-mail (ex.: `paulo.` ou `@gmail.com`) não encontra mais pelo contato — isso é proposital, para não permitir varrer endereços.
