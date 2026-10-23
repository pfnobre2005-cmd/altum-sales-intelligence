(function (A) {
  'use strict';
  const { ui } = A;

  A.views.configuracoes = {
    title: 'Integrações & dados',
    render() {
      const db = A.store.db, admin = A.session.isAdmin(), r = db.regras;
      const dis = admin ? '' : 'disabled';
      return `
      <section class="grid-3">
        <article class="card integ"><div class="integ-head"><h3>Supabase</h3>${ui.badge('Não configurado', 'muted')}</div>
          <p class="small">Login, banco de dados e regras de acesso. <b>Etapa 2.</b></p></article>
        <article class="card integ"><div class="integ-head"><h3>Nuvemshop</h3>${ui.badge('Não conectada', 'muted')}</div>
          <p class="small">Clientes, pedidos, produtos e cupons via API oficial, com token guardado só no backend. <b>Etapa 3.</b></p></article>
        <article class="card integ"><div class="integ-head"><h3>WhatsApp / e-mail</h3>${ui.badge('Fora da V1', 'muted')}</div>
          <p class="small">Sem disparo automático na primeira versão. Futuro: somente soluções oficiais, com consentimento e descadastro.</p></article>
      </section>

      <section class="card">
        <header class="card-head"><h2>Fonte dos dados</h2>${ui.badge('Dados fictícios', 'warn')}</header>
        <p>${ui.esc(db.meta.aviso)} Gerada em ${ui.date(db.meta.geradoEm)}: ${db.clientes.length} clientes, ${db.pedidos.length} pedidos, ${db.leads.length} contatos no funil. Fica salva apenas neste navegador.</p>
        <div class="btn-row">
          <button class="btn btn-ghost" id="exportAll">Exportar backup (JSON)</button>
          <button class="btn btn-danger" id="resetDb" ${dis}>Recriar base fictícia</button>
        </div>
        ${admin ? '' : '<p class="muted small">Recriar a base é restrito ao administrador.</p>'}
      </section>

      <section class="grid-2">
        <article class="card">
          <header class="card-head"><h2>Regras de segmentação</h2></header>
          <form id="rulesForm" class="form">
            <div class="form-grid">
              <label>Inativo após (dias sem pedido)<input type="number" min="15" max="720" name="inativoAposDias" value="${r.inativoAposDias}" ${dis}></label>
              <label>Fidelização a partir de (pedidos)<input type="number" min="2" max="20" name="fidelidadeMinPedidos" value="${r.fidelidadeMinPedidos}" ${dis}></label>
              <label>Janela: dias antes da reposição<input type="number" min="0" max="60" name="janelaAntesDias" value="${r.janelaAntesDias}" ${dis}></label>
              <label>Janela: dias depois da reposição<input type="number" min="0" max="120" name="janelaDepoisDias" value="${r.janelaDepoisDias}" ${dis}></label>
            </div>
            ${admin ? '<div class="btn-row end"><button class="btn btn-primary">Salvar regras</button></div>' : ''}
          </form>
        </article>
        <article class="card">
          <header class="card-head"><h2>Ciclo de recompra por produto</h2></header>
          <p class="muted small">Em quantos dias um pedido de 1 unidade costuma ser reposto. <b>Valores de exemplo — confirme com o rendimento real de cada embalagem.</b></p>
          <form id="cycleForm" class="form">
            <div class="table-wrap"><table><thead><tr><th>Produto</th><th class="num">Ciclo (dias)</th></tr></thead><tbody>
              ${db.produtos.map(p => `<tr><td>${ui.esc(p.nome)}</td><td class="num"><input class="input-sm" type="number" min="1" max="365" name="${p.id}" value="${p.cicloDias}" ${dis}></td></tr>`).join('')}
            </tbody></table></div>
            ${admin ? '<div class="btn-row end"><button class="btn btn-primary">Salvar ciclos</button></div>' : ''}
          </form>
        </article>
      </section>

      <section class="card">
        <header class="card-head"><h2>Registro de alterações</h2><span class="muted small">últimas 50</span></header>
        ${admin ? `<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Perfil</th><th>Ação</th><th>Detalhe</th></tr></thead><tbody>
          ${db.auditoria.slice(0, 50).map(a => `<tr><td class="nowrap">${new Date(a.data).toLocaleString('pt-BR')}</td><td>${ui.esc(a.usuario)}</td><td>${ui.esc(a.acao)}</td><td>${ui.esc(a.detalhe)}</td></tr>`).join('')}
        </tbody></table></div>` : ui.empty('Visível apenas para administradores.')}
      </section>`;
    },
    bind(root) {
      root.querySelector('#exportAll').addEventListener('click', () => {
        ui.download(`altum-si-backup-${A.analytics.iso(new Date())}.json`, A.store.exportJSON());
        A.store.audit('Backup exportado', 'Arquivo JSON completo');
      });
      const rs = root.querySelector('#resetDb');
      if (rs && A.session.isAdmin()) rs.addEventListener('click', () => {
        ui.modal(`<h2>Recriar a base fictícia?</h2><p>Todas as alterações feitas nos dados de teste (contatos, campanhas, interações) serão perdidas.</p>
          <div class="btn-row end"><button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-danger" id="confReset">Recriar</button></div>`,
        m => m.querySelector('#confReset').addEventListener('click', () => { A.store.reset(); ui.closeModal(); ui.toast('Base fictícia recriada.'); A.router.render(); }));
      });
      const rf = root.querySelector('#rulesForm');
      rf.addEventListener('submit', e => {
        e.preventDefault(); if (!A.session.isAdmin()) return;
        const fd = new FormData(rf); const patch = {};
        ['inativoAposDias', 'fidelidadeMinPedidos', 'janelaAntesDias', 'janelaDepoisDias'].forEach(k => { const v = parseInt(fd.get(k), 10); if (!isNaN(v)) patch[k] = v; });
        A.store.setRegras(patch);
        ui.toast('Regras salvas.'); A.router.render();
      });
      const cf = root.querySelector('#cycleForm');
      cf.addEventListener('submit', e => {
        e.preventDefault(); if (!A.session.isAdmin()) return;
        const fd = new FormData(cf);
        A.store.setCiclos(Object.fromEntries(A.store.db.produtos.map(p => [p.id, parseInt(fd.get(p.id), 10)])));
        ui.toast('Ciclos salvos.'); A.router.render();
      });
    }
  };
})(window.ALTUM);
