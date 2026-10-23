(function (A) {
  'use strict';
  const { ui } = A;
  const OBJ = { recompra: 'Recompra', fidelizacao: 'Fidelização', reativacao: 'Reativação' };
  const CANAL = { whatsapp: 'WhatsApp', email: 'E-mail' };
  const STATUS = { rascunho: ['Rascunho', 'muted'], andamento: ['Em andamento', 'sand'], concluida: ['Concluída', 'sage'] };
  const PUBLICOS = ['janela', 'atrasado', 'primeira_compra', 'recorrentes', 'fieis', 'inativos'];
  const MODELOS = {
    recompra: 'Oi {primeiro_nome}! Aqui é da Altum Nutrition. Você levou {produto} em {data_ultima_compra}. Se quiser repor, o cupom {cupom} vale na próxima compra. Para não receber mais mensagens, responda SAIR.',
    fidelizacao: 'Oi {primeiro_nome}, obrigado por comprar com a Altum mais de uma vez! Como agradecimento, separamos o cupom {cupom}. Para não receber mais mensagens, responda SAIR.',
    reativacao: 'Olá {primeiro_nome}, faz um tempo que você não passa pela loja da Altum. Preparamos o cupom {cupom} para a sua próxima compra. Para não receber mais mensagens, responda SAIR.'
  };

  function complianceBox(texto, canal) {
    const r = A.compliance.check(texto, canal);
    if (r.ok) return '<div class="check-ok">✓ Nenhum termo de risco encontrado e há opção de descadastro. Revisão humana continua obrigatória.</div>';
    return `<div class="check-warn"><strong>Revisar antes de usar:</strong><ul>${r.alertas.map(a => `<li>${ui.esc(a.motivo)}${a.trecho ? ` — “${ui.esc(a.trecho)}”` : ''}</li>`).join('')}</ul>
      <small>Suplemento não pode alegar prevenir, tratar ou curar doença; alegações de benefício só com o texto exato da IN 28/2018 e validação do responsável técnico.</small></div>`;
  }

  function openNew(preset = {}) {
    const db = A.store.db, an = A.analytics;
    const obj0 = preset.objetivo || (preset.publico === 'inativos' ? 'reativacao' : preset.publico === 'fieis' || preset.publico === 'recorrentes' ? 'fidelizacao' : 'recompra');
    ui.modal(`
      <h2>Nova campanha</h2>
      <p class="muted small">Nesta versão nada é disparado automaticamente: o sistema monta a lista e as mensagens; o envio é feito por uma pessoa e marcado aqui.</p>
      <form id="cpf" class="form">
        <div class="form-grid">
          <label>Nome*<input name="nome" required placeholder="Ex.: Recompra Juice — novembro"></label>
          <label>Objetivo<select name="objetivo">${Object.entries(OBJ).map(([k, v]) => `<option value="${k}" ${k === obj0 ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Público<select name="publico">${PUBLICOS.map(k => `<option value="${k}" ${k === (preset.publico || 'janela') ? 'selected' : ''}>${an.SEGMENTOS[k].label}</option>`).join('')}</select></label>
          <label>Canal<select name="canal"><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option></select></label>
          <label>Cupom<select name="cupom"><option value="">Sem cupom</option>${Object.keys(db.cupons).map(c => `<option>${c}</option>`).join('')}</select></label>
        </div>
        <p class="muted small">Cupons listados são os da base de teste. Na Etapa 3 virão da Nuvemshop (o sistema não cria cupom na loja).</p>
        <div id="audInfo" class="notice"></div>
        <label>Mensagem <small class="muted">variáveis: {primeiro_nome} {produto} {data_ultima_compra} {cupom}</small>
          <textarea name="mensagem" rows="5" required>${ui.esc(MODELOS[obj0])}</textarea></label>
        <div id="ckBox"></div>
        <div class="btn-row end"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary">Salvar rascunho</button></div>
      </form>`,
    m => {
      const f = m.querySelector('#cpf');
      const upd = () => {
        const fd = new FormData(f);
        const list = an.audience(db, fd.get('publico'));
        const ok = an.eligible(list, fd.get('canal'));
        m.querySelector('#audInfo').innerHTML = `<b>${ok.length}</b> contatos elegíveis (autorizaram ${CANAL[fd.get('canal')]}) · ${list.length - ok.length} excluídos por falta de permissão.`;
        m.querySelector('#ckBox').innerHTML = complianceBox(fd.get('mensagem'), fd.get('canal'));
      };
      f.objetivo.addEventListener('change', () => { if (!f.mensagem.value.trim() || Object.values(MODELOS).includes(f.mensagem.value)) f.mensagem.value = MODELOS[f.objetivo.value]; upd(); });
      ['publico', 'canal', 'cupom'].forEach(n => f[n].addEventListener('change', upd));
      f.mensagem.addEventListener('input', upd);
      upd();
      f.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(f);
        if (fd.get('mensagem').includes('{cupom}') && !fd.get('cupom')) { ui.toast('A mensagem usa {cupom}: escolha um cupom ou remova a variável.', 'warn'); return; }
        const ck = A.compliance.check(fd.get('mensagem'), fd.get('canal'));
        if (!ck.ok) { ui.toast('Ajuste os pontos de revisão da mensagem antes de salvar.', 'warn'); return; }
        const list = an.eligible(an.audience(db, fd.get('publico')), fd.get('canal'));
        if (!list.length) { ui.toast('Nenhum contato elegível para este público/canal.', 'warn'); return; }
        const c = A.store.addCampanha({
          nome: fd.get('nome').trim(), objetivo: fd.get('objetivo'), publico: fd.get('publico'), canal: fd.get('canal'),
          cupom: fd.get('cupom') || null, mensagem: fd.get('mensagem').trim(), status: 'rascunho',
          destinatarios: list.map(s => ({ clienteId: s.cliente.id, enviadoEm: null }))
        });
        ui.closeModal(); ui.toast('Campanha salva como rascunho.');
        location.hash = '#/campanhas/' + c.id;
      });
    });
  }

  function listView() {
    const db = A.store.db;
    return `
      <section class="toolbar"><button class="btn btn-primary" id="newCamp">+ Nova campanha</button>
      <p class="muted small">Conversão = destinatários marcados como enviados que fizeram pedido pago com o cupom da campanha depois do envio.</p></section>
      <section class="camp-grid">
      ${db.campanhas.map(c => {
        const r = A.analytics.campaignResults(db, c); const [st, tone] = STATUS[c.status];
        return `<a class="card camp-card" href="#/campanhas/${c.id}">
          <div class="camp-top">${ui.badge(st, tone)}${ui.badge(OBJ[c.objetivo], 'neutral')}${ui.badge(CANAL[c.canal], 'neutral')}</div>
          <h3>${ui.esc(c.nome)}</h3>
          <p class="muted small">Público: ${ui.esc(A.analytics.SEGMENTOS[c.publico] ? A.analytics.SEGMENTOS[c.publico].label : c.publico)} · cupom ${ui.esc(c.cupom || '—')}</p>
          <div class="camp-stats"><div><b>${r.enviados}</b>/${r.destinatarios}<small>enviados</small></div><div><b>${r.clientesConvertidos}</b><small>compraram</small></div><div><b>${ui.pct(r.taxa)}</b><small>conversão</small></div><div><b>${ui.brl0(r.receita)}</b><small>receita</small></div></div>
        </a>`; }).join('') || ui.empty('Nenhuma campanha.')}
      </section>`;
  }

  function detailView(id) {
    const db = A.store.db, c = A.store.campanha(id);
    if (!c) return ui.empty('Campanha não encontrada.');
    const r = A.analytics.campaignResults(db, c);
    const stats = A.analytics.customerStats(db);
    const [st, tone] = STATUS[c.status];
    return `
      <a href="#/campanhas" class="link back">← Voltar para campanhas</a>
      <section class="card">
        <header class="card-head"><div><h2 class="display">${ui.esc(c.nome)}</h2>
          <p class="muted small">${OBJ[c.objetivo]} · ${CANAL[c.canal]} · cupom ${ui.esc(c.cupom || '—')} · criada em ${ui.date(c.criadaEm)}</p></div>
          <div class="btn-row">${ui.badge(st, tone)}${c.status !== 'concluida' ? '<button class="btn btn-ghost" id="closeCamp">Marcar como concluída</button>' : ''}</div></header>
        <div class="kpi-grid kpi-grid-5">
          ${ui.kpi({ label: 'Destinatários', value: r.destinatarios })}
          ${ui.kpi({ label: 'Enviados (manual)', value: r.enviados })}
          ${ui.kpi({ label: 'Clientes que compraram', value: r.clientesConvertidos, hint: `${r.pedidos} pedidos` })}
          ${ui.kpi({ label: 'Conversão', value: ui.pct(r.taxa) })}
          ${ui.kpi({ label: 'Receita atribuída', value: ui.brl(r.receita), hint: r.usosForaDoPublico ? `+${r.usosForaDoPublico} usos do cupom fora do público` : '' })}
        </div>
      </section>
      <section class="grid-2">
        <article class="card"><header class="card-head"><h2>Mensagem</h2></header>
          <p class="msg-template">${ui.esc(c.mensagem)}</p>${complianceBox(c.mensagem, c.canal)}</article>
        <article class="card"><header class="card-head"><h2>Como usar</h2></header>
          <ol class="steps"><li>Clique em <b>Copiar</b> na linha do contato — a mensagem já vem personalizada.</li>
          <li>Envie pelo ${CANAL[c.canal]} oficial da Altum.</li><li>Volte aqui e marque <b>Enviado</b>. Só enviados contam na conversão.</li>
          <li>Se o contato pedir para sair, desmarque a permissão na ficha do cliente.</li></ol></article>
      </section>
      <section class="card"><header class="card-head"><h2>Destinatários</h2><span class="muted small">${c.destinatarios.length} contatos</span></header>
        ${c.destinatarios.length ? `<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Prévia da mensagem</th><th>Situação</th><th></th></tr></thead><tbody>
        ${c.destinatarios.map(d => { const s = stats.get(d.clienteId); if (!s) return ''; const blocked = !s.cliente.consentimento[c.canal] || s.cliente.statusComercial === 'nao_contatar';
          return `<tr><td><a href="#/clientes/${d.clienteId}" class="link-strong">${ui.esc(s.cliente.nome)}</a><small class="block muted">${ui.esc(c.canal === 'email' ? s.cliente.email : s.cliente.telefone)}</small></td>
          <td class="msg-cell">${ui.esc(A.compliance.render(c.mensagem, s, c))}</td>
          <td>${d.enviadoEm ? ui.badge('Enviado ' + ui.date(d.enviadoEm), 'sage') : blocked ? ui.badge('Permissão revogada', 'warn') : ui.badge('Pendente', 'muted')}</td>
          <td class="nowrap">${!d.enviadoEm && !blocked && c.status !== 'concluida' ? `<button class="btn btn-ghost btn-sm" data-copy="${d.clienteId}">Copiar</button> <button class="btn btn-primary btn-sm" data-sent="${d.clienteId}">Enviado</button>` : ''}</td></tr>`; }).join('')}
        </tbody></table></div>` : ui.empty('Rascunho sem destinatários. Crie uma nova campanha a partir de um público.')}
      </section>`;
  }

  A.views.campanhas = {
    title: 'Campanhas e mensagens',
    openNew,
    render(id) { return id ? detailView(id) : listView(); },
    bind(root, id) {
      if (!id) { root.querySelector('#newCamp').addEventListener('click', () => openNew()); return; }
      const c = A.store.campanha(id); if (!c) return;
      const stats = A.analytics.customerStats(A.store.db);
      root.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
        const ok = await ui.copy(A.compliance.render(c.mensagem, stats.get(b.dataset.copy), c));
        ui.toast(ok ? 'Mensagem copiada.' : 'Não foi possível copiar.', ok ? 'ok' : 'warn');
      }));
      root.querySelectorAll('[data-sent]').forEach(b => b.addEventListener('click', () => {
        A.store.marcarEnvio(id, b.dataset.sent, A.analytics.iso(new Date()), A.session.role === 'admin' ? 'Administrador' : 'Operador');
        A.router.render();
      }));
      const cl = root.querySelector('#closeCamp');
      if (cl) cl.addEventListener('click', () => { A.store.updateCampanha(id, { status: 'concluida' }, 'Campanha concluída'); A.router.render(); });
    }
  };
})(window.ALTUM);
