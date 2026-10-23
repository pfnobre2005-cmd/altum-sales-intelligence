# ALTUM Sales Intelligence — Etapa 1 (protótipo)

Plataforma interna de inteligência comercial da ALTUM Nutrition.
**Nesta etapa todos os dados são fictícios**, gerados no navegador e marcados como tal em todas as telas.
Não há login real, banco de dados nem integração com a Nuvemshop — isso vem nas Etapas 2 e 3.

Arquitetura completa: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) · Auditoria: [`docs/AUDITORIA-ETAPA-1.md`](docs/AUDITORIA-ETAPA-1.md) · Plano da Etapa 2 (v2, aguardando aprovação): [`docs/etapa-2/`](docs/etapa-2/00-LEIA-ME.md).

## O que já funciona

| Tela | O que dá para fazer |
|---|---|
| **Dashboard** | 8 indicadores com comparação ao período anterior (30/90/180 dias/12 meses), faturamento mensal 1ª compra × recompra, clientes na janela de recompra, follow-ups vencidos |
| **Clientes** | Busca, filtros (segmento, origem, permissão), ordenação, paginação. Ficha com pedidos, produtos, interações, status comercial, permissões de WhatsApp/e-mail, exportar dados e anonimizar (LGPD) |
| **Recompra** | 6 segmentos: na janela de recompra, recompra atrasada, primeira compra, recorrentes, elegíveis à fidelização, inativos. Cria campanha direto do segmento |
| **Prospecção & funil** | Kanban com as 7 etapas (arrastar e soltar; no celular, pela ficha), observações, próximo acompanhamento, bloqueio de duplicados e exigência de consentimento para avançar |
| **Campanhas** | Público elegível (só quem autorizou o canal), modelos de mensagem, checagem de termos proibidos para suplemento e de opção de descadastro, cópia da mensagem personalizada, marcação manual de envio, conversão e receita por cupom |
| **Inteligência** | Hipóteses para testar (com evidência numérica), recorrência por origem e por produto de entrada, produtos em pedidos repetidos, ranking de campanhas |
| **Integrações & dados** | Status das integrações, regras de segmentação e ciclo de recompra por produto editáveis, backup JSON, registro de alterações |

## Como executar no seu computador

1. Descompacte a pasta `altum-sales-intelligence`.
2. Dê dois cliques em `index.html`. Abre no navegador e já funciona.

Não precisa instalar nada. Os dados de teste ficam salvos só naquele navegador; para começar de novo use
**Integrações & dados → Recriar base fictícia**.

## Como publicar no GitHub Pages

1. Crie um repositório no GitHub (pode ser **privado** se o seu plano permitir Pages em repositório privado; senão, público — nesta etapa não há nenhum dado real nem credencial no código).
2. Envie o conteúdo da pasta (arraste os arquivos em **Add file → Upload files**), mantendo `index.html` na raiz.
3. Em **Settings → Pages**, escolha *Deploy from a branch*, branch `main`, pasta `/ (root)`, e salve.
4. Em 1–2 minutos o endereço aparece na mesma tela (`https://SEU-USUARIO.github.io/NOME-DO-REPO/`).

> Importante: o endereço do GitHub Pages é público. Por isso, a partir da Etapa 2, nenhum dado
> aparece sem login — a proteção fica no Supabase (RLS), não no frontend.

## Roteiro de teste (10 minutos)

1. **Dashboard**: troque o período (30 → 90 dias) e confira que os números e as setas de comparação mudam.
2. **Clientes**: busque "ana", filtre "Sem permissão de marketing", ordene por total gasto. Abra um cliente, registre uma interação, desligue a permissão de WhatsApp.
3. **Recompra**: clique em "Na janela de recompra" → "Criar campanha com este público".
4. Na campanha, escreva "esse produto cura" e veja o alerta; o sistema não deixa salvar. Use o modelo padrão, escolha um cupom e salve.
5. Na campanha criada: **Copiar** uma mensagem e marcar **Enviado**. Confira na ficha do cliente que a interação foi registrada.
6. **Funil**: crie um contato sem consentimento e tente arrastar para "Primeiro atendimento" — deve bloquear. Abra o cartão, marque o consentimento informando a origem e avance.
7. Tente criar outro contato com o mesmo telefone — deve recusar como duplicado.
8. Troque o perfil (rodapé do menu) para **Operador** e veja que regras, ciclos, auditoria e anonimização ficam bloqueados.
9. **Integrações & dados**: mude "Inativo após" para 60 dias e veja o dashboard recalcular. Confira o registro de alterações.
10. Abra no celular (ou reduza a janela do navegador) e navegue pelo menu ☰.

## Estrutura

```
index.html
assets/css/styles.css
assets/js/config.js          configuração (Supabase entra aqui na Etapa 2 — só a publishable key)
assets/js/mock-data.js       gerador de dados FICTÍCIOS (sai na Etapa 3)
assets/js/store.js           camada de dados (única peça trocada na Etapa 2)
assets/js/analytics.js       indicadores e regras de segmentação (reaproveitado)
assets/js/compliance.js      checagem de mensagens (claims de suplemento + descadastro)
assets/js/ui.js              componentes visuais
assets/js/views/*.js         telas
assets/js/app.js             navegação
docs/ARQUITETURA.md          arquitetura técnica
```

## Limitações conhecidas desta etapa

- Login e perfis são simulados (seletor no menu). Proteção real só com Supabase Auth + RLS (Etapa 2).
- Ciclo de recompra por produto e preços são **valores de exemplo**: precisam ser confirmados com o rendimento real de cada embalagem.
- A checagem de mensagens é um filtro auxiliar por palavras; não substitui a revisão do responsável técnico nem a lista da IN 28/2018.
- Cupons vêm da base de teste. O sistema nunca criará cupom na loja; na Etapa 3 apenas lerá os existentes.

## O que vai exigir configuração manual sua nas próximas etapas

- **Etapa 2**: criar a conta/projeto no Supabase (plano gratuito atende o início), criar os usuários (admin/operador) e copiar a URL e a **publishable key** (`sb_publishable_…`) para `config.js`.
- **Etapa 3**: criar o aplicativo na Nuvemshop (Parceiros → aplicativo para a própria loja), autorizar na loja e guardar o token como *secret* da Edge Function — nunca no GitHub.
