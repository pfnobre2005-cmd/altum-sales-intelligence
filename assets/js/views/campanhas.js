/* ALTUM Sales Intelligence — Campanhas e mensagens (Supabase)
 * Campanhas comerciais reais (006 + 016). Layout da versão anterior: lista em cartões e
 * detalhe com indicadores, mensagem, "como usar" e destinatários.
 * • Nada é enviado pelo sistema: a pessoa envia pelo canal oficial e marca "Enviado"
 *   (o banco revalida a permissão no momento e registra data, autor e interação).
 * • Destinatários só entram pela função do banco, que recusa quem não tem permissão de
 *   marketing no canal (consentimento, recusa/revogação, oposição, "não contatar").
 * • Para iniciar, um ADMINISTRADOR aprova o conteúdo exato (o filtro automático é só auxílio).
 * • Resultado SÓ com evidência: pedido pago da Nuvemshop, com o cupom da campanha, feito pelo
 *   destinatário depois do envio e dentro da janela. Sem cupom, nenhuma venda é atribuída.
 * • Dados fictícios de teste: somente leitura (garantido pela 016). Nada no localStorage.
 */
(function (A) {
  'use strict';
  const { ui } = A;
  const R = () => A.repositorio;
  const OBJ = { recompra: 'Recompra', fidelizacao: 'Fidelização', reativacao: 'Reativação' };
  const CANAL = { whatsapp: 'WhatsApp', email: 'E-mail', telefone: 'Telefone', instagram: 'Instagram' };
  const STATUS = { rascunho: ['Rascunho', 'muted'], andamento: ['Em andamento', 'sand'], concluida: ['Concluída', 'sage'] };
  const PUBLICO = { janela: 'Na janela de recompra', atrasado: 'Recompra atrasada', primeira_compra: 'Primeira compra', recorrentes: 'Recorrentes ativos',
                    fieis: 'Elegíveis à fidelização', inativos: 'Inativos', selecao_manual: 'Seleção manual' };
  const MOTIVO = { anonimizado: 'Anonimizado (LGPD)', nao_contatar: 'Não contatar', oposicao: 'Oposição a marketing', sem_consentimento_no_canal: 'Sem consentimento no canal',
                   negativa_em_registro_vinculado: 'Recusa em cadastro vinculado', mesma_pessoa: 'Mesma pessoa já na campanha' };
  const TIPO_CUPOM = { percentual: '% de desconto', valor_fixo: 'R$ de desconto', frete_gratis: 'Frete grátis' };
  const MODELOS = {
    recompra: 'Oi {primeiro_nome}! Aqui é da Altum Nutrition. Você levou {produto} em {data_ultima_compra}. Se quiser repor, o cupom {cupom} vale na próxima compra. Para não receber mais mensagens, responda SAIR.',
    fidelizacao: 'Oi {primeiro_nome}, obrigado por comprar com a Altum mais de uma vez! Como agradecimento, separamos o cupom {cupom}. Para não receber mais mensagens, responda SAIR.',
    reativacao: 'Olá {primeiro_nome}, faz um tempo que você não passa pela loja da Altum. Preparamos o cupom {cupom} para a sua próxima compra. Para não receber mais mensagens, responda SAIR.'
  };
  const permitirFicticios = () => !(A.config && A.config.dashboard && A.config.dashboard.permitirFicticios === false);
  const opcoes = (pares, sel, vazio) => (vazio !== undefined ? `<option value="">${ui.esc(vazio)}</option>` : '')
    + pares.map(([v, l]) => `<option value="${ui.esc(v)}" ${v === sel ? 'selected' : ''}>${ui.esc(l)}</option>`).join('');
  const msgErro = e => ui.esc((e && e.message) || 'Erro inesperado.');
  const dataHora = ts => (ts ? new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const hojeIso = () => A.analytics.iso(A.analytics.today());

  // Estado só em memória
  const estado = { origem: 'real', lista: null, erro: null, carregando: false, g: 0, existemFicticios: null, detalhe: null, gd: 0 };
  const fic = () => estado.origem === 'ficticio';
  const avisarAlteracao = () => window.dispatchEvent(new CustomEvent('altum:dados-alterados', { detail: { origem: 'campanhas' } }));

  // ---------- compliance (auxiliar; a revisão humana continua obrigatória) ----------
  function complianceBox(texto, canal) {
    const r = A.compliance.check(texto, canal);
    if (r.ok) return '<div class="check-ok">✓ Nenhum termo de risco encontrado e há opção de descadastro. Revisão humana continua obrigatória.</div>';
    return `<div class="check-warn"><strong>Revisar antes de usar:</strong><ul>${r.alertas.map(a => `<li>${ui.esc(a.motivo)}${a.trecho ? ` — “${ui.esc(a.trecho)}”` : ''}</li>`).join('')}</ul>
      <small>Suplemento não pode alegar prevenir, tratar ou curar doença; alegações de benefício só com o texto exato da IN 28/2018 e validação do responsável técnico.</small></div>`;
  }

  // Mensagem personalizada para copiar (o envio é feito pela pessoa, fora do sistema)
  function personalizar(texto, d, det) {
    const produto = det.produtos.length ? det.produtos[0].nome : 'seu produto';
    return String(texto || '')
      .replaceAll('{primeiro_nome}', String(d.nome || '').split(' ')[0])
      .replaceAll('{nome}', d.nome || '')
      .replaceAll('{produto}', produto)
      .replaceAll('{data_ultima_compra}', d.ultimaCompra ? ui.date(d.ultimaCompra) : '')
      .replaceAll('{cupom}', det.cupom ? det.cupom.codigo : '');
  }

  // ---------- carregamento ----------
  async function carregarLista() {
    const g = ++estado.g;
    estado.carregando = true; estado.erro = null;
    try {
      const d = await R().campanhasLista(estado.origem);
      if (g !== estado.g) return;
      estado.lista = d; estado.existemFicticios = d.existemFicticios;
    } catch (e) { if (g !== estado.g) return; console.error(e); estado.erro = e; estado.lista = null; }
    finally { if (g === estado.g) estado.carregando = false; }
    if (A.router.parse().name === 'campanhas' && !A.router.parse().param) A.router.render();
  }
  async function carregarDetalhe(id) {
    const g = ++estado.gd;
    estado.detalhe = { id, carregando: true };
    try {
      const d = await R().campanhaDetalhe(id);
      if (g !== estado.gd) return;
      estado.detalhe = { id, dados: d };
      if (d.campanha.status !== 'concluida' && d.campanha.fonte !== 'ficticio' && d.destinatarios.some(x => x.situacao === 'pendente' && x.podeEnviar)) {
        try { const ct = await R().campanhaContatos(id, d.campanha.canal); if (g === estado.gd) estado.detalhe.contatos = ct; } catch (e) { console.error(e); }
      }
    } catch (e) { if (g !== estado.gd) return; console.error(e); estado.detalhe = { id, erro: e }; }
    const p = A.router.parse();
    if (p.name === 'campanhas' && p.param === id) A.router.render();
  }
  const recarregarTudo = id => { estado.lista = null; carregarDetalhe(id); };

  // ---------- topo ----------
  function seletorOrigem() {
    const mostrar = permitirFicticios() && estado.existemFicticios !== false;
    if (!mostrar && !fic()) return '';
    return `<div class="seg-control seletor-origem" role="group" aria-label="Origem dos dados">
      <button type="button" class="${!fic() ? 'active' : ''}" data-origem="real">Dados reais</button>
      ${mostrar ? `<button type="button" class="${fic() ? 'active' : ''}" data-origem="ficticio">Dados fictícios (teste)</button>` : ''}</div>`;
  }
  function topo(lidoEm) {
    return `<div class="fonte-dados small" id="fonteCampanhas">
      <span class="badge ${fic() ? 'badge-warn' : 'badge-sage'}">Supabase</span>
      <span>${fic() ? 'campanhas de teste (somente leitura)' : 'campanhas reais'}${lidoEm ? ` · lidas às ${lidoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
      <span class="fonte-acoes">${seletorOrigem()}<button class="btn btn-ghost btn-sm" id="atualizarCampanhas" type="button" ${estado.carregando ? 'disabled' : ''}>${estado.carregando ? 'Atualizando…' : 'Atualizar'}</button></span>
    </div>
    ${fic() ? '<div class="aviso-ficticio" role="note" id="avisoFicticioCampanhas"><strong>DADOS FICTÍCIOS DE TESTE</strong> — carga da migração 010. Nada pode ser registrado aqui.</div>' : ''}`;
  }
  const NOTA_CONVERSAO = 'Conversão = destinatários marcados como enviados que fizeram pedido pago na Nuvemshop com o cupom da campanha, depois do envio e dentro da janela da campanha. Campanha sem cupom não tem venda atribuída.';

  // ---------- lista ----------
  function listView() {
    const d = estado.lista;
    if (estado.erro) return topo() + `<section class="card error" role="alert" id="erroCampanhas"><h2>Não foi possível carregar as campanhas</h2><p>${msgErro(estado.erro)}</p>
      <div class="btn-row"><button class="btn btn-primary" id="tentarCampanhas" type="button">Tentar de novo</button></div></section>`;
    if (!d || d.origem !== estado.origem) return topo() + '<section class="card" aria-busy="true"><p class="muted">Carregando campanhas do Supabase…</p></section>';
    const admin = A.session.isAdmin();
    return topo(d.lidoEm) + `
      <section class="toolbar"><div class="btn-row">${fic() ? '' : '<button class="btn btn-primary" id="newCamp" type="button">+ Nova campanha</button>'}
        ${!fic() ? `<button class="btn btn-ghost" id="verCupons" type="button">${admin ? 'Cupons' : 'Ver cupons'}</button>` : ''}</div>
      <p class="muted small">${NOTA_CONVERSAO}</p></section>
      ${d.itens.length ? `<section class="camp-grid" id="listaCampanhas">
      ${d.itens.map(c => { const [st, tone] = STATUS[c.status] || [c.status, 'neutral'];
        return `<a class="card camp-card" href="#/campanhas/${ui.esc(c.id)}" data-camp="${ui.esc(c.id)}">
          <div class="camp-top">${ui.badge(st, tone)}${ui.badge(OBJ[c.objetivo] || c.objetivo, 'neutral')}${ui.badge(CANAL[c.canal] || c.canal, 'neutral')}</div>
          <h3>${ui.esc(c.nome)}</h3>
          <p class="muted small">Público: ${ui.esc(PUBLICO[c.publico] || c.publico)} · cupom ${ui.esc(c.cupom || '—')}${c.dataInicio || c.dataFim ? ` · ${ui.date(c.dataInicio)} a ${ui.date(c.dataFim)}` : ''}</p>
          <div class="camp-stats"><div><b>${ui.num(c.enviados)}</b>/${ui.num(c.destinatarios)}<small>enviados</small></div><div><b>${ui.num(c.compradores)}</b><small>compraram</small></div>
            <div><b>${ui.pct(c.taxa)}</b><small>conversão</small></div><div><b>${ui.brl0(c.receita)}</b><small>receita</small></div></div>
        </a>`; }).join('')}</section>`
        : `<section class="card estado-vazio" id="campanhasVazio"><h2>${fic() ? 'Nenhuma campanha de teste' : 'Nenhuma campanha real ainda'}</h2>
          ${fic() ? '' : `<p>Crie a primeira campanha: escolha objetivo, público, canal e cupom; um administrador aprova o texto; depois os destinatários (só quem autorizou o canal) recebem a mensagem enviada por você, e o resultado é medido pelos pedidos pagos da Nuvemshop com o cupom.</p>
            ${permitirFicticios() && estado.existemFicticios ? '<div class="btn-row"><button class="btn btn-ghost" type="button" data-origem="ficticio">Ver campanhas fictícias de teste</button></div>' : ''}`}</section>`}`;
  }

  // ---------- formulário de campanha (nova / editar) ----------
  async function abrirFormulario(det) {
    const c = det ? det.campanha : null;
    const travado = !!c && c.status !== 'rascunho';            // depois de iniciada: conteúdo congelado (006)
    let cup;
    try { cup = await R().cupons('real'); } catch (e) { ui.toast(e.message, 'warn'); return; }
    const ativos = cup.itens.filter(x => x.ativo || (c && x.id === c.cupomId));
    const obj0 = c ? c.objetivo : 'recompra';
    ui.modal(`
      <h2>${c ? 'Editar campanha' : 'Nova campanha'}</h2>
      <p class="muted small">Nada é disparado automaticamente: o sistema monta a lista e as mensagens; o envio é feito por uma pessoa e marcado aqui.${travado ? ' <strong>Campanha iniciada:</strong> mensagem, canal, cupom, objetivo e público ficam congelados (evidência do que foi enviado).' : ''}</p>
      <form id="cpf" class="form" novalidate>
        <div class="form-grid">
          <label>Nome *<input name="nome" required maxlength="120" value="${ui.esc(c ? c.nome : '')}" placeholder="Ex.: Recompra Juice — novembro"></label>
          <label>Objetivo<select name="objetivo" ${travado ? 'disabled' : ''}>${opcoes(Object.entries(OBJ), obj0)}</select></label>
          <label>Público<select name="publico" ${travado ? 'disabled' : ''}>${opcoes(Object.entries(PUBLICO), c ? c.publico : 'janela')}</select></label>
          <label>Canal<select name="canal" ${travado ? 'disabled' : ''}>${opcoes([['whatsapp', 'WhatsApp'], ['email', 'E-mail']], c ? c.canal : 'whatsapp')}</select></label>
          <label>Cupom<select name="cupom" ${travado ? 'disabled' : ''}>${opcoes(ativos.map(x => [x.id, x.codigo + (x.ativo ? '' : ' (inativo)')]), c ? c.cupomId || '' : '', 'Sem cupom (vendas não serão atribuídas)')}</select></label>
          <label>Janela de atribuição (dias)<input type="number" name="janela" min="1" max="180" step="1" value="${c ? c.janela : 30}"></label>
          <label>Início<input type="date" name="dataInicio" value="${ui.esc(c && c.dataInicio || '')}"></label>
          <label>Fim<input type="date" name="dataFim" value="${ui.esc(c && c.dataFim || '')}"></label>
          <label>Meta de pedidos<input type="number" name="metaPedidos" min="1" step="1" value="${c && c.metaPedidos ? c.metaPedidos : ''}"></label>
          <label>Meta de receita (R$)<input type="number" name="metaReceita" min="0.01" step="0.01" value="${c && c.metaReceita ? c.metaReceita : ''}"></label>
        </div>
        <p class="muted small">${ativos.length ? 'Cupons cadastrados no sistema (referência do código que já existe na Nuvemshop; o sistema não cria nem altera cupom na loja).' : 'Nenhum cupom cadastrado ainda. O administrador cadastra em "Cupons", na lista de campanhas, o código que já existe na Nuvemshop.'}</p>
        <label>Mensagem <small class="muted">variáveis: {primeiro_nome} {produto} {data_ultima_compra} {cupom}</small>
          <textarea name="mensagem" rows="5" maxlength="2000" required ${travado ? 'disabled' : ''}>${ui.esc(c ? c.mensagem : MODELOS[obj0])}</textarea></label>
        <div id="ckBox"></div>
        <label>Observações internas<textarea name="observacoes" rows="2" maxlength="2000">${ui.esc(c && c.observacoes || '')}</textarea></label>
        ${c && c.aprovadaEm && !travado ? '<p class="small aviso-inline">Alterar mensagem, canal, cupom, objetivo ou público anula a aprovação: o administrador precisará aprovar de novo.</p>' : ''}
      </form>
      <div class="auth-msg auth-msg-erro" id="cpfErro" role="alert" hidden></div>
      <div class="btn-row end"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" type="button" id="cpfSalvar">${c ? 'Salvar' : 'Salvar rascunho'}</button></div>`,
    m => {
      const f = m.querySelector('#cpf'), err = m.querySelector('#cpfErro'), btn = m.querySelector('#cpfSalvar');
      const upd = () => { m.querySelector('#ckBox').innerHTML = complianceBox(f.mensagem.value, f.canal.value); };
      if (!travado) {
        f.objetivo.addEventListener('change', () => { if (!f.mensagem.value.trim() || Object.values(MODELOS).includes(f.mensagem.value)) f.mensagem.value = MODELOS[f.objetivo.value]; upd(); });
        f.canal.addEventListener('change', upd); f.mensagem.addEventListener('input', upd);
      }
      upd();
      btn.addEventListener('click', async () => {
        err.hidden = true;
        const fd = new FormData(f);
        const d = {
          nome: String(fd.get('nome') || '').trim(), janela: Number(fd.get('janela')), dataInicio: fd.get('dataInicio') || null, dataFim: fd.get('dataFim') || null,
          metaPedidos: fd.get('metaPedidos') ? Number(fd.get('metaPedidos')) : null, metaReceita: fd.get('metaReceita') ? Number(fd.get('metaReceita')) : null,
          observacoes: String(fd.get('observacoes') || '').trim()
        };
        if (!travado) Object.assign(d, { objetivo: fd.get('objetivo'), publico: fd.get('publico'), canal: fd.get('canal'), cupomId: fd.get('cupom') || null, mensagem: String(fd.get('mensagem') || '').trim() });
        const erros = [];
        if (d.nome.length < 3 || d.nome.length > 120) erros.push('Nome: de 3 a 120 caracteres.');
        if (!Number.isInteger(d.janela) || d.janela < 1 || d.janela > 180) erros.push('Janela de atribuição: de 1 a 180 dias.');
        if (d.dataInicio && d.dataFim && d.dataFim < d.dataInicio) erros.push('A data final é anterior à inicial.');
        if (d.metaPedidos !== null && !(Number.isInteger(d.metaPedidos) && d.metaPedidos > 0)) erros.push('Meta de pedidos inválida.');
        if (d.metaReceita !== null && !(d.metaReceita > 0)) erros.push('Meta de receita inválida.');
        if (!travado) {
          if (!d.mensagem) erros.push('Escreva a mensagem.');
          if (d.mensagem.includes('{cupom}') && !d.cupomId) erros.push('A mensagem usa {cupom}: escolha um cupom ou remova a variável.');
        }
        if (erros.length) { err.textContent = erros.join(' '); err.hidden = false; return; }
        btn.disabled = true; btn.textContent = 'Salvando…';
        try {
          let id = c && c.id;
          if (c) await R().campanhaAtualizar(c.id, c.atualizadoEm, d);
          else id = await R().campanhaCriar(d);
          avisarAlteracao();
          ui.closeModal(); ui.toast(c ? 'Campanha salva.' : 'Campanha salva como rascunho.');
          estado.lista = null;
          if (c) carregarDetalhe(id); else location.hash = '#/campanhas/' + id;
        } catch (e) {
          console.error(e); err.textContent = (e && e.message) || 'Erro inesperado.'; err.hidden = false; btn.disabled = false; btn.textContent = c ? 'Salvar' : 'Salvar rascunho';
          if (e && e.tipo === 'conflito') carregarDetalhe(c.id);
        }
      });
    });
  }

  // ---------- detalhe ----------
  function detailView(id) {
    const dt = estado.detalhe;
    const voltar = '<a href="#/campanhas" class="link back">← Voltar para campanhas</a>';
    if (!dt || dt.id !== id || dt.carregando) return voltar + '<section class="card" aria-busy="true" id="carregandoCampanha"><p class="muted">Carregando a campanha do Supabase…</p></section>';
    if (dt.erro) return voltar + `<section class="card error" role="alert" id="erroCampanha"><h2>Campanha indisponível</h2><p>${msgErro(dt.erro)}</p></section>`;
    const det = dt.dados, c = det.campanha, r = det.resultado || {};
    const ficticia = c.fonte === 'ficticio', admin = A.session.isAdmin();
    const editavel = !ficticia && c.status !== 'concluida';
    const aprovada = !!c.aprovadaEm;
    const [st, tone] = STATUS[c.status] || [c.status, 'neutral'];
    const contatos = dt.contatos || {};
    const pend = det.destinatarios.filter(x => x.situacao === 'pendente');
    const semCupom = !det.cupom;
    return voltar + `
      ${ficticia ? '<div class="aviso-ficticio" role="note" id="avisoCampanhaFicticia"><strong>CAMPANHA FICTÍCIA DE TESTE</strong> — somente leitura.</div>' : ''}
      <section class="card" id="cabecalhoCampanha" data-camp="${ui.esc(c.id)}" data-lido="${det.lidoEm.getTime()}">
        <header class="card-head"><div><h2 class="display">${ui.esc(c.nome)}</h2>
          <p class="muted small">${ui.esc(OBJ[c.objetivo] || c.objetivo)} · ${ui.esc(CANAL[c.canal] || c.canal)} · público ${ui.esc(PUBLICO[c.publico] || c.publico)} · cupom ${ui.esc(det.cupom ? det.cupom.codigo : '—')}
            · período ${ui.date(c.dataInicio)} a ${ui.date(c.dataFim)} · janela de ${ui.num(c.janela)} dias · criada em ${ui.date(c.criadaEm)} por ${ui.esc(c.criadaPor)}</p></div>
          <div class="btn-row">${ui.badge(st, tone)}
            <button class="btn btn-ghost btn-sm" id="atualizarCampanha" type="button" title="Reler do banco">Atualizar</button>
            ${editavel ? '<button class="btn btn-ghost" id="editCamp" type="button">Editar</button>' : ''}
            ${editavel ? '<button class="btn btn-ghost" id="closeCamp" type="button">Marcar como concluída</button>' : ''}
            ${!ficticia && admin && c.status === 'rascunho' && !r.enviados ? '<button class="btn btn-ghost" id="excluirCamp" type="button">Excluir rascunho</button>' : ''}</div></header>
        <div class="kpi-grid kpi-grid-5" id="kpisCampanha">
          ${ui.kpi({ label: 'Destinatários', value: ui.num(r.destinatarios), hint: r.bloqueados ? `${ui.num(r.bloqueados)} bloqueados` : '' })}
          ${ui.kpi({ label: 'Enviados (manual)', value: ui.num(r.enviados), hint: r.pendentes ? `${ui.num(r.pendentes)} pendentes` : '' })}
          ${ui.kpi({ label: 'Clientes que compraram', value: semCupom ? '—' : ui.num(r.compradores), hint: semCupom ? 'sem cupom: não atribuído' : `${ui.num(r.pedidos)} pedidos` })}
          ${ui.kpi({ label: 'Conversão', value: semCupom ? '—' : ui.esc(ui.pct(r.taxa)) })}
          ${ui.kpi({ label: 'Receita atribuída', value: semCupom ? '—' : ui.esc(ui.brl(r.receita)), hint: r.usosForaDoPublico ? `+${r.usosForaDoPublico} usos do cupom fora do público (não somados)` : '' })}
        </div>
        <p class="small muted">${NOTA_CONVERSAO}${r.usosOutraCampanha ? ` ${ui.num(r.usosOutraCampanha)} uso(s) do cupom foram atribuídos a outra campanha (envio mais recente).` : ''}
          ${c.metaPedidos || c.metaReceita ? `Metas: ${c.metaPedidos ? ui.num(c.metaPedidos) + ' pedidos' : ''}${c.metaPedidos && c.metaReceita ? ' · ' : ''}${c.metaReceita ? ui.brl(c.metaReceita) : ''}.` : ''}</p>
      </section>
      <section class="grid-2">
        <article class="card" id="cardMensagem"><header class="card-head"><h2>Mensagem</h2>
          ${aprovada ? ui.badge('Aprovada', 'sage') : ui.badge('Aguardando aprovação', 'warn')}</header>
          <p class="msg-template">${ui.esc(c.mensagem)}</p>${complianceBox(c.mensagem, c.canal)}
          ${aprovada ? `<p class="small muted" id="infoAprovacao">Aprovada por ${ui.esc(c.aprovadaPor)} em ${dataHora(c.aprovadaEm)}: “${ui.esc(c.aprovacaoObservacao || '')}”</p>`
            : `<p class="small" id="infoAprovacao">Para marcar envios, um <strong>administrador</strong> precisa revisar e aprovar este conteúdo exato. O filtro automático não substitui essa revisão.</p>
               ${admin && editavel ? `<form class="form" id="formAprovar" novalidate><label>O que foi revisado *<input name="obs" maxlength="1000" placeholder="Ex.: texto sem alegação de saúde; cupom confere com a loja"></label>
                 <div class="btn-row end"><button class="btn btn-primary btn-sm" type="button" id="aprovarCamp">Aprovar conteúdo</button></div></form>` : ''}`}
          ${det.produtos.length ? `<p class="small muted">Produto(s) em foco: ${det.produtos.map(p => ui.esc(p.nome)).join(', ')}</p>` : ''}
          ${c.observacoes ? `<p class="small muted">Observações: ${ui.esc(c.observacoes)}</p>` : ''}
        </article>
        <article class="card"><header class="card-head"><h2>Como usar</h2></header>
          <ol class="steps"><li>Inclua os destinatários (só entram clientes reais que autorizaram o ${ui.esc(CANAL[c.canal] || c.canal)}).</li>
          <li>Clique em <b>Copiar</b> na linha do contato — a mensagem já vem personalizada.</li>
          <li>Envie pelo ${ui.esc(CANAL[c.canal] || c.canal)} oficial da Altum.</li><li>Volte aqui e marque <b>Enviado</b>. Só enviados contam na conversão.</li>
          <li>Se o contato pedir para sair, registre a revogação ou oposição na ficha do cliente.</li></ol>
          ${c.status === 'concluida' ? `<form class="form" id="formNotas" novalidate>${ficticia ? '' : `<label>Notas de resultado<textarea name="notas" rows="3" maxlength="4000">${ui.esc(c.resultadoNotas || '')}</textarea></label>
            <div class="btn-row end"><button class="btn btn-ghost btn-sm" type="button" id="salvarNotas">Salvar notas</button></div>`}</form>
            ${ficticia && c.resultadoNotas ? `<p class="small">${ui.esc(c.resultadoNotas)}</p>` : ''}` : ''}
        </article>
      </section>
      <section class="card" id="cardDestinatarios"><header class="card-head"><h2>Destinatários</h2><span class="muted small">${ui.num(det.destinatarios.length)} contatos</span></header>
        ${editavel ? `<div class="btn-row"><button class="btn btn-ghost btn-sm" id="incluirDest" type="button">Incluir destinatários</button>
          ${det.destinatarios.some(x => x.situacao !== 'enviado') ? '<button class="btn btn-ghost btn-sm" id="revalidarDest" type="button">Revalidar permissões</button>' : ''}</div>` : ''}
        ${!aprovada && pend.length && editavel ? '<p class="small aviso-inline">Envios só podem ser marcados depois da aprovação do administrador.</p>' : ''}
        ${det.destinatarios.length ? `<div class="table-wrap"><table id="tabelaDestinatarios"><thead><tr><th>Cliente</th><th>Prévia da mensagem</th><th>Situação</th><th></th></tr></thead><tbody>
        ${det.destinatarios.map(d => {
          const contato = contatos[d.id];
          const situacao = d.situacao === 'enviado' ? ui.badge('Enviado ' + ui.date(d.enviadoEm), 'sage') + `<small class="block muted">${dataHora(d.enviadoEm)} · ${ui.esc(d.enviadoPor || '')}</small>`
            : d.situacao === 'bloqueado' ? ui.badge('Bloqueado', 'warn') + `<small class="block muted">${ui.esc(MOTIVO[d.motivo] || d.motivo || '')}</small>`
            : d.podeEnviar ? ui.badge('Pendente', 'muted') : ui.badge('Permissão mudou', 'warn') + '<small class="block muted">revalide</small>';
          const pode = editavel && d.situacao === 'pendente' && d.podeEnviar;
          return `<tr data-dest="${ui.esc(d.id)}"><td><a href="#/clientes/${ui.esc(d.clienteId)}" class="link-strong">${ui.esc(d.nome || 'Cliente anonimizado')}</a>${pode && contato ? `<small class="block muted">${ui.esc(contato)}</small>` : ''}</td>
          <td class="msg-cell">${d.situacao === 'bloqueado' ? '<span class="muted">—</span>' : ui.esc(personalizar(c.mensagem, d, det))}</td>
          <td>${situacao}</td>
          <td class="nowrap">${pode ? `<button class="btn btn-ghost btn-sm" type="button" data-copy="${ui.esc(d.id)}">Copiar</button> ${aprovada ? `<button class="btn btn-primary btn-sm" type="button" data-sent="${ui.esc(d.id)}">Enviado</button>` : ''}` : ''}
            ${editavel && d.situacao !== 'enviado' ? `<button class="btn btn-ghost btn-sm" type="button" data-remover="${ui.esc(d.id)}" title="Remover da campanha">✕</button>` : ''}</td></tr>`; }).join('')}
        </tbody></table></div>` : ui.empty(editavel ? 'Nenhum destinatário. Use "Incluir destinatários".' : 'Sem destinatários.')}
      </section>
      <section class="card" id="cardAtribuidos"><header class="card-head"><h2>Pedidos atribuídos</h2><span class="muted small">evidência do resultado</span></header>
        ${semCupom ? '<p class="small">Campanha sem cupom: o sistema não atribui vendas (não há evidência de que a compra veio da mensagem).</p>'
          : det.atribuidos.length ? `<div class="table-wrap"><table id="tabelaAtribuidos"><thead><tr><th>Pedido</th><th>Cliente</th><th>Data do pedido</th><th>Envio</th><th>Cupom</th><th class="num">Total</th></tr></thead><tbody>
            ${det.atribuidos.map(a => `<tr><td>${ui.esc(a.numero)}</td><td><a class="link" href="#/clientes/${ui.esc(a.clienteId)}">${ui.esc(a.cliente)}</a></td><td>${dataHora(a.data)}</td><td>${dataHora(a.enviadoEm)}</td>
              <td>${ui.esc(a.cupom || '')}</td><td class="num">${ui.brl(a.total)}</td></tr>`).join('')}</tbody></table></div>`
          : '<p class="small muted">Nenhum pedido pago com o cupom da campanha depois do envio até agora.</p>'}
      </section>`;
  }

  // ---------- inclusão de destinatários ----------
  function abrirInclusao(det) {
    const c = det.campanha;
    ui.modal(`<h2>Incluir destinatários</h2>
      <p class="small">Clientes <strong>reais</strong> com permissão atual de marketing por ${ui.esc(CANAL[c.canal])}. O banco confere de novo cada um ao incluir e recusa quem revogou, se opôs, está em "não contatar" ou foi anonimizado.</p>
      <div class="form"><div class="form-grid">
        <label>Público<select id="incPublico">${opcoes(Object.entries(PUBLICO), c.publico)}</select></label>
        <label>Buscar por nome<input type="search" id="incBusca" maxlength="80" placeholder="opcional"></label></div></div>
      <div id="incLista" class="small" aria-busy="true"><p class="muted">Carregando candidatos…</p></div>
      <div class="auth-msg auth-msg-erro" id="incErro" role="alert" hidden></div>
      <div class="btn-row end"><button class="btn btn-ghost" data-close type="button">Cancelar</button><button class="btn btn-primary" type="button" id="incSalvar" disabled>Incluir selecionados</button></div>`,
    m => {
      const lista = m.querySelector('#incLista'), btn = m.querySelector('#incSalvar'), err = m.querySelector('#incErro');
      const ja = new Set(det.destinatarios.map(d => d.clienteId));
      let g = 0, tb = null;
      const carregar = async () => {
        const meu = ++g;
        lista.innerHTML = '<p class="muted">Carregando candidatos…</p>';
        try {
          const cands = (await R().campanhaCandidatos({ publico: m.querySelector('#incPublico').value, canal: c.canal, q: m.querySelector('#incBusca').value })).filter(x => !ja.has(x.id));
          if (meu !== g) return;
          lista.removeAttribute('aria-busy');
          lista.innerHTML = cands.length ? `<label class="check"><input type="checkbox" id="incTodos" checked> Selecionar todos (${ui.num(cands.length)})</label>
            <ul class="list-plain" id="incCandidatos">${cands.map(x => `<li><label class="check"><input type="checkbox" name="cli" value="${ui.esc(x.id)}" checked> ${ui.esc(x.nome)} <small class="muted">${ui.esc(x.detalhe || '')}</small></label></li>`).join('')}</ul>`
            : '<p class="muted" id="incNenhum">Nenhum cliente elegível neste público (ou todos já estão na campanha).</p>';
          const todos = lista.querySelector('#incTodos');
          if (todos) todos.addEventListener('change', () => lista.querySelectorAll('[name=cli]').forEach(x => { x.checked = todos.checked; }));
          btn.disabled = !cands.length;
        } catch (e) { if (meu === g) { lista.innerHTML = `<p class="aviso-inline">${msgErro(e)}</p>`; btn.disabled = true; } }
      };
      m.querySelector('#incPublico').addEventListener('change', carregar);
      m.querySelector('#incBusca').addEventListener('input', () => { clearTimeout(tb); tb = setTimeout(carregar, 350); });
      carregar();
      btn.addEventListener('click', async () => {
        const ids = [...lista.querySelectorAll('[name=cli]:checked')].map(x => x.value);
        if (!ids.length) { err.textContent = 'Selecione ao menos um cliente.'; err.hidden = false; return; }
        btn.disabled = true; btn.textContent = 'Incluindo…';
        try {
          const r = await R().campanhaIncluir(c.id, ids);
          const recus = Object.entries(r.recusados_por_motivo || {}).map(([k, n]) => `${n} ${MOTIVO[k] || k}`).join(', ');
          avisarAlteracao(); ui.closeModal();
          ui.toast(`${r.incluidos} incluído(s).${r.mesma_pessoa ? ` ${r.mesma_pessoa} já representado(s) (mesma pessoa).` : ''}${recus ? ` Recusados pelo banco: ${recus}.` : ''}`, recus ? 'warn' : 'ok');
          recarregarTudo(c.id);
        } catch (e) { console.error(e); err.textContent = (e && e.message) || 'Erro inesperado.'; err.hidden = false; btn.disabled = false; btn.textContent = 'Incluir selecionados'; }
      });
    });
  }

  // ---------- cupons ----------
  async function abrirCupons() {
    const admin = A.session.isAdmin();
    ui.modal('<div id="modalCupons" aria-busy="true"><p class="muted">Carregando cupons…</p></div>');
    let d;
    try { d = await R().cupons('real'); } catch (e) { ui.modal(`<h2>Cupons</h2><p>${msgErro(e)}</p><div class="btn-row end"><button class="btn btn-ghost" data-close type="button">Fechar</button></div>`); return; }
    ui.modal(`<div id="modalCupons"><h2>Cupons</h2>
      <p class="small">Cadastre aqui o <strong>código de um cupom que já existe na Nuvemshop</strong>, exatamente como está na loja. O sistema só guarda a referência para atribuir as vendas: <strong>não cria, não altera e não desativa nada na loja</strong>.</p>
      ${d.itens.length ? `<div class="table-wrap"><table id="tabelaCupons"><thead><tr><th>Código</th><th>Tipo</th><th>Situação</th><th></th></tr></thead><tbody>
        ${d.itens.map(x => `<tr><td><strong>${ui.esc(x.codigo)}</strong></td><td>${ui.esc(x.tipo ? (x.tipo === 'frete_gratis' ? TIPO_CUPOM[x.tipo] : `${x.valor === null ? '' : ui.num(x.valor)} ${TIPO_CUPOM[x.tipo]}`) : '—')}</td>
          <td>${x.ativo ? ui.badge('Ativo', 'sage') : ui.badge('Inativo', 'muted')}</td>
          <td>${admin ? `<button class="btn btn-ghost btn-sm" type="button" data-cupom="${ui.esc(x.id)}" data-ativo="${x.ativo ? '0' : '1'}">${x.ativo ? 'Desativar' : 'Ativar'}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Nenhum cupom cadastrado.</p>'}
      ${d.usadosNaoCadastrados.length ? `<p class="small" id="cuponsUsados">Códigos usados em pedidos pagos da loja e ainda não cadastrados: ${d.usadosNaoCadastrados.map(x => `<strong>${ui.esc(x.codigo)}</strong> (${ui.num(x.pedidos)})`).join(', ')}</p>` : ''}
      ${admin ? `<form class="form" id="formCupom" novalidate><div class="form-grid">
          <label>Código *<input name="codigo" maxlength="60" placeholder="Ex.: VOLTA10" list="cuponsSugeridos"></label>
          <datalist id="cuponsSugeridos">${d.usadosNaoCadastrados.map(x => `<option value="${ui.esc(x.codigo)}">`).join('')}</datalist>
          <label>Tipo<select name="tipo">${opcoes(Object.entries(TIPO_CUPOM), '', 'Não informar')}</select></label>
          <label>Valor<input name="valor" type="number" min="0" step="0.01"></label></div>
          <div class="btn-row end"><button class="btn btn-primary btn-sm" type="button" id="salvarCupom">Cadastrar cupom</button></div></form>`
        : '<p class="small muted">Só o administrador cadastra ou desativa cupons.</p>'}
      <div class="auth-msg auth-msg-erro" id="cupomErro" role="alert" hidden></div>
      <div class="btn-row end"><button class="btn btn-ghost" data-close type="button">Fechar</button></div></div>`, m => {
      const err = m.querySelector('#cupomErro');
      const salvar = m.querySelector('#salvarCupom');
      if (salvar) salvar.addEventListener('click', async () => {
        err.hidden = true;
        const fd = new FormData(m.querySelector('#formCupom'));
        const codigo = String(fd.get('codigo') || '').trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/.test(codigo)) { err.textContent = 'Código inválido: letras, números, ponto, hífen ou sublinhado, como está na Nuvemshop.'; err.hidden = false; return; }
        salvar.disabled = true;
        try { await R().cupomRegistrar({ codigo, tipo: fd.get('tipo'), valor: fd.get('valor') }); ui.toast(`Cupom ${codigo} cadastrado.`); abrirCupons(); }
        catch (e) { err.textContent = (e && e.message) || 'Erro inesperado.'; err.hidden = false; salvar.disabled = false; }
      });
      m.querySelectorAll('[data-cupom]').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        try { await R().cupomAlterarStatus(b.dataset.cupom, b.dataset.ativo === '1'); ui.toast('Cupom atualizado.'); abrirCupons(); }
        catch (e) { err.textContent = (e && e.message) || 'Erro inesperado.'; err.hidden = false; b.disabled = false; }
      }));
    });
  }

  // ---------- ações do detalhe ----------
  async function acao(botao, fn, ok, id) {
    if (botao) botao.disabled = true;
    try {
      const r = await fn();
      avisarAlteracao();
      if (ok) ui.toast(typeof ok === 'function' ? ok(r) : ok);
      recarregarTudo(id);
      return r;
    } catch (e) {
      console.error(e); ui.toast((e && e.message) || 'Erro inesperado.', 'warn');
      if (botao) botao.disabled = false;
      if (e && e.tipo === 'conflito') recarregarTudo(id);
      return null;
    }
  }

  function bindDetalhe(root, id) {
    const dt = estado.detalhe;
    if (!dt || dt.id !== id || (!dt.dados && !dt.erro && !dt.carregando)) { carregarDetalhe(id); return; }
    if (!dt.dados) return;
    const det = dt.dados, c = det.campanha;
    const on = (sel, fn) => { const b = root.querySelector(sel); if (b) b.addEventListener('click', () => fn(b)); };
    on('#atualizarCampanha', () => { carregarDetalhe(c.id); A.router.render(); });
    on('#editCamp', () => abrirFormulario(det));
    on('#incluirDest', () => abrirInclusao(det));
    on('#revalidarDest', b => acao(b, () => R().campanhaRevalidar(c.id), r => `Permissões revalidadas: ${r.liberados} liberado(s), ${r.bloqueados} bloqueado(s).`, c.id));
    on('#closeCamp', b => {
      if (!confirmar(b, 'Concluir a campanha? Depois disso não é possível marcar envios nem alterar o conteúdo; o resultado continua sendo medido pela janela de atribuição.')) return;
      acao(b, () => R().campanhaAtualizar(c.id, c.atualizadoEm, null, 'concluida'), 'Campanha concluída.', c.id);
    });
    on('#excluirCamp', b => {
      if (!confirmar(b, 'Excluir este rascunho? Esta ação não pode ser desfeita.')) return;
      b.disabled = true;
      R().campanhaExcluir(c.id).then(() => { avisarAlteracao(); ui.toast('Rascunho excluído.'); estado.lista = null; location.hash = '#/campanhas'; })
        .catch(e => { ui.toast(e.message, 'warn'); b.disabled = false; });
    });
    on('#aprovarCamp', b => {
      const obs = String((root.querySelector('#formAprovar [name=obs]') || {}).value || '').trim();
      if (obs.length < 10) { ui.toast('Descreva o que foi revisado (mínimo 10 caracteres).', 'warn'); return; }
      acao(b, () => R().campanhaAprovar(c.id, obs), 'Conteúdo aprovado. Os envios já podem ser marcados.', c.id);
    });
    on('#salvarNotas', b => acao(b, () => R().campanhaAtualizar(c.id, c.atualizadoEm, { resultadoNotas: String(root.querySelector('#formNotas [name=notas]').value || '').trim() }), 'Notas salvas.', c.id));
    root.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
      const d = det.destinatarios.find(x => x.id === b.dataset.copy);
      const okc = await ui.copy(personalizar(c.mensagem, d, det));
      ui.toast(okc ? 'Mensagem copiada.' : 'Não foi possível copiar.', okc ? 'ok' : 'warn');
    }));
    root.querySelectorAll('[data-sent]').forEach(b => b.addEventListener('click', () => {
      const d = det.destinatarios.find(x => x.id === b.dataset.sent);
      if (!confirmar(b, `Confirmar que a mensagem foi enviada para ${d ? d.nome : 'este cliente'} pelo ${CANAL[c.canal]}? O registro fica com a data e o seu usuário e não pode ser desfeito.`)) return;
      acao(b, () => R().campanhaMarcarEnvio(b.dataset.sent),
        r => (r && r.resultado === 'bloqueado' ? `Não registrado: a permissão mudou (${MOTIVO[r.motivo] || r.motivo}). O contato foi bloqueado nesta campanha.`
          : r && r.resultado === 'ja_enviado' ? 'Este envio já estava registrado.' : 'Envio registrado.'), c.id);
    }));
    root.querySelectorAll('[data-remover]').forEach(b => b.addEventListener('click', () => {
      acao(b, () => R().campanhaRemoverDestinatario(b.dataset.remover), 'Destinatário removido da campanha.', c.id);
    }));
  }
  // confirmação no próprio botão (1º clique explica e vira "Confirmar"; 2º clique executa; volta sozinho em 8 s)
  function confirmar(botao, texto) {
    if (botao.dataset.confirmar === '1') { botao.dataset.confirmar = ''; return true; }
    const original = botao.textContent;
    botao.dataset.confirmar = '1'; botao.textContent = 'Confirmar'; botao.classList.add('btn-confirmar');
    ui.toast(texto + ' Clique em "Confirmar".', 'warn');
    setTimeout(() => { if (botao.dataset.confirmar === '1') { botao.dataset.confirmar = ''; botao.textContent = original; botao.classList.remove('btn-confirmar'); } }, 8000);
    return false;
  }

  function bindLista(root) {
    estado.detalhe = null;          // abrir uma campanha de novo sempre relê o banco (resultado e permissões mudam)
    if ((!estado.lista && !estado.erro && !estado.carregando) || (estado.lista && estado.lista.origem !== estado.origem && !estado.carregando)) carregarLista();
    root.querySelectorAll('[data-origem]').forEach(b => b.addEventListener('click', () => {
      const o = b.dataset.origem; if (o === 'ficticio' && !permitirFicticios()) return;
      if (o === estado.origem) return;
      estado.origem = o; estado.lista = null; carregarLista(); A.router.render();
    }));
    [['#atualizarCampanhas', () => { carregarLista(); A.router.render(); }], ['#tentarCampanhas', () => { carregarLista(); A.router.render(); }],
     ['#newCamp', () => abrirFormulario(null)], ['#verCupons', abrirCupons]]
      .forEach(([s, fn]) => { const b = root.querySelector(s); if (b) b.addEventListener('click', fn); });
  }

  // ---------- registro da tela ----------
  window.addEventListener('altum:dados-alterados', e => {
    if (e.detail && e.detail.origem === 'campanhas') return;
    estado.lista = null; if (estado.detalhe) estado.detalhe = null;
  });

  A.views.campanhas = {
    title: 'Campanhas e mensagens',
    get fonteDados() {
      const p = A.router.parse(), dt = estado.detalhe;
      const ficticia = p.param ? !!(dt && dt.id === p.param && dt.dados && dt.dados.campanha.fonte === 'ficticio') : fic();
      return ficticia ? 'Dados FICTÍCIOS de teste' : 'Supabase · dados reais';
    },
    openNew: () => abrirFormulario(null),
    render(id) { return id ? detailView(id) : listView(); },
    bind(root, id) {
      if (id) bindDetalhe(root, id); else bindLista(root);
    }
  };
})(window.ALTUM);
