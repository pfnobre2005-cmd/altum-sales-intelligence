(function (A) {
  'use strict';
  const { ui } = A;

  A.views.dashboard = {
    title: 'Dashboard comercial',
    render() {
      const db = A.store.db, an = A.analytics;
      const days = A.state.periodo;
      const k = an.kpis(db, days), a = k.atual, p = k.anterior;
      const opps = an.repurchase(db);
      const janela = opps.filter(o => o.status === 'janela');
      const fups = an.followUps(db);
      const series = an.monthlySeries(db, 8);
      const periodos = [[30, '30 dias'], [90, '90 dias'], [180, '180 dias'], [365, '12 meses']];

      return `
      <section class="toolbar">
        <div class="seg-control" role="group" aria-label="Período">
          ${periodos.map(([d, l]) => `<button class="${d === days ? 'active' : ''}" data-days="${d}">${l}</button>`).join('')}
        </div>
        <p class="muted small">Período ${ui.date(k.periodo.start)} – ${ui.date(k.periodo.end)} · comparado a ${ui.date(k.periodo.pStart)} – ${ui.date(k.periodo.pEnd)}</p>
      </section>

      <section class="kpi-grid">
        ${ui.kpi({ label: 'Clientes cadastrados', value: ui.num(a.clientes), delta: ui.delta(a.clientes, p.clientes), hint: 'no fim do período' })}
        ${ui.kpi({ label: 'Novos clientes', value: ui.num(a.novos), delta: ui.delta(a.novos, p.novos), hint: '1º pedido no período' })}
        ${ui.kpi({ label: 'Clientes recorrentes', value: ui.num(a.recorrentes), delta: ui.delta(a.recorrentes, p.recorrentes), hint: 'acumulado · 2+ pedidos pagos' })}
        ${ui.kpi({ label: 'Clientes inativos', value: ui.num(a.inativos), delta: ui.delta(a.inativos, p.inativos, { inverse: true }), hint: `sem pedido há +${db.regras.inativoAposDias} dias` })}
        ${ui.kpi({ label: 'Faturamento (pedidos pagos)', value: ui.brl0(a.faturamento), delta: ui.delta(a.faturamento, p.faturamento), hint: `${ui.num(a.pedidos)} pedidos` })}
        ${ui.kpi({ label: 'Ticket médio', value: ui.brl(a.ticket), delta: ui.delta(a.ticket, p.ticket) })}
        ${ui.kpi({ label: 'Taxa de recompra', value: ui.pct(a.taxaRecompra), delta: ui.delta(a.taxaRecompra, p.taxaRecompra, { isPct: true }), hint: 'acumulado · recorrentes ÷ compradores' })}
        ${ui.kpi({ label: 'Oportunidades de relacionamento', value: ui.num(janela.length + fups.length), hint: `${janela.length} recompras · ${fups.length} follow-ups` })}
      </section>

      <section class="grid-2">
        <article class="card">
          <header class="card-head"><h2>Faturamento mensal</h2><span class="muted small">primeira compra × recompra</span></header>
          ${ui.stackedBars(series, { keys: ['primeira', 'recompra'], names: ['Primeira compra', 'Recompra'], format: ui.brl0 })}
        </article>
        <article class="card">
          <header class="card-head"><h2>Na janela de recompra</h2><a href="#/recompra" class="link">ver todas</a></header>
          ${janela.length ? `<ul class="list">${janela.slice(0, 6).map(o => `
            <li><a href="#/clientes/${o.clienteId}">
              <div><strong>${ui.esc(o.cliente.nome)}</strong><small>${ui.esc(o.produto.nome)} · reposição estimada ${ui.date(o.estimada)}</small></div>
              <div class="list-right">${ui.consentIcons(o.cliente)}</div></a></li>`).join('')}</ul>` : ui.empty('Nenhum cliente na janela agora.')}
        </article>
      </section>

      <section class="card">
        <header class="card-head"><h2>Follow-ups do funil (vencidos ou hoje)</h2><a href="#/funil" class="link">abrir funil</a></header>
        ${fups.length ? `<div class="table-wrap"><table><thead><tr><th>Contato</th><th>Origem</th><th>Etapa</th><th>Agendado</th></tr></thead><tbody>
          ${fups.map(l => `<tr data-lead="${l.id}" class="clickable"><td>${ui.esc(l.nome)}${l.empresa ? `<small class="block muted">${ui.esc(l.empresa)}</small>` : ''}</td>
          <td>${ui.esc(l.origem)}</td><td>${ui.esc(A.views.funil.stageLabel(l.etapa))}</td>
          <td>${ui.date(l.proximoContato)} ${l.proximoContato < an.iso(an.today()) ? ui.badge('atrasado', 'warn') : ui.badge('hoje', 'sage')}</td></tr>`).join('')}
        </tbody></table></div>` : ui.empty('Nenhum follow-up pendente.')}
      </section>`;
    },
    bind(root) {
      root.querySelectorAll('[data-days]').forEach(b => b.addEventListener('click', () => { A.state.periodo = +b.dataset.days; A.router.render(); }));
      root.querySelectorAll('[data-lead]').forEach(tr => tr.addEventListener('click', () => A.views.funil.openLead(tr.dataset.lead)));
    }
  };
})(window.ALTUM);
