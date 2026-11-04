/* ALTUM Sales Intelligence — Prospecção & Funil (Supabase)
 * Contatos comerciais (leads, 004) em quadro por etapa. Leitura e gravação no banco, sob o RLS
 * (perfil ativo + 2 etapas). Etapa, responsável, origem, próximo contato, valor e motivo de perda
 * ficam no contato; o histórico do funil é gravado pelo banco; observações são interações (só
 * inclusão). Sair de "Novo contato" exige base para contato com evidência (005). Vínculo com
 * cliente real existente: sugerido pelo banco (mesmo e-mail/telefone) ou buscado; quem decide
 * é uma pessoa. Dados fictícios de teste: somente leitura (garantido pela 015).
 * Nenhuma mensagem é enviada: a tela só organiza e registra.
 */
(function (A) {
  'use strict';
  const { ui } = A;
  const R = () => A.repositorio;

  const STAGES = [
    ['novo', 'Novo contato'], ['autorizado', 'Contato autorizado'], ['atendimento', 'Primeiro atendimento'],
    ['interessado', 'Interessado'], ['proposta', 'Proposta enviada'], ['comprou', 'Compra realizada'], ['perdido', 'Perdido / sem interesse']
  ];
  const label = k => (STAGES.find(s => s[0] === k) || [k, k])[1];
  const EXIGEM_BASE = ['autorizado', 'atendimento', 'interessado', 'proposta'];
  const CANAIS = { whatsapp: 'WhatsApp', email: 'E-mail', telefone: 'Telefone', instagram: 'Instagram' };
  const FINALIDADE = { atendimento_solicitado: 'Atendimento solicitado', prospeccao_b2b: 'Prospecção B2B', relacionamento: 'Relacionamento',
                       execucao_pedido: 'Execução de pedido', marketing_promocional: 'Marketing' };
  const BASE_LEGAL = { contrato_ou_preliminares: 'pedido do próprio titular (procedimentos preliminares)', consentimento: 'consentimento',
                       legitimo_interesse: 'legítimo interesse', obrigacao_legal: 'obrigação legal' };
  // opções de base para contato (combinações aceitas pela 005); legítimo interesse só com teste ativo
  const OPCOES_BASE = [
    ['atendimento_solicitado|contrato_ou_preliminares', 'O próprio contato procurou a Altum pedindo informação ou atendimento'],
    ['atendimento_solicitado|consentimento', 'O contato autorizou expressamente ser atendido'],
    ['prospeccao_b2b|consentimento', 'Empresa (B2B): o responsável autorizou o contato'],
    ['prospeccao_b2b|legitimo_interesse', 'Empresa (B2B): legítimo interesse (teste aprovado pelo administrador)'],
    ['relacionamento|consentimento', 'Autorizou contato de relacionamento'],
    ['relacionamento|legitimo_interesse', 'Relacionamento: legítimo interesse (teste aprovado pelo administrador)']
  ];
  const MOTIVO = { mesmo_email: 'mesmo e-mail', mesmo_telefone: 'mesmo telefone', nome_cidade: 'nome e cidade' };
  const permitirFicticios = () => !(A.config && A.config.dashboard && A.config.dashboard.permitirFicticios === false);

  // Estado só em memória (nada no localStorage)
  const estado = { origem: 'real', lista: null, erro: null, carregando: false, g: 0, existemFicticios: null,
                   filtro: { origem: '', responsavel: '', q: '' } };
  const fic = () => estado.origem === 'ficticio';
  const msgErro = e => ui.esc((e && e.message) || 'Erro inesperado.');
  const hojeIso = () => A.analytics.iso(A.analytics.today());
  const dataHora = ts => (ts ? new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const opcoes = (pares, sel, vazio) => (vazio !== undefined ? `<option value="">${ui.esc(vazio)}</option>` : '')
    + pares.map(([v, l]) => `<option value="${ui.esc(v)}" ${v === sel ? 'selected' : ''}>${ui.esc(l)}</option>`).join('');
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  let usuarioSessao = null;                 // vem do repositório junto com os dados (só para a tela)
  const meuId = () => usuarioSessao;

  // ---------- validação (o banco valida de novo) ----------
  function validarContato(d) {
    const e = [];
    if (!d.nome || d.nome.length > 200) e.push('Informe o nome (até 200 caracteres).');
    if (!A.config.leadOrigens.includes(d.origem)) e.push('Escolha a origem.');
    if (!d.email && !d.telefone) e.push('Informe telefone ou e-mail.');
    if (d.email && (d.email.length > 254 || !EMAIL_RE.test(d.email))) e.push('E-mail inválido.');
    if (d.telefone) { const n = d.telefone.replace(/\D/g, '').length; if (d.telefone.length > 40 || n < 8 || n > 15) e.push('Telefone inválido (8 a 15 dígitos).'); }
    if (d.empresa && d.empresa.length > 200) e.push('Empresa: até 200 caracteres.');
    return e;
  }
  function validarComercial(d) {
    const e = [];
    if (d.valor !== undefined && (!(Number(d.valor) >= 0) || Number(d.valor) > 9999999999)) e.push('Valor potencial inválido.');
    if (d.motivoPerda && d.motivoPerda.length > 500) e.push('Motivo da perda: até 500 caracteres.');
    return e;
  }

  // ---------- carregamento ----------
  async function carregar() {
    const g = ++estado.g;
    estado.carregando = true; estado.erro = null;
    const btn = document.querySelector('#atualizarFunil');
    if (btn) { btn.disabled = true; btn.textContent = 'Atualizando…'; }
    try {
      const d = await R().funilLista(estado.origem);
      if (g !== estado.g) return;
      estado.lista = d; estado.existemFicticios = d.existemFicticios; usuarioSessao = d.usuarioId || usuarioSessao;
    } catch (e) {
      if (g !== estado.g) return;
      console.error(e); estado.erro = e; estado.lista = null;
    } finally {
      if (g === estado.g) estado.carregando = false;
    }
    if (A.router.parse().name === 'funil') A.router.render();
  }
  // outras telas (Dashboard: follow-ups do funil) descartam o que leram e releem na próxima abertura
  const avisarAlteracao = () => window.dispatchEvent(new CustomEvent('altum:dados-alterados', { detail: { origem: 'funil' } }));

  // ---------- quadro ----------
  function seletorOrigem() {
    const mostrar = permitirFicticios() && estado.existemFicticios !== false;
    if (!mostrar && !fic()) return '';
    return `<div class="seg-control seletor-origem" role="group" aria-label="Origem dos dados">
      <button type="button" class="${!fic() ? 'active' : ''}" data-origem="real">Dados reais</button>
      ${mostrar ? `<button type="button" class="${fic() ? 'active' : ''}" data-origem="ficticio">Dados fictícios (teste)</button>` : ''}
    </div>`;
  }

  function topo() {
    const d = estado.lista;
    return `<div class="fonte-dados small" id="fonteFunil">
      <span class="badge ${fic() ? 'badge-warn' : 'badge-sage'}">Supabase</span>
      <span>${fic() ? 'contatos de teste (somente leitura)' : 'contatos reais'}${d ? ` · lidos às ${d.lidoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
      <span class="fonte-acoes">${seletorOrigem()}
        <button class="btn btn-ghost btn-sm" id="atualizarFunil" type="button" ${estado.carregando ? 'disabled' : ''}>${estado.carregando ? 'Atualizando…' : 'Atualizar'}</button></span>
    </div>
    ${fic() ? '<div class="aviso-ficticio" role="note" id="avisoFicticioFunil"><strong>DADOS FICTÍCIOS DE TESTE</strong> — carga da migração 010. Não são contatos reais; nada pode ser registrado aqui.</div>' : ''}`;
  }

  function filtrados(d) {
    const f = estado.filtro, eu = meuId();
    const q = f.q.trim().toLowerCase();
    return d.itens.filter(l => (!f.origem || l.origem === f.origem)
      && (!f.responsavel || (f.responsavel === 'meus' ? l.responsavelId === eu : f.responsavel === 'sem' ? !l.responsavelId : l.responsavelId === f.responsavel))
      && (!q || String(l.nome || '').toLowerCase().includes(q) || String(l.empresa || '').toLowerCase().includes(q)));
  }

  function card(l, hoje) {
    const late = l.proximoContato && l.proximoContato < hoje && !['comprou', 'perdido'].includes(l.etapa);
    return `<div class="kcard" ${fic() ? '' : 'draggable="true"'} data-lead="${ui.esc(l.id)}" tabindex="0">
      <div class="kcard-top"><strong>${ui.esc(l.nome)}</strong>${l.temBase ? '<span class="consent on" title="Base para contato registrada">✓</span>' : '<span class="consent off" title="Sem base para contato: registre antes de avançar">!</span>'}</div>
      ${l.empresa ? `<small class="muted block">${ui.esc(l.empresa)}</small>` : ''}
      <div class="kcard-meta">${ui.badge(l.origem, 'sand')}${l.proximoContato ? `<span class="${late ? 'late' : 'muted'} small">↻ ${ui.date(l.proximoContato)}</span>` : ''}</div>
      ${l.clienteId || l.sugestoes || l.responsavel ? `<div class="kcard-meta small muted">${l.responsavel ? `<span title="Responsável">👤 ${ui.esc(l.responsavel)}</span>` : '<span></span>'}
        ${l.clienteId ? '<span title="Vinculado a cliente">cliente</span>' : l.sugestoes ? `<span class="aviso-inline" title="O banco encontrou cliente com o mesmo e-mail/telefone">possível cliente</span>` : ''}</div>` : ''}
    </div>`;
  }

  function quadro(d) {
    const hoje = hojeIso(), f = estado.filtro;
    const leads = filtrados(d);
    const abertos = leads.filter(l => !['comprou', 'perdido'].includes(l.etapa));
    const ganhos = leads.filter(l => l.etapa === 'comprou').length, perdidos = leads.filter(l => l.etapa === 'perdido').length;
    const admin = A.session.isAdmin();
    const resp = [['meus', 'Meus contatos'], ['sem', 'Sem responsável']]
      .concat(admin ? d.perfis.filter(p => p.ativo).map(p => [p.id, p.nome]) : []);
    if (!d.itens.length && !fic()) {
      return `<section class="toolbar"><div class="btn-row"><button class="btn btn-primary" id="newLead" type="button">+ Novo contato</button></div></section>
        <section class="card estado-vazio" id="funilVazio"><h2>Nenhum contato comercial real ainda</h2>
        <p>Cadastre os contatos que procuraram a Altum (WhatsApp, Instagram, anúncio, indicação, B2B…). Não é preciso que já tenham comprado na loja.
        Quando o e-mail ou telefone coincidir com um cliente, o sistema sugere o vínculo — quem decide é você.</p>
        ${permitirFicticios() && estado.existemFicticios ? '<div class="btn-row"><button class="btn btn-ghost" type="button" data-origem="ficticio">Ver dados fictícios de teste</button></div>' : ''}</section>`;
    }
    return `
      <section class="toolbar">
        <div class="btn-row">
          ${fic() ? '' : '<button class="btn btn-primary" id="newLead" type="button">+ Novo contato</button>'}
          <select id="forig" aria-label="Filtrar origem">${opcoes(A.config.leadOrigens.map(o => [o, o]), f.origem, 'Todas as origens')}</select>
          <select id="fresp" aria-label="Filtrar responsável">${opcoes(resp, f.responsavel, 'Todos os responsáveis')}</select>
          <input type="search" id="fq" placeholder="Buscar nome ou empresa" value="${ui.esc(f.q)}" aria-label="Buscar contato" maxlength="80">
        </div>
        <p class="muted small" id="resumoFunil">${abertos.length} em aberto (${ui.brl0(abertos.reduce((t, l) => t + (l.valor || 0), 0))} potencial) · ${ganhos} compras · ${perdidos} perdidos · conversão ${ui.pct((ganhos + perdidos) ? ganhos / (ganhos + perdidos) : NaN)} dos encerrados${fic() ? '' : ' · arraste os cartões entre colunas'}</p>
      </section>
      <section class="kanban" id="kanbanFunil">
        ${STAGES.map(([k, t]) => { const col = leads.filter(l => l.etapa === k); return `
          <div class="kcol" data-stage="${k}"><header><span>${t}</span><span class="count">${col.length}</span></header>
          <div class="kcol-body">${col.map(l => card(l, hoje)).join('') || '<div class="kempty">—</div>'}</div></div>`; }).join('')}
      </section>
      <p class="small muted">✓ = base para contato registrada (exigida para sair de "Novo contato"). A base para contato não autoriza mensagens de marketing: essas dependem da permissão por canal. Nada é enviado por esta tela.</p>`;
  }

  function render() {
    const d = estado.lista;
    let corpo;
    if (estado.erro) corpo = `<section class="card error" role="alert" id="erroFunil"><h2>Não foi possível carregar o funil</h2><p>${msgErro(estado.erro)}</p>
      <div class="btn-row"><button class="btn btn-primary" id="tentarFunil" type="button">Tentar de novo</button></div></section>`;
    else if (!d || d.origem !== estado.origem) corpo = '<section class="card" aria-busy="true"><p class="muted">Carregando o funil do Supabase…</p></section>';
    else corpo = quadro(d);
    return topo() + corpo;
  }

  function lead(id) { return estado.lista && estado.lista.itens.find(l => l.id === id); }

  async function mover(id, etapa) {
    const l = lead(id); if (!l || l.etapa === etapa || fic()) return;
    if (EXIGEM_BASE.includes(etapa) && !l.temBase) {
      ui.toast('Registre a base para contato (abra o contato) antes de avançar no funil.', 'warn'); return;
    }
    try {
      await R().funilAtualizar(id, l.atualizadoEm, { etapa });
      avisarAlteracao();
      ui.toast(`${l.nome}: ${label(l.etapa)} → ${label(etapa)}`);
    } catch (e) { console.error(e); ui.toast((e && e.message) || 'Erro ao mover.', 'warn'); }
    carregar();
  }

  let temporizador = null;
  function bind(root) {
    if ((!estado.lista && !estado.erro && !estado.carregando) || (estado.lista && estado.lista.origem !== estado.origem && !estado.carregando)) carregar();
    root.querySelectorAll('[data-origem]').forEach(b => b.addEventListener('click', () => {
      const o = b.dataset.origem; if (o === 'ficticio' && !permitirFicticios()) return;
      if (o === estado.origem) return;
      estado.origem = o; estado.lista = null; carregar(); A.router.render();
    }));
    [['#atualizarFunil', () => { carregar(); A.router.render(); }], ['#tentarFunil', () => { carregar(); A.router.render(); }], ['#newLead', abrirNovo]]
      .forEach(([s, fn]) => { const b = root.querySelector(s); if (b) b.addEventListener('click', fn); });
    const fo = root.querySelector('#forig'); if (fo) fo.addEventListener('change', () => { estado.filtro.origem = fo.value; A.router.render(); });
    const fr = root.querySelector('#fresp'); if (fr) fr.addEventListener('change', () => { estado.filtro.responsavel = fr.value; A.router.render(); });
    const fq = root.querySelector('#fq');
    if (fq) fq.addEventListener('input', () => {
      estado.filtro.q = fq.value; clearTimeout(temporizador);
      temporizador = setTimeout(() => { A.router.render(); const n = document.querySelector('#fq'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 300);
    });
    root.querySelectorAll('.kcard').forEach(c => {
      c.addEventListener('click', () => abrirLead(c.dataset.lead));
      c.addEventListener('keydown', e => { if (e.key === 'Enter') abrirLead(c.dataset.lead); });
      if (fic()) return;
      c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', c.dataset.lead); c.classList.add('dragging'); });
      c.addEventListener('dragend', () => c.classList.remove('dragging'));
    });
    if (fic()) return;
    root.querySelectorAll('.kcol').forEach(col => {
      col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', () => col.classList.remove('over'));
      col.addEventListener('drop', e => {
        e.preventDefault(); col.classList.remove('over');
        mover(e.dataTransfer.getData('text/plain'), col.dataset.stage);
      });
    });
  }

  // ---------- novo contato ----------
  function opcoesResponsavel(perfis, sel) {
    const eu = meuId();
    const lista = (perfis || []).filter(p => p.ativo || p.id === sel).map(p => [p.id, p.id === eu ? `${p.nome} (você)` : p.nome]);
    if (sel && !lista.some(([id]) => id === sel)) lista.push([sel, 'Outro usuário']);
    return opcoes(lista, sel, 'Sem responsável');
  }
  function campoBase(prefixo, testes) {
    const temLi = f => (testes || []).some(t => t.finalidade === f);
    const pares = OPCOES_BASE.filter(([v]) => !v.endsWith('|legitimo_interesse') || temLi(v.split('|')[0]));
    return `<label>Como o contato chegou à Altum *<select name="${prefixo}base">${opcoes(pares, '', 'Escolha…')}</select></label>
      <label>Evidência (como e quando) *<textarea name="${prefixo}evidencia" rows="2" maxlength="1000" placeholder="Ex.: mandou mensagem no WhatsApp em 03/11 pedindo a tabela de preços"></textarea></label>`;
  }
  function lerBase(fd, prefixo, testes) {
    const v = String(fd.get(prefixo + 'base') || '');
    if (!v) return null;
    const [finalidade, baseLegal] = v.split('|');
    const t = (testes || []).find(x => x.finalidade === finalidade);
    return { finalidade, baseLegal, evidencia: String(fd.get(prefixo + 'evidencia') || '').trim(), testeLiId: baseLegal === 'legitimo_interesse' && t ? t.id : null };
  }

  function abrirNovo() {
    if (fic()) return;
    const d = estado.lista || { perfis: [] };
    ui.modal(`
      <h2>Novo contato</h2>
      <p class="muted small">Somente contatos captados por canais legítimos (o próprio contato procurou a Altum, indicação, B2B ou importação autorizada). Não é preciso que já tenha comprado na loja.</p>
      <form id="nf" class="form" novalidate>
        <div class="form-grid">
          <label>Nome *<input name="nome" required maxlength="200"></label>
          <label>Origem *<select name="origem">${opcoes(A.config.leadOrigens.map(o => [o, o]), '')}</select></label>
          <label>Telefone<input name="telefone" inputmode="tel" maxlength="40"></label>
          <label>E-mail<input name="email" type="email" maxlength="254"></label>
          <label>Empresa (B2B)<input name="empresa" maxlength="200"></label>
          <label>Responsável<select name="responsavel">${opcoesResponsavel(d.perfis, meuId())}</select></label>
          <label>Próximo acompanhamento<input type="date" name="proximoContato" min="${hojeIso()}"></label>
          <label>Valor potencial (R$)<input type="number" min="0" step="0.01" name="valor"></label>
        </div>
        <label class="check"><input type="checkbox" name="temBase" id="nfTemBase"> Já tenho base para contato (o contato procurou a Altum ou autorizou)</label>
        <div id="nfBase" hidden>${campoBase('', [])}<p class="small muted">Com a base registrada, o contato já entra em "Contato autorizado". Legítimo interesse pode ser registrado depois, na ficha.</p></div>
        <div class="form-grid">
          <label>Primeira observação<textarea name="nota" rows="2" maxlength="2000" placeholder="O que aconteceu. Não registre dados de saúde."></textarea></label>
          <label>Canal da observação<select name="canal">${opcoes(Object.entries(CANAIS), 'whatsapp')}</select></label>
        </div>
        <div id="nfDup" hidden></div>
      </form>
      <div class="auth-msg auth-msg-erro" id="nfErro" role="alert" hidden></div>
      <div class="btn-row end"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" type="button" id="nfCriar">Criar</button></div>`,
    m => {
      const form = m.querySelector('#nf'), err = m.querySelector('#nfErro'), btn = m.querySelector('#nfCriar'), dup = m.querySelector('#nfDup');
      m.querySelector('#nfTemBase').addEventListener('change', e => { m.querySelector('#nfBase').hidden = !e.target.checked; });
      let conferido = null;          // contato já conferido contra duplicados (chave e-mail|telefone)
      ['email', 'telefone', 'nome'].forEach(n => form.elements[n].addEventListener('input', () => { conferido = null; dup.hidden = true; btn.textContent = 'Criar'; }));
      btn.addEventListener('click', async () => {
        err.hidden = true;
        const fd = new FormData(form);
        const dados = {
          nome: String(fd.get('nome') || '').trim(), origem: fd.get('origem'), telefone: String(fd.get('telefone') || '').trim(),
          email: String(fd.get('email') || '').trim(), empresa: String(fd.get('empresa') || '').trim(),
          responsavelId: fd.get('responsavel') || null, proximoContato: fd.get('proximoContato') || null,
          valor: fd.get('valor') === '' ? 0 : Number(fd.get('valor')), nota: String(fd.get('nota') || '').trim(), canal: fd.get('canal')
        };
        const erros = validarContato(dados).concat(validarComercial(dados));
        if (fd.get('temBase') === 'on') {
          dados.base = lerBase(fd, '', []);
          if (!dados.base) erros.push('Escolha como o contato chegou à Altum (ou desmarque a base).');
          else if (dados.base.evidencia.length < 3) erros.push('Descreva a evidência da base para contato.');
        }
        if (dados.nota.length > 2000) erros.push('Observação: até 2.000 caracteres.');
        if (erros.length) { err.textContent = erros.join(' '); err.hidden = false; return; }
        const chave = `${dados.email.toLowerCase()}|${dados.telefone.replace(/\D/g, '')}`;
        btn.disabled = true; btn.textContent = 'Verificando…';
        try {
          if (conferido !== chave) {
            const p = await R().funilPossiveisDuplicados(dados);
            conferido = chave;
            if (p.leads.length || p.clientes.length) {
              dup.innerHTML = `<div class="check-warn" id="nfAvisoDup"><strong>Possível duplicidade.</strong> O sistema não bloqueia; confira antes de criar:
                <ul>${p.leads.map(x => `<li>Contato no funil: <strong>${ui.esc(x.nome)}</strong>${x.empresa ? ` (${ui.esc(x.empresa)})` : ''} · ${ui.esc(label(x.etapa))} · ${ui.esc(MOTIVO[x.motivo] || '')}</li>`).join('')}
                ${p.clientes.map(x => `<li>Cliente: <strong>${ui.esc(x.nome)}</strong>${x.cidade ? ` · ${ui.esc(x.cidade)}/${ui.esc(x.uf || '')}` : ''} · ${ui.esc(MOTIVO[x.motivo] || '')}
                  <label class="check small"><input type="radio" name="vinc" value="${ui.esc(x.id)}"> vincular a este cliente</label></li>`).join('')}</ul>
                ${p.clientes.length ? '<label class="check small"><input type="radio" name="vinc" value="" checked> não vincular agora</label>' : ''}
                <label>Por que criar mesmo assim? *<input name="motivoDup" maxlength="500" placeholder="Ex.: é outra pessoa da mesma empresa"></label></div>`;
              dup.hidden = false; btn.disabled = false; btn.textContent = 'Criar mesmo assim';
              return;
            }
          }
          if (!dup.hidden) {
            const motivo = String((form.querySelector('[name=motivoDup]') || {}).value || '').trim();
            const vinc = form.querySelector('[name=vinc]:checked');
            if (vinc && vinc.value) dados.clienteId = vinc.value;
            else if (motivo.length < 5) { err.textContent = 'Explique por que criar mesmo assim (ou vincule ao cliente encontrado).'; err.hidden = false; btn.disabled = false; btn.textContent = 'Criar mesmo assim'; return; }
            if (motivo) dados.motivoDuplicidade = motivo;
          }
          btn.textContent = 'Criando…';
          const r = await R().funilCriar(dados);
          avisarAlteracao();
          ui.closeModal();
          ui.toast(r.avisos.length ? `Contato criado. ${r.avisos.join(' ')}` : 'Contato criado.', r.avisos.length ? 'warn' : 'ok');
          carregar();
        } catch (e) {
          console.error(e); err.textContent = (e && e.message) || 'Erro inesperado.'; err.hidden = false;
          btn.disabled = false; btn.textContent = dup.hidden ? 'Criar' : 'Criar mesmo assim';
        }
      });
    });
  }

  // ---------- ficha do contato ----------
  function secaoBase(d, editavel) {
    const l = d.lead;
    const ativas = d.bases.filter(b => !b.encerradaEm);
    return `<section id="secBase"><h3 class="subhead">Base para contato ${l.temBase ? ui.badge('registrada', 'sage') : ui.badge('pendente', 'warn')}</h3>
      ${d.bases.length ? `<ul class="list-plain small">${d.bases.map(b => `<li>${b.encerradaEm ? '<s>' : ''}<strong>${ui.esc(FINALIDADE[b.finalidade] || b.finalidade)}</strong> · ${ui.esc(BASE_LEGAL[b.baseLegal] || b.baseLegal)}${b.encerradaEm ? '</s> (encerrada)' : ''}
        <small class="block muted">${ui.esc(b.evidencia)} — ${ui.esc(b.por)}, ${dataHora(b.em)}</small></li>`).join('')}</ul>` : ''}
      ${!ativas.length ? '<p class="small">Sem base registrada: o contato só pode ficar em "Novo contato", "Perdido" ou "Compra realizada".</p>' : ''}
      ${l.oposicaoTotal ? '<p class="small aviso-inline">O titular se opôs a contato não essencial: só "Perdido" ou "Compra realizada".</p>' : ''}
      ${editavel && !l.temBase && !l.oposicaoTotal ? `<details id="detBase"><summary class="small">Registrar base para contato</summary>
        <form class="form" id="formBase" novalidate>${campoBase('', d.testesLi)}
          <p class="small muted">A base registra por que a Altum pode responder/atender este contato. Ela não autoriza marketing promocional (isso depende da permissão por canal) e não pode ser editada depois — só encerrada.</p>
          <div class="btn-row end"><button class="btn btn-ghost btn-sm" type="button" id="salvarBase">Registrar base</button></div></form></details>` : ''}
    </section>`;
  }

  function secaoVinculo(d, editavel) {
    const c = d.cliente;
    return `<section id="secVinculo"><h3 class="subhead">Cliente vinculado</h3>
      ${c ? `<p>${fic() || c.fonte === 'ficticio' ? `<strong>${ui.esc(c.nome)}</strong>` : `<a class="link-strong" href="#/clientes/${ui.esc(c.id)}" id="abrirClienteVinc">${ui.esc(c.nome)}</a>`}${c.cidade ? ` <small class="muted">${ui.esc(c.cidade)}/${ui.esc(c.uf || '')}</small>` : ''}
        ${editavel ? ' <button class="btn btn-ghost btn-sm" type="button" id="desvincular">Desvincular</button>' : ''}</p>`
        : '<p class="small muted">Não vinculado a cliente. Contatos que ainda não compraram ficam sem vínculo.</p>'}
      ${!c && d.sugestoes.length ? `<div class="check-warn small" id="sugestoesLead"><strong>O banco encontrou cliente com o mesmo contato.</strong> Só vincule se for a mesma pessoa:
        <ul>${d.sugestoes.map(s => `<li><strong>${ui.esc(s.cliente.nome)}</strong>${s.cliente.cidade ? ` · ${ui.esc(s.cliente.cidade)}/${ui.esc(s.cliente.uf || '')}` : ''} · ${ui.esc(MOTIVO[s.motivo] || s.motivo)}
          ${editavel ? `<span class="btn-row"><button class="btn btn-ghost btn-sm" type="button" data-vincular="${ui.esc(s.cliente.id)}">Vincular</button>
          <button class="btn btn-ghost btn-sm" type="button" data-rejeitar="${ui.esc(s.id)}">Não é a mesma pessoa</button></span>` : ''}</li>`).join('')}</ul></div>` : ''}
      ${editavel && !c ? `<details id="detBuscaCliente"><summary class="small">Buscar cliente para vincular</summary>
        <div class="form"><input type="search" id="buscaCliente" placeholder="Nome, e-mail ou telefone completo" maxlength="80" aria-label="Buscar cliente">
        <ul class="list-plain small" id="resultadoBusca"></ul></div></details>` : ''}
    </section>`;
  }

  function secaoHistorico(d, editavel) {
    return `<section id="secHistorico"><h3 class="subhead">Observações e contatos</h3>
      ${editavel ? `<form class="form" id="formObs" novalidate><div class="form-grid">
          <label>Canal *<select name="canal">${opcoes(Object.entries(CANAIS), 'whatsapp')}</select></label>
          <label>Quando<input type="datetime-local" name="data" max="${hojeIso()}T23:59"></label></div>
          <label>Nova observação *<textarea name="nota" rows="2" maxlength="2000" placeholder="O que aconteceu. Não registre dados de saúde."></textarea></label>
          <div class="btn-row end"><button class="btn btn-ghost btn-sm" type="button" id="salvarObs">Registrar observação</button></div></form>` : ''}
      <ul class="timeline" id="timelineLead">${d.interacoes.map(i => `<li><span class="tl-date">${dataHora(i.data)}</span> ${ui.esc(CANAIS[i.canal] || i.canal)} — ${ui.esc(i.nota)}<small class="muted"> — ${ui.esc(i.por)}</small></li>`).join('') || '<li class="muted">Sem observações.</li>'}</ul>
      <p class="small muted">Observações não podem ser alteradas nem apagadas; uma correção é uma nova observação.</p>
      <details class="historico" id="histFunil"><summary>Histórico do funil (${d.movimentacoes.length})</summary><ul class="list-plain small">
        ${d.movimentacoes.map(m => `<li>${dataHora(m.em)} · ${m.de ? `${ui.esc(label(m.de))} → ` : 'criado em '}${ui.esc(label(m.para))} <small class="muted">— ${ui.esc(m.por)}</small></li>`).join('')}</ul></details>
      ${d.vinculos.length ? `<details class="historico"><summary>Histórico de vínculos (${d.vinculos.length})</summary><ul class="list-plain small">
        ${d.vinculos.map(v => `<li>${dataHora(v.em)} · ${ui.esc(v.acao)}${v.cliente ? `: ${ui.esc(v.cliente.nome)}` : ''}${v.anterior ? ` (antes: ${ui.esc(v.anterior.nome)})` : ''}${v.origem ? ` · ${v.origem === 'sugestao' ? 'pela sugestão' : 'manual'}` : ''} <small class="muted">— ${ui.esc(v.por)}</small></li>`).join('')}</ul></details>` : ''}
    </section>`;
  }

  function corpoLead(d) {
    const l = d.lead, editavel = !fic() && l.fonte !== 'ficticio' && !l.anonimizado;
    const etapas = STAGES.map(([k, t]) => [k, t + (EXIGEM_BASE.includes(k) && !l.temBase ? ' (exige base)' : '')]);
    return `<div id="fichaLead" data-lead="${ui.esc(l.id)}">
      <h2>${ui.esc(l.nome || 'Contato anonimizado')}</h2>
      ${!editavel ? '<div class="aviso-ficticio small" role="note">Dados fictícios de teste: somente leitura.</div>' : ''}
      <p class="muted small">${ui.esc(l.origem)}${l.empresa ? ' · ' + ui.esc(l.empresa) : ''} · criado em ${ui.date(l.criadoEm)}${l.criadoPor ? ` por ${ui.esc(l.criadoPor)}` : ''}
        · ${ui.esc(l.telefone || 'sem telefone')} · ${ui.esc(l.email || 'sem e-mail')}</p>
      ${l.motivoDuplicidade ? `<p class="small muted">Criado apesar de possível duplicidade: ${ui.esc(l.motivoDuplicidade)}</p>` : ''}
      <form id="lf" class="form" novalidate>
        <div class="form-grid">
          <label>Etapa<select name="etapa" ${editavel ? '' : 'disabled'}>${opcoes(etapas, l.etapa)}</select></label>
          <label>Responsável<select name="responsavel" ${editavel ? '' : 'disabled'}>${opcoesResponsavel(d.perfis, l.responsavelId)}</select></label>
          <label>Próximo acompanhamento<input type="date" name="proximoContato" value="${ui.esc(l.proximoContato || '')}" ${editavel ? '' : 'disabled'}></label>
          <label>Valor potencial (R$)<input type="number" min="0" step="0.01" name="valor" value="${l.valor || ''}" ${editavel ? '' : 'disabled'}></label>
        </div>
        <label id="lfMotivo" ${l.etapa === 'perdido' ? '' : 'hidden'}>Motivo da perda<input name="motivoPerda" maxlength="500" value="${ui.esc(l.motivoPerda || '')}" ${editavel ? '' : 'disabled'}></label>
        ${editavel ? `<details id="detDados"><summary class="small">Editar nome, origem e contato</summary><div class="form-grid">
          <label>Nome *<input name="nome" maxlength="200" value="${ui.esc(l.nome || '')}"></label>
          <label>Origem *<select name="origem">${opcoes(A.config.leadOrigens.map(o => [o, o]), l.origem)}</select></label>
          <label>Telefone<input name="telefone" inputmode="tel" maxlength="40" value="${ui.esc(l.telefone || '')}"></label>
          <label>E-mail<input name="email" type="email" maxlength="254" value="${ui.esc(l.email || '')}"></label>
          <label>Empresa (B2B)<input name="empresa" maxlength="200" value="${ui.esc(l.empresa || '')}"></label></div></details>` : ''}
        <div class="auth-msg auth-msg-erro" id="lfErro" role="alert" hidden></div>
        <div class="btn-row end"><button type="button" class="btn btn-ghost" data-close>Fechar</button>${editavel ? '<button class="btn btn-primary" type="button" id="lfSalvar">Salvar</button>' : ''}</div>
      </form>
      ${secaoBase(d, editavel)}
      ${secaoVinculo(d, editavel)}
      ${secaoHistorico(d, editavel)}
    </div>`;
  }

  async function abrirLead(id) {
    ui.modal('<div id="fichaLead" aria-busy="true"><p class="muted">Carregando o contato…</p></div>');
    let d;
    try { d = await R().funilLead(id); usuarioSessao = d.usuarioId || usuarioSessao; } catch (e) {
      console.error(e);
      ui.modal(`<h2>Contato indisponível</h2><p id="erroFicha">${msgErro(e)}</p><div class="btn-row end"><button class="btn btn-ghost" data-close type="button">Fechar</button></div>`);
      return;
    }
    ui.modal(corpoLead(d), m => ligarFicha(m, d));
  }

  // ação na ficha: executa, avisa, recarrega ficha e quadro (conflito também recarrega)
  async function acao(m, botao, fn, ok, alvoErro) {
    const err = alvoErro || m.querySelector('#lfErro');
    if (err) err.hidden = true;
    if (botao) botao.disabled = true;
    try {
      await fn();
      avisarAlteracao();
      ui.toast(ok);
      carregar();
      await abrirLead(m.querySelector('#fichaLead').dataset.lead);
    } catch (e) {
      console.error(e);
      if (e && e.tipo === 'conflito') { ui.toast(e.message, 'warn'); carregar(); await abrirLead(m.querySelector('#fichaLead').dataset.lead); return; }
      if (err) { err.textContent = (e && e.message) || 'Erro inesperado.'; err.hidden = false; err.scrollIntoView({ block: 'nearest' }); }
      else ui.toast((e && e.message) || 'Erro inesperado.', 'warn');
      if (botao) botao.disabled = false;
    }
  }

  function ligarFicha(m, d) {
    const l = d.lead, form = m.querySelector('#lf');
    const selEtapa = form.querySelector('[name=etapa]');
    if (selEtapa) selEtapa.addEventListener('change', () => { m.querySelector('#lfMotivo').hidden = selEtapa.value !== 'perdido'; });
    const salvar = m.querySelector('#lfSalvar');
    if (salvar) salvar.addEventListener('click', () => {
      const fd = new FormData(form), err = m.querySelector('#lfErro');
      const p = {
        etapa: fd.get('etapa'), responsavelId: fd.get('responsavel') || null, proximoContato: fd.get('proximoContato') || null,
        valor: fd.get('valor') === '' ? 0 : Number(fd.get('valor')), motivoPerda: fd.get('etapa') === 'perdido' ? String(fd.get('motivoPerda') || '').trim() : l.motivoPerda
      };
      const dados = { nome: String(fd.get('nome') || '').trim(), origem: fd.get('origem'), telefone: String(fd.get('telefone') || '').trim(),
                      email: String(fd.get('email') || '').trim(), empresa: String(fd.get('empresa') || '').trim() };
      const erros = validarContato(dados).concat(validarComercial(p));
      if (p.etapa !== l.etapa && EXIGEM_BASE.includes(p.etapa) && !l.temBase) erros.push('Registre a base para contato antes de avançar no funil.');
      if (erros.length) { err.textContent = erros.join(' '); err.hidden = false; return; }
      // só envia o que mudou
      const mud = {};
      Object.entries(Object.assign({}, p, dados)).forEach(([k, v]) => {
        const atual = { etapa: l.etapa, responsavelId: l.responsavelId, proximoContato: l.proximoContato, valor: l.valor, motivoPerda: l.motivoPerda,
                        nome: l.nome, origem: l.origem, telefone: l.telefone, email: l.email, empresa: l.empresa }[k];
        if ((v === '' ? null : v) !== (atual === '' || atual === undefined ? null : atual)) mud[k] = v;
      });
      if (!Object.keys(mud).length) { ui.toast('Nada foi alterado.'); return; }
      acao(m, salvar, () => R().funilAtualizar(l.id, l.atualizadoEm, mud), mud.etapa ? `Etapa: ${label(l.etapa)} → ${label(mud.etapa)}. Contato salvo.` : 'Contato salvo.');
    });

    const btnBase = m.querySelector('#salvarBase');
    if (btnBase) btnBase.addEventListener('click', () => {
      const fd = new FormData(m.querySelector('#formBase'));
      const b = lerBase(fd, '', d.testesLi);
      const err = m.querySelector('#lfErro');
      if (!b) { err.textContent = 'Escolha como o contato chegou à Altum.'; err.hidden = false; return; }
      if (b.evidencia.length < 3) { err.textContent = 'Descreva a evidência (como e quando).'; err.hidden = false; return; }
      acao(m, btnBase, () => R().funilRegistrarBase(l.id, b), 'Base para contato registrada. O contato já pode avançar no funil.');
    });

    const btnObs = m.querySelector('#salvarObs');
    if (btnObs) btnObs.addEventListener('click', () => {
      const fd = new FormData(m.querySelector('#formObs'));
      const nota = String(fd.get('nota') || '').trim(), quando = fd.get('data');
      const err = m.querySelector('#lfErro');
      if (!nota) { err.textContent = 'Escreva a observação.'; err.hidden = false; return; }
      if (quando && new Date(quando) > new Date()) { err.textContent = 'A data da observação não pode ser futura.'; err.hidden = false; return; }
      acao(m, btnObs, () => R().funilRegistrarInteracao(l.id, { canal: fd.get('canal'), nota, data: quando ? new Date(quando).toISOString() : null }), 'Observação registrada.');
    });

    const desv = m.querySelector('#desvincular');
    if (desv) desv.addEventListener('click', () => acao(m, desv, () => R().funilAtualizar(l.id, l.atualizadoEm, { clienteId: null }), 'Vínculo removido.'));
    m.querySelectorAll('[data-vincular]').forEach(b => b.addEventListener('click', () =>
      acao(m, b, () => R().funilAtualizar(l.id, l.atualizadoEm, { clienteId: b.dataset.vincular }), 'Contato vinculado ao cliente.')));
    m.querySelectorAll('[data-rejeitar]').forEach(b => b.addEventListener('click', () =>
      acao(m, b, () => R().funilRejeitarSugestao(b.dataset.rejeitar), 'Sugestão descartada: não é a mesma pessoa.')));
    const abrirCli = m.querySelector('#abrirClienteVinc');
    if (abrirCli) abrirCli.addEventListener('click', () => ui.closeModal());

    const busca = m.querySelector('#buscaCliente'), res = m.querySelector('#resultadoBusca');
    let tb = null;
    if (busca) busca.addEventListener('input', () => {
      clearTimeout(tb);
      tb = setTimeout(async () => {
        const q = busca.value;
        if (q.trim().length < 2) { res.innerHTML = ''; return; }
        try {
          const lista = await R().funilBuscarClientes(q);
          if (busca.value !== q) return;
          res.innerHTML = lista.length ? lista.map(c => `<li>${ui.esc(c.nome)}${c.cidade ? ` · ${ui.esc(c.cidade)}/${ui.esc(c.uf || '')}` : ''} · ${ui.num(c.pedidos)} ${c.pedidos === 1 ? 'pedido' : 'pedidos'}
            <button class="btn btn-ghost btn-sm" type="button" data-vincular-busca="${ui.esc(c.id)}">Vincular</button></li>`).join('') : '<li class="muted">Nenhum cliente real encontrado.</li>';
          res.querySelectorAll('[data-vincular-busca]').forEach(b => b.addEventListener('click', () =>
            acao(m, b, () => R().funilAtualizar(l.id, l.atualizadoEm, { clienteId: b.dataset.vincularBusca }), 'Contato vinculado ao cliente.')));
        } catch (e) { res.innerHTML = `<li class="aviso-inline">${msgErro(e)}</li>`; }
      }, 350);
    });
  }

  // ---------- registro da tela ----------
  window.addEventListener('altum:dados-alterados', e => { if (!(e.detail && e.detail.origem === 'funil')) estado.lista = null; });

  A.views.funil = {
    title: 'Prospecção & funil de vendas',
    get fonteDados() { return fic() ? 'Dados FICTÍCIOS de teste' : 'Supabase · dados reais'; },
    stageLabel: label, openLead: abrirLead,
    render, bind
  };
})(window.ALTUM);
