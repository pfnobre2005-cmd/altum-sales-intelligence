(function (A) {
  'use strict';
  const { ui } = A;

  // Teste da Nuvemshop: estado só em memória; guarda apenas o resumo (quantidade e status de pagamento)
  const nuv = { testando: false, resultado: null, erro: null };
  const ROTULO_PAGAMENTO = { paid: 'Pago', pending: 'Pendente', authorized: 'Autorizado', abandoned: 'Abandonado',
                             refunded: 'Reembolsado', voided: 'Cancelado', partially_paid: 'Pago parcialmente',
                             partially_refunded: 'Reembolsado parcialmente', outro: 'Outro' };

  function secaoNuvemshop(admin) {
    let resultado = '';
    if (nuv.erro) {
      resultado = `<div class="auth-msg auth-msg-erro" role="alert" id="nuvemshopErro">${ui.esc(nuv.erro)}</div>`;
    } else if (nuv.resultado) {
      const r = nuv.resultado;
      const hora = r.em.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      resultado = `<div class="nuvemshop-ok" role="status" id="nuvemshopResultado">
          <p><strong>Conexão bem-sucedida</strong> <span class="muted small">· testada às ${hora}</span></p>
          ${r.reconhecido ? `<p>Pedidos retornados pela consulta: <strong id="nuvemshopQtd">${r.pedidos === null ? '—' : ui.num(r.pedidos)}</strong></p>
            ${r.status.length ? `<ul class="list-plain" id="nuvemshopStatus">${r.status.map(s => `<li>${ui.esc(ROTULO_PAGAMENTO[s.status] || s.status)}: <strong>${ui.num(s.n)}</strong></li>`).join('')}</ul>`
                             : '<p class="small muted" id="nuvemshopStatus">A resposta não trouxe status de pagamento.</p>'}`
            : '<p class="small muted">A função respondeu, mas em um formato sem quantidade de pedidos reconhecível. Nada foi exibido por segurança.</p>'}
        </div>`;
    }
    return `<section class="card" id="secaoNuvemshop">
        <header class="card-head"><h2>Nuvemshop</h2>${ui.badge('Somente teste de leitura', 'sand')}</header>
        <p class="small">Testa a função <code>nuvemshop-consulta</code> do Supabase, que consulta pedidos da loja em modo somente leitura.
          O token da loja fica só no servidor. <strong>Nada é gravado, importado ou sincronizado</strong>; a tela mostra apenas a quantidade de pedidos e os status de pagamento.</p>
        ${admin ? `<div class="btn-row"><button class="btn btn-primary" type="button" id="testarNuvemshop" ${nuv.testando ? 'disabled aria-busy="true"' : ''}>${nuv.testando ? 'Testando…' : 'Testar conexão'}</button></div>`
                : '<p class="muted small" id="nuvemshopSoAdmin">O teste de conexão é restrito a administradores.</p>'}
        ${resultado}
      </section>`;
  }

  async function testar() {
    if (nuv.testando || !A.session.isAdmin()) return;
    nuv.testando = true; nuv.erro = null; nuv.resultado = null;
    if (A.router.parse().name === 'configuracoes') A.router.render();
    try { nuv.resultado = await A.repositorio.testarNuvemshop(); }
    catch (e) { nuv.erro = (e && e.message) || 'Erro inesperado ao testar a conexão.'; }
    finally { nuv.testando = false; }
    if (A.router.parse().name === 'configuracoes') A.router.render();
  }

  A.views.configuracoes = {
    title: 'Integrações & dados',
    render() {
      const db = A.store.db, admin = A.session.isAdmin(), r = db.regras;
      const dis = admin ? '' : 'disabled';
      return `
      <section class="grid-3">
        <article class="card integ"><div class="integ-head"><h3>Supabase</h3>${ui.badge('Não configurado', 'muted')}</div>
          <p class="small">Login, banco de dados e regras de acesso. <b>Etapa 2.</b></p></article>
        <article class="card integ"><div class="integ-head"><h3>Nuvemshop</h3>${ui.badge('Só teste de leitura', 'sand')}</div>
          <p class="small">Clientes, pedidos, produtos e cupons via API oficial, com token guardado só no backend. Sincronização: <b>Etapa 3.</b></p></article>
        <article class="card integ"><div class="integ-head"><h3>WhatsApp / e-mail</h3>${ui.badge('Fora da V1', 'muted')}</div>
          <p class="small">Sem disparo automático na primeira versão. Futuro: somente soluções oficiais, com consentimento e descadastro.</p></article>
      </section>

      ${secaoNuvemshop(admin)}

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
      const tn = root.querySelector('#testarNuvemshop');
      if (tn) tn.addEventListener('click', testar);
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
