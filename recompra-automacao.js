(function (A) {
  'use strict';
  // =====================================================================
  // Integrações → "Automação de recompra por e-mail" (0.14.0, migração 020 + Edge Function recompra-automacao)
  // Só administrador com 2 etapas. Tudo começa DESLIGADO: simulação primeiro, aprovação, modo real,
  // chave geral e Secret do servidor. A tela recebe só contagens e códigos (nome do cliente só no detalhe).
  // Estado só em memória.
  // =====================================================================
  const { ui } = A;
  const R = () => A.repositorio;
  const rc = { painel: null, erro: null, carregando: false, produtos: null, erroProdutos: null, ocupado: null, msg: null, erroAcao: null,
               servidor: null, erroServidor: null, edicao: null, detalhe: null, erroDetalhe: null };
  const naTela = () => A.router.parse().name === 'configuracoes';
  const render = () => { if (naTela()) A.router.render(); };

  const BLOQUEIO = {
    chave_geral_desligada: 'a chave geral do envio real está desligada',
    automacao_em_simulacao: 'a automação está em modo simulação',
    sem_aprovacao: 'nenhuma simulação foi aprovada',
    lista_nao_definida: 'falta o número da lista do Nuvem Marketing',
    trigger_nao_definido: 'falta o trigger_key do Custom Trigger',
    produtos_invalidos: 'há produto inexistente ou fictício',
    agendamento_desligado: 'o agendamento está desligado',
    executada_recentemente: 'já rodou nas últimas 20 horas',
    em_andamento: 'já havia uma execução em andamento',
    automacao_inexistente: 'automação inexistente',
  };
  const ERRO = {
    envio_real_desligado_no_servidor: 'o servidor não liberou o envio real (Secret RECOMPRA_ENVIO_REAL diferente de "ativado")',
    url_trigger_ausente_ou_invalida: 'falta o Secret NUVEM_MARKETING_TRIGGER_URL (URL oficial do Custom Trigger)',
    segredos_ausentes: 'faltam os Secrets da API do Nuvem Marketing',
    api_recusou_401: 'a API do Nuvem Marketing recusou a chave (401)', api_recusou_403: 'a chave não tem permissão (403)',
    api_limitou_429: 'a API limitou as chamadas (429): o resto ficou sem auditoria', api_limitou_503: 'a API ficou indisponível (503): o resto ficou sem auditoria',
    trigger_limitou_429: 'o Custom Trigger atingiu o limite (200 eventos/h): disparos interrompidos',
    tempo_esgotado: 'tempo da função esgotado: o resto ficou sem auditoria',
    banco_lote: 'falha ao ler o lote no banco', banco_registrar: 'falha ao gravar o resultado', banco_reservar: 'falha ao reservar o envio', inesperado: 'erro inesperado',
  };
  const STATUS = { em_andamento: ['Em andamento', 'sand'], concluida: ['Concluída', 'sage'], concluida_com_avisos: ['Concluída com avisos', 'warn'],
                   falhou: ['Falhou', 'warn'], bloqueada: ['Bloqueada', 'muted'], abandonada: ['Interrompida', 'muted'] };
  const ETAPA = { candidato: 'Candidato (CRM ok)', bloqueado_crm: 'Bloqueado no CRM', sem_consentimento_crm: 'Sem autorização de e-mail', descadastrado_crm: 'Descadastrado no CRM',
                  recusa_vinculada: 'Recusa no mesmo e-mail/cadastro vinculado', sem_email: 'Sem e-mail', fora_da_janela: 'Fora da janela', ja_enviado: 'Já enviado',
                  email_duplicado: 'E-mail repetido', acima_do_limite: 'Acima do limite (próxima execução)' };
  const RESULTADO = { autorizado: ['Autorizado', 'sage'], descadastrado_nm: ['Descadastrado no Nuvem Marketing', 'warn'], bloqueado_nm: ['Bloqueado no Nuvem Marketing', 'warn'],
                      inconclusivo_nm: ['Inconclusivo (não autorizado)', 'sand'], nao_auditado: ['Não auditado (não autorizado)', 'muted'] };
  const ACAO = { nenhuma: '—', simulada: 'Simulado (nada enviado)', sincronizada: 'Sincronizado', evento_enviado: 'E-mail disparado (Custom Trigger)',
                 falha_sincronizacao: 'Falha na lista', falha_evento: 'Falha no disparo', envio_ja_reservado: 'Não enviado (reserva recusada)' };
  const ATIVIDADE = { descadastro_encontrado: 'evento de descadastro', nenhum_evento_retornado: '200 sem descadastro', inconclusivo_processando: 'HTTP 202 (inconclusivo)',
                      inconclusivo_formato: 'formato inesperado', inconclusivo_filtro_ignorado: 'filtro ignorado', erro: 'erro', nao_consultada: 'não consultada' };
  const lista = (codigos, dic) => codigos.map(c => dic[c] || c).join('; ');
  const quando = d => (d ? new Date(d).toLocaleString('pt-BR') : '—');

  function grupos(lista) {
    const m = new Map();
    lista.forEach(p => { const k = p.produtoLoja ? 'loja:' + p.produtoLoja : 'id:' + p.id;
      if (!m.has(k)) m.set(k, { chave: k, nome: String(p.nome || '').split(' — ')[0].trim(), ids: [] });
      m.get(k).ids.push(p.id); });
    return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }
  async function carregar() {
    if (rc.carregando) return;
    rc.carregando = true; rc.erro = null;
    try {
      const [p, prods] = await Promise.all([R().recompraPainel(), rc.produtos ? Promise.resolve(null) : R().produtosParaCampanha().catch(e => { rc.erroProdutos = e.message; return null; })]);
      rc.painel = p; if (prods) rc.produtos = grupos(prods);
    } catch (e) { rc.erro = (e && e.message) || 'Não foi possível ler a automação.'; }
    finally { rc.carregando = false; }
    render();
  }
  async function acao(nome, fn, sucesso) {
    if (rc.ocupado) return;
    rc.ocupado = nome; rc.msg = null; rc.erroAcao = null; render();
    try { const r = await fn(); rc.msg = typeof sucesso === 'function' ? sucesso(r) : sucesso; }
    catch (e) { rc.erroAcao = (e && e.message) || 'Erro inesperado.'; }
    finally { rc.ocupado = null; }
    await carregar();
  }
  function resumoExecucao(r) {
    if (r.bloqueada) return `Execução ${r.modo === 'real' ? 'REAL' : 'de simulação'} bloqueada: ${lista(r.bloqueios, BLOQUEIO)}. Nada foi enviado.`;
    const st = (STATUS[r.status] || ['Situação desconhecida'])[0];
    return `${r.modo === 'real' ? 'Execução real' : 'Simulação'} — ${st}${r.erro ? ` (${ERRO[r.erro] || r.erro})` : ''}. Veja o histórico abaixo.`;
  }
  // confirmação no próprio botão (1º clique explica e vira "Confirmar"; 2º executa; volta sozinho em 8 s)
  function confirmar(botao, texto) {
    if (botao.dataset.confirmar === '1') { botao.dataset.confirmar = ''; return true; }
    const original = botao.textContent;
    botao.dataset.confirmar = '1'; botao.textContent = 'Confirmar'; botao.classList.add('btn-confirmar');
    ui.toast(texto + ' Clique em "Confirmar".', 'warn');
    setTimeout(() => { if (botao.dataset.confirmar === '1') { botao.dataset.confirmar = ''; botao.textContent = original; botao.classList.remove('btn-confirmar'); } }, 8000);
    return false;
  }

  // Secrets em três grupos: só os da simulação podem "faltar"; os do envio real e do agendamento
  // ficam "não necessário agora" até a ativação (nunca contam como erro).
  function blocoServidor() {
    const s = rc.servidor;
    const obrig = (okk, txt) => `<li data-secret="obrigatorio">${ui.badge(okk ? 'OK' : 'Falta', okk ? 'sage' : 'warn')} ${txt}</li>`;
    const opc = (okk, txt) => `<li data-secret="opcional">${ui.badge(okk ? 'Configurado' : 'Não necessário agora', okk ? 'sand' : 'muted')} ${txt}</li>`;
    return `<div class="btn-row"><button class="btn btn-ghost btn-sm" type="button" id="recServidor" ${rc.ocupado ? 'disabled' : ''}>Conferir Secrets do servidor</button></div>
      ${rc.erroServidor ? `<p class="aviso-inline" role="alert" id="recServidorErro">${ui.esc(rc.erroServidor)}</p>` : ''}
      ${s ? `<div id="recServidorLista" class="small"><p class="muted">Função publicada: recompra-automacao ${ui.esc(s.versao)}</p>
        <p><strong>Para simular</strong> ${s.chaveApi && s.conta ? ui.badge('pronto', 'sage') : ui.badge('incompleto', 'warn')}</p>
        <ul class="lista-simples">${obrig(s.chaveApi, 'NUVEM_MARKETING_API_KEY')}${obrig(s.conta, 'NUVEM_MARKETING_CONTA')}</ul>
        <p><strong>Só para o envio real</strong> (criar apenas na ativação)</p>
        <ul class="lista-simples">${opc(s.urlTrigger, 'NUVEM_MARKETING_TRIGGER_URL (URL oficial do Custom Trigger)')}${opc(s.envioRealServidor, 'RECOMPRA_ENVIO_REAL = "ativado" (trava do servidor)')}</ul>
        <p><strong>Só para o agendamento</strong></p>
        <ul class="lista-simples">${opc(s.segredoAgendamento, 'RECOMPRA_CRON_SECRET')}</ul>
        ${!(s.chaveApi && s.conta) ? '<p class="aviso-inline">Sem a chave e a conta do Nuvem Marketing a simulação termina como "Falhou" (registrada no histórico). Confira os Secrets em Edge Functions → Secrets.</p>' : ''}</div>` : ''}`;
  }
  function formulario() {
    const e = rc.edicao; if (!e) return '';
    const prods = rc.produtos || [];
    const chaveSel = e.chave || (prods.find(g => g.ids.length === e.produtos.length && g.ids.every(i => e.produtos.includes(i))) || prods.find(g => /juice\s*protein/i.test(g.nome)) || prods[0] || {}).chave;
    return `<form class="form" id="recForm"><h3>${e.id ? 'Editar automação' : 'Nova automação'}</h3>
      <div class="form-grid">
        <label>Nome<input name="nome" required minlength="3" maxlength="80" value="${ui.esc(e.nome || '')}"></label>
        <label>Produto<select name="produto">${prods.map(g => `<option value="${ui.esc(g.chave)}" ${g.chave === chaveSel ? 'selected' : ''}>${ui.esc(g.nome)}${g.ids.length > 1 ? ` (${g.ids.length} variantes)` : ''}</option>`).join('')}</select></label>
        <label>Nº da lista dedicada no Nuvem Marketing<input name="lista" type="number" min="1" step="1" value="${e.lista || ''}" placeholder="crie a lista no Nuvem Marketing"></label>
        <label>trigger_key do Custom Trigger<input name="trigger" pattern="[a-z0-9_]{1,30}" maxlength="30" value="${ui.esc(e.trigger || '')}" placeholder="ex.: altum_recompra_juice"></label>
        <label>Limite por execução<input name="limite" type="number" min="1" max="100" step="1" value="${e.limite || 25}"></label>
        <label>Intervalo mínimo de reenvio (dias)<input name="intervalo" type="number" min="7" max="365" step="1" value="${e.intervalo || 30}"></label>
      </div>
      <p class="small muted">Mudar produto, lista, trigger ou limites desfaz a aprovação e volta a automação para simulação.</p>
      <div class="btn-row end"><button class="btn btn-ghost" type="button" id="recCancelar">Cancelar</button><button class="btn btn-primary" type="submit" ${rc.ocupado ? 'disabled' : ''}>Salvar</button></div>
    </form>`;
  }
  function cartaoAutomacao(a, p) {
    const execs = p.execucoes.filter(x => x.automacao === a.id);
    const ultSim = execs.find(x => x.modo === 'simulacao' && ['concluida', 'concluida_com_avisos'].includes(x.status));
    const podeReal = a.bloqueiosReal.length === 0;
    const aprovada = a.aprovadaEm ? `Simulação aprovada em ${quando(a.aprovadaEm)}` : 'Sem simulação aprovada';
    const oc = rc.ocupado;
    return `<article class="card-sub recAutomacao" data-id="${ui.esc(a.id)}">
      <div class="integ-head"><h3>${ui.esc(a.nome)}</h3>${ui.badge(a.modo === 'real' ? 'Modo real' : 'Simulação', a.modo === 'real' ? 'warn' : 'muted')}
        ${ui.badge(a.agendamento ? 'Agendamento ligado' : 'Agendamento desligado', a.agendamento ? 'sand' : 'muted')}</div>
      <p class="small">${ui.esc(a.produtosNomes.join(', '))} · lista ${a.lista ? '#' + ui.esc(String(a.lista)) : '<em>não definida</em>'} · trigger ${a.trigger ? `<code>${ui.esc(a.trigger)}</code>` : '<em>não definido</em>'}
        · até ${ui.num(a.limite)} por execução · reenvio após ${ui.num(a.intervalo)} dias · ${ui.esc(aprovada)}</p>
      <p class="small ${podeReal ? '' : 'muted'} recBloqueios">${podeReal ? '<strong>Envio real liberado no banco.</strong> O servidor ainda exige o Secret RECOMPRA_ENVIO_REAL.' : `Envio real bloqueado: ${ui.esc(lista(a.bloqueiosReal, BLOQUEIO))}.`}</p>
      <div class="btn-row">
        <button class="btn btn-primary btn-sm" type="button" data-rec="simular" data-id="${ui.esc(a.id)}" ${oc ? 'disabled' : ''}>${oc === 'simular:' + a.id ? 'Simulando…' : 'Simular agora (nada é enviado)'}</button>
        ${ultSim ? `<button class="btn btn-ghost btn-sm" type="button" data-rec="aprovar" data-id="${ui.esc(a.id)}" data-exec="${ui.esc(ultSim.id)}" ${oc || a.aprovacaoExecucao === ultSim.id ? 'disabled' : ''}>${a.aprovacaoExecucao === ultSim.id ? 'Última simulação aprovada' : 'Aprovar a última simulação'}</button>` : ''}
        ${a.modo === 'real' ? `<button class="btn btn-ghost btn-sm" type="button" data-rec="modo" data-modo="simulacao" data-id="${ui.esc(a.id)}" ${oc ? 'disabled' : ''}>Voltar para simulação</button>`
          : `<button class="btn btn-ghost btn-sm" type="button" data-rec="modo" data-modo="real" data-id="${ui.esc(a.id)}" ${oc || !a.aprovadaEm ? 'disabled' : ''}>Passar para modo real</button>`}
        <button class="btn btn-ghost btn-sm" type="button" data-rec="agenda" data-id="${ui.esc(a.id)}" ${oc ? 'disabled' : ''}>${a.agendamento ? 'Desligar agendamento' : 'Ligar agendamento'}</button>
        <button class="btn btn-danger btn-sm" type="button" data-rec="real" data-id="${ui.esc(a.id)}" ${oc || !podeReal ? 'disabled' : ''}>Executar envio real agora</button>
        <button class="btn btn-ghost btn-sm" type="button" data-rec="editar" data-id="${ui.esc(a.id)}" ${oc ? 'disabled' : ''}>Editar</button>
      </div></article>`;
  }
  function historico(p) {
    if (!p.execucoes.length) return '<p class="muted small">Nenhuma execução ainda.</p>';
    const nome = id => (p.automacoes.find(a => a.id === id) || {}).nome || '—';
    return `<div class="table-wrap"><table id="recHistorico"><thead><tr><th>Início</th><th>Automação</th><th>Modo</th><th>Status</th><th class="num">Candidatos CRM</th>
      <th class="num">Autorizados NM</th><th class="num">Descadastrados/bloqueados NM</th><th class="num">Inconclusivos</th><th class="num">Disparados</th><th>Observação</th><th></th></tr></thead><tbody>
      ${p.execucoes.map(e => { const st = STATUS[e.status] || [e.status, 'muted'];
        const cand = (e.crm.candidato || 0), aut = e.nm.autorizado || 0, desc = (e.nm.descadastrado_nm || 0) + (e.nm.bloqueado_nm || 0), inc = (e.nm.inconclusivo_nm || 0) + (e.nm.nao_auditado || 0);
        const obs = e.bloqueios.length ? 'Bloqueada: ' + lista(e.bloqueios, BLOQUEIO) : e.erro ? (ERRO[e.erro] || e.erro) : (e.api.atividade_202 ? `/activity respondeu 202 ${e.api.atividade_202}× (tratado como não autorizado)` : '');
        return `<tr data-exec="${ui.esc(e.id)}"><td class="nowrap">${ui.esc(quando(e.iniciadaEm))}</td><td>${ui.esc(nome(e.automacao))}</td>
          <td>${e.modo === 'real' ? 'Real' : 'Simulação'}${e.origem === 'agendada' ? ' · agendada' : ''}</td><td>${ui.badge(st[0], st[1])}</td>
          <td class="num">${ui.num(cand)}</td><td class="num">${ui.num(aut)}</td><td class="num">${ui.num(desc)}</td><td class="num">${ui.num(inc)}</td>
          <td class="num">${ui.num(e.acoes.evento_enviado || 0)}${e.acoes.simulada ? ` <span class="muted">(${ui.num(e.acoes.simulada)} simulados)</span>` : ''}</td>
          <td class="small">${ui.esc(obs)}</td><td>${e.bloqueios.length ? '' : `<button class="btn btn-ghost btn-sm" type="button" data-rec="detalhe" data-exec="${ui.esc(e.id)}">Clientes</button>`}</td></tr>`; }).join('')}
    </tbody></table></div>`;
  }
  function detalhe() {
    const d = rc.detalhe; if (!d && !rc.erroDetalhe) return '';
    if (rc.erroDetalhe) return `<p class="aviso-inline">${ui.esc(rc.erroDetalhe)}</p>`;
    return `<div id="recDetalhe"><h3>Clientes da execução de ${ui.esc(quando(d.iniciadaEm))}</h3>
      <div class="table-wrap"><table id="recDetalheTabela"><thead><tr><th>Cliente</th><th>Compra de referência</th><th>CRM</th><th>Nuvem Marketing</th><th>Estado / atividade</th><th>Ação</th></tr></thead><tbody>
      ${d.itens.map(i => { const r = RESULTADO[i.resultado];
        return `<tr><td>${ui.esc(i.cliente)}</td><td class="nowrap">${i.compraRef ? ui.esc(new Date(i.compraRef + 'T12:00:00').toLocaleDateString('pt-BR')) : '—'}</td><td>${ui.esc(ETAPA[i.etapa] || i.etapa || '')}</td>
          <td>${r ? ui.badge(r[0], r[1]) : '<span class="muted">—</span>'}</td>
          <td class="small">${i.resultado ? `${ui.esc(i.contato === 'nao_encontrado' ? 'contato inexistente' : (i.estado || i.contato || '—'))} · ${ui.esc(ATIVIDADE[i.atividade] || '—')}` : ''}</td>
          <td class="small">${ui.esc(ACAO[i.acao] || i.acao || '')}${i.detalhe ? ` <span class="muted">(${ui.esc(i.detalhe)})</span>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div></div>`;
  }

  function secao(admin) {
    if (!admin) return '';
    const p = rc.painel;
    return `<section class="card" id="secaoAutomacaoRecompra">
      <header class="card-head"><h2>Automação de recompra por e-mail</h2>${p ? ui.badge(p.envioRealLiberado ? 'Chave geral LIGADA' : 'Envio real desligado', p.envioRealLiberado ? 'warn' : 'muted') : ''}</header>
      <p class="small">O CRM decide quem pode receber (consentimento de e-mail comprovado, sem descadastro, recusa, oposição ou "não contatar", na janela de reposição, sem envio recente).
        Antes de qualquer sincronização, cada candidato é auditado no Nuvem Marketing: só passa com contato <code>active</code> (ou inexistente) <strong>e</strong> consulta de descadastros com resposta 200 sem evento.
        Resposta <strong>HTTP 202</strong>, estado desconhecido, erro ou limite contam como <strong>não autorizado</strong>. "Ativo" sozinho nunca é consentimento.</p>
      <p class="small muted">Ordem segura: simular → aprovar uma simulação sem avisos → modo real → chave geral → Secret do servidor. A simulação faz só leituras; nada é enviado.</p>
      ${blocoServidor()}
      ${rc.erro ? `<p class="aviso-inline" role="alert" id="recErro">${ui.esc(rc.erro)}</p>` : ''}
      ${rc.erroAcao ? `<p class="aviso-inline" role="alert" id="recErroAcao">${ui.esc(rc.erroAcao)}</p>` : ''}
      ${rc.msg ? `<p class="small kpi-destaque" id="recMsg">${ui.esc(rc.msg)}</p>` : ''}
      ${!p ? `<p class="muted small" aria-busy="${rc.carregando}">${rc.carregando ? 'Carregando…' : ''}</p>` : `
        <div class="btn-row">
          <button class="btn btn-ghost btn-sm" type="button" id="recNova" ${rc.ocupado || !rc.produtos ? 'disabled' : ''}>Nova automação</button>
          <button class="btn btn-ghost btn-sm" type="button" id="recAtualizar" ${rc.carregando ? 'disabled' : ''}>Atualizar</button>
          ${p.envioRealLiberado ? `<button class="btn btn-ghost btn-sm" type="button" id="recChaveDesligar" ${rc.ocupado ? 'disabled' : ''}>Desligar envio real (chave geral)</button>`
            : `<button class="btn btn-danger btn-sm" type="button" id="recChaveLigar" ${rc.ocupado ? 'disabled' : ''}>Ligar envio real (chave geral)</button>`}
        </div>
        <p class="small muted">Eventos de e-mail na última hora: ${ui.num(p.enviosUltimaHora)} de 180 (a Perfit aceita 200/h).</p>
        ${formulario()}
        ${p.automacoes.length ? p.automacoes.map(a => cartaoAutomacao(a, p)).join('') : '<p class="muted small">Nenhuma automação criada.</p>'}
        <h3>Histórico de execuções</h3>${historico(p)}${detalhe()}`}
    </section>`;
  }

  function bind(root) {
    if (!A.session.isAdmin() || !root.querySelector('#secaoAutomacaoRecompra')) return;
    if (!rc.painel && !rc.erro && !rc.carregando) carregar();
    const q = s => root.querySelector(s);
    if (q('#recAtualizar')) q('#recAtualizar').addEventListener('click', carregar);
    if (q('#recServidor')) q('#recServidor').addEventListener('click', async () => {
      rc.erroServidor = null; rc.ocupado = 'servidor'; render();
      try { rc.servidor = await R().recompraEstadoServidor(); } catch (e) { rc.erroServidor = e.message; } finally { rc.ocupado = null; }
      render();
    });
    if (q('#recNova')) q('#recNova').addEventListener('click', () => { rc.edicao = { id: null, nome: 'Juice Protein — recompra', produtos: [], limite: 25, intervalo: 30 }; render(); });
    if (q('#recCancelar')) q('#recCancelar').addEventListener('click', () => { rc.edicao = null; render(); });
    if (q('#recForm')) q('#recForm').addEventListener('submit', ev => {
      ev.preventDefault();
      const f = new FormData(ev.target), g = (rc.produtos || []).find(x => x.chave === f.get('produto'));
      const dados = { id: rc.edicao.id, nome: String(f.get('nome') || '').trim(), produtos: g ? g.ids : [], lista: Number(f.get('lista')) || null,
                      trigger: String(f.get('trigger') || '').trim() || null, limite: Number(f.get('limite')) || 25, intervalo: Number(f.get('intervalo')) || 30 };
      acao('salvar', () => R().recompraSalvarAutomacao(dados), () => { rc.edicao = null; return 'Automação salva. Mudanças de produto, lista, trigger ou limites exigem nova simulação e aprovação.'; });
    });
    if (q('#recChaveLigar')) q('#recChaveLigar').addEventListener('click', ev => {
      if (!confirmar(ev.currentTarget, 'Ligar a chave geral permite envios REAIS das automações em modo real (o servidor ainda exige o Secret RECOMPRA_ENVIO_REAL).')) return;
      acao('chave', () => R().recompraChaveGeral(true), 'Chave geral ligada.');
    });
    if (q('#recChaveDesligar')) q('#recChaveDesligar').addEventListener('click', () => acao('chave', () => R().recompraChaveGeral(false), 'Chave geral desligada: nenhum envio real começa.'));
    root.querySelectorAll('#secaoAutomacaoRecompra [data-rec]').forEach(b => b.addEventListener('click', ev => {
      const t = ev.currentTarget, id = t.dataset.id, p = rc.painel, a = p && p.automacoes.find(x => x.id === id);
      switch (t.dataset.rec) {
        case 'simular': return acao('simular:' + id, () => R().recompraExecutar(id, 'simulacao'), resumoExecucao);
        case 'aprovar': return acao('aprovar', () => R().recompraAprovar(id, t.dataset.exec), 'Simulação aprovada. O modo real já pode ser ativado.');
        case 'modo':
          if (t.dataset.modo === 'real' && !confirmar(t, 'No modo real, as execuções (manuais ou agendadas) sincronizam e disparam e-mails quando a chave geral e o servidor estiverem liberados.')) return;
          return acao('modo', () => R().recompraModo(id, t.dataset.modo, a ? a.agendamento : false), t.dataset.modo === 'real' ? 'Modo real ativado.' : 'Automação de volta à simulação.');
        case 'agenda':
          if (a && !a.agendamento && !confirmar(t, `O agendamento roda esta automação sozinho (no modo ${a.modo === 'real' ? 'REAL' : 'simulação'}) quando o pg_cron estiver ligado.`)) return;
          return acao('agenda', () => R().recompraModo(id, a ? a.modo : 'simulacao', !(a && a.agendamento)), a && a.agendamento ? 'Agendamento desligado.' : 'Agendamento ligado.');
        case 'real':
          if (!confirmar(t, 'Executar o ENVIO REAL agora: os contatos autorizados entram na lista e o Custom Trigger dispara o e-mail.')) return;
          return acao('real:' + id, () => R().recompraExecutar(id, 'real'), resumoExecucao);
        case 'editar':
          rc.edicao = a ? { id: a.id, nome: a.nome, produtos: a.produtos, lista: a.lista, trigger: a.trigger, limite: a.limite, intervalo: a.intervalo } : null; return render();
        case 'detalhe': {
          const ex = p.execucoes.find(x => x.id === t.dataset.exec);
          rc.erroDetalhe = null; rc.detalhe = null; render();
          return R().recompraExecucaoDetalhe(t.dataset.exec).then(itens => { rc.detalhe = { iniciadaEm: ex && ex.iniciadaEm, itens }; }, e => { rc.erroDetalhe = e.message; }).then(render);
        }
        default: return undefined;
      }
    }));
  }

  A.recompraAutomacao = Object.freeze({ secao, bind });
})(window.ALTUM);
