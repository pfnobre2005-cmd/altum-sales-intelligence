/* ALTUM Sales Intelligence — Produtos
 * Fonte: SUPABASE (tabela produtos + produto_custos), via A.repositorio. Nenhum nome fixo no código.
 * Administrador (2 etapas): cadastra, edita, envia imagem, desativa e reativa — sempre com confirmação.
 * Operador: só visualiza (sem custo; o banco nem envia o custo para ele).
 * Gravação: funções do banco (migração 011), que validam tudo de novo e recusam edição simultânea.
 */
(function (A) {
  'use strict';
  const { ui } = A;
  const R = () => A.repositorio;
  const VALIDADE_MS = 5 * 60 * 1000;
  const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;
  const ORIGENS = { manual: ['Manual', 'sage'], nuvemshop: ['Nuvemshop', 'sand'], ficticio: ['Fictício', 'muted'] };

  // Estado só em memória (nada no localStorage).
  const estado = { dados: null, erro: null, carregando: false, geracao: 0, filtro: { q: '', status: 'ativos', origem: '' } };

  async function carregar() {
    if (estado.carregando) return;
    estado.carregando = true; estado.erro = null;
    const g = ++estado.geracao;
    try {
      const d = await R().produtos();
      if (g !== estado.geracao) return;
      estado.dados = d;
    } catch (e) {
      if (g !== estado.geracao) return;
      console.error(e);
      estado.erro = e instanceof R().ErroDados ? e : new (R().ErroDados)('consulta', 'Erro inesperado ao carregar os produtos.');
    } finally {
      if (g === estado.geracao) estado.carregando = false;
    }
    if (A.router.parse().name === 'produtos') A.router.render();
  }

  // ---------- formatação e validação ----------
  const admin = () => A.session.isAdmin();
  const fmtDecimal = v => (v === null || v === undefined ? '' : Number(v).toFixed(2).replace('.', ','));
  const margem = p => (p.custo === null || p.custo === undefined || !p.preco) ? null : (p.preco - p.custo) / p.preco;
  const colapsar = s => String(s || '').trim().replace(/\s+/g, ' ');

  // "1.234,56" | "1234,56" | "1234.56" | "R$ 59,90" → número com 2 casas (ou NaN)
  function lerDinheiro(txt) {
    let s = String(txt || '').replace(/R\$|\s/g, '');
    if (s === '') return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return NaN;
    const n = Number(s);
    return n <= 999999.99 ? n : NaN;
  }

  function validar(v, produto) {
    const erros = {};
    const lista = (estado.dados && estado.dados.itens) || [];
    const loja = produto && produto.fonte === 'nuvemshop';
    if (!loja) {
      if (v.nome.length < 2 || v.nome.length > 200) erros.nome = 'Informe o nome (2 a 200 caracteres).';
      if (!v.sku) erros.sku = 'Informe o SKU.';
      else if (!SKU_RE.test(v.sku)) erros.sku = 'Use até 64 caracteres: letras, números, ponto, hífen, sublinhado ou barra, sem espaços.';
      else {
        const dono = lista.find(p => p.sku && p.sku.toUpperCase() === v.sku.toUpperCase() && (!produto || p.id !== produto.id));
        if (dono) erros.sku = `SKU já usado por "${dono.nome}".`;
      }
      if (v.preco === null || Number.isNaN(v.preco)) erros.preco = 'Informe o preço (ex.: 59,90).';
    }
    if (v.categoria.length > 80) erros.categoria = 'Máximo de 80 caracteres.';
    if (Number.isNaN(v.custo)) erros.custo = 'Valor inválido (ex.: 21,40). Deixe em branco se não souber.';
    if (v.cicloTxt !== '' && !(Number.isInteger(v.ciclo) && v.ciclo >= 1 && v.ciclo <= 365)) erros.ciclo = 'De 1 a 365 dias, ou em branco.';
    return erros;
  }

  // ---------- lista ----------
  function filtrar(itens) {
    const f = estado.filtro;
    const q = f.q.trim().toLowerCase();
    return itens.filter(p =>
      (f.status === 'todos' || (f.status === 'ativos' ? p.ativo : !p.ativo))
      && (!f.origem || p.fonte === f.origem)
      && (!q || [p.nome, p.sku, p.categoria].some(x => x && x.toLowerCase().includes(q))));
  }

  function miniatura(p, tamanho) {
    const t = tamanho || 40;
    if (p.imagemUrl) return `<img class="prod-img" src="${ui.esc(p.imagemUrl)}" alt="" width="${t}" height="${t}" loading="lazy">`;
    const ini = colapsar(p.nome).split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
    return `<span class="prod-img prod-img-vazia" style="width:${t}px;height:${t}px" aria-hidden="true">${ui.esc(ini)}</span>`;
  }

  function linha(p, comCusto) {
    const [origem, tom] = ORIGENS[p.fonte] || [p.fonte, 'neutral'];
    const m = margem(p);
    const acoes = admin() && p.fonte !== 'ficticio'
      ? `<button class="btn btn-ghost btn-sm" data-editar="${p.id}" type="button">Editar</button>
         <button class="btn btn-sm ${p.ativo ? 'btn-danger' : 'btn-ghost'}" data-status="${p.id}" type="button">${p.ativo ? 'Desativar' : 'Reativar'}</button>`
      : (p.fonte === 'ficticio' ? '<span class="muted small">somente leitura</span>' : '');
    return `<tr class="clickable${p.ativo ? '' : ' inativo'}" data-ver="${p.id}">
      <td>${miniatura(p)}</td>
      <td><strong>${ui.esc(p.nome)}</strong>${p.categoria ? `<small class="block muted">${ui.esc(p.categoria)}</small>` : ''}</td>
      <td><code>${ui.esc(p.sku || '—')}</code></td>
      <td class="num">${p.preco === null ? '—' : ui.brl(p.preco)}</td>
      ${comCusto ? `<td class="num">${p.custo === null ? '<span class="muted">—</span>' : ui.brl(p.custo)}</td>
                    <td class="num">${m === null ? '<span class="muted">—</span>' : ui.pct(m)}</td>` : ''}
      <td class="num">${p.ciclo ? `${p.ciclo} d` : '<span class="muted">—</span>'}</td>
      <td>${p.ativo ? ui.badge('Ativo', 'sage') : ui.badge('Inativo', 'muted')}</td>
      <td>${ui.badge(origem, tom)}</td>
      <td class="acoes">${acoes}</td>
    </tr>`;
  }

  function hora(d) { return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }

  A.views.produtos = {
    title: 'Produtos',
    fonteDados: 'Supabase · cadastro real',
    render() {
      const d = estado.dados;
      const topo = `<p class="fonte-dados small" id="fonteProdutos"><span class="badge badge-sage">Supabase</span> cadastro de produtos
        ${d ? `· lido às ${hora(d.lidoEm)}` : ''}
        <span class="fonte-acoes">
          ${admin() ? '<button class="btn btn-primary btn-sm" id="novoProduto" type="button">Novo produto</button>' : ''}
          <button class="btn btn-ghost btn-sm" id="atualizarProdutos" type="button" ${estado.carregando ? 'disabled' : ''}>${estado.carregando ? 'Atualizando…' : 'Atualizar'}</button>
        </span></p>`;
      if (!d) {
        return topo + (estado.erro
          ? `<section class="card error" role="alert" id="erroProdutos"><h2>Não foi possível carregar os produtos</h2><p>${ui.esc(estado.erro.message)}</p>
             <div class="btn-row"><button class="btn btn-primary" id="tentarProdutos" type="button">Tentar de novo</button></div></section>`
          : '<section class="card" aria-busy="true"><p class="muted">Carregando produtos do Supabase…</p></section>');
      }
      const f = estado.filtro;
      const itens = filtrar(d.itens);
      const ativos = d.itens.filter(p => p.ativo).length;
      return `${topo}
      ${estado.erro ? `<div class="card error" role="alert"><p>${ui.esc(estado.erro.message)} Exibindo a última leitura.</p></div>` : ''}
      <section class="filters card filtros-produtos">
        <input type="search" id="pq" placeholder="Buscar por nome, SKU ou categoria" value="${ui.esc(f.q)}" aria-label="Buscar produto">
        <select id="pstatus" aria-label="Status">
          ${[['ativos', 'Ativos'], ['inativos', 'Inativos'], ['todos', 'Todos']].map(([v, l]) => `<option value="${v}" ${f.status === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <select id="porigem" aria-label="Origem">
          <option value="">Todas as origens</option>
          ${Object.entries(ORIGENS).map(([v, [l]]) => `<option value="${v}" ${f.origem === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </section>
      <section class="card">
        <header class="card-head"><h2>${ui.num(itens.length)} de ${ui.num(d.itens.length)} produtos</h2><span class="muted small">${ui.num(ativos)} ativos</span></header>
        ${itens.length ? `<div class="table-wrap"><table id="tabelaProdutos"><thead><tr>
            <th></th><th>Produto</th><th>SKU</th><th class="num">Preço</th>
            ${d.comCusto ? '<th class="num">Custo</th><th class="num">Margem</th>' : ''}
            <th class="num">Ciclo</th><th>Status</th><th>Origem</th><th></th></tr></thead>
          <tbody>${itens.map(p => linha(p, d.comCusto)).join('')}</tbody></table></div>`
          : ui.empty(d.itens.length ? 'Nenhum produto com esses filtros.' : 'Nenhum produto cadastrado ainda.')}
        ${d.itens.some(p => p.fonte === 'ficticio') ? '<p class="small muted">Produtos "Fictício" são dados de teste (migração 010): somente leitura e removidos junto com os dados fictícios. Cadastre os produtos reais como novos.</p>' : ''}
      </section>`;
    },
    bind(root) {
      const vencido = estado.dados && Date.now() - estado.dados.lidoEm.getTime() > VALIDADE_MS;
      if ((!estado.dados && !estado.erro) || vencido) carregar();
      const atualizar = () => { carregar(); A.router.render(); };
      [['#atualizarProdutos', atualizar], ['#tentarProdutos', atualizar], ['#novoProduto', () => abrirFormulario(null)]].forEach(([sel, fn]) => {
        const b = root.querySelector(sel); if (b) b.addEventListener('click', fn);
      });
      const q = root.querySelector('#pq');
      if (q) q.addEventListener('input', () => {
        estado.filtro.q = q.value; const pos = q.selectionStart; A.router.render();
        const n = document.getElementById('pq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); }
      });
      const st = root.querySelector('#pstatus'); if (st) st.addEventListener('change', () => { estado.filtro.status = st.value; A.router.render(); });
      const og = root.querySelector('#porigem'); if (og) og.addEventListener('change', () => { estado.filtro.origem = og.value; A.router.render(); });
      root.querySelectorAll('[data-ver]').forEach(tr => tr.addEventListener('click', ev => {
        if (ev.target.closest('button')) return;
        abrirDetalhe(produtoPorId(tr.dataset.ver));
      }));
      root.querySelectorAll('[data-editar]').forEach(b => b.addEventListener('click', () => abrirFormulario(produtoPorId(b.dataset.editar))));
      root.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', () => confirmarStatus(produtoPorId(b.dataset.status))));
    }
  };

  function produtoPorId(id) { return estado.dados && estado.dados.itens.find(p => p.id === id); }

  // ---------- visualização ----------
  function abrirDetalhe(p) {
    if (!p) return;
    const [origem] = ORIGENS[p.fonte] || [p.fonte];
    const m = margem(p);
    const campo = (r, v) => `<div><dt>${ui.esc(r)}</dt><dd>${v}</dd></div>`;
    ui.modal(`<h2>${ui.esc(p.nome)}</h2>
      <div class="prod-detalhe">
        <div class="prod-detalhe-img">${miniatura(p, 160)}</div>
        <dl class="prod-campos">
          ${campo('SKU', `<code>${ui.esc(p.sku || '—')}</code>`)}
          ${campo('Categoria', ui.esc(p.categoria || '—'))}
          ${campo('Preço', p.preco === null ? '—' : ui.brl(p.preco))}
          ${p.custo !== undefined ? campo('Custo', p.custo === null ? '—' : ui.brl(p.custo)) + campo('Margem', m === null ? '—' : ui.pct(m)) : ''}
          ${campo('Ciclo de recompra', p.ciclo ? `${p.ciclo} dias` : 'sem ciclo (não gera recompra)')}
          ${campo('Status', p.ativo ? 'Ativo' : 'Inativo — fora de campanhas novas e da recompra')}
          ${campo('Origem', ui.esc(origem))}
          ${p.nuvemshopProdutoId ? campo('Nuvemshop', `produto ${ui.esc(p.nuvemshopProdutoId)}${p.nuvemshopVarianteId ? ` · variante ${ui.esc(p.nuvemshopVarianteId)}` : ''}`) : ''}
          ${campo('Atualizado em', ui.esc(new Date(p.atualizadoEm).toLocaleString('pt-BR')))}
        </dl>
      </div>
      <div class="btn-row end">
        <button class="btn btn-ghost" data-close type="button">Fechar</button>
        ${admin() && p.fonte !== 'ficticio' ? `<button class="btn btn-primary" id="detEditar" type="button">Editar</button>` : ''}
      </div>`, m2 => {
      const b = m2.querySelector('#detEditar'); if (b) b.addEventListener('click', () => abrirFormulario(p));
    });
  }

  // ---------- cadastro / edição ----------
  function abrirFormulario(p) {
    if (!admin()) return;
    const novo = !p;
    const loja = p && p.fonte === 'nuvemshop';
    const cats = [...new Set(((estado.dados && estado.dados.itens) || []).map(x => x.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const travado = loja ? 'disabled title="Vem da Nuvemshop: altere pela loja"' : '';
    let arquivo = null, previa = null, removerImagem = false;

    ui.modal(`<h2>${novo ? 'Novo produto' : 'Editar produto'}</h2>
      ${loja ? '<p class="small muted">Produto da Nuvemshop: nome, SKU, preço e imagem são da loja. Aqui você altera custo, categoria e ciclo.</p>' : ''}
      <form id="formProduto" class="form" novalidate>
        <label>Nome *<input name="nome" maxlength="200" required value="${ui.esc(p ? p.nome : '')}" ${travado} autocomplete="off"><span class="erro-campo" data-erro="nome"></span></label>
        <div class="form-grid">
          <label>SKU *<input name="sku" maxlength="64" required value="${ui.esc(p ? p.sku || '' : '')}" ${travado} autocomplete="off" spellcheck="false"><span class="erro-campo" data-erro="sku"></span></label>
          <label>Categoria<input name="categoria" maxlength="80" list="listaCategorias" value="${ui.esc(p ? p.categoria || '' : '')}" autocomplete="off"><span class="erro-campo" data-erro="categoria"></span></label>
        </div>
        <datalist id="listaCategorias">${cats.map(c => `<option value="${ui.esc(c)}">`).join('')}</datalist>
        <div class="form-grid">
          <label>Preço de venda (R$) *<input name="preco" inputmode="decimal" placeholder="59,90" value="${ui.esc(p ? fmtDecimal(p.preco) : '')}" ${travado}><span class="erro-campo" data-erro="preco"></span></label>
          <label>Custo (R$)<input name="custo" inputmode="decimal" placeholder="em branco = não informado" value="${ui.esc(p ? fmtDecimal(p.custo) : '')}"><small class="muted dica-campo">Visível só para administradores.</small><span class="erro-campo" data-erro="custo"></span></label>
        </div>
        <label>Ciclo de recompra (dias)<input name="ciclo" inputmode="numeric" placeholder="ex.: 30 · em branco = não gera recompra" value="${p && p.ciclo ? p.ciclo : ''}"><span class="erro-campo" data-erro="ciclo"></span></label>
        ${loja ? '' : `<fieldset class="prod-imagem-campo"><legend>Imagem (JPG, PNG ou WebP, até 1 MB)</legend>
          <div class="prod-imagem-linha"><span id="previaImagem">${p ? miniatura(p, 64) : ''}</span>
            <div><input type="file" name="imagem" accept="image/jpeg,image/png,image/webp">
            ${p && p.imagemPath ? '<label class="check"><input type="checkbox" name="removerImagem"> Remover a imagem atual</label>' : ''}
            <span class="erro-campo" data-erro="imagem"></span></div></div></fieldset>`}
        <div class="auth-msg auth-msg-erro" id="erroForm" role="alert" hidden></div>
        <div class="btn-row end"><button class="btn btn-ghost" data-close type="button">Cancelar</button>
          <button class="btn btn-primary" type="submit">Revisar alterações</button></div>
      </form>`, modal => {
      const form = modal.querySelector('#formProduto');
      const inp = form.querySelector('input[name="imagem"]');
      if (inp) inp.addEventListener('change', async () => {
        const errEl = form.querySelector('[data-erro="imagem"]'); errEl.textContent = '';
        arquivo = null;
        if (previa) { URL.revokeObjectURL(previa); previa = null; }
        const f = inp.files && inp.files[0];
        if (!f) return;
        try {
          await R().validarImagem(f);
          arquivo = f; previa = URL.createObjectURL(f);
          modal.querySelector('#previaImagem').innerHTML = `<img class="prod-img" src="${previa}" alt="Prévia" width="64" height="64">`;
          const rm = form.querySelector('input[name="removerImagem"]'); if (rm) rm.checked = false;
        } catch (e) { errEl.textContent = e.message; inp.value = ''; }
      });
      form.addEventListener('submit', ev => {
        ev.preventDefault();
        const fd = new FormData(form);
        const cicloTxt = String(fd.get('ciclo') || '').trim();
        const v = {
          nome: loja ? p.nome : colapsar(fd.get('nome')),
          sku: loja ? p.sku : String(fd.get('sku') || '').trim(),
          categoria: colapsar(fd.get('categoria')),
          preco: loja ? p.preco : lerDinheiro(fd.get('preco')),
          custo: lerDinheiro(fd.get('custo')),
          cicloTxt, ciclo: cicloTxt === '' ? null : (/^\d+$/.test(cicloTxt) ? Number(cicloTxt) : NaN)
        };
        removerImagem = !!fd.get('removerImagem');
        const erros = validar(v, p);
        form.querySelectorAll('[data-erro]').forEach(el => { if (el.dataset.erro !== 'imagem') el.textContent = erros[el.dataset.erro] || ''; });
        if (Object.keys(erros).length) { const prim = form.querySelector(`[name="${Object.keys(erros)[0]}"]`); if (prim) prim.focus(); return; }
        revisar(p, v, { arquivo, removerImagem, previa });
      });
    });
  }

  // ---------- confirmação (antes → depois) e gravação ----------
  function revisar(p, v, img) {
    const fmt = {
      nome: x => ui.esc(x || '—'), sku: x => `<code>${ui.esc(x || '—')}</code>`, categoria: x => ui.esc(x || '—'),
      preco: x => (x === null || x === undefined ? '—' : ui.brl(x)), custo: x => (x === null || x === undefined ? '—' : ui.brl(x)),
      ciclo: x => (x ? `${x} dias` : 'sem ciclo')
    };
    const rot = { nome: 'Nome', sku: 'SKU', categoria: 'Categoria', preco: 'Preço', custo: 'Custo', ciclo: 'Ciclo de recompra' };
    const antes = p ? { nome: p.nome, sku: p.sku, categoria: p.categoria || '', preco: p.preco, custo: p.custo, ciclo: p.ciclo || null } : {};
    const depois = { nome: v.nome, sku: v.sku, categoria: v.categoria, preco: v.preco, custo: v.custo, ciclo: v.ciclo };
    const mudou = Object.keys(rot).filter(k => !p || String(antes[k] ?? '') !== String(depois[k] ?? ''));
    const imgTexto = img.arquivo ? `nova imagem: ${ui.esc(img.arquivo.name)}` : (img.removerImagem ? 'remover a imagem atual' : '');
    if (p && !mudou.length && !imgTexto) {
      ui.toast('Nenhuma alteração para salvar.', 'warn');
      return;
    }
    ui.modal(`<h2>${p ? 'Confirmar alterações' : 'Confirmar novo produto'}</h2>
      <p class="small muted">${p ? `Produto: <strong>${ui.esc(p.nome)}</strong>` : 'O produto será criado como ativo, origem Manual.'}</p>
      <div class="table-wrap"><table class="tabela-revisao"><thead><tr><th>Campo</th>${p ? '<th>Antes</th>' : ''}<th>${p ? 'Depois' : 'Valor'}</th></tr></thead><tbody>
        ${mudou.map(k => `<tr><td>${rot[k]}</td>${p ? `<td class="antes">${fmt[k](antes[k])}</td>` : ''}<td><strong>${fmt[k](depois[k])}</strong></td></tr>`).join('')}
        ${imgTexto ? `<tr><td>Imagem</td>${p ? '<td class="antes">—</td>' : ''}<td><strong>${imgTexto}</strong></td></tr>` : ''}
      </tbody></table></div>
      <div class="auth-msg auth-msg-erro" id="erroGravar" role="alert" hidden></div>
      <div class="btn-row end"><button class="btn btn-ghost" id="voltarForm" type="button">Voltar e editar</button>
        <button class="btn btn-primary" id="confirmarGravar" type="button">Confirmar e salvar</button></div>`, modal => {
      modal.querySelector('#voltarForm').addEventListener('click', () => abrirFormulario(p));
      const btn = modal.querySelector('#confirmarGravar');
      btn.addEventListener('click', async () => {
        const erroEl = modal.querySelector('#erroGravar');
        erroEl.hidden = true;
        btn.disabled = true; btn.textContent = 'Salvando…';
        modal.querySelector('#voltarForm').disabled = true;
        let etapa = 'produto';
        try {
          const res = await R().salvarProduto({ id: p && p.id, versao: p && p.versao, ...v });
          let versao = res.versao;
          if (img.arquivo) { etapa = 'imagem'; versao = (await R().enviarImagemProduto(res.id, versao, img.arquivo)).versao; }
          else if (img.removerImagem) { etapa = 'imagem'; await R().removerImagemProduto(res.id, versao); }
          if (img.previa) URL.revokeObjectURL(img.previa);
          ui.closeModal();
          ui.toast(p ? 'Produto atualizado.' : 'Produto cadastrado.');
          await carregar();
        } catch (e) {
          console.error(e);
          const msg = e && e.message ? e.message : 'Erro inesperado.';
          if (etapa === 'imagem') {
            ui.closeModal();
            ui.toast('Dados salvos, mas a imagem não foi alterada: ' + msg, 'warn');
            await carregar();
            return;
          }
          erroEl.textContent = msg + (e && e.tipo === 'conflito' ? ' (use "Atualizar" na lista)' : '');
          erroEl.hidden = false;
          btn.disabled = false; btn.textContent = 'Confirmar e salvar';
          modal.querySelector('#voltarForm').disabled = false;
          if (e && (e.tipo === 'conflito' || e.tipo === 'nao_encontrado')) carregar();
        }
      });
    });
  }

  function confirmarStatus(p) {
    if (!p || !admin()) return;
    const desativar = p.ativo;
    ui.modal(`<h2>${desativar ? 'Desativar' : 'Reativar'} produto?</h2>
      <p><strong>${ui.esc(p.nome)}</strong> · <code>${ui.esc(p.sku || '—')}</code></p>
      <p class="small">${desativar
        ? 'O produto continua no histórico de vendas e nas campanhas já criadas, mas deixa de gerar oportunidades de recompra e não pode entrar em campanha nova. Nada é excluído.'
        : 'O produto volta a gerar oportunidades de recompra (se tiver ciclo) e pode entrar em campanhas novas.'}</p>
      <div class="auth-msg auth-msg-erro" id="erroStatus" role="alert" hidden></div>
      <div class="btn-row end"><button class="btn btn-ghost" data-close type="button">Cancelar</button>
        <button class="btn ${desativar ? 'btn-danger' : 'btn-primary'}" id="confirmarStatus" type="button">${desativar ? 'Desativar' : 'Reativar'}</button></div>`, modal => {
      const btn = modal.querySelector('#confirmarStatus');
      btn.addEventListener('click', async () => {
        const erroEl = modal.querySelector('#erroStatus'); erroEl.hidden = true;
        btn.disabled = true; btn.textContent = 'Salvando…';
        try {
          await R().alterarStatusProduto(p.id, !desativar, p.versao);
          ui.closeModal();
          ui.toast(desativar ? 'Produto desativado.' : 'Produto reativado.');
          await carregar();
        } catch (e) {
          erroEl.textContent = e.message; erroEl.hidden = false;
          btn.disabled = false; btn.textContent = desativar ? 'Desativar' : 'Reativar';
          if (e.tipo === 'conflito' || e.tipo === 'nao_encontrado') carregar();
        }
      });
    });
  }
})(window.ALTUM);
