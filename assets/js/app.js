/* ALTUM Sales Intelligence — navegação (rotas por #hash, funciona no GitHub Pages) */
(function (A) {
  'use strict';
  const view = () => document.getElementById('view');

  A.router = {
    parse() {
      const parts = (location.hash || '#/dashboard').replace(/^#\/?/, '').split('/');
      const name = A.views[parts[0]] ? parts[0] : 'dashboard';
      return { name, param: parts[1] ? decodeURIComponent(parts[1]) : null };
    },
    render() {
      const { name, param } = this.parse();
      const v = A.views[name];
      document.getElementById('pageTitle').textContent = v.title;
      document.title = `${v.title} · ALTUM Sales Intelligence`;
      document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === name));
      const root = view();
      try {
        root.innerHTML = v.render(param);
        if (v.bind) v.bind(root, param);
      } catch (err) {
        console.error(err);
        root.innerHTML = `<div class="card error"><h2>Algo deu errado ao abrir esta tela</h2><p class="small">${A.ui.esc(err.message)}</p>
          <p class="small">Tente recarregar. Se continuar, use "Recriar base fictícia" em Integrações & Dados.</p></div>`;
      }
    }
  };

  let iniciado = false;

  // Chamado SOMENTE pelo módulo de autenticação, depois da autenticação completa.
  function iniciar() {
    if (iniciado) return;
    iniciado = true;
    document.getElementById('appShell').hidden = false;
    document.getElementById('demoBanner').hidden = false;
    A.store.load();

    const sb = document.getElementById('sidebar');
    document.getElementById('menuBtn').addEventListener('click', () => sb.classList.toggle('open'));
    document.getElementById('nav').addEventListener('click', e => { if (e.target.closest('a')) sb.classList.remove('open'); });

    window.addEventListener('hashchange', () => { A.router.render(); window.scrollTo(0, 0); });
    A.router.render();
  }

  A.app = {
    iniciar,
    get iniciado() { return iniciado; }
  };
})(window.ALTUM);
