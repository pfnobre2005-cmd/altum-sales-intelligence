/* ALTUM Sales Intelligence — Dashboard comercial
 * Fonte: SUPABASE (A.repositorio.dashboard). Não usa A.store (base local das demais telas).
 * Duas origens que NUNCA se misturam: "Dados reais" (padrão) e "Dados fictícios de teste" (migração 010).
 * Indicadores: regras de A.analytics aplicadas só aos registros da origem escolhida.
 * Sem registros → estado vazio ou "—"; nenhum número é inventado.
 * Clientes anonimizados: contados no histórico (sem nenhum dado pessoal) e mostrados à parte.
 */
(function (A) {
  'use strict';
  const { ui } = A;
  const VALIDADE_MS = 5 * 60 * 1000;     // ao voltar ao Dashboard, relê se a leitura tiver mais de 5 min
  const permitirFicticios = () => !(A.config && A.config.dashboard && A.config.dashboard.permitirFicticios === false);
  const ROTULO = { real: 'Dados reais', ficticio: 'Dados fictícios (teste)' };

  // Estado só em memória (some ao sair/recarregar). Nada vai para o localStorage.
  const estado = {
    origem: 'real',
    dados: { real: null, ficticio: null },
    erro: { real: null, ficticio: null },
    carregando: { real: false, ficticio: false },
    geracao: { real: 0, ficticio: 0 },
    existemFicticios: null              // descoberto na primeira leitura
  };

  async function carregar(origem) {
    if (estado.carregando[origem]) return;
    estado.carregando[origem] = true;
    estado.erro[origem] = null;
    const g = ++estado.geracao[origem];
    try {
      const d = await A.repositorio.dashboard(origem);
      if (g !== estado.geracao[origem]) return;
      estado.dados[origem] = d;
      estado.existemFicticios = d.existemFicticios;
    } catch (e) {
      if (g !== estado.geracao[origem]) return;
      console.error(e);
      estado.erro[origem] = e instanceof A.repositorio.ErroDados ? e : new A.repositorio.ErroDados('consulta', 'Erro inesperado ao montar o Dashboard.');
    } finally {
      if (g === estado.geracao[origem]) estado.carregando[origem] = false;
    }
    if (A.router.parse().name === 'dashboard') A.router.render();
  }

  // ---------- cálculo ----------
  // Recorte só com clientes anonimizados e os pedidos deles (os indicadores de clientes são somas
  // por cliente, então total = identificáveis + anonimizados, sem contagem dupla).
  function recorteAnonimizados(db) {
    const ids = new Set(db.clientes.filter(c => c.anonimizado).map(c => c.id));
    return Object.assign({}, db, { clientes: db.clientes.filter(c => ids.has(c.id)), pedidos: db.pedidos.filter(p => ids.has(p.clienteId)), leads: [] });
  }

  // Comparação só quando o período anterior tem base; sem base, diz isso (não inventa variação).
  function comparar(cur, prev, temBase, opt) {
    if (!temBase) return '<span class="delta neutral">sem base de comparação</span>';
    return ui.delta(cur, prev, opt || {});
  }

  function dicaAnon(n, singular, plural) {
    return n > 0 ? ` · inclui ${ui.num(n)} ${n === 1 ? singular : plural}` : '';
  }

  // ---------- partes da tela ----------
  function hora(d) { return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }

  function seletorOrigem() {
    const mostrarTeste = permitirFicticios() && estado.existemFicticios !== false;
    if (!mostrarTeste && estado.origem === 'real') return '';
    return `<div class="seg-control seletor-origem" role="group" aria-label="Origem dos dados">
      ${['real', 'ficticio'].filter(o => o === 'real' || mostrarTeste).map(o =>
        `<button type="button" class="${estado.origem === o ? 'active' : ''}" data-origem="${o}" aria-pressed="${estado.origem === o}">${ROTULO[o]}</button>`).join('')}
    </div>`;
  }

  function barraFonte() {
    const o = estado.origem;
    const d = estado.dados[o];
    return `<div class="fonte-dados small" id="fonteDados">
      <span class="badge ${o === 'ficticio' ? 'badge-warn' : 'badge-sage'}">Supabase</span>
      <span>${o === 'ficticio' ? 'registros fictícios de teste' : 'registros reais (manual, Nuvemshop, importação)'}${d ? ` · lidos às ${hora(d.lidoEm)}` : ''}</span>
      <span class="fonte-acoes">${seletorOrigem()}
        <button class="btn btn-ghost btn-sm" id="atualizarDash" type="button" ${estado.carregando[o] ? 'disabled' : ''}>${estado.carregando[o] ? 'Atualizando…' : 'Atualizar'}</button></span>
    </div>
    ${o === 'ficticio' ? `<div class="aviso-ficticio" role="note" id="avisoFicticio"><strong>DADOS FICTÍCIOS DE TESTE</strong> — carga da migração 010 (fonte = fictício). Não representam clientes nem vendas reais e não entram nos indicadores reais.</div>` : ''}`;
  }

  function telaCarregando() {
    return `<section class="card" aria-busy="true"><p class="muted">Carregando dados do Supabase…</p></section>`;
  }

  function telaErro(e) {
    return `<section class="card error" role="alert" id="erroDash">
      <h2>Não foi possível carregar o Dashboard</h2>
      <p>${ui.esc(e.message)}</p>
      <p class="small muted">Nenhum número foi exibido para não mostrar dados incompletos.</p>
      <div class="btn-row"><button class="btn btn-primary" id="tentarDash" type="button">Tentar de novo</button></div>
    </section>`;
  }

  function telaVazia() {
    const podeTeste = permitirFicticios() && estado.existemFicticios;
    return `<section class="card estado-vazio" id="dashVazio">
      <h2>Ainda não há dados comerciais reais</h2>
      <p>O Supabase ainda não tem clientes, pedidos ou contatos reais. Eles aparecerão aqui quando forem cadastrados ou quando a integração com a Nuvemshop for ativada.</p>
      <p class="small muted">Nenhum indicador é exibido sem registros, para não mostrar números que não existem.</p>
      ${podeTeste ? '<div class="btn-row"><button class="btn btn-primary" type="button" data-origem="ficticio" id="verFicticios">Ver dados fictícios de teste</button></div>' : ''}
    </section>`;
  }

  function telaVaziaFicticia() {
    return `<section class="card estado-vazio" id="dashVazioFicticio">
      <h2>Não há dados fictícios no banco</h2>
      <p>A carga de teste foi removida ou não existe. Volte para os dados reais.</p>
      <div class="btn-row"><button class="btn btn-primary" type="button" data-origem="real">Ver dados reais</button></div>
    </section>`;
  }

  function indicadores(d) {
    const db = d.base, an = A.analytics;
    const days = A.state.periodo;
    const k = an.kpis(db, days), a = k.atual, p = k.anterior;
    const ka = an.kpis(recorteAnonimizados(db), days).atual;
    const fups = an.followUps(db);
    const janela = d.janela;
    const series = an.monthlySeries(db, 8);
    const temMeses = series.some(m => m.primeira > 0 || m.recompra > 0);
    const periodos = [[30, '30 dias'], [90, '90 dias'], [180, '180 dias'], [365, '12 meses']];
    const baseClientes = p.clientes > 0, basePedidos = p.pedidos > 0;
    const identificaveis = a.clientes - ka.clientes;

    return `
      ${d.pedidosForaDaOrigem > 0 ? `<div class="card aviso-inconsistencia" role="note">${ui.num(d.pedidosForaDaOrigem)} pedido(s) desta origem estão ligados a clientes de outra origem e ficaram <strong>fora</strong> de todos os indicadores.</div>` : ''}
      <section class="toolbar">
        <div class="seg-control" role="group" aria-label="Período">
          ${periodos.map(([dd, l]) => `<button type="button" class="${dd === days ? 'active' : ''}" data-days="${dd}">${l}</button>`).join('')}
        </div>
        <p class="muted small">Período ${ui.date(k.periodo.start)} – ${ui.date(k.periodo.end)} · comparado a ${ui.date(k.periodo.pStart)} – ${ui.date(k.periodo.pEnd)}</p>
      </section>

      <section class="kpi-grid" id="kpis" data-origem-dados="${d.origem}">
        ${ui.kpi({ label: 'Clientes cadastrados', value: ui.num(a.clientes), delta: comparar(a.clientes, p.clientes, baseClientes),
                   hint: `${ui.num(identificaveis)} identificáveis · ${ui.num(ka.clientes)} anonimizados` })}
        ${ui.kpi({ label: 'Novos clientes', value: ui.num(a.novos), delta: comparar(a.novos, p.novos, basePedidos),
                   hint: '1º pedido no período' + dicaAnon(ka.novos, 'anonimizado', 'anonimizados') })}
        ${ui.kpi({ label: 'Clientes recorrentes', value: ui.num(a.recorrentes), delta: comparar(a.recorrentes, p.recorrentes, baseClientes),
                   hint: 'acumulado · 2+ pedidos pagos' + dicaAnon(ka.recorrentes, 'anonimizado', 'anonimizados') })}
        ${ui.kpi({ label: 'Clientes inativos', value: ui.num(a.inativos), delta: comparar(a.inativos, p.inativos, baseClientes, { inverse: true }),
                   hint: `sem pedido há +${db.regras.inativoAposDias} dias` + dicaAnon(ka.inativos, 'anonimizado', 'anonimizados') })}
        ${ui.kpi({ label: 'Faturamento (pedidos pagos)', value: ui.brl0(a.faturamento), delta: comparar(a.faturamento, p.faturamento, basePedidos),
                   hint: a.pedidos ? `${ui.num(a.pedidos)} pedidos` : 'nenhum pedido pago no período' })}
        ${ui.kpi({ label: 'Ticket médio', value: a.pedidos ? ui.brl(a.ticket) : '—',
                   delta: a.pedidos ? comparar(a.ticket, p.ticket, basePedidos) : '', hint: a.pedidos ? '' : 'sem pedidos no período' })}
        ${ui.kpi({ label: 'Taxa de recompra', value: a.compradores ? ui.pct(a.taxaRecompra) : '—',
                   delta: a.compradores ? comparar(a.taxaRecompra, p.taxaRecompra, p.compradores > 0, { isPct: true }) : '',
                   hint: a.compradores ? 'acumulado · recorrentes ÷ compradores' : 'nenhum cliente com pedido pago' })}
        ${ui.kpi({ label: 'Oportunidades de relacionamento', value: ui.num(janela.length + fups.length), hint: `${ui.num(janela.length)} recompras · ${ui.num(fups.length)} follow-ups` })}
      </section>

      <section class="grid-2">
        <article class="card">
          <header class="card-head"><h2>Faturamento mensal</h2><span class="muted small">primeira compra × recompra</span></header>
          ${temMeses ? ui.stackedBars(series, { keys: ['primeira', 'recompra'], names: ['Primeira compra', 'Recompra'], format: ui.brl0 })
                     : ui.empty('Nenhum pedido pago nos últimos 8 meses.')}
        </article>
        <article class="card">
          <header class="card-head"><h2>Na janela de recompra</h2><span class="muted small">${ui.num(janela.length)} clientes</span></header>
          ${janela.length ? `<ul class="list" id="listaJanela">${janela.slice(0, 6).map(o => `
            <li><div class="list-item">
              <div><strong>${ui.esc(o.cliente.nome)}</strong><small>${ui.esc(o.produto.nome)} · reposição estimada ${ui.date(o.estimada)}</small></div>
              <div class="list-right">${ui.consentIcons(o.cliente)}</div></div></li>`).join('')}</ul>
            <p class="small muted">Ícones: permissão atual de marketing no banco (consentimento, oposições e supressões). Produtos desativados e clientes "não contatar" não entram.</p>`
          : ui.empty('Nenhum cliente na janela agora.')}
        </article>
      </section>

      <section class="card">
        <header class="card-head"><h2>Follow-ups do funil (vencidos ou hoje)</h2><span class="muted small">${ui.num(fups.length)} contatos</span></header>
        ${fups.length ? `<div class="table-wrap"><table id="tabelaFups"><thead><tr><th>Contato</th><th>Origem</th><th>Etapa</th><th>Agendado</th></tr></thead><tbody>
          ${fups.map(l => `<tr><td>${ui.esc(l.nome)}${l.empresa ? `<small class="block muted">${ui.esc(l.empresa)}</small>` : ''}</td>
          <td>${ui.esc(l.origem)}</td><td>${ui.esc(A.views.funil.stageLabel(l.etapa))}</td>
          <td>${ui.date(l.proximoContato)} ${l.proximoContato < an.iso(an.today()) ? ui.badge('atrasado', 'warn') : ui.badge('hoje', 'sage')}</td></tr>`).join('')}
        </tbody></table></div>` : ui.empty('Nenhum follow-up pendente.')}
      </section>
      <p class="small muted">Recompra e Funil ainda usam a base local; os atalhos para essas telas voltam quando elas forem conectadas ao banco.</p>`;
  }

  function trocarOrigem(o) {
    if (!['real', 'ficticio'].includes(o) || (o === 'ficticio' && !permitirFicticios())) return;
    estado.origem = o;
    A.router.render();
  }

  A.views.dashboard = {
    title: 'Dashboard comercial',
    get fonteDados() { return estado.origem === 'ficticio' ? 'Dados FICTÍCIOS de teste' : 'Supabase · dados reais'; },
    render() {
      const o = estado.origem;
      const d = estado.dados[o];
      if (!d) return barraFonte() + (estado.erro[o] ? telaErro(estado.erro[o]) : telaCarregando());
      const aviso = estado.erro[o] ? `<div class="card error" role="alert"><p>${ui.esc(estado.erro[o].message)} Exibindo a última leitura (${hora(d.lidoEm)}).</p></div>` : '';
      if (d.vazio) return barraFonte() + aviso + (o === 'real' ? telaVazia() : telaVaziaFicticia());
      return barraFonte() + aviso + indicadores(d);
    },
    bind(root) {
      const o = estado.origem;
      const d = estado.dados[o];
      const vencido = d && Date.now() - d.lidoEm.getTime() > VALIDADE_MS;
      if ((!d && !estado.erro[o]) || vencido) carregar(o);
      const atualizar = () => { carregar(estado.origem); A.router.render(); };
      const b1 = root.querySelector('#atualizarDash'); if (b1) b1.addEventListener('click', atualizar);
      const b2 = root.querySelector('#tentarDash'); if (b2) b2.addEventListener('click', atualizar);
      root.querySelectorAll('[data-origem]').forEach(b => b.addEventListener('click', () => trocarOrigem(b.dataset.origem)));
      root.querySelectorAll('[data-days]').forEach(b => b.addEventListener('click', () => { A.state.periodo = +b.dataset.days; A.router.render(); }));
    }
  };
})(window.ALTUM);
