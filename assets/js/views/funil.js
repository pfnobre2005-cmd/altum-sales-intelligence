(function (A) {
  'use strict';
  const { ui } = A;
  const STAGES = [
    ['novo', 'Novo contato'], ['autorizado', 'Contato autorizado'], ['atendimento', 'Primeiro atendimento'],
    ['interessado', 'Interessado'], ['proposta', 'Proposta enviada'], ['comprou', 'Compra realizada'], ['perdido', 'Perdido / sem interesse']
  ];
  const label = k => (STAGES.find(s => s[0] === k) || [k, k])[1];
  const autor = () => A.session.role === 'admin' ? 'Administrador' : 'Operador';

  /** Regra LGPD: sair de "Novo contato" exige consentimento registrado. */
  function canMove(lead, etapa) {
    if (etapa !== 'novo' && etapa !== 'perdido' && !lead.consentimento) return 'Registre o consentimento do contato antes de avançar no funil.';
    return null;
  }

  function move(id, etapa) {
    const l = A.store.lead(id); if (!l || l.etapa === etapa) return false;
    const err = canMove(l, etapa);
    if (err) { ui.toast(err, 'warn'); return false; }
    const patch = { etapa };
    if (['comprou', 'perdido'].includes(etapa)) patch.proximoContato = null;
    A.store.updateLead(id, patch, `Funil: ${label(l.etapa)} → ${label(etapa)}`);
    return true;
  }

  function card(l, hoje) {
    const late = l.proximoContato && l.proximoContato < hoje;
    return `<div class="kcard" draggable="true" data-lead="${l.id}" tabindex="0">
      <div class="kcard-top"><strong>${ui.esc(l.nome)}</strong>${l.consentimento ? '<span class="consent on" title="Consentimento registrado">✓</span>' : '<span class="consent off" title="Sem consentimento">!</span>'}</div>
      ${l.empresa ? `<small class="muted block">${ui.esc(l.empresa)}</small>` : ''}
      <div class="kcard-meta">${ui.badge(l.origem, 'sand')}${l.proximoContato ? `<span class="${late ? 'late' : 'muted'} small">↻ ${ui.date(l.proximoContato)}</span>` : ''}</div>
    </div>`;
  }

  function openLead(id) {
    const l = A.store.lead(id); if (!l) return;
    ui.modal(`
      <h2>${ui.esc(l.nome)}</h2>
      <p class="muted small">${ui.esc(l.origem)}${l.empresa ? ' · ' + ui.esc(l.empresa) : ''} · criado em ${ui.date(l.criadoEm)} · ${ui.esc(l.telefone || '')} ${ui.esc(l.email || '')}</p>
      <form id="lf" class="form">
        <div class="form-grid">
          <label>Etapa<select name="etapa">${STAGES.map(([k, t]) => `<option value="${k}" ${l.etapa === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <label>Próximo acompanhamento<input type="date" name="proximoContato" value="${l.proximoContato || ''}"></label>
          <label>Valor potencial (R$)<input type="number" min="0" step="1" name="valorPotencial" value="${l.valorPotencial || ''}"></label>
        </div>
        <label class="check"><input type="checkbox" name="consentimento" ${l.consentimento ? 'checked' : ''}> O contato autorizou ser contatado pela Altum</label>
        <label>Como a autorização foi obtida<input name="consentimentoFonte" value="${ui.esc(l.consentimentoFonte || '')}" placeholder="Ex.: mandou mensagem pedindo informações"></label>
        <label>Nova observação<textarea name="obs" rows="2" placeholder="Registrar o que aconteceu"></textarea></label>
        <div class="btn-row end"><button type="button" class="btn btn-ghost" data-close>Fechar</button><button class="btn btn-primary">Salvar</button></div>
      </form>
      <h3 class="subhead">Observações</h3>
      <ul class="timeline">${(l.observacoes || []).slice().reverse().map(o => `<li><span class="tl-date">${ui.date(o.data)}</span>${ui.esc(o.texto)}<small class="muted"> — ${ui.esc(o.autor)}</small></li>`).join('') || '<li class="muted">Sem observações.</li>'}</ul>`,
    m => m.querySelector('#lf').addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const consent = fd.get('consentimento') === 'on';
      const fonte = fd.get('consentimentoFonte').trim();
      if (consent && !fonte) { ui.toast('Informe como a autorização foi obtida.', 'warn'); return; }
      const etapa = fd.get('etapa');
      if (etapa !== l.etapa) { const err = canMove({ ...l, consentimento: consent }, etapa); if (err) { ui.toast(err, 'warn'); return; } }
      A.store.updateLead(id, { consentimento: consent, consentimentoFonte: fonte, proximoContato: fd.get('proximoContato') || null, valorPotencial: +fd.get('valorPotencial') || 0 }, 'Contato do funil atualizado');
      const obs = fd.get('obs').trim();
      if (obs) A.store.addObservacaoLead(id, { data: A.analytics.iso(new Date()), texto: obs, autor: autor() });
      if (etapa !== l.etapa) move(id, etapa);
      ui.closeModal(); ui.toast('Contato atualizado.'); A.router.render();
    }));
  }

  function openNew() {
    ui.modal(`
      <h2>Novo contato</h2>
      <p class="muted small">Somente contatos captados por canais legítimos (o próprio contato procurou a Altum, indicação, B2B ou importação autorizada).</p>
      <form id="nf" class="form">
        <div class="form-grid">
          <label>Nome*<input name="nome" required></label>
          <label>Origem*<select name="origem">${A.config.leadOrigens.map(o => `<option>${o}</option>`).join('')}</select></label>
          <label>Telefone<input name="telefone" inputmode="tel"></label>
          <label>E-mail<input name="email" type="email"></label>
          <label>Empresa (B2B)<input name="empresa"></label>
          <label>Próximo acompanhamento<input type="date" name="proximoContato"></label>
        </div>
        <label class="check"><input type="checkbox" name="consentimento"> O contato autorizou ser contatado</label>
        <label>Como a autorização foi obtida<input name="consentimentoFonte" placeholder="Obrigatório se autorizado"></label>
        <label>Observação<textarea name="obs" rows="2"></textarea></label>
        <div class="btn-row end"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary">Criar</button></div>
      </form>`,
    m => m.querySelector('#nf').addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const consent = fd.get('consentimento') === 'on';
      const fonte = fd.get('consentimentoFonte').trim();
      if (!fd.get('telefone').trim() && !fd.get('email').trim()) { ui.toast('Informe telefone ou e-mail.', 'warn'); return; }
      if (consent && !fonte) { ui.toast('Informe como a autorização foi obtida.', 'warn'); return; }
      const obs = fd.get('obs').trim();
      const res = A.store.addLead({
        nome: fd.get('nome').trim(), origem: fd.get('origem'), telefone: fd.get('telefone').trim(), email: fd.get('email').trim(),
        empresa: fd.get('empresa').trim(), etapa: consent ? 'autorizado' : 'novo', consentimento: consent, consentimentoFonte: fonte,
        proximoContato: fd.get('proximoContato') || null, valorPotencial: 0,
        observacoes: obs ? [{ data: A.analytics.iso(new Date()), texto: obs, autor: autor() }] : []
      });
      if (res.erro) { ui.toast(res.erro, 'warn'); return; }
      ui.closeModal(); ui.toast('Contato criado.'); A.router.render();
    }));
  }

  A.views.funil = {
    title: 'Prospecção & funil de vendas',
    stageLabel: label, openLead,
    render() {
      const db = A.store.db, hoje = A.analytics.iso(A.analytics.today());
      const f = A.state.funil.origem;
      const leads = db.leads.filter(l => !f || l.origem === f);
      const abertos = leads.filter(l => !['comprou', 'perdido'].includes(l.etapa));
      const ganhos = leads.filter(l => l.etapa === 'comprou').length, perdidos = leads.filter(l => l.etapa === 'perdido').length;
      return `
      <section class="toolbar">
        <div class="btn-row">
          <button class="btn btn-primary" id="newLead">+ Novo contato</button>
          <select id="forig" aria-label="Filtrar origem"><option value="">Todas as origens</option>${A.config.leadOrigens.map(o => `<option ${f === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
        </div>
        <p class="muted small">${abertos.length} em aberto (${ui.brl0(abertos.reduce((t, l) => t + (l.valorPotencial || 0), 0))} potencial) · ${ganhos} compras · ${perdidos} perdidos · conversão ${ui.pct((ganhos + perdidos) ? ganhos / (ganhos + perdidos) : NaN)} dos encerrados · arraste os cartões entre colunas</p>
      </section>
      <section class="kanban">
        ${STAGES.map(([k, t]) => { const col = leads.filter(l => l.etapa === k); return `
          <div class="kcol" data-stage="${k}"><header><span>${t}</span><span class="count">${col.length}</span></header>
          <div class="kcol-body">${col.map(l => card(l, hoje)).join('') || '<div class="kempty">—</div>'}</div></div>`; }).join('')}
      </section>`;
    },
    bind(root) {
      root.querySelector('#newLead').addEventListener('click', openNew);
      root.querySelector('#forig').addEventListener('change', e => { A.state.funil.origem = e.target.value; A.router.render(); });
      root.querySelectorAll('.kcard').forEach(c => {
        c.addEventListener('click', () => openLead(c.dataset.lead));
        c.addEventListener('keydown', e => { if (e.key === 'Enter') openLead(c.dataset.lead); });
        c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', c.dataset.lead); c.classList.add('dragging'); });
        c.addEventListener('dragend', () => c.classList.remove('dragging'));
      });
      root.querySelectorAll('.kcol').forEach(col => {
        col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('over'); });
        col.addEventListener('dragleave', () => col.classList.remove('over'));
        col.addEventListener('drop', e => {
          e.preventDefault(); col.classList.remove('over');
          if (move(e.dataTransfer.getData('text/plain'), col.dataset.stage)) A.router.render();
        });
      });
    }
  };
})(window.ALTUM);
