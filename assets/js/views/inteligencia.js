(function (A) {
  'use strict';
  const { ui } = A;

  A.views.inteligencia = {
    title: 'Inteligência comercial',
    render() {
      const db = A.store.db, an = A.analytics;
      const hip = an.hypotheses(db);
      const porOrigem = an.recurrenceBy(db, s => s.cliente.origem);
      const prod0 = Object.fromEntries(db.produtos.map(p => [p.id, p.nome]));
      const porEntrada = an.recurrenceBy(db, s => prod0[s.pedidos[0].itens[0].produtoId]);
      const prods = an.productInsights(db);
      const camps = db.campanhas.filter(c => c.status !== 'rascunho').map(c => ({ c, r: an.campaignResults(db, c) }));
      const opps = an.repurchase(db);
      const fups = an.followUps(db);
      const bars = rows => ui.hbars(rows.map(g => ({ label: g.chave, sub: `${g.recorrentes}/${g.compradores} compradores${g.amostraPequena ? ' · amostra pequena' : ''}`, value: g.taxa, dim: g.amostraPequena })));

      return `
      <section class="card">
        <header class="card-head"><h2>Hipóteses para testar</h2><span class="muted small">geradas a partir dos dados — validar com teste antes de concluir</span></header>
        ${hip.length ? `<div class="hyp-grid">${hip.map((h, i) => `<div class="hyp"><span class="hyp-n">H${i + 1}</span><h3>${ui.esc(h.titulo)}</h3>
          <p><b>Evidência:</b> ${ui.esc(h.evidencia)}</p><p><b>Teste sugerido:</b> ${ui.esc(h.teste)}</p></div>`).join('')}</div>` : ui.empty('Dados insuficientes para hipóteses.')}
      </section>

      <section class="grid-2">
        <article class="card"><header class="card-head"><h2>Recorrência por origem do cliente</h2></header>${bars(porOrigem)}</article>
        <article class="card"><header class="card-head"><h2>Recorrência por produto da 1ª compra</h2></header>${bars(porEntrada)}</article>
      </section>

      <section class="card">
        <header class="card-head"><h2>Produtos em pedidos repetidos</h2></header>
        <div class="table-wrap"><table><thead><tr><th>Produto</th><th class="num">Compradores</th><th class="num">Recompraram o mesmo</th><th class="num">Taxa</th><th class="num">Presença em recompras</th><th class="num">Receita (itens)</th><th class="num hide-sm">Ciclo usado</th></tr></thead><tbody>
        ${prods.map(p => `<tr><td>${ui.esc(p.produto.nome)}</td><td class="num">${p.compradores}</td><td class="num">${p.recompradores}</td><td class="num">${ui.pct(p.taxa)}</td><td class="num">${p.pedidosRecompra}</td><td class="num">${ui.brl0(p.receita)}</td><td class="num hide-sm">${p.produto.cicloDias} d</td></tr>`).join('')}
        </tbody></table></div>
        <p class="muted small">"Presença em recompras" = quantos pedidos a partir do 2º de cada cliente contêm o produto.</p>
      </section>

      <section class="grid-2">
        <article class="card"><header class="card-head"><h2>Campanhas que geraram vendas</h2><a href="#/campanhas" class="link">campanhas</a></header>
          ${camps.length ? `<div class="table-wrap"><table><thead><tr><th>Campanha</th><th class="num">Enviados</th><th class="num">Conversão</th><th class="num">Receita</th></tr></thead><tbody>
          ${camps.sort((a, b) => b.r.taxa - a.r.taxa).map(x => `<tr><td><a class="link-strong" href="#/campanhas/${x.c.id}">${ui.esc(x.c.nome)}</a></td><td class="num">${x.r.enviados}</td><td class="num">${ui.pct(x.r.taxa)}</td><td class="num">${ui.brl0(x.r.receita)}</td></tr>`).join('')}
          </tbody></table></div>` : ui.empty('Nenhuma campanha enviada ainda.')}
        </article>
        <article class="card"><header class="card-head"><h2>O que merece acompanhamento agora</h2></header>
          <ul class="list plain">
            <li><a href="#/recompra" data-seg="janela"><span><b>${opps.filter(o => o.status === 'janela').length}</b> clientes na janela de recompra</span><span class="link">abrir</span></a></li>
            <li><a href="#/recompra" data-seg="atrasado"><span><b>${opps.filter(o => o.status === 'atrasado').length}</b> recompras atrasadas (ainda não inativos)</span><span class="link">abrir</span></a></li>
            <li><a href="#/funil"><span><b>${fups.length}</b> follow-ups do funil vencidos ou para hoje</span><span class="link">abrir</span></a></li>
            <li><a href="#/recompra" data-seg="fieis"><span><b>${an.audience(db, 'fieis').length}</b> clientes elegíveis à fidelização</span><span class="link">abrir</span></a></li>
          </ul>
        </article>
      </section>`;
    },
    bind(root) {
      root.querySelectorAll('[data-seg]').forEach(a => a.addEventListener('click', () => { A.state.recompra.seg = a.dataset.seg; }));
    }
  };
})(window.ALTUM);
