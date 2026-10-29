/* ALTUM Sales Intelligence — Tela 3: Recompra (Supabase)
 * Oportunidades por cliente × produto (v_recompra_painel, migração 013): última compra paga do
 * produto, ciclo da Tela Produtos, data estimada, dias restantes, situação, permissão por canal
 * (regra real do banco) e acompanhamento comercial. Paginação e filtros no servidor.
 * Registro de acompanhamento só pela função recompra_registrar (2 etapas, concorrência, canal
 * permitido). Histórico somente leitura. Nenhuma mensagem é enviada: a tela orienta e registra.
 * Origens nunca misturadas: "Dados reais" (padrão) × "Dados fictícios (teste)" (somente leitura).
 */
(function (A) {
  'use strict';
  const { ui } = A;
  const R = () => A.repositorio;
  const an = () => A.analytics;

  const SITUACAO = {
    janela: ['Na janela', 'sage', 'Data estimada dentro da janela de contato.'],
    atrasado: ['Atrasada', 'warn', 'Passou da janela sem nova compra.'],
    antes_da_janela: ['Antes da janela', 'neutral', 'Ainda é cedo para o contato.'],
    inativo: ['Cliente inativo', 'muted', 'Cliente sem nenhuma compra há mais tempo que o limite de inatividade.']
  };
  const ORDEM_SIT = ['janela', 'atrasado', 'antes_da_janela', 'inativo'];
  const ACOMP = { sem_acompanhamento: ['Sem acompanhamento', 'neutral'], agendada: ['Próxima ação agendada', 'sand'],
                  vencida: ['Próxima ação vencida', 'warn'], encerrada: ['Encerrada', 'muted'] };
  const RESULTADOS = { sem_resposta: 'Sem resposta', retornar_depois: 'Pediu retorno depois', interessado: 'Interessado',
                       comprou: 'Comprou (informado)', nao_interessado: 'Sem interesse agora', pediu_nao_contatar: 'Pediu para não ser contatado' };
  const ABERTOS = ['sem_resposta', 'retornar_depois', 'interessado'];
  const ACOES = { novo_contato: 'Novo contato', aguardar_cliente: 'Aguardar retorno do cliente', conferir_pedido: 'Conferir pedido na loja', outro: 'Outro' };
  const CANAIS = { whatsapp: 'WhatsApp', email: 'E-mail', telefone: 'Telefone', instagram: 'Instagram' };
  const INICIATIVA = { empresa: 'Contato feito pela empresa', cliente: 'Cliente entrou em contato' };
  const permitirFicticios = () => !(A.config && A.config.dashboard && A.config.dashboard.permitirFicticios === false);

  // Estado só em memória (nada no localStorage)
  const FILTRO_PADRAO = { q: '', situacao: '', acompanhamento: 'abertas', produto: '', contato: '', de: '', ate: '', ordem: 'data', pagina: 1 };
  const estado = {
    origem: 'real', filtro: Object.assign({}, FILTRO_PADRAO),
    lista: null, erro: null, carregando: false, g: 0, existemFicticios: null,
    produtos: null, produtosOrigem: null
  };

  // ---------- utilidades ----------
  const opcoes = (mapa, sel, vazio) => (vazio !== undefined ? `<option value="">${ui.esc(vazio)}</option>` : '')
    + Object.entries(mapa).map(([v, l]) => `<option value="${ui.esc(v)}" ${v === sel ? 'selected' : ''}>${ui.esc(Array.isArray(l) ? l[0] : l)}</option>`).join('');
  const msgErro = e => ui.esc((e && e.message) || 'Erro inesperado.');
  const hojeIso = () => an().iso(an().today());
  const somarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return an().iso(d); };
  const dataHora = ts => (ts ? new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  function diasTexto(n) {
    if (n === 0) return 'hoje';
    if (n > 0) return `em ${ui.num(n)} ${n === 1 ? 'dia' : 'dias'}`;
    return `há ${ui.num(-n)} ${n === -1 ? 'dia' : 'dias'}`;
  }
  const badgeSit = s => ui.badge((SITUACAO[s] || [s])[0], (SITUACAO[s] || [, 'neutral'])[1]);
  const badgeAcomp = a => ui.badge((ACOMP[a] || [a])[0], (ACOMP[a] || [, 'neutral'])[1]);
  const icones = o => ui.consentIcons({ consentimento: { whatsapp: o.podeWhatsapp, email: o.podeEmail } });
  const fic = () => estado.origem === 'ficticio';

  // ---------- carregamento ----------
  async function carregar() {
    const g = ++estado.g;
    estado.carregando = true; estado.erro = null;
    // sinaliza a leitura sem redesenhar a tela (não tira o foco do campo de busca)
    const btn = document.querySelector('#atualizarRecompra');
    if (btn) { btn.disabled = true; btn.textContent = 'Atualizando…'; }
    const tab = document.querySelector('#tabelaRecompra');
    if (tab) tab.setAttribute('aria-busy', 'true');
    try {
      const pedidos = [R().recompraLista(Object.assign({ origem: estado.origem }, estado.filtro))];
      if (estado.produtosOrigem !== estado.origem) pedidos.push(R().recompraProdutos(estado.origem));
      const [d, prods] = await Promise.all(pedidos);
      if (g !== estado.g) return;
      estado.lista = d; estado.existemFicticios = d.existemFicticios;
      if (prods) { estado.produtos = prods; estado.produtosOrigem = d.origem; }
    } catch (e) {
      if (g !== estado.g) return;
      console.error(e); estado.erro = e; estado.lista = null;
    } finally {
      if (g === estado.g) estado.carregando = false;
    }
    if (A.router.parse().name === 'recompra') A.router.render();
  }

  // ---------- topo ----------
  function seletorOrigem() {
    const mostrar = permitirFicticios() && estado.existemFicticios !== false;
    if (!mostrar && estado.origem === 'real') return '';
    return `<div class="seg-control seletor-origem" role="group" aria-label="Origem dos dados">
      <button type="button" class="${!fic() ? 'active' : ''}" data-origem="real">Dados reais</button>
      ${mostrar ? `<button type="button" class="${fic() ? 'active' : ''}" data-origem="ficticio">Dados fictícios (teste)</button>` : ''}
    </div>`;
  }

  function topo() {
    const d = estado.lista;
    return `<div class="fonte-dados small" id="fonteRecompra">
      <span class="badge ${fic() ? 'badge-warn' : 'badge-sage'}">Supabase</span>
      <span>${fic() ? 'oportunidades de teste (somente leitura)' : 'oportunidades reais'}${d ? ` · lidas às ${d.lidoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
      <span class="fonte-acoes">${seletorOrigem()}
        <button class="btn btn-ghost btn-sm" id="atualizarRecompra" type="button" ${estado.carregando ? 'disabled' : ''}>${estado.carregando ? 'Atualizando…' : 'Atualizar'}</button></span>
    </div>
    ${fic() ? '<div class="aviso-ficticio" role="note" id="avisoFicticioRecompra"><strong>DADOS FICTÍCIOS DE TESTE</strong> — carga da migração 010. Não são clientes reais; nada pode ser registrado aqui.</div>' : ''}
    <div class="notice small" id="regrasRecompra">${d ? `Regras do banco: janela de contato de <b>${ui.num(d.regras.janelaAntesDias)} dias antes</b> a <b>${ui.num(d.regras.janelaDepoisDias)} dias depois</b> da data estimada · cliente inativo após <b>${ui.num(d.regras.inativoAposDias)} dias</b> sem comprar. Data estimada = última compra paga do produto + ciclo do produto × quantidade (ciclo definido na <a href="#/produtos" class="link">Tela Produtos</a>).` : 'Regras de recompra lidas do banco.'}
      <br><small>Hipótese comercial a partir do histórico de pedidos — não indica necessidade de consumo nem orientação de saúde. Nenhuma mensagem é enviada por esta tela. Ficam fora: produtos desativados ou sem ciclo, clientes anonimizados, com oposição ou em "não contatar".</small></div>`;
  }

  function cartoes(d) {
    if (!d) return '';
    const sel = estado.filtro.situacao;
    return `<section class="seg-cards" id="cartoesRecompra">
      ${ORDEM_SIT.map(s => `<button class="seg-card ${s === sel ? 'active' : ''}" type="button" data-sit="${s}" aria-pressed="${s === sel}">
        <span class="seg-num">${ui.num(d.contagem[s])}</span><span class="seg-name">${ui.esc(SITUACAO[s][0])}</span>
        <span class="seg-desc">${ui.esc(SITUACAO[s][2])}</span></button>`).join('')}
      <button class="seg-card ${estado.filtro.acompanhamento === 'vencida' ? 'active' : ''}" type="button" data-vencidas="1">
        <span class="seg-num">${ui.num(d.vencidas)}</span><span class="seg-name">Ações vencidas</span>
        <span class="seg-desc">Próxima ação com data passada.</span></button>
    </section>`;
  }

  function filtros() {
    const f = estado.filtro;
    const prods = (estado.produtos || []).reduce((m, p) => (m[p.id] = p.nome + (p.sku ? ` (${p.sku})` : ''), m), {});
    return `<section class="filters card filtros-recompra">
      <input type="search" id="rq" placeholder="Buscar cliente pelo nome" value="${ui.esc(f.q)}" aria-label="Buscar cliente" maxlength="80">
      <select id="rsit" aria-label="Situação">${opcoes(Object.fromEntries(ORDEM_SIT.map(s => [s, SITUACAO[s][0]])), f.situacao, 'Todas as situações')}</select>
      <select id="racomp" aria-label="Acompanhamento">${opcoes({ abertas: 'Abertas (não encerradas)', sem_acompanhamento: 'Sem acompanhamento', agendada: 'Ação agendada', vencida: 'Ação vencida', encerrada: 'Encerradas', todas: 'Todas' }, f.acompanhamento)}</select>
      <select id="rprod" aria-label="Produto">${opcoes(prods, f.produto, 'Todos os produtos')}</select>
      <select id="rcont" aria-label="Possibilidade de contato">${opcoes({ algum: 'Com algum canal permitido', whatsapp: 'Pode WhatsApp', email: 'Pode e-mail', nenhum: 'Sem canal permitido' }, f.contato, 'Qualquer permissão')}</select>
      <label class="small periodo">Data estimada de <input type="date" id="rde" value="${ui.esc(f.de)}" aria-label="Data estimada a partir de"></label>
      <label class="small periodo">até <input type="date" id="rate" value="${ui.esc(f.ate)}" aria-label="Data estimada até"></label>
      <select id="rordem" aria-label="Ordenar">${opcoes({ data: 'Ordenar: data estimada', proxima: 'Ordenar: próxima ação', ultima: 'Ordenar: última compra', cliente: 'Ordenar: cliente' }, f.ordem)}</select>
      <button class="btn btn-ghost btn-sm" id="limparFiltros" type="button">Limpar filtros</button>
    </section>`;
  }

  const semFiltro = () => JSON.stringify(Object.assign({}, estado.filtro, { pagina: 1, ordem: 'data' })) === JSON.stringify(FILTRO_PADRAO);

  function tabela(d) {
    if (!d.itens.length) {
      if (!fic() && semFiltro()) {
        return `<section class="card estado-vazio" id="recompraVazio"><h2>Ainda não há oportunidades de recompra reais</h2>
          <p>As oportunidades aparecem quando existem <strong>pedidos pagos reais</strong> de <strong>produtos ativos com ciclo de recompra</strong> (defina o ciclo na <a href="#/produtos" class="link">Tela Produtos</a>).
          Os pedidos ainda não são importados: a integração com a Nuvemshop será ativada numa próxima etapa e, a partir dela, os pedidos da loja entram aqui automaticamente.</p>
          ${permitirFicticios() && estado.existemFicticios ? '<div class="btn-row"><button class="btn btn-ghost" type="button" data-origem="ficticio">Ver dados fictícios de teste</button></div>' : ''}</section>`;
      }
      return `<section class="card" id="recompraSemResultado">${ui.empty('Nenhuma oportunidade com esses filtros.')}</section>`;
    }
    const ini = (d.pagina - 1) * d.porPagina + 1, fim = ini + d.itens.length - 1;
    const paginas = Math.max(1, Math.ceil(d.total / d.porPagina));
    return `<section class="card">
      <header class="card-head"><h2>${ui.num(d.total)} ${d.total === 1 ? 'oportunidade' : 'oportunidades'}</h2><span class="muted small">mostrando ${ui.num(ini)}–${ui.num(fim)}</span></header>
      <div class="table-wrap"><table id="tabelaRecompra"><thead><tr>
        <th>Cliente</th><th>Produto</th><th>Última compra</th><th class="num">Ciclo</th><th>Data estimada</th><th>Situação</th><th>Contato</th><th>Acompanhamento</th><th></th></tr></thead><tbody>
        ${d.itens.map(o => `<tr data-cli="${o.clienteId}" data-prod="${o.produtoId}">
          <td><a href="#/clientes/${o.clienteId}" class="link-strong">${ui.esc(o.cliente || '—')}</a>${o.fonte !== 'manual' && o.fonte !== 'ficticio' ? `<small class="block muted">origem: ${ui.esc(o.fonte)}</small>` : ''}</td>
          <td>${ui.esc(o.produto)}${o.sku ? `<small class="block muted">${ui.esc(o.sku)}</small>` : ''}</td>
          <td>${ui.date(o.ultimaCompra)}<small class="block muted">${ui.num(o.qtd)} un. · ${ui.num(o.compras)} ${o.compras === 1 ? 'compra' : 'compras'} do produto</small></td>
          <td class="num">${ui.num(o.ciclo)} d${o.qtd > 1 ? `<small class="block muted">× ${ui.num(o.qtd)}</small>` : ''}</td>
          <td>${ui.date(o.estimada)}<small class="block muted">${diasTexto(o.diasRestantes)}</small></td>
          <td>${badgeSit(o.situacao)}</td>
          <td>${icones(o)}</td>
          <td>${badgeAcomp(o.acompanhamento)}${o.proximaAcaoEm && o.acompanhamento !== 'encerrada' ? `<small class="block muted">${ui.esc(ACOES[o.proximaAcao] || '')} · ${ui.date(o.proximaAcaoEm)}</small>` : ''}
            ${o.acompanhamento === 'encerrada' && o.ultimoResultado ? `<small class="block muted">${ui.esc(RESULTADOS[o.ultimoResultado] || '')}</small>` : ''}</td>
          <td><button class="btn btn-ghost btn-sm" type="button" data-abrir="${o.clienteId}|${o.produtoId}">${fic() ? 'Ver' : 'Abrir'}</button></td></tr>`).join('')}
      </tbody></table></div>
      <nav class="pager" aria-label="Paginação"><button class="btn btn-ghost btn-sm" id="pagAntR" type="button" ${d.pagina <= 1 ? 'disabled' : ''}>← Anterior</button>
        <span class="small muted">Página ${ui.num(d.pagina)} de ${ui.num(paginas)}</span>
        <button class="btn btn-ghost btn-sm" id="pagProxR" type="button" ${d.pagina >= paginas ? 'disabled' : ''}>Próxima →</button></nav>
      <p class="small muted">WA/@: permissão atual de contato comercial no banco (consentimento, recusa, revogação, oposição e supressão). Contato só por canal permitido; nada é enviado automaticamente.</p>
    </section>`;
  }

  function render() {
    const d = estado.lista;
    let corpo;
    if (estado.erro) corpo = filtros() + `<section class="card error" role="alert" id="erroRecompra"><h2>Não foi possível carregar as oportunidades</h2><p>${msgErro(estado.erro)}</p>
      <div class="btn-row"><button class="btn btn-primary" id="tentarRecompra" type="button">Tentar de novo</button></div></section>`;
    else if (!d || d.origem !== estado.origem) corpo = '<section class="card" aria-busy="true"><p class="muted">Carregando oportunidades do Supabase…</p></section>';
    else corpo = cartoes(d) + filtros() + tabela(d);
    return topo() + corpo;
  }

  let temporizador = null;
  function bind(root) {
    if ((!estado.lista && !estado.erro && !estado.carregando) || (estado.lista && estado.lista.origem !== estado.origem && !estado.carregando)) carregar();
    const recarregar = () => { estado.filtro.pagina = 1; carregar(); A.router.render(); };
    root.querySelectorAll('[data-origem]').forEach(b => b.addEventListener('click', () => {
      const o = b.dataset.origem; if (o === 'ficticio' && !permitirFicticios()) return;
      if (o === estado.origem) return;
      estado.origem = o; estado.lista = null; estado.filtro.produto = ''; recarregar();
    }));
    [['#atualizarRecompra', () => { carregar(); A.router.render(); }], ['#tentarRecompra', () => { carregar(); A.router.render(); }],
     ['#limparFiltros', () => { estado.filtro = Object.assign({}, FILTRO_PADRAO); recarregar(); }]]
      .forEach(([s, fn]) => { const b = root.querySelector(s); if (b) b.addEventListener('click', fn); });
    root.querySelectorAll('[data-sit]').forEach(b => b.addEventListener('click', () => {
      estado.filtro.situacao = estado.filtro.situacao === b.dataset.sit ? '' : b.dataset.sit; recarregar();
    }));
    const venc = root.querySelector('[data-vencidas]');
    if (venc) venc.addEventListener('click', () => {
      estado.filtro.acompanhamento = estado.filtro.acompanhamento === 'vencida' ? 'abertas' : 'vencida'; estado.filtro.situacao = ''; recarregar();
    });
    const q = root.querySelector('#rq');
    if (q) q.addEventListener('input', () => {
      estado.filtro.q = q.value; clearTimeout(temporizador);
      temporizador = setTimeout(() => { estado.filtro.pagina = 1; carregar(); }, 350);
    });
    [['#rsit', 'situacao'], ['#racomp', 'acompanhamento'], ['#rprod', 'produto'], ['#rcont', 'contato'], ['#rde', 'de'], ['#rate', 'ate'], ['#rordem', 'ordem']]
      .forEach(([s, k]) => { const el = root.querySelector(s); if (el) el.addEventListener('change', () => { estado.filtro[k] = el.value; recarregar(); }); });
    const ant = root.querySelector('#pagAntR'), prox = root.querySelector('#pagProxR');
    if (ant) ant.addEventListener('click', () => { estado.filtro.pagina--; carregar(); A.router.render(); });
    if (prox) prox.addEventListener('click', () => { estado.filtro.pagina++; carregar(); A.router.render(); });
    root.querySelectorAll('[data-abrir]').forEach(b => b.addEventListener('click', () => {
      const [c, p] = b.dataset.abrir.split('|'); abrirDetalhe(c, p);
    }));
  }

  // ---------- detalhe (modal) ----------
  function corpoDetalhe(d) {
    const o = d.oportunidade;
    const editavel = o.fonte !== 'ficticio';
    const canais = [o.podeWhatsapp ? 'WhatsApp' : null, o.podeEmail ? 'e-mail' : null].filter(Boolean);
    return `<div id="detalheRecompra" data-lido="${d.lidoEm.getTime()}">
      <h2>${ui.esc(o.cliente || '—')} · ${ui.esc(o.produto)}</h2>
      ${!editavel ? '<div class="aviso-ficticio small" role="note">Dados fictícios de teste: somente leitura.</div>' : ''}
      <dl class="resumo-recompra">
        <div><dt>Última compra do produto</dt><dd>${ui.date(o.ultimaCompra)} · ${ui.num(o.qtd)} un.</dd></div>
        <div><dt>Ciclo de reposição</dt><dd>${ui.num(o.ciclo)} dias por unidade</dd></div>
        <div><dt>Data estimada</dt><dd>${ui.date(o.estimada)} (${diasTexto(o.diasRestantes)})</dd></div>
        <div><dt>Situação</dt><dd>${badgeSit(o.situacao)}</dd></div>
        <div><dt>Última compra do cliente</dt><dd>${ui.date(o.ultimaCompraCliente)} (há ${ui.num(o.diasSemComprar)} dias)</dd></div>
        <div><dt>Compras deste produto</dt><dd>${ui.num(o.compras)}</dd></div>
      </dl>
      <section class="contato-recompra">
        <h3>Contato</h3>
        <p>${icones(o)} ${canais.length ? `Contato comercial permitido por <strong>${canais.join(' e ')}</strong>.` : '<strong>Nenhum canal permitido</strong> para contato comercial. Só registre contatos iniciados pelo cliente.'}</p>
        ${editavel && canais.length ? '<button class="btn btn-ghost btn-sm" type="button" id="mostrarContato">Mostrar contato permitido</button><div id="contatoPermitido" class="small"></div>' : ''}
        <p class="small muted">A mensagem é enviada por você, fora do sistema. Esta tela não envia nada.</p>
      </section>
      <section>
        <h3>Acompanhamento ${badgeAcomp(o.acompanhamento)}</h3>
        ${o.proximaAcaoEm && o.acompanhamento !== 'encerrada' ? `<p class="small">Próxima ação: <strong>${ui.esc(ACOES[o.proximaAcao] || '')}</strong> em ${ui.date(o.proximaAcaoEm)}</p>` : ''}
        ${d.historico.length ? `<ol class="historico list-plain" id="historicoRecompra">${d.historico.map(h => `<li>
            <strong>${ui.esc(RESULTADOS[h.resultado] || h.resultado)}</strong> · ${ui.esc(CANAIS[h.canal] || h.canal)} · ${ui.esc(h.iniciativa === 'cliente' ? 'iniciado pelo cliente' : 'iniciado pela empresa')}
            <small class="block muted">${dataHora(h.em)}${h.compraReferencia !== o.ultimaCompra ? ` · ciclo anterior (compra de ${ui.date(h.compraReferencia)})` : ''}${h.proximaAcao ? ` · próxima: ${ui.esc(ACOES[h.proximaAcao])} em ${ui.date(h.proximaAcaoEm)}` : ''}</small>
            ${h.nota ? `<small class="block">${ui.esc(h.nota)}</small>` : ''}</li>`).join('')}</ol>`
          : '<p class="muted small" id="historicoRecompra">Nenhum acompanhamento registrado para este produto.</p>'}
        <p class="small muted">O histórico não pode ser alterado nem apagado; um novo registro sempre se soma aos anteriores.</p>
      </section>
      ${d.interacoes.length ? `<details class="historico"><summary>Últimas interações do cliente (${ui.num(d.interacoes.length)})</summary><ul class="list-plain">
        ${d.interacoes.map(i => `<li>${dataHora(i.data)} · ${ui.esc(CANAIS[i.canal] || i.canal)}<small class="block">${ui.esc(i.nota)}</small></li>`).join('')}</ul></details>` : ''}
      <div class="btn-row end">
        <a class="btn btn-ghost" href="#/clientes/${o.clienteId}" id="abrirFicha">Abrir ficha do cliente</a>
        <button class="btn btn-ghost" data-close type="button">Fechar</button>
        ${editavel ? '<button class="btn btn-primary" type="button" id="registrarAcomp">Registrar acompanhamento</button>' : ''}
      </div></div>`;
  }

  async function abrirDetalhe(clienteId, produtoId) {
    ui.modal('<div id="detalheRecompra" aria-busy="true"><p class="muted">Carregando a oportunidade…</p></div>');
    let d;
    try { d = await R().recompraDetalhe(clienteId, produtoId); } catch (e) {
      console.error(e);
      ui.modal(`<h2>Oportunidade indisponível</h2><p id="erroDetalhe">${msgErro(e)}</p><div class="btn-row end"><button class="btn btn-ghost" data-close type="button">Fechar</button></div>`);
      return;
    }
    ui.modal(corpoDetalhe(d), m => {
      const ficha = m.querySelector('#abrirFicha');
      if (ficha) ficha.addEventListener('click', () => ui.closeModal());
      const btnC = m.querySelector('#mostrarContato');
      if (btnC) btnC.addEventListener('click', async () => {
        btnC.disabled = true;
        const alvo = m.querySelector('#contatoPermitido');
        try {
          const c = await R().recompraContato(clienteId, { whatsapp: d.oportunidade.podeWhatsapp, email: d.oportunidade.podeEmail });
          alvo.innerHTML = [c.telefone !== undefined ? `WhatsApp: <strong>${ui.esc(c.telefone || 'não cadastrado')}</strong>` : '',
                            c.email !== undefined ? `E-mail: <strong>${ui.esc(c.email || 'não cadastrado')}</strong>` : ''].filter(Boolean).join('<br>');
          btnC.hidden = true;
        } catch (e) { alvo.textContent = (e && e.message) || 'Erro ao ler o contato.'; btnC.disabled = false; }
      });
      const reg = m.querySelector('#registrarAcomp');
      if (reg) reg.addEventListener('click', () => formularioAcompanhamento(d));
    });
  }

  function formularioAcompanhamento(d) {
    const o = d.oportunidade;
    const permitido = { whatsapp: o.podeWhatsapp, email: o.podeEmail, telefone: false, instagram: false };
    const hoje = hojeIso();
    ui.modal(`<h2>Registrar acompanhamento</h2>
      <p class="small">${ui.esc(o.cliente || '—')} · ${ui.esc(o.produto)} · compra de ${ui.date(o.ultimaCompra)}</p>
      <form class="form" id="formAcomp" novalidate>
        <fieldset class="radio-row"><legend>Quem iniciou o contato? *</legend>
          ${Object.entries(INICIATIVA).map(([v, l]) => `<label><input type="radio" name="iniciativa" value="${v}" ${v === 'empresa' ? 'checked' : ''}> ${ui.esc(l)}</label>`).join('')}</fieldset>
        <label>Canal *<select name="canal" id="acCanal"></select></label>
        <p class="small muted" id="acCanalAviso"></p>
        <label>Resultado *<select name="resultado" id="acResultado">${opcoes(RESULTADOS, '', 'Escolha…')}</select></label>
        <div class="form-grid" id="acProxima" hidden>
          <label>Próxima ação *<select name="proxima" id="acAcao">${opcoes(ACOES, 'novo_contato')}</select></label>
          <label>Data *<input type="date" name="proximaEm" id="acData" min="${hoje}" max="${somarDias(hoje, 180)}" value="${somarDias(hoje, 3)}"></label>
        </div>
        <p class="small aviso-inline" id="acAvisoOposicao" hidden>Isto registra uma <strong>oposição a todo contato não essencial</strong>: o cliente passa para "não contatar" e sai da recompra e das campanhas. Para desfazer, só o administrador encerra a oposição na ficha do cliente.</p>
        <label>Anotação (opcional)<textarea name="nota" rows="3" maxlength="1000" placeholder="Só o necessário para o próximo contato. Não registre dados de saúde."></textarea></label>
      </form>
      <div class="auth-msg auth-msg-erro" id="erroAcomp" role="alert" hidden></div>
      <div class="btn-row end"><button class="btn btn-ghost" data-close type="button">Cancelar</button>
        <button class="btn btn-primary" type="button" id="salvarAcomp">Registrar</button></div>`, m => {
      const form = m.querySelector('#formAcomp'), canal = m.querySelector('#acCanal'), aviso = m.querySelector('#acCanalAviso');
      const resultado = m.querySelector('#acResultado'), prox = m.querySelector('#acProxima'), avisoOp = m.querySelector('#acAvisoOposicao');
      const atualizarCanais = () => {
        const ini = form.querySelector('[name=iniciativa]:checked').value;
        const atual = canal.value;
        const lista = Object.entries(CANAIS).filter(([v]) => ini === 'cliente' || permitido[v]);
        canal.innerHTML = lista.length ? lista.map(([v, l]) => `<option value="${v}" ${v === atual ? 'selected' : ''}>${ui.esc(l)}</option>`).join('')
                                       : '<option value="">Nenhum canal permitido</option>';
        canal.disabled = !lista.length;
        aviso.textContent = ini === 'empresa'
          ? (lista.length ? 'Só aparecem os canais com permissão atual de contato comercial.' : 'Este cliente não tem canal permitido: a empresa não pode iniciar contato comercial. Só registre contatos iniciados pelo cliente.')
          : 'Contato iniciado pelo cliente pode ser registrado em qualquer canal.';
        const semResp = resultado.querySelector('option[value=sem_resposta]');
        if (semResp) { semResp.disabled = ini === 'cliente'; if (ini === 'cliente' && resultado.value === 'sem_resposta') resultado.value = ''; }
      };
      const atualizarResultado = () => {
        prox.hidden = !ABERTOS.includes(resultado.value);
        avisoOp.hidden = resultado.value !== 'pediu_nao_contatar';
      };
      form.querySelectorAll('[name=iniciativa]').forEach(r => r.addEventListener('change', atualizarCanais));
      resultado.addEventListener('change', atualizarResultado);
      atualizarCanais(); atualizarResultado();

      const btn = m.querySelector('#salvarAcomp'), err = m.querySelector('#erroAcomp');
      btn.addEventListener('click', async () => {
        err.hidden = true;
        const f = new FormData(form);
        const dados = {
          clienteId: o.clienteId, produtoId: o.produtoId, compraReferencia: o.ultimaCompra, ultimoConhecido: o.ultimoId,
          iniciativa: f.get('iniciativa'), canal: f.get('canal'), resultado: f.get('resultado'),
          nota: String(f.get('nota') || '').trim(),
          proximaAcao: ABERTOS.includes(f.get('resultado')) ? f.get('proxima') : null,
          proximaAcaoEm: ABERTOS.includes(f.get('resultado')) ? f.get('proximaEm') : null
        };
        const erros = [];
        if (!dados.canal) erros.push('Escolha o canal.');
        if (!dados.resultado) erros.push('Escolha o resultado.');
        if (dados.iniciativa === 'cliente' && dados.resultado === 'sem_resposta') erros.push('"Sem resposta" só vale para contato feito pela empresa.');
        if (dados.proximaAcao && (!dados.proximaAcaoEm || dados.proximaAcaoEm < hoje || dados.proximaAcaoEm > somarDias(hoje, 180))) erros.push('Data da próxima ação: de hoje até 180 dias.');
        if (dados.nota.length > 1000) erros.push('Anotação muito longa (máximo 1000 caracteres).');
        if (erros.length) { err.textContent = erros.join(' '); err.hidden = false; return; }
        btn.disabled = true; btn.textContent = 'Registrando…';
        try {
          const r = await R().recompraRegistrar(dados);
          ui.closeModal();
          ui.toast(r && r.oposicao_registrada ? 'Registrado. Oposição aplicada: o cliente está em "não contatar".' : 'Acompanhamento registrado.');
          carregar(); A.router.render();
        } catch (e) {
          console.error(e);
          err.textContent = (e && e.message) || 'Erro inesperado.';
          if (e && e.tipo === 'conflito') {
            err.textContent += ' A lista foi atualizada.';
            carregar();
          }
          err.hidden = false; btn.disabled = false; btn.textContent = 'Registrar';
        }
      });
    });
  }

  // ---------- registro da tela ----------
  A.views.recompra = {
    title: 'Recompra',
    get fonteDados() { return fic() ? 'Dados FICTÍCIOS de teste' : 'Supabase · dados reais'; },
    render,
    bind
  };
})(window.ALTUM);
