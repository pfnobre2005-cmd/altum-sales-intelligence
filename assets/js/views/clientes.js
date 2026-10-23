(function (A) {
  'use strict';
  const { ui } = A;
  const PAGE = 25;
  const STATUS = { ativo: 'Ativo', acompanhamento: 'Em acompanhamento', nao_contatar: 'Não contatar' };

  function filtered() {
    const st = A.state.clientes;
    const stats = [...A.analytics.customerStats(A.store.db).values()];
    const q = st.q.trim().toLowerCase();
    let rows = stats.filter(s => {
      const c = s.cliente;
      if (q && !(`${c.nome} ${c.email} ${c.telefone} ${c.cidade}`.toLowerCase().includes(q))) return false;
      if (st.seg && s.segmento !== st.seg) return false;
      if (st.origem && c.origem !== st.origem) return false;
      if (st.consent === 'whatsapp' && !c.consentimento.whatsapp) return false;
      if (st.consent === 'email' && !c.consentimento.email) return false;
      if (st.consent === 'nenhum' && (c.consentimento.whatsapp || c.consentimento.email)) return false;
      return true;
    });
    const key = { nome: s => s.cliente.nome, total: s => s.total, pedidos: s => s.n, ultima: s => s.ultima || '' }[st.sort];
    rows.sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * st.dir; });
    return rows;
  }

  function tableHTML() {
    const st = A.state.clientes;
    const rows = filtered();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    st.page = Math.min(st.page, pages);
    const slice = rows.slice((st.page - 1) * PAGE, st.page * PAGE);
    const th = (k, l, cls = '') => `<th class="sortable ${cls}" data-sort="${k}">${l}${st.sort === k ? (st.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
    return `<p class="muted small">${ui.num(rows.length)} clientes encontrados</p>
      <div class="table-wrap"><table class="table-clientes"><thead><tr>
        ${th('nome', 'Cliente')}<th class="hide-sm">Origem</th>${th('pedidos', 'Pedidos', 'num')}${th('total', 'Total gasto', 'num')}${th('ultima', 'Última compra')}<th>Segmento</th><th class="hide-sm">Permissões</th>
      </tr></thead><tbody>
      ${slice.map(s => `<tr class="clickable" data-id="${s.cliente.id}">
        <td><strong>${ui.esc(s.cliente.nome)}</strong><small class="block muted">${ui.esc(s.cliente.email || '—')}</small></td>
        <td class="hide-sm">${ui.esc(s.cliente.origem)}</td>
        <td class="num">${s.n}</td><td class="num">${ui.brl(s.total)}</td>
        <td>${ui.date(s.ultima)}</td><td>${ui.segBadge(s.segmento)}${s.cliente.statusComercial === 'nao_contatar' ? ' ' + ui.badge('não contatar', 'warn') : ''}</td>
        <td class="hide-sm">${ui.consentIcons(s.cliente)}</td></tr>`).join('') || `<tr><td colspan="7">${ui.empty('Nenhum cliente com esses filtros.')}</td></tr>`}
      </tbody></table></div>
      <div class="pager">
        <button class="btn btn-ghost" data-page="-1" ${st.page <= 1 ? 'disabled' : ''}>← Anterior</button>
        <span class="muted small">Página ${st.page} de ${pages}</span>
        <button class="btn btn-ghost" data-page="1" ${st.page >= pages ? 'disabled' : ''}>Próxima →</button>
      </div>`;
  }

  function listView() {
    const st = A.state.clientes, db = A.store.db;
    const origens = [...new Set(db.clientes.map(c => c.origem))].sort();
    const segs = [['primeira_compra', '1ª compra (ativo)'], ['recorrentes', `Recorrente (2 a ${db.regras.fidelidadeMinPedidos - 1} pedidos, ativo)`], ['fieis', `Fiel (${db.regras.fidelidadeMinPedidos}+ pedidos, ativo)`], ['inativos', 'Inativo']];
    return `
      <section class="filters card">
        <input type="search" id="fq" placeholder="Buscar por nome, e-mail, telefone ou cidade" value="${ui.esc(st.q)}" aria-label="Buscar">
        <select id="fseg" aria-label="Segmento"><option value="">Todos os segmentos</option>${segs.map(([v, l]) => `<option value="${v}" ${st.seg === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select id="forig" aria-label="Origem"><option value="">Todas as origens</option>${origens.map(o => `<option ${st.origem === o ? 'selected' : ''}>${ui.esc(o)}</option>`).join('')}</select>
        <select id="fcons" aria-label="Permissão"><option value="">Qualquer permissão</option>
          <option value="whatsapp" ${st.consent === 'whatsapp' ? 'selected' : ''}>Autorizou WhatsApp</option>
          <option value="email" ${st.consent === 'email' ? 'selected' : ''}>Autorizou e-mail</option>
          <option value="nenhum" ${st.consent === 'nenhum' ? 'selected' : ''}>Sem permissão de marketing</option></select>
      </section>
      <section class="card" id="clientesTable">${tableHTML()}</section>`;
  }

  function detailView(id) {
    const db = A.store.db;
    const s = A.analytics.customerStats(db).get(id);
    if (!s) return ui.empty('Cliente não encontrado.');
    const c = s.cliente;
    const allOrders = db.pedidos.filter(o => o.clienteId === id).sort((a, b) => b.data.localeCompare(a.data));
    const prods = Object.entries(s.produtos).sort((a, b) => b[1] - a[1]);
    const opp = A.analytics.repurchase(db).find(o => o.clienteId === id);
    return `
      <a href="#/clientes" class="link back">← Voltar para clientes</a>
      <section class="card profile">
        <div>
          <h2 class="display">${ui.esc(c.nome)}</h2>
          <p class="muted">${ui.esc(c.email || '—')} · ${ui.esc(c.telefone || '—')} · ${ui.esc([c.cidade, c.uf].filter(Boolean).join('/') || '—')}</p>
          <p class="small">Origem: <strong>${ui.esc(c.origem)}</strong> · cliente desde ${ui.date(c.criadoEm)} ${c.anonimizado ? ui.badge('anonimizado', 'muted') : ''}</p>
        </div>
        <div class="profile-side">
          ${ui.segBadge(s.segmento)}
          <label class="field-inline">Status comercial
            <select id="statusCom">${Object.entries(STATUS).map(([v, l]) => `<option value="${v}" ${c.statusComercial === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          </label>
        </div>
      </section>

      ${opp ? `<div class="notice">${opp.status === 'janela' ? 'Na janela estimada de reposição' : 'Reposição estimada já passou'} de <strong>${ui.esc(opp.produto.nome)}</strong> (estimativa: ${ui.date(opp.estimada)}). Hipótese comercial com base no ciclo configurado — não é recomendação de consumo.</div>` : ''}

      <section class="kpi-grid kpi-grid-6">
        ${ui.kpi({ label: 'Pedidos pagos', value: s.n })}
        ${ui.kpi({ label: 'Total gasto', value: ui.brl(s.total) })}
        ${ui.kpi({ label: 'Ticket médio', value: ui.brl(s.n ? s.total / s.n : 0) })}
        ${ui.kpi({ label: 'Primeira compra', value: ui.date(s.primeira) })}
        ${ui.kpi({ label: 'Última compra', value: ui.date(s.ultima) })}
        ${ui.kpi({ label: 'Dias sem comprar', value: s.diasSemComprar ?? '—' })}
      </section>

      <section class="grid-2">
        <article class="card">
          <header class="card-head"><h2>Histórico de pedidos</h2></header>
          <div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Data</th><th>Itens</th><th>Cupom</th><th class="num">Total</th></tr></thead><tbody>
          ${allOrders.map(o => `<tr class="${o.status !== 'pago' ? 'row-muted' : ''}"><td>${o.id}${o.status !== 'pago' ? ' ' + ui.badge(o.status, 'muted') : ''}</td><td>${ui.date(o.data)}</td>
            <td>${o.itens.map(it => `${it.qtd}× ${ui.esc((A.store.produto(it.produtoId) || {}).nome || it.produtoId)}`).join('<br>')}</td>
            <td>${o.cupom ? ui.badge(o.cupom, 'sand') : '—'}</td><td class="num">${ui.brl(o.total)}</td></tr>`).join('') || `<tr><td colspan="5">${ui.empty('Sem pedidos.')}</td></tr>`}
          </tbody></table></div>
          <h3 class="subhead">Produtos adquiridos</h3>
          <div class="chips">${prods.map(([pid, q]) => `<span class="chip">${ui.esc((A.store.produto(pid) || {}).nome || pid)} <b>${q}</b></span>`).join('') || '—'}</div>
        </article>

        <div class="stack">
          <article class="card">
            <header class="card-head"><h2>Permissões de comunicação</h2></header>
            <p class="muted small">Marketing só com autorização. Atendimento ao pedido (entrega, troca) não depende disto.</p>
            <label class="switch"><input type="checkbox" data-consent="whatsapp" ${c.consentimento.whatsapp ? 'checked' : ''} ${c.anonimizado ? 'disabled' : ''}><span></span> WhatsApp (marketing)</label>
            <label class="switch"><input type="checkbox" data-consent="email" ${c.consentimento.email ? 'checked' : ''} ${c.anonimizado ? 'disabled' : ''}><span></span> E-mail (marketing)</label>
            <p class="muted small">Última atualização: ${ui.date(c.consentimento.atualizadoEm)} · fonte: ${ui.esc(c.consentimento.fonte || '—')}</p>
          </article>

          <article class="card">
            <header class="card-head"><h2>Interações</h2></header>
            <form id="interForm" class="inline-form">
              <select name="canal" aria-label="Canal"><option>WhatsApp</option><option>E-mail</option><option>Telefone</option><option>Instagram</option></select>
              <input name="nota" placeholder="O que foi conversado?" required aria-label="Nota">
              <button class="btn btn-primary">Registrar</button>
            </form>
            <ul class="timeline">${c.interacoes.map(i => `<li><span class="tl-date">${ui.date(i.data)} · ${ui.esc(i.canal)}</span>${ui.esc(i.nota)}<small class="muted"> — ${ui.esc(i.autor)}</small></li>`).join('') || `<li class="muted">Nenhuma interação registrada.</li>`}</ul>
          </article>

          <article class="card">
            <header class="card-head"><h2>Privacidade (LGPD)</h2></header>
            <div class="btn-row">
              <button class="btn btn-ghost" id="exportCli">Exportar dados do cliente</button>
              ${A.session.isAdmin() && !c.anonimizado ? '<button class="btn btn-danger" id="anonCli">Anonimizar</button>' : ''}
            </div>
            <p class="muted small">Anonimizar remove nome e contatos e mantém os pedidos sem dados pessoais (para não distorcer os indicadores). Apenas administradores.</p>
          </article>
        </div>
      </section>`;
  }

  A.views.clientes = {
    title: 'Central de clientes',
    render(id) { return id ? detailView(id) : listView(); },
    bind(root, id) {
      if (id) return bindDetail(root, id);
      const st = A.state.clientes;
      const refresh = () => { root.querySelector('#clientesTable').innerHTML = tableHTML(); bindTable(); };
      function bindTable() {
        root.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => { location.hash = '#/clientes/' + tr.dataset.id; }));
        root.querySelectorAll('[data-sort]').forEach(th => th.addEventListener('click', () => {
          const k = th.dataset.sort; if (st.sort === k) st.dir *= -1; else { st.sort = k; st.dir = k === 'nome' ? 1 : -1; } refresh();
        }));
        root.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { st.page += +b.dataset.page; refresh(); }));
      }
      let t;
      root.querySelector('#fq').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; st.page = 1; refresh(); }, 180); });
      root.querySelector('#fseg').addEventListener('change', e => { st.seg = e.target.value; st.page = 1; refresh(); });
      root.querySelector('#forig').addEventListener('change', e => { st.origem = e.target.value; st.page = 1; refresh(); });
      root.querySelector('#fcons').addEventListener('change', e => { st.consent = e.target.value; st.page = 1; refresh(); });
      bindTable();
    }
  };

  function bindDetail(root, id) {
    const c = A.store.cliente(id); if (!c) return;
    const sel = root.querySelector('#statusCom');
    if (sel) sel.addEventListener('change', () => {
      A.store.updateCliente(id, { statusComercial: sel.value }, `Status comercial → ${STATUS[sel.value]}`);
      ui.toast('Status atualizado.'); A.router.render();
    });
    root.querySelectorAll('[data-consent]').forEach(cb => cb.addEventListener('change', () => {
      A.store.setConsentimento(id, cb.dataset.consent, cb.checked);
      ui.toast('Permissão registrada no histórico de auditoria.'); A.router.render();
    }));
    const f = root.querySelector('#interForm');
    if (f) f.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(f);
      A.store.addInteracao(id, { data: A.analytics.iso(new Date()), canal: fd.get('canal'), nota: fd.get('nota').trim(), autor: A.session.role === 'admin' ? 'Administrador' : 'Operador' });
      ui.toast('Interação registrada.'); A.router.render();
    });
    root.querySelector('#exportCli').addEventListener('click', () => {
      const pedidos = A.store.pedidosDoCliente(id);
      ui.download(`cliente-${id}.json`, JSON.stringify({ aviso: A.store.db.meta.aviso, cliente: c, pedidos }, null, 2));
      A.store.audit('Exportação de dados do cliente', `${c.nome} (${id})`);
    });
    const an = root.querySelector('#anonCli');
    if (an) an.addEventListener('click', () => {
      ui.modal(`<h2>Anonimizar ${ui.esc(c.nome)}?</h2><p>Nome, e-mail, telefone, cidade e interações serão apagados. Os pedidos continuam contando nos indicadores, sem identificação. Esta ação não pode ser desfeita.</p>
        <div class="btn-row end"><button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-danger" id="confAnon">Anonimizar</button></div>`,
        m => m.querySelector('#confAnon').addEventListener('click', () => { A.store.anonimizarCliente(id); ui.closeModal(); ui.toast('Cliente anonimizado.'); A.router.render(); }));
    });
  }
})(window.ALTUM);
