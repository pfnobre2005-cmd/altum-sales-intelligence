(function (A) {
  'use strict';
  const { ui } = A;
  const ORDER = ['janela', 'atrasado', 'primeira_compra', 'recorrentes', 'fieis', 'inativos'];

  A.views.recompra = {
    title: 'Inteligência de recompra',
    render() {
      const db = A.store.db, an = A.analytics;
      const seg = A.state.recompra.seg;
      const opps = an.repurchase(db);
      const oppMap = new Map(opps.map(o => [o.clienteId, o]));
      const lists = Object.fromEntries(ORDER.map(k => [k, an.audience(db, k)]));
      const list = lists[seg].slice().sort((a, b) => (a.ultima || '').localeCompare(b.ultima || '') * -1);
      const r = db.regras;

      return `
      <div class="notice">Regras ativas: inativo após <b>${r.inativoAposDias} dias</b> sem pedido · fidelização a partir de <b>${r.fidelidadeMinPedidos} pedidos</b> · janela de recompra de <b>${r.janelaAntesDias} dias antes</b> a <b>${r.janelaDepoisDias} dias depois</b> da reposição estimada (ciclo por produto). Ajuste em <a href="#/configuracoes" class="link">Integrações & Dados</a>.
      <br><small>As estimativas são hipóteses comerciais a partir do histórico de pedidos — não indicam necessidade de consumo nem orientação de saúde.</small></div>

      <section class="seg-cards">
        ${ORDER.map(k => `<button class="seg-card ${k === seg ? 'active' : ''}" data-seg="${k}">
          <span class="seg-num">${ui.num(lists[k].length)}</span>
          <span class="seg-name">${ui.esc(an.SEGMENTOS[k].label)}</span>
          <span class="seg-desc">${ui.esc(an.SEGMENTOS[k].desc)}</span></button>`).join('')}
      </section>

      <section class="card">
        <header class="card-head">
          <h2>${ui.esc(an.SEGMENTOS[seg].label)}</h2>
          <div class="btn-row">
            <span class="muted small">${an.eligible(list, 'whatsapp').length} com WhatsApp · ${an.eligible(list, 'email').length} com e-mail autorizado</span>
            <button class="btn btn-primary" id="mkCamp" ${list.length ? '' : 'disabled'}>Criar campanha com este público</button>
          </div>
        </header>
        ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Cliente</th><th class="num">Pedidos</th><th>Última compra</th><th>Produto / reposição estimada</th><th>Permissões</th><th></th></tr></thead><tbody>
          ${list.slice(0, 200).map(s => { const o = oppMap.get(s.cliente.id); return `<tr>
            <td><a href="#/clientes/${s.cliente.id}" class="link-strong">${ui.esc(s.cliente.nome)}</a></td>
            <td class="num">${s.n}</td><td>${ui.date(s.ultima)} <small class="muted">(${s.diasSemComprar} d)</small></td>
            <td>${o ? `${ui.esc(o.produto.nome)} · ${ui.date(o.estimada)} ${o.status === 'janela' ? ui.badge('na janela', 'sage') : ui.badge('atrasada', 'warn')}` : '<span class="muted">—</span>'}</td>
            <td>${ui.consentIcons(s.cliente)}</td>
            <td><button class="btn btn-ghost btn-sm" data-contact="${s.cliente.id}">Registrar contato</button></td></tr>`; }).join('')}
        </tbody></table></div>${list.length > 200 ? `<p class="muted small">Mostrando 200 de ${list.length}.</p>` : ''}` : ui.empty('Nenhum cliente neste segmento.')}
      </section>`;
    },
    bind(root) {
      root.querySelectorAll('[data-seg]').forEach(b => b.addEventListener('click', () => { A.state.recompra.seg = b.dataset.seg; A.router.render(); }));
      const mk = root.querySelector('#mkCamp');
      if (mk) mk.addEventListener('click', () => A.views.campanhas.openNew({ publico: A.state.recompra.seg }));
      root.querySelectorAll('[data-contact]').forEach(b => b.addEventListener('click', () => {
        const c = A.store.cliente(b.dataset.contact);
        ui.modal(`<h2>Registrar contato — ${ui.esc(c.nome)}</h2>
          <form id="cf" class="form">
            <label>Canal<select name="canal"><option>WhatsApp</option><option>E-mail</option><option>Telefone</option></select></label>
            <label>Resumo<textarea name="nota" rows="3" required placeholder="Ex.: lembrete de reposição enviado manualmente"></textarea></label>
            <div class="btn-row end"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary">Salvar</button></div>
          </form>`, m => m.querySelector('#cf').addEventListener('submit', e => {
          e.preventDefault(); const fd = new FormData(e.target);
          A.store.addInteracao(c.id, { data: A.analytics.iso(new Date()), canal: fd.get('canal'), nota: fd.get('nota').trim(), autor: A.session.role === 'admin' ? 'Administrador' : 'Operador' });
          ui.closeModal(); ui.toast('Contato registrado no histórico do cliente.');
        }));
      }));
    }
  };
})(window.ALTUM);
