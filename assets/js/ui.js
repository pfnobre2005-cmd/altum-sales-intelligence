/* ALTUM Sales Intelligence — componentes de interface */
(function (A) {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ui = {
    esc,
    brl(v) { return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); },
    brl0(v) { return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); },
    num(v) { return (v || 0).toLocaleString('pt-BR'); },
    pct(v, d = 1) { return isFinite(v) ? (v * 100).toFixed(d).replace('.', ',') + '%' : '—'; },
    date(s) { if (!s) return '—'; const [y, m, d] = s.slice(0, 10).split('-'); return `${d}/${m}/${y}`; },

    delta(cur, prev, opt = {}) {
      if (prev === null || prev === undefined) return '';
      let txt, dir;
      if (opt.isPct) {
        const pp = (cur - prev) * 100;
        dir = Math.abs(pp) < 0.05 ? 0 : Math.sign(pp);
        txt = (pp >= 0 ? '+' : '') + pp.toFixed(1).replace('.', ',') + ' p.p.';
      } else if (!prev) {
        if (!cur) return '<span class="delta neutral">sem variação</span>';
        return '<span class="delta neutral">sem base anterior</span>';
      } else {
        const ch = (cur - prev) / prev;
        dir = Math.abs(ch) < 0.0005 ? 0 : Math.sign(ch);
        txt = (ch >= 0 ? '+' : '') + (ch * 100).toFixed(1).replace('.', ',') + '%';
      }
      const good = opt.inverse ? -dir : dir;
      const cls = dir === 0 ? 'neutral' : good > 0 ? 'up' : 'down';
      const arrow = dir === 0 ? '→' : dir > 0 ? '↑' : '↓';
      return `<span class="delta ${cls}">${arrow} ${txt}</span>`;
    },

    kpi({ label, value, delta, hint }) {
      return `<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${value}</div>
        <div class="kpi-foot">${delta || ''}${hint ? `<span class="kpi-hint">${esc(hint)}</span>` : ''}</div></div>`;
    },

    badge(text, tone = 'neutral') { return `<span class="badge badge-${tone}">${esc(text)}</span>`; },

    segBadge(seg) {
      const map = { primeira_compra: ['1ª compra', 'sand'], recorrentes: ['Recorrente', 'sage'], fieis: ['Fiel', 'sage-strong'], inativos: ['Inativo', 'muted'], sem_pedido: ['Sem pedido', 'muted'] };
      const [t, tone] = map[seg] || [seg, 'neutral'];
      return ui.badge(t, tone);
    },

    consentIcons(c) {
      const k = c.consentimento || {};
      return `<span class="consent ${k.whatsapp ? 'on' : 'off'}" title="WhatsApp: ${k.whatsapp ? 'autorizado' : 'não autorizado'}">WA</span>` +
        `<span class="consent ${k.email ? 'on' : 'off'}" title="E-mail: ${k.email ? 'autorizado' : 'não autorizado'}">@</span>`;
    },

    /** Barras empilhadas (SVG) — series: [{label, a, b}] */
    stackedBars(series, { keys, names, format }) {
      const W = 640, H = 240, pad = { l: 56, r: 12, t: 16, b: 30 };
      const max = Math.max(1, ...series.map(s => keys.reduce((t, k) => t + s[k], 0)));
      const nice = (() => { const p = Math.pow(10, Math.floor(Math.log10(max))); return Math.ceil(max / p) * p; })();
      const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
      const bw = iw / series.length * 0.56;
      let g = '';
      for (let i = 0; i <= 4; i++) {
        const y = pad.t + ih - ih * i / 4;
        g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" class="grid"/>` +
          `<text x="${pad.l - 8}" y="${y + 4}" text-anchor="end" class="axis">${esc(format(nice * i / 4))}</text>`;
      }
      series.forEach((s, i) => {
        const x = pad.l + iw / series.length * i + (iw / series.length - bw) / 2;
        let y = pad.t + ih;
        keys.forEach((k, ki) => {
          const h = ih * s[k] / nice;
          y -= h;
          if (h > 0) g += `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="2" class="bar bar-${ki}"><title>${esc(s.label)} · ${esc(names[ki])}: ${esc(format(s[k]))}</title></rect>`;
        });
        g += `<text x="${x + bw / 2}" y="${H - 10}" text-anchor="middle" class="axis">${esc(s.label)}</text>`;
      });
      const legend = names.map((n, i) => `<span class="legend-item"><i class="sw sw-${i}"></i>${esc(n)}</span>`).join('');
      return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet">${g}</svg><div class="legend">${legend}</div></div>`;
    },

    /** Barras horizontais — rows: [{label, value, sub}] value 0..1 */
    hbars(rows, fmt = ui.pct) {
      const max = Math.max(0.0001, ...rows.map(r => r.value));
      return `<div class="hbars">${rows.map(r => `<div class="hbar-row">
        <div class="hbar-label">${esc(r.label)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</div>
        <div class="hbar-track"><div class="hbar-fill${r.dim ? ' dim' : ''}" style="width:${(r.value / max * 100).toFixed(1)}%"></div></div>
        <div class="hbar-val">${fmt(r.value)}</div></div>`).join('')}</div>`;
    },

    empty(msg) { return `<div class="empty">${esc(msg)}</div>`; },

    modal(html, onMount) {
      const root = document.getElementById('modalRoot');
      root.innerHTML = `<div class="modal-backdrop" data-close></div><div class="modal" role="dialog" aria-modal="true">${html}</div>`;
      root.classList.add('open');
      root.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', ui.closeModal));
      document.addEventListener('keydown', ui._esc);
      const first = root.querySelector('input,select,textarea,button:not([data-close])');
      if (first) first.focus();
      if (onMount) onMount(root.querySelector('.modal'));
    },
    _esc(e) { if (e.key === 'Escape') ui.closeModal(); },
    closeModal() {
      const root = document.getElementById('modalRoot');
      root.classList.remove('open'); root.innerHTML = '';
      document.removeEventListener('keydown', ui._esc);
    },

    toast(msg, tone = 'ok') {
      const t = document.getElementById('toast');
      t.textContent = msg; t.className = `toast show ${tone}`;
      clearTimeout(ui._tt); ui._tt = setTimeout(() => { t.className = 'toast'; }, 3200);
    },

    download(filename, text, type = 'application/json') {
      const blob = new Blob([text], { type });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },

    async copy(text) {
      try { await navigator.clipboard.writeText(text); return true; }
      catch (e) {
        const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
        let ok = false; try { ok = document.execCommand('copy'); } catch (_) { /* ignore */ }
        ta.remove(); return ok;
      }
    }
  };
  A.ui = ui;
  A.views = A.views || {};
  A.state = A.state || { periodo: 30, clientes: { q: '', seg: '', consent: '', origem: '', sort: 'ultima', dir: -1, page: 1 }, recompra: { seg: 'janela' }, funil: { origem: '' } };
})(window.ALTUM);
