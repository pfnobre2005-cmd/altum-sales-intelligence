/* ALTUM Sales Intelligence — Tela 2: Clientes (Supabase)
 * Lista paginada NO SERVIDOR (v_clientes_resumo), ficha completa, cadastro/edição (cliente_salvar),
 * consentimentos, oposições, interações, solicitações LGPD e anonimização (admin) — tudo pelas
 * estruturas das migrações 003–012, respeitando RLS e 2 etapas. Não usa A.store.
 * Origens nunca misturadas: "Dados reais" (padrão) × "Dados fictícios (teste)" (somente leitura).
 * Nenhuma mensagem é enviada: a tela só registra.
 */
(function (A) {
  'use strict';
  const { ui } = A;
  const R = () => A.repositorio;
  const an = () => A.analytics;

  const STATUS = { ativo: 'Ativo', acompanhamento: 'Em acompanhamento', nao_contatar: 'Não contatar' };
  const SEG = { primeira_compra: '1ª compra', recorrentes: 'Recorrente', fieis: 'Fiel', inativos: 'Inativo', sem_pedido: 'Sem pedido' };
  const CANAIS = { whatsapp: 'WhatsApp', email: 'E-mail', telefone: 'Telefone', instagram: 'Instagram' };
  const SITUACAO = { concedida: 'Concedida', revogada: 'Revogada', recusada: 'Recusada' };
  const MEIOS = { checkout: 'Checkout da loja', formulario_site: 'Formulário do site', formulario_anuncio: 'Formulário de anúncio',
                  mensagem_escrita: 'Mensagem escrita', email_resposta: 'Resposta por e-mail', ligacao_gravada: 'Ligação gravada', documento_assinado: 'Documento assinado' };
  const ESCOPO = { marketing: 'Só marketing', todo_contato_nao_essencial: 'Todo contato não essencial' };
  const TIPOS_LGPD = { confirmacao: 'Confirmação de tratamento', acesso: 'Acesso aos dados', correcao: 'Correção', eliminacao: 'Eliminação',
                       revogacao: 'Revogação de consentimento', oposicao: 'Oposição', portabilidade: 'Portabilidade', informacao: 'Informação' };
  const CANAIS_LGPD = { whatsapp: 'WhatsApp', email: 'E-mail', telefone: 'Telefone', instagram: 'Instagram', formulario: 'Formulário', outro: 'Outro' };
  const STATUS_LGPD = { recebida: 'Recebida', em_andamento: 'Em andamento', atendida: 'Atendida', indeferida: 'Indeferida' };
  const ORIGENS = ['Loja virtual', 'WhatsApp', 'Instagram', 'Anúncio', 'Indicação', 'B2B', 'Cadastro manual', 'Importação autorizada'];
  const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
  const permitirFicticios = () => !(A.config && A.config.dashboard && A.config.dashboard.permitirFicticios === false);
  const admin = () => A.session.isAdmin();

  // Estado só em memória (nada no localStorage)
  const estado = {
    origem: 'real',
    filtro: { q: '', status: '', segmento: '', permissao: '', anonimizados: 'todos', ordem: 'nome', pagina: 1 },
    lista: null, erroLista: null, carregandoLista: false, gLista: 0, existemFicticios: null,
    ficha: null, fichaId: null, erroFicha: null, carregandoFicha: false, gFicha: 0
  };

  // ---------- utilidades ----------
  const dataLocal = ts => (ts ? ui.date(an().iso(new Date(ts))) : '—');
  const nomeCliente = c => (c.anonimizado ? '<em class="muted">Cliente anonimizado</em>' : ui.esc(c.nome || '—'));
  const segBadge = s => ui.segBadge(s);
  const icones = (w, e) => ui.consentIcons({ consentimento: { whatsapp: w, email: e } });
  const opcoes = (mapa, sel, vazio) => (vazio !== undefined ? `<option value="">${ui.esc(vazio)}</option>` : '')
    + Object.entries(mapa).map(([v, l]) => `<option value="${ui.esc(v)}" ${v === sel ? 'selected' : ''}>${ui.esc(l)}</option>`).join('');
  const lista = (arr, sel, vazio) => (vazio !== undefined ? `<option value="">${ui.esc(vazio)}</option>` : '')
    + arr.map(v => `<option ${v === sel ? 'selected' : ''}>${ui.esc(v)}</option>`).join('');
  const msgErro = e => ui.esc((e && e.message) || 'Erro inesperado.');
  const digitos = s => String(s || '').replace(/\D/g, '');

  // ---------- carregamento ----------
  async function carregarLista() {
    const g = ++estado.gLista;
    estado.carregandoLista = true; estado.erroLista = null;
    try {
      const d = await R().clientesLista(Object.assign({ origem: estado.origem }, estado.filtro));
      if (g !== estado.gLista) return;
      estado.lista = d; estado.existemFicticios = d.existemFicticios;
    } catch (e) {
      if (g !== estado.gLista) return;
      console.error(e); estado.erroLista = e; estado.lista = null;
    } finally {
      if (g === estado.gLista) estado.carregandoLista = false;
    }
    const r = A.router.parse();
    if (r.name === 'clientes' && !r.param) A.router.render();
  }

  async function carregarFicha(id) {
    const g = ++estado.gFicha;
    estado.fichaId = id; estado.carregandoFicha = true; estado.erroFicha = null;
    try {
      const d = await R().cliente(id);
      if (g !== estado.gFicha) return;
      estado.ficha = d;
    } catch (e) {
      if (g !== estado.gFicha) return;
      console.error(e); estado.erroFicha = e; estado.ficha = null;
    } finally {
      if (g === estado.gFicha) estado.carregandoFicha = false;
    }
    const r = A.router.parse();
    if (r.name === 'clientes' && r.param === id) A.router.render();
  }

  // ---------- LISTA ----------
  function seletorOrigem() {
    const mostrar = permitirFicticios() && estado.existemFicticios !== false;
    if (!mostrar && estado.origem === 'real') return '';
    return `<div class="seg-control seletor-origem" role="group" aria-label="Origem dos dados">
      <button type="button" class="${estado.origem === 'real' ? 'active' : ''}" data-origem="real">Dados reais</button>
      ${mostrar ? `<button type="button" class="${estado.origem === 'ficticio' ? 'active' : ''}" data-origem="ficticio">Dados fictícios (teste)</button>` : ''}
    </div>`;
  }

  function topoLista() {
    const fic = estado.origem === 'ficticio';
    return `<div class="fonte-dados small" id="fonteClientes">
      <span class="badge ${fic ? 'badge-warn' : 'badge-sage'}">Supabase</span>
      <span>${fic ? 'clientes fictícios de teste (somente leitura)' : 'clientes reais'}${estado.lista ? ` · lidos às ${estado.lista.lidoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
      <span class="fonte-acoes">${seletorOrigem()}
        ${!fic ? '<button class="btn btn-primary btn-sm" id="novoCliente" type="button">Novo cliente</button>' : ''}
        <button class="btn btn-ghost btn-sm" id="atualizarClientes" type="button" ${estado.carregandoLista ? 'disabled' : ''}>${estado.carregandoLista ? 'Atualizando…' : 'Atualizar'}</button></span>
    </div>
    ${fic ? '<div class="aviso-ficticio" role="note" id="avisoFicticioClientes"><strong>DADOS FICTÍCIOS DE TESTE</strong> — carga da migração 010. Não são clientes reais; nada pode ser alterado aqui.</div>' : ''}`;
  }

  function filtros() {
    const f = estado.filtro;
    return `<section class="filters card filtros-clientes">
      <input type="search" id="cq" placeholder="Nome, cidade, e-mail completo ou telefone" title="E-mail: digite o endereço completo. Telefone: pelo menos 8 dígitos (com ou sem DDD)." value="${ui.esc(f.q)}" aria-label="Buscar cliente" maxlength="80">
      <select id="cstatus" aria-label="Status comercial">${opcoes(STATUS, f.status, 'Todos os status')}</select>
      <select id="cseg" aria-label="Segmento">${opcoes(SEG, f.segmento, 'Todos os segmentos')}</select>
      <select id="cperm" aria-label="Permissão de contato">${opcoes({ whatsapp: 'Pode WhatsApp', email: 'Pode e-mail', nenhuma: 'Sem permissão' }, f.permissao, 'Qualquer permissão')}</select>
      <select id="canon" aria-label="Anonimizados">${opcoes({ todos: 'Com anonimizados', sem: 'Só identificáveis', so: 'Só anonimizados' }, f.anonimizados)}</select>
      <select id="cordem" aria-label="Ordenar">${opcoes({ nome: 'Ordenar: nome', ultima: 'Ordenar: última compra', total: 'Ordenar: total gasto' }, f.ordem)}</select>
    </section>`;
  }

  function semFiltro() { const f = estado.filtro; return !f.q && !f.status && !f.segmento && !f.permissao && f.anonimizados === 'todos'; }

  function tabela(d) {
    if (!d.itens.length) {
      if (estado.origem === 'real' && semFiltro()) {
        return `<section class="card estado-vazio" id="clientesVazio"><h2>Ainda não há clientes reais</h2>
          <p>Cadastre o primeiro pelo botão "Novo cliente". Quando a integração com a Nuvemshop for ativada, os clientes da loja também aparecerão aqui.</p>
          <div class="btn-row"><button class="btn btn-primary" type="button" id="novoCliente2">Novo cliente</button>
          ${permitirFicticios() && estado.existemFicticios ? '<button class="btn btn-ghost" type="button" data-origem="ficticio">Ver dados fictícios de teste</button>' : ''}</div></section>`;
      }
      return `<section class="card">${ui.empty('Nenhum cliente com esses filtros.')}</section>`;
    }
    const ini = (d.pagina - 1) * d.porPagina + 1, fim = ini + d.itens.length - 1;
    const paginas = Math.max(1, Math.ceil(d.total / d.porPagina));
    return `<section class="card">
      <header class="card-head"><h2>${ui.num(d.total)} clientes</h2><span class="muted small">mostrando ${ui.num(ini)}–${ui.num(fim)}</span></header>
      <div class="table-wrap"><table id="tabelaClientes"><thead><tr>
        <th>Cliente</th><th>Segmento</th><th class="num">Pedidos</th><th class="num">Total</th><th>Última compra</th><th>Status</th><th>Permissões</th></tr></thead><tbody>
        ${d.itens.map(c => `<tr class="clickable" data-cliente="${c.id}">
          <td><a href="#/clientes/${c.id}" class="link-strong">${nomeCliente(c)}</a><small class="block muted">${ui.esc([c.cidade, c.uf].filter(Boolean).join(' / ') || '—')} · ${ui.esc(c.origem || '')}</small></td>
          <td>${segBadge(c.segmento)}</td><td class="num">${ui.num(c.pedidos)}</td><td class="num">${c.pedidos ? ui.brl(c.total) : '—'}</td>
          <td>${ui.date(c.ultima)}${c.diasSemComprar !== null && c.diasSemComprar !== undefined ? `<small class="block muted">há ${ui.num(c.diasSemComprar)} dias</small>` : ''}</td>
          <td>${ui.badge(STATUS[c.status] || c.status, c.status === 'nao_contatar' ? 'warn' : c.status === 'acompanhamento' ? 'sand' : 'neutral')}</td>
          <td>${c.anonimizado ? '—' : icones(c.podeWhatsapp, c.podeEmail)}</td></tr>`).join('')}
      </tbody></table></div>
      <nav class="pager" aria-label="Paginação"><button class="btn btn-ghost btn-sm" id="pagAnt" type="button" ${d.pagina <= 1 ? 'disabled' : ''}>← Anterior</button>
        <span class="small muted">Página ${ui.num(d.pagina)} de ${ui.num(paginas)}</span>
        <button class="btn btn-ghost btn-sm" id="pagProx" type="button" ${d.pagina >= paginas ? 'disabled' : ''}>Próxima →</button></nav>
      <p class="small muted">Ícones WA/@: permissão atual de marketing no banco (consentimento, oposição e supressão). Nenhuma mensagem é enviada por esta tela.</p>
    </section>`;
  }

  function renderLista() {
    const d = estado.lista;
    let corpo;
    if (estado.erroLista) corpo = `<section class="card error" role="alert" id="erroClientes"><h2>Não foi possível carregar os clientes</h2><p>${msgErro(estado.erroLista)}</p>
      <div class="btn-row"><button class="btn btn-primary" id="tentarClientes" type="button">Tentar de novo</button></div></section>`;
    else if (!d || d.origem !== estado.origem) corpo = '<section class="card" aria-busy="true"><p class="muted">Carregando clientes do Supabase…</p></section>';
    else corpo = tabela(d);
    return topoLista() + filtros() + corpo;
  }

  let temporizadorBusca = null;
  function bindLista(root) {
    if ((!estado.lista && !estado.erroLista && !estado.carregandoLista) || (estado.lista && estado.lista.origem !== estado.origem && !estado.carregandoLista)) carregarLista();
    const recarregar = () => { estado.filtro.pagina = 1; carregarLista(); A.router.render(); };
    root.querySelectorAll('[data-origem]').forEach(b => b.addEventListener('click', () => {
      const o = b.dataset.origem; if (o === 'ficticio' && !permitirFicticios()) return;
      estado.origem = o; estado.lista = null; recarregar();
    }));
    [['#novoCliente', () => abrirFormulario(null)], ['#novoCliente2', () => abrirFormulario(null)],
     ['#atualizarClientes', () => { carregarLista(); A.router.render(); }], ['#tentarClientes', () => { carregarLista(); A.router.render(); }]]
      .forEach(([s, fn]) => { const b = root.querySelector(s); if (b) b.addEventListener('click', fn); });
    const q = root.querySelector('#cq');
    if (q) q.addEventListener('input', () => {
      estado.filtro.q = q.value; clearTimeout(temporizadorBusca);
      temporizadorBusca = setTimeout(() => { estado.filtro.pagina = 1; carregarLista(); }, 350);
    });
    [['#cstatus', 'status'], ['#cseg', 'segmento'], ['#cperm', 'permissao'], ['#canon', 'anonimizados'], ['#cordem', 'ordem']].forEach(([s, k]) => {
      const el = root.querySelector(s); if (el) el.addEventListener('change', () => { estado.filtro[k] = el.value; recarregar(); });
    });
    const ant = root.querySelector('#pagAnt'), prox = root.querySelector('#pagProx');
    if (ant) ant.addEventListener('click', () => { estado.filtro.pagina--; carregarLista(); A.router.render(); });
    if (prox) prox.addEventListener('click', () => { estado.filtro.pagina++; carregarLista(); A.router.render(); });
    root.querySelectorAll('[data-cliente]').forEach(tr => tr.addEventListener('click', ev => { if (!ev.target.closest('a')) location.hash = '#/clientes/' + tr.dataset.cliente; }));
  }

  // ---------- FICHA ----------
  function produtosComprados(pedidos) {
    const m = new Map();
    pedidos.filter(p => p.status === 'pago' && !p.foraDaOrigem).forEach(p => p.itens.forEach(i => {
      const k = i.produtoId || 'sem:' + i.nome;
      const x = m.get(k) || { nome: i.nome, qtd: 0, pedidos: new Set(), ultima: null, valor: 0 };
      x.qtd += i.qtd; x.pedidos.add(p.id); x.valor += i.qtd * i.preco;
      if (!x.ultima || p.data > x.ultima) x.ultima = p.data;
      m.set(k, x);
    }));
    return [...m.values()].sort((a, b) => (b.ultima || '').localeCompare(a.ultima || ''));
  }

  function renderFicha(id) {
    const voltar = '<p><a href="#/clientes" class="link">← Voltar para a lista</a></p>';
    if (estado.erroFicha && estado.fichaId === id) {
      return voltar + `<section class="card error" role="alert" id="erroFicha"><h2>Cliente não disponível</h2><p>${msgErro(estado.erroFicha)}</p></section>`;
    }
    const d = estado.ficha;
    if (!d || d.cliente.id !== id) return voltar + '<section class="card" aria-busy="true"><p class="muted">Carregando a ficha do Supabase…</p></section>';
    const c = d.cliente, s = d.resumo;
    const fic = c.fonte === 'ficticio', loja = c.fonte === 'nuvemshop';
    const editavel = !fic && !c.anonimizado;
    const prods = produtosComprados(d.pedidos);
    const foraOrigem = d.pedidos.filter(p => p.foraDaOrigem).length;
    const ativa = d.oposicoes.some(o => !o.encerrada_em && o.escopo === 'todo_contato_nao_essencial');
    const canais = ['whatsapp', 'email', 'telefone', 'instagram'];
    const atual = Object.fromEntries(d.permissoes.map(p => [p.canal, p]));

    return voltar + `
    ${fic ? '<div class="aviso-ficticio" role="note" id="avisoFicticioFicha"><strong>CLIENTE FICTÍCIO DE TESTE</strong> — somente leitura; não é um cliente real.</div>' : ''}
    ${c.anonimizado ? `<div class="aviso-ficticio" role="note" id="avisoAnonimizado"><strong>Cliente anonimizado</strong> em ${dataLocal(c.anonimizadoEm)} — os dados pessoais foram removidos; o histórico de vendas foi mantido sem identificação.</div>` : ''}
    <section class="card ficha-topo" id="fichaCliente" data-cliente-id="${c.id}" data-lido="${d.lidoEm.getTime()}">
      <div class="profile">
        <div>
          <h2 class="ficha-nome">${c.anonimizado ? '<em>Cliente anonimizado</em>' : ui.esc(c.nome)}</h2>
          <p class="small muted">${ui.badge(fic ? 'Fictício' : loja ? 'Nuvemshop' : 'Manual', fic ? 'muted' : loja ? 'sand' : 'sage')} ${s ? segBadge(s.segmento) : ''}
            · cadastrado em ${dataLocal(c.cadastradoEm)} · origem ${ui.esc(c.origem || '—')}</p>
          ${c.anonimizado ? '' : `<dl class="prod-campos ficha-dados">
            <div><dt>E-mail</dt><dd>${ui.esc(c.email || '—')}</dd></div>
            <div><dt>Telefone</dt><dd>${ui.esc(c.telefone || '—')}</dd></div>
            <div><dt>Cidade / UF</dt><dd>${ui.esc([c.cidade, c.uf].filter(Boolean).join(' / ') || '—')}</dd></div>
            ${c.nuvemshopId ? `<div><dt>ID na Nuvemshop</dt><dd>${ui.esc(c.nuvemshopId)}</dd></div>` : ''}</dl>`}
        </div>
        <div class="profile-side">
          <label class="field-inline">Status comercial
            <select id="fichaStatus" ${editavel ? '' : 'disabled'}>${opcoes(STATUS, c.status)}</select></label>
          ${ativa ? '<small class="muted">Oposição ativa: permanece "não contatar".</small>' : ''}
          ${editavel ? '<button class="btn btn-ghost btn-sm" id="editarCliente" type="button">Editar dados</button>' : ''}
        </div>
      </div>
    </section>

    <section class="kpi-grid">
      ${ui.kpi({ label: 'Pedidos pagos', value: s ? ui.num(s.pedidos) : '—' })}
      ${ui.kpi({ label: 'Total gasto', value: s && s.pedidos ? ui.brl(s.total) : '—' })}
      ${ui.kpi({ label: 'Ticket médio', value: s && s.pedidos ? ui.brl(s.total / s.pedidos) : '—' })}
      ${ui.kpi({ label: 'Última compra', value: s ? ui.date(s.ultima) : '—', hint: s && s.diasSemComprar !== null && s.diasSemComprar !== undefined ? `há ${ui.num(s.diasSemComprar)} dias · 1ª em ${ui.date(s.primeira)}` : 'sem pedido pago' })}
    </section>

    <section class="grid-2">
      <article class="card">
        <header class="card-head"><h2>Histórico de pedidos</h2><span class="muted small">${ui.num(d.pedidos.length)} pedidos</span></header>
        ${foraOrigem ? `<p class="small aviso-inline">${ui.num(foraOrigem)} pedido(s) de outra origem (real × fictício) não entram no resumo.</p>` : ''}
        ${d.pedidos.length ? `<div class="lista-pedidos" id="pedidosCliente">${d.pedidos.map(p => `
          <details class="pedido"><summary><span>${dataLocal(p.data)}${p.numero ? ` · nº ${ui.esc(p.numero)}` : ''}</span>
            <span>${ui.badge(p.status, p.status === 'pago' ? 'sage' : 'muted')} <strong>${ui.brl(p.total)}</strong></span></summary>
            <table class="itens"><tbody>${p.itens.map(i => `<tr><td>${ui.esc(i.nome)}</td><td class="num">${ui.num(i.qtd)} × ${ui.brl(i.preco)}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">Sem itens registrados.</td></tr>'}</tbody></table>
            <p class="small muted">${p.cupom ? `Cupom ${ui.esc(p.cupom)} · ` : ''}subtotal ${ui.brl(p.subtotal)} · desconto ${ui.brl(p.desconto)} · frete ${ui.brl(p.frete)}</p>
          </details>`).join('')}</div>` : ui.empty('Nenhum pedido.')}
      </article>
      <article class="card">
        <header class="card-head"><h2>Produtos comprados</h2><span class="muted small">pedidos pagos</span></header>
        ${prods.length ? `<table id="produtosCliente"><thead><tr><th>Produto</th><th class="num">Qtd.</th><th class="num">Pedidos</th><th>Última</th></tr></thead><tbody>
          ${prods.map(x => `<tr><td>${ui.esc(x.nome)}</td><td class="num">${ui.num(x.qtd)}</td><td class="num">${ui.num(x.pedidos.size)}</td><td>${dataLocal(x.ultima)}</td></tr>`).join('')}</tbody></table>` : ui.empty('Nenhum produto comprado.')}
      </article>
    </section>

    <section class="card" id="secaoPermissoes">
      <header class="card-head"><h2>Permissões de contato</h2>${editavel ? '<button class="btn btn-ghost btn-sm" id="novaPermissao" type="button">Registrar permissão</button>' : ''}</header>
      <div class="table-wrap"><table><thead><tr><th>Canal</th><th>Situação atual</th><th>Desde</th><th>Marketing permitido</th></tr></thead><tbody>
        ${canais.map(k => { const p = atual[k]; return `<tr><td>${CANAIS[k]}</td><td>${p ? ui.esc(SITUACAO[p.situacao] || p.situacao) : '<span class="muted">sem registro</span>'}</td>
          <td>${p ? dataLocal(p.ocorrido_em) : '—'}</td><td>${p && p.marketing_permitido ? ui.badge('sim', 'sage') : ui.badge('não', 'muted')}</td></tr>`; }).join('')}
      </tbody></table></div>
      ${d.historicoPermissoes.length ? `<details class="historico"><summary>Histórico (${ui.num(d.historicoPermissoes.length)})</summary><ul class="list-plain">
        ${d.historicoPermissoes.map(h => `<li>${dataLocal(h.ocorrido_em)} · ${CANAIS[h.canal] || h.canal} · <strong>${SITUACAO[h.situacao] || h.situacao}</strong> — ${ui.esc(h.como_obtida)}${h.meio_coleta ? ` (${ui.esc(MEIOS[h.meio_coleta] || h.meio_coleta)})` : ''}</li>`).join('')}</ul></details>` : ''}
    </section>

    <section class="grid-2">
      <article class="card" id="secaoOposicoes">
        <header class="card-head"><h2>Oposição a contato</h2>${editavel ? '<button class="btn btn-ghost btn-sm" id="novaOposicao" type="button">Registrar oposição</button>' : ''}</header>
        ${d.oposicoes.length ? `<ul class="list-plain">${d.oposicoes.map(o => `<li>${ui.badge(o.encerrada_em ? 'encerrada' : 'ativa', o.encerrada_em ? 'muted' : 'warn')} <strong>${ESCOPO[o.escopo] || o.escopo}</strong> · ${dataLocal(o.registrada_em)}
          <small class="block muted">${ui.esc(o.como_recebida)}${o.encerrada_em ? ` · encerrada em ${dataLocal(o.encerrada_em)}: ${ui.esc(o.motivo_encerramento || '')}` : ''}</small>
          ${!o.encerrada_em && admin() && editavel ? `<button class="btn btn-ghost btn-sm" data-encerrar-oposicao="${o.id}" type="button">Encerrar</button>` : ''}</li>`).join('')}</ul>`
        : ui.empty('Nenhuma oposição registrada.')}
      </article>
      <article class="card" id="secaoInteracoes">
        <header class="card-head"><h2>Interações</h2>${editavel ? '<button class="btn btn-ghost btn-sm" id="novaInteracao" type="button">Registrar interação</button>' : ''}</header>
        ${d.interacoes.length ? `<ul class="list-plain">${d.interacoes.map(i => `<li>${dataLocal(i.data)} · ${CANAIS[i.canal] || i.canal}<small class="block">${ui.esc(i.nota)}</small></li>`).join('')}</ul>` : ui.empty('Nenhuma interação registrada.')}
      </article>
    </section>

    <section class="grid-2">
      <article class="card" id="secaoDuplicados">
        <header class="card-head"><h2>Possível mesma pessoa</h2><span class="muted small">sugestões pendentes</span></header>
        ${d.sugestoes.length ? `<ul class="list-plain">${d.sugestoes.map(x => `<li>${x.lead ? 'Contato do funil' : (x.outro ? `<a href="#/clientes/${x.outro.id}" class="link-strong">${ui.esc(x.outro.nome || 'Cliente anonimizado')}</a> <small class="muted">${ui.esc([x.outro.cidade, x.outro.uf].filter(Boolean).join(' / '))}</small>` : 'Cliente')}
          · ${x.motivo === 'mesmo_email' ? 'mesmo e-mail' : x.motivo === 'mesmo_telefone' ? 'mesmo telefone' : 'nome e cidade'}</li>`).join('')}</ul>
          <p class="small muted">Os registros nunca são unidos automaticamente; a decisão é de uma pessoa (tela de vínculos, etapa futura).</p>` : ui.empty('Nenhuma sugestão pendente.')}
      </article>
      <article class="card" id="secaoLgpd">
        <header class="card-head"><h2>LGPD — solicitações do titular</h2>${!fic ? '<button class="btn btn-ghost btn-sm" id="novaSolicitacao" type="button">Registrar solicitação</button>' : ''}</header>
        ${d.solicitacoes.length ? `<ul class="list-plain">${d.solicitacoes.map(x => `<li><strong>${ui.esc(x.protocolo)}</strong> · ${ui.esc(TIPOS_LGPD[x.tipo] || x.tipo)} · ${ui.badge(STATUS_LGPD[x.status] || x.status, x.status === 'em_andamento' ? 'sand' : x.status === 'recebida' ? 'warn' : 'muted')}
          <small class="block muted">recebida ${dataLocal(x.recebida_em)} · prazo ${dataLocal(x.prazo_resposta_em)}${x.identidade_verificada ? ' · identidade verificada' : ''}</small>
          ${admin() && x.status === 'recebida' && !fic ? `<button class="btn btn-ghost btn-sm" data-iniciar="${x.id}" type="button">Iniciar atendimento</button>` : ''}</li>`).join('')}</ul>` : ui.empty('Nenhuma solicitação.')}
        ${admin() && editavel ? '<div class="btn-row"><button class="btn btn-danger btn-sm" id="anonimizarCliente" type="button">Anonimizar…</button></div>' : ''}
        <p class="small muted">Encerramento de solicitações (resposta, indeferimento) fica na tela LGPD (etapa futura).</p>
      </article>
    </section>`;
  }

  function bindFicha(root, id) {
    if ((estado.fichaId !== id || (!estado.ficha && !estado.erroFicha)) && !estado.carregandoFicha) carregarFicha(id);
    const d = estado.ficha;
    if (!d || d.cliente.id !== id) return;
    const c = d.cliente;
    const on = (sel, fn) => { const b = root.querySelector(sel); if (b) b.addEventListener('click', fn); };
    on('#editarCliente', () => abrirFormulario(c));
    const st = root.querySelector('#fichaStatus');
    if (st) st.addEventListener('change', () => confirmarStatus(c, st.value, () => { const atual = document.getElementById('fichaStatus'); if (atual) atual.value = (estado.ficha && estado.ficha.cliente.id === c.id) ? estado.ficha.cliente.status : c.status; }));
    on('#novaPermissao', () => formPermissao(d));
    on('#novaOposicao', () => formOposicao(c));
    on('#novaInteracao', () => formInteracao(c));
    on('#novaSolicitacao', () => formSolicitacao(c));
    on('#anonimizarCliente', () => fluxoAnonimizar(d));
    root.querySelectorAll('[data-encerrar-oposicao]').forEach(b => b.addEventListener('click', () => formEncerrarOposicao(c, b.dataset.encerrarOposicao)));
    root.querySelectorAll('[data-iniciar]').forEach(b => b.addEventListener('click', () => formIniciarAtendimento(c, b.dataset.iniciar)));
  }

  // ---------- ações (todas com confirmação) ----------
  function recarregarTudo(id) {
    estado.lista = null;
    if (id) { carregarFicha(id); }
  }

  function modalComErro(titulo, corpo, rotulo, executar, opts) {
    const o = opts || {};
    ui.modal(`<h2>${ui.esc(titulo)}</h2>${corpo}
      <div class="auth-msg auth-msg-erro" id="erroAcao" role="alert" hidden></div>
      <div class="btn-row end"><button class="btn btn-ghost" data-close type="button">Cancelar</button>
        <button class="btn ${o.perigo ? 'btn-danger' : 'btn-primary'}" id="confirmarAcao" type="button">${ui.esc(rotulo)}</button></div>`, m => {
      const btn = m.querySelector('#confirmarAcao');
      btn.addEventListener('click', async () => {
        const err = m.querySelector('#erroAcao'); err.hidden = true;
        btn.disabled = true; const txt = btn.textContent; btn.textContent = 'Salvando…';
        try {
          const ok = await executar(m);
          if (ok === false) { btn.disabled = false; btn.textContent = txt; return; }
          ui.closeModal();
        } catch (e) {
          console.error(e); err.textContent = (e && e.message) || 'Erro inesperado.'; err.hidden = false;
          btn.disabled = false; btn.textContent = txt;
        }
      });
      if (o.aoAbrir) o.aoAbrir(m);
    });
  }

  function confirmarStatus(c, novo, desfazer) {
    if (novo === c.status) return;
    let salvo = false;
    modalComErro('Alterar status comercial?', `<p><strong>${ui.esc(c.nome)}</strong>: ${ui.esc(STATUS[c.status])} → <strong>${ui.esc(STATUS[novo])}</strong></p>
      <p class="small muted">"Não contatar" bloqueia campanhas e oportunidades de contato para este cliente.</p>`, 'Confirmar', async () => {
      await R().clienteSalvar({ id: c.id, versao: c.versao, nome: c.nome, email: c.email, telefone: c.telefone, cidade: c.cidade, uf: c.uf, origem: c.origem, status: novo, confirmarDuplicado: true });
      salvo = true;
      ui.toast('Status atualizado.'); recarregarTudo(c.id);
    });
    // fechado sem salvar (cancelar, Esc ou erro): o seletor volta ao valor gravado
    const root = document.getElementById('modalRoot');
    const obs = new MutationObserver(() => { if (!root.classList.contains('open')) { obs.disconnect(); if (!salvo) desfazer(); } });
    obs.observe(root, { attributes: true, attributeFilter: ['class'] });
  }

  function validarCliente(v) {
    const e = {};
    if (v.nome.length < 2 || v.nome.length > 200) e.nome = 'Informe o nome (2 a 200 caracteres).';
    if (!v.email && !v.telefone) e.email = 'Informe e-mail ou telefone.';
    if (v.email && (v.email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email))) e.email = 'E-mail inválido.';
    if (v.telefone) { const n = digitos(v.telefone).length; if (n < 10 || n > 15 || !/^[0-9()+\-.\s]+$/.test(v.telefone)) e.telefone = 'Telefone com DDD (10 a 15 dígitos).'; }
    if (v.cidade.length > 100) e.cidade = 'Máximo de 100 caracteres.';
    return e;
  }

  function abrirFormulario(c, rascunho) {
    const novo = !c;
    const pre = rascunho || c || {};
    const loja = c && c.fonte === 'nuvemshop';
    const trava = loja ? 'disabled title="Vem da Nuvemshop: altere pela loja"' : '';
    ui.modal(`<h2>${novo ? 'Novo cliente' : 'Editar cliente'}</h2>
      ${loja ? '<p class="small muted">Cliente da Nuvemshop: nome, contato, cidade e UF são da loja.</p>' : ''}
      <form id="formCliente" class="form" novalidate>
        <label>Nome *<input name="nome" maxlength="200" value="${ui.esc(pre.nome || '')}" ${trava} autocomplete="off"><span class="erro-campo" data-erro="nome"></span></label>
        <div class="form-grid">
          <label>E-mail<input name="email" type="email" maxlength="254" value="${ui.esc(pre.email || '')}" ${trava} autocomplete="off"><span class="erro-campo" data-erro="email"></span></label>
          <label>Telefone (com DDD)<input name="telefone" inputmode="tel" maxlength="40" value="${ui.esc(pre.telefone || '')}" ${trava} autocomplete="off"><span class="erro-campo" data-erro="telefone"></span></label>
        </div>
        <div class="form-grid">
          <label>Cidade<input name="cidade" maxlength="100" value="${ui.esc(pre.cidade || '')}" ${trava} autocomplete="off"><span class="erro-campo" data-erro="cidade"></span></label>
          <label>UF<select name="uf" ${trava}>${lista(UFS, pre.uf || '', '—')}</select></label>
        </div>
        <div class="form-grid">
          <label>Origem<select name="origem">${lista(pre.origem && !ORIGENS.includes(pre.origem) ? [pre.origem, ...ORIGENS] : ORIGENS, pre.origem || 'Cadastro manual')}</select></label>
          <label>Status comercial<select name="status">${opcoes(STATUS, pre.status || 'ativo')}</select></label>
        </div>
        <p class="small muted">Pelo menos um contato. Consentimento para marketing é registrado depois, na ficha, com evidência. Não registre dados de saúde.</p>
        <div class="btn-row end"><button class="btn btn-ghost" data-close type="button">Cancelar</button><button class="btn btn-primary" type="submit">Continuar</button></div>
      </form>`, m => {
      const form = m.querySelector('#formCliente');
      form.addEventListener('submit', async ev => {
        ev.preventDefault();
        const fd = new FormData(form);
        const col = k => String(fd.get(k) || '').trim().replace(/\s+/g, ' ');
        const v = loja ? { nome: c.nome, email: c.email || '', telefone: c.telefone || '', cidade: c.cidade || '', uf: c.uf || '', origem: col('origem'), status: col('status') }
                       : { nome: col('nome'), email: col('email'), telefone: col('telefone'), cidade: col('cidade'), uf: col('uf'), origem: col('origem'), status: col('status') };
        const e = loja ? {} : validarCliente(v);
        form.querySelectorAll('[data-erro]').forEach(el => { el.textContent = e[el.dataset.erro] || ''; });
        if (Object.keys(e).length) return;
        const contatoMudou = novo || digitos(v.telefone) !== digitos(c.telefone) || v.email.toLowerCase() !== String(c.email || '').toLowerCase();
        let dups = [];
        if (contatoMudou || (novo && v.cidade)) {
          try { dups = await R().clientesPossiveisDuplicados({ id: c && c.id, nome: v.nome, email: v.email, telefone: v.telefone, cidade: v.cidade }); }
          catch (err) { ui.toast('Não foi possível conferir duplicados: ' + err.message, 'warn'); return; }
        }
        if (dups.length) return avisoDuplicados(c, v, dups);
        revisarCliente(c, v, false);
      });
    });
  }

  function avisoDuplicados(c, v, dups) {
    const mot = { mesmo_email: 'mesmo e-mail', mesmo_telefone: 'mesmo telefone', nome_cidade: 'nome parecido na mesma cidade' };
    ui.modal(`<h2>Possível cliente já cadastrado</h2>
      <p>Encontramos ${dups.length === 1 ? 'um cadastro parecido' : `${dups.length} cadastros parecidos`}. Confira antes de continuar:</p>
      <ul class="list-plain" id="listaDuplicados">${dups.map(x => `<li><a href="#/clientes/${x.id}" class="link-strong" data-close>${ui.esc(x.nome)}</a>
        <small class="muted">${ui.esc([x.cidade, x.uf].filter(Boolean).join(' / '))} · ${mot[x.motivo] || x.motivo}</small></li>`).join('')}</ul>
      <p class="small muted">Família e empresa podem dividir e-mail ou telefone. Nada é unido automaticamente: se for outra pessoa, confirme; o banco registra apenas uma sugestão de vínculo para revisão.</p>
      <div class="btn-row end"><button class="btn btn-ghost" id="dupVoltar" type="button">Voltar e editar</button>
        <button class="btn btn-primary" id="dupConfirmar" type="button">É outra pessoa — continuar</button></div>`, m => {
      m.querySelector('#dupVoltar').addEventListener('click', () => abrirFormulario(c, v));
      m.querySelector('#dupConfirmar').addEventListener('click', () => revisarCliente(c, v, true));
    });
  }

  function revisarCliente(c, v, confirmarDuplicado) {
    const rot = { nome: 'Nome', email: 'E-mail', telefone: 'Telefone', cidade: 'Cidade', uf: 'UF', origem: 'Origem', status: 'Status' };
    const fmt = (k, x) => (k === 'status' ? ui.esc(STATUS[x] || x) : ui.esc(x || '—'));
    const antes = c ? { nome: c.nome, email: c.email || '', telefone: c.telefone || '', cidade: c.cidade || '', uf: c.uf || '', origem: c.origem || '', status: c.status } : {};
    const mud = Object.keys(rot).filter(k => !c || String(antes[k] || '') !== String(v[k] || ''));
    if (c && !mud.length) { ui.closeModal(); ui.toast('Nenhuma alteração para salvar.', 'warn'); return; }
    modalComErro(c ? 'Confirmar alterações' : 'Confirmar novo cliente', `
      ${c ? `<p class="small muted">Cliente: <strong>${ui.esc(c.nome)}</strong></p>` : '<p class="small muted">Será criado com origem do registro "manual".</p>'}
      <div class="table-wrap"><table class="tabela-revisao"><thead><tr><th>Campo</th>${c ? '<th>Antes</th>' : ''}<th>${c ? 'Depois' : 'Valor'}</th></tr></thead><tbody>
      ${mud.map(k => `<tr><td>${rot[k]}</td>${c ? `<td class="antes">${fmt(k, antes[k])}</td>` : ''}<td><strong>${fmt(k, v[k])}</strong></td></tr>`).join('')}</tbody></table></div>
      ${confirmarDuplicado ? '<p class="small aviso-inline">Você confirmou que é outra pessoa: o banco registrará uma sugestão de vínculo, sem unir os cadastros.</p>' : ''}`,
    'Confirmar e salvar', async () => {
      try {
        const r = await R().clienteSalvar(Object.assign({ id: c && c.id, versao: c && c.versao, confirmarDuplicado }, v));
        ui.toast(c ? 'Cliente atualizado.' : 'Cliente cadastrado.');
        estado.lista = null;
        if (c) recarregarTudo(c.id); else location.hash = '#/clientes/' + r.id;
      } catch (e) {
        if (e.tipo === 'conflito' && c) carregarFicha(c.id);
        if (e.tipo === 'possivel_duplicado') { e.message += ' Volte e confira os possíveis duplicados.'; }
        throw e;
      }
    });
  }

  function formPermissao(d) {
    const c = d.cliente;
    const textos = d.textosVigentes;
    modalComErro('Registrar permissão de contato', `
      <form class="form" id="formPermissao" novalidate>
        <div class="form-grid"><label>Canal<select name="canal">${opcoes(CANAIS, 'whatsapp')}</select></label>
          <label>Situação<select name="situacao">${opcoes(SITUACAO, 'concedida')}</select></label></div>
        <label>Como foi obtida/recebida *<textarea name="como" rows="2" maxlength="1000" placeholder="Ex.: marcou a caixa de aceite no formulário do site"></textarea></label>
        <div class="so-concessao">
          <div class="form-grid"><label>Meio de coleta *<select name="meio">${opcoes(MEIOS, '', '—')}</select></label>
            <label>Onde conferir a prova *<input name="evidencia" maxlength="500" placeholder="Ex.: print salvo na pasta LGPD/2026/…"></label></div>
          <label>Texto de consentimento apresentado *<select name="texto">${textos.length ? textos.map(t => `<option value="${t.id}">${ui.esc(t.versao)} · ${t.canal ? ui.esc(CANAIS[t.canal]) : 'todos os canais'} · desde ${dataLocal(t.vigente_desde)}</option>`).join('') : '<option value="">— nenhum texto vigente —</option>'}</select></label>
          ${!textos.length ? `<p class="small aviso-inline">Não há texto de consentimento real vigente. ${admin() ? '<button class="btn btn-ghost btn-sm" type="button" id="cadTexto">Cadastrar texto</button>' : 'Peça ao administrador para cadastrar o texto vigente.'}</p>` : ''}
        </div>
        <label>Data em que ocorreu<input name="data" type="date" max="${an().iso(an().today())}"><small class="muted">em branco = agora</small></label>
        <p class="small muted">A permissão é registrada no histórico (não se edita nem apaga). Registrar uma permissão não envia nenhuma mensagem.</p>
      </form>`, 'Registrar', async m => {
      const f = new FormData(m.querySelector('#formPermissao'));
      const sit = f.get('situacao');
      const comoObtida = String(f.get('como') || '').trim();
      if (comoObtida.length < 3) throw new Error('Descreva como a permissão foi obtida ou recebida.');
      const dados = { clienteId: c.id, canal: f.get('canal'), situacao: sit, comoObtida };
      if (sit === 'concedida') {
        if (comoObtida.length < 15) throw new Error('Na concessão, descreva com mais detalhe como foi obtida (mínimo 15 caracteres).');
        dados.meioColeta = f.get('meio'); dados.evidenciaRef = String(f.get('evidencia') || '').trim(); dados.textoId = f.get('texto');
        if (!dados.meioColeta || dados.evidenciaRef.length < 5 || !dados.textoId) throw new Error('Concessão exige meio de coleta, onde conferir a prova e o texto de consentimento.');
      }
      const dt = f.get('data'); if (dt) dados.ocorridoEm = new Date(dt + 'T12:00:00').toISOString();
      await R().registrarPermissao(dados);
      ui.toast('Permissão registrada.'); recarregarTudo(c.id);
    }, { aoAbrir: m => {
      const sel = m.querySelector('[name=situacao]'), bloco = m.querySelector('.so-concessao');
      const ajusta = () => { bloco.hidden = sel.value !== 'concedida'; };
      sel.addEventListener('change', ajusta); ajusta();
      const b = m.querySelector('#cadTexto'); if (b) b.addEventListener('click', () => formTextoConsentimento(c.id));
    } });
  }

  function formTextoConsentimento(clienteId) {
    modalComErro('Cadastrar texto de consentimento', `
      <p class="small">Cole o texto <strong>exato</strong> apresentado ao titular (revisado pelo responsável jurídico). Depois de salvo, o texto não pode ser editado: nova redação = nova versão.</p>
      <form class="form" id="formTexto" novalidate>
        <div class="form-grid"><label>Versão *<input name="versao" maxlength="40" placeholder="Ex.: 2026-11-v1"></label>
          <label>Canal<select name="canal">${opcoes(CANAIS, '', 'Todos os canais')}</select></label></div>
        <label>Texto *<textarea name="texto" rows="5" maxlength="3000"></textarea></label>
        <label>Vigente desde<input name="desde" type="date" max="${an().iso(an().today())}"><small class="muted">em branco = agora</small></label>
      </form>`, 'Salvar texto', async m => {
      const f = new FormData(m.querySelector('#formTexto'));
      const versao = String(f.get('versao') || '').trim(), texto = String(f.get('texto') || '').trim();
      if (!versao || /^FICTICIO-/i.test(versao)) throw new Error('Informe a versão (não use o prefixo FICTICIO-).');
      if (texto.length < 20) throw new Error('O texto precisa ter pelo menos 20 caracteres.');
      const desde = f.get('desde');
      await R().cadastrarTextoConsentimento({ versao, texto, canal: f.get('canal') || null, vigenteDesde: desde ? new Date(desde + 'T00:00:00').toISOString() : null });
      ui.toast('Texto de consentimento cadastrado.'); recarregarTudo(clienteId);
    });
  }

  function formOposicao(c) {
    modalComErro('Registrar oposição a contato', `
      <form class="form" id="formOposicao" novalidate>
        <label>Escopo<select name="escopo">${opcoes(ESCOPO, 'marketing')}</select></label>
        <label>Como foi recebida *<textarea name="como" rows="2" maxlength="1000" placeholder="Ex.: respondeu SAIR no WhatsApp em 28/10"></textarea></label>
        <p class="small muted">"Todo contato não essencial" coloca o cliente em <strong>não contatar</strong> automaticamente. Só o administrador pode encerrar uma oposição.</p>
      </form>`, 'Registrar oposição', async m => {
      const f = new FormData(m.querySelector('#formOposicao'));
      const como = String(f.get('como') || '').trim();
      if (como.length < 3) throw new Error('Descreva como a oposição foi recebida.');
      await R().registrarOposicao({ clienteId: c.id, escopo: f.get('escopo'), comoRecebida: como });
      ui.toast('Oposição registrada.'); recarregarTudo(c.id);
    }, { perigo: true });
  }

  function formEncerrarOposicao(c, id) {
    modalComErro('Encerrar oposição', `<form class="form" id="formEnc"><label>Motivo *<textarea name="motivo" rows="2" maxlength="500" placeholder="Ex.: titular pediu para voltar a receber ofertas (mensagem de 28/10)"></textarea></label></form>
      <p class="small muted">Encerrar não concede permissão nem muda o status: o cliente continua em "não contatar" até alguém alterar o status, e o consentimento continua sendo exigido para marketing.</p>`, 'Encerrar', async m => {
      const motivo = String(new FormData(m.querySelector('#formEnc')).get('motivo') || '').trim();
      if (motivo.length < 3) throw new Error('Informe o motivo.');
      await R().encerrarOposicao(id, motivo);
      ui.toast('Oposição encerrada.'); recarregarTudo(c.id);
    });
  }

  function formInteracao(c) {
    modalComErro('Registrar interação', `
      <form class="form" id="formInteracao" novalidate>
        <div class="form-grid"><label>Canal<select name="canal">${opcoes(CANAIS, 'whatsapp')}</select></label>
          <label>Data<input name="data" type="date" max="${an().iso(an().today())}"></label></div>
        <label>Anotação *<textarea name="nota" rows="3" maxlength="2000" placeholder="Resumo do contato"></textarea></label>
        <p class="small muted">Não registre dados de saúde nem informações sensíveis. A anotação não pode ser editada depois.</p>
      </form>`, 'Registrar', async m => {
      const f = new FormData(m.querySelector('#formInteracao'));
      const nota = String(f.get('nota') || '').trim();
      if (!nota) throw new Error('Escreva a anotação.');
      const dt = f.get('data');
      await R().registrarInteracao({ clienteId: c.id, canal: f.get('canal'), nota, data: dt ? new Date(dt + 'T12:00:00').toISOString() : null });
      ui.toast('Interação registrada.'); recarregarTudo(c.id);
    });
  }

  function formSolicitacao(c) {
    modalComErro('Registrar solicitação do titular (LGPD)', `
      <form class="form" id="formSol" novalidate>
        <div class="form-grid"><label>Tipo<select name="tipo">${opcoes(TIPOS_LGPD, 'eliminacao')}</select></label>
          <label>Recebida por<select name="canal">${opcoes(CANAIS_LGPD, 'whatsapp')}</select></label></div>
        <label>Contato para resposta<input name="contato" maxlength="254" placeholder="opcional — apagado quando a solicitação for encerrada"></label>
        <label>Descrição<textarea name="descricao" rows="2" maxlength="2000" placeholder="opcional — só o necessário"></textarea></label>
        <p class="small muted">O banco gera o protocolo e o prazo de resposta (15 dias). O tratamento é feito pelo administrador.</p>
      </form>`, 'Registrar', async m => {
      const f = new FormData(m.querySelector('#formSol'));
      const r = await R().registrarSolicitacao({ clienteId: c.id, tipo: f.get('tipo'), canal: f.get('canal'),
        contato: String(f.get('contato') || '').trim() || null, descricao: String(f.get('descricao') || '').trim() || null });
      ui.toast('Solicitação registrada' + (r && r[0] ? ': ' + r[0].protocolo : '.')); recarregarTudo(c.id);
    });
  }

  function formIniciarAtendimento(c, id) {
    modalComErro('Iniciar atendimento da solicitação', `
      <form class="form" id="formIni"><label>Como a identidade foi verificada<input name="como" maxlength="300" placeholder="Ex.: respondeu do mesmo WhatsApp do cadastro"></label>
      <small class="muted">Opcional agora; obrigatório antes de concluir pedidos de acesso, correção, eliminação ou portabilidade.</small></form>`, 'Iniciar atendimento', async m => {
      const como = String(new FormData(m.querySelector('#formIni')).get('como') || '').trim();
      if (como && como.length < 5) throw new Error('Descreva a verificação com pelo menos 5 caracteres (ou deixe em branco).');
      await R().iniciarAtendimento(id, como || null);
      ui.toast('Atendimento iniciado.'); recarregarTudo(c.id);
    });
  }

  // Anonimização: solicitação válida → simulação → "ANONIMIZAR" + novo código do autenticador
  function fluxoAnonimizar(d) {
    const c = d.cliente;
    const validas = d.solicitacoes.filter(s => s.status === 'em_andamento' && ['eliminacao', 'oposicao', 'revogacao'].includes(s.tipo));
    if (!validas.length) {
      ui.modal(`<h2>Anonimizar cliente</h2><p>É preciso uma solicitação do titular de <strong>eliminação, oposição ou revogação</strong> com status <strong>em andamento</strong>.</p>
        <p class="small muted">Registre a solicitação nesta ficha e use "Iniciar atendimento".</p><div class="btn-row end"><button class="btn btn-ghost" data-close type="button">Fechar</button></div>`);
      return;
    }
    modalComErro('Anonimizar cliente — 1/2: simulação', `
      <p>Primeiro o banco simula o impacto, sem alterar nada.</p>
      <label class="form">Solicitação<select id="solAnon">${validas.map(s => `<option value="${s.id}">${ui.esc(s.protocolo)} · ${ui.esc(TIPOS_LGPD[s.tipo])}</option>`).join('')}</select></label>`,
    'Simular', async m => {
      const sol = m.querySelector('#solAnon').value;
      const r = await R().anonimizarSimular(c.id, sol);
      etapaExecutar(c, sol, r && r.impacto);
      return false;      // a próxima etapa abre outro modal
    }, { perigo: true });
  }

  function etapaExecutar(c, sol, impacto) {
    const linhas = impacto && typeof impacto === 'object' ? Object.entries(impacto).filter(([, v]) => typeof v !== 'object' || v === null) : [];
    modalComErro('Anonimizar cliente — 2/2: confirmação', `
      <p><strong>Esta ação não pode ser desfeita.</strong> Nome e contatos são apagados; pedidos ficam no histórico sem identificação; interações são apagadas; os contatos entram na lista de supressão.</p>
      ${linhas.length ? `<details open class="historico"><summary>Impacto calculado pelo banco</summary><ul class="list-plain">${linhas.map(([k, v]) => `<li>${ui.esc(k.replace(/_/g, ' '))}: <strong>${ui.esc(String(v))}</strong></li>`).join('')}</ul></details>` : ''}
      <form class="form" id="formAnon" novalidate>
        <label>Digite ANONIMIZAR para confirmar<input name="palavra" autocomplete="off" spellcheck="false"></label>
        <label>Código atual do aplicativo autenticador<input name="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="7" class="auth-code"></label>
      </form>`, 'Anonimizar definitivamente', async m => {
      const f = new FormData(m.querySelector('#formAnon'));
      if (String(f.get('palavra') || '').trim() !== 'ANONIMIZAR') throw new Error('Digite ANONIMIZAR exatamente, em maiúsculas.');
      const codigo = digitos(f.get('codigo'));
      if (codigo.length !== 6) throw new Error('Digite os 6 números do aplicativo autenticador.');
      await R().reconfirmarCodigo(codigo);
      await R().anonimizarExecutar(c.id, sol, 'ANONIMIZAR');
      ui.toast('Cliente anonimizado.'); recarregarTudo(c.id);
    }, { perigo: true });
  }

  // ---------- registro da tela ----------
  A.views.clientes = {
    title: 'Clientes',
    get fonteDados() {
      const r = A.router.parse();
      if (r.param && estado.ficha && estado.ficha.cliente.id === r.param) return estado.ficha.cliente.fonte === 'ficticio' ? 'Dados FICTÍCIOS de teste' : 'Supabase · dados reais';
      return estado.origem === 'ficticio' ? 'Dados FICTÍCIOS de teste' : 'Supabase · dados reais';
    },
    render(id) { return id ? renderFicha(id) : renderLista(); },
    bind(root, id) { if (id) bindFicha(root, id); else bindLista(root); }
  };
})(window.ALTUM);
