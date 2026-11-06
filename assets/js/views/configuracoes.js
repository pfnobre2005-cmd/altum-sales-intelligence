(function (A) {
  'use strict';
  const { ui } = A;

  // Nuvemshop: teste de conexão + importação (prévia / execução). Estado só em memória; guarda apenas resumos.
  const nuv = { ocupado: null, resultado: null, erro: null, sync: null, erroSync: null, painel: null, erroPainel: null, carregandoPainel: false, ultimaPrevia: null };
  // Nuvem Marketing: só a verificação da chave (nenhum e-mail é enviado). Estado só em memória.
  const nm = { ocupado: false, resultado: null, erro: null };
  const ROTULO_PAGAMENTO = { paid: 'Pago', pending: 'Pendente', authorized: 'Autorizado', abandoned: 'Abandonado',
                             refunded: 'Reembolsado', voided: 'Cancelado', partially_paid: 'Pago parcialmente',
                             partially_refunded: 'Reembolsado parcialmente', outro: 'Outro' };
  const STATUS_PEDIDO = { pago: 'Pago', pendente: 'Pendente', cancelado: 'Cancelado', reembolsado: 'Reembolsado' };
  const MODO = { previa: 'Prévia', execucao: 'Importação', agendada: 'Automática' };
  const SITUACAO = { em_andamento: ['Em andamento', 'sand'], concluida: ['Concluída', 'sage'], concluida_com_avisos: ['Concluída com avisos', 'warn'],
                     falhou: ['Falhou', 'warn'], abandonada: ['Interrompida', 'muted'] };
  const AVISOS = {
    vinculado_sku: a => `Vinculado ao produto cadastrado "${a.nome_anterior || ''}" pelo mesmo SKU (custo, ciclo e histórico preservados).`,
    possivel_duplicado_manual: a => `Não criado: nome parecido com o produto cadastrado "${a.nome_anterior || ''}". ${a.sku ? `Se for o mesmo produto, coloque o SKU "${a.sku}" nele (Tela Produtos)` : 'Cadastre o mesmo SKU na loja e no produto da Tela Produtos'} e sincronize de novo.`,
    sku_de_produto_ficticio: () => 'SKU igual ao de um produto fictício de teste: não importado. Remova os fictícios ou ajuste o SKU.',
    sku_duplicado_na_loja: () => 'SKU repetido em outra variante da loja: importado sem SKU. Corrija na Nuvemshop.',
    sku_em_conflito: () => 'O SKU novo já é usado por outro produto: mantido o SKU anterior.',
    sku_invalido: () => 'SKU inválido na loja (muito longo): importado sem SKU.',
    preco_invalido: () => 'Preço inválido na loja: importado sem preço.',
    produto_sem_nome: () => 'Produto sem nome na loja: não importado.',
    produto_sem_id: () => 'Produto sem identificação: não importado.',
    id_em_produto_ficticio: () => 'Identificação ligada a produto fictício: não importado.',
    cliente_sem_nome: () => 'Cliente sem nome na loja: não importado (os pedidos dele também ficam de fora).',
    cliente_sem_id: () => 'Cliente sem identificação: não importado.',
    email_invalido: () => 'E-mail inválido na loja: importado sem e-mail.',
    telefone_invalido: () => 'Telefone inválido na loja: importado sem telefone.',
    id_em_cliente_ficticio: () => 'Identificação ligada a cliente fictício: não importado.',
    status_desconhecido: () => 'Status de pagamento desconhecido: pedido não importado.',
    pedido_sem_data: () => 'Pedido sem data: não importado.',
    pedido_sem_cliente: () => 'Pedido sem cliente: não importado.',
    valores_invalidos: () => 'Valores inválidos no pedido: não importado.',
    item_invalido: () => 'Item com quantidade ou preço inválido: pedido não importado.',
    cliente_indisponivel: () => 'Cliente suprimido a pedido do titular, anonimizado ou não importado: pedido não importado.',
    item_sem_produto: () => 'Item sem produto correspondente (produto apagado ou ainda não importado): pedido importado, item sem vínculo.',
    parcialmente_reembolsado: () => 'Reembolso parcial: o pedido continua como pago pelo valor total. Confira na loja.',
    frete_nao_informado: () => 'Frete não informado pela loja: registrado como zero.',
    id_em_pedido_nao_nuvemshop: () => 'Identificação já usada por um pedido que não é da loja: não importado.'
  };
  const textoAviso = a => (AVISOS[a.codigo] ? AVISOS[a.codigo](a) : /^banco_/.test(a.codigo || '') ? `Recusado por uma regra do banco (${a.codigo.slice(6)}).` : `Aviso: ${a.codigo || '—'}.`);
  const alvoAviso = a => (a.entidade === 'produto' ? `Produto${a.nome ? ` "${a.nome}"` : ''}${a.sku ? ` · SKU ${a.sku}` : ''}`
                         : a.entidade === 'cliente' ? `Cliente nº ${a.id} da loja` : `Pedido (ID ${a.id} na loja)`);
  const n0 = v => ui.num(Number(v) || 0);
  const dataHora = ts => (ts ? new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

  function quadroContadores(c) {
    const p = c.produtos || {}, cl = c.clientes || {}, o = c.pedidos || {};
    const linha = (nome, x, extras) => `<tr><th scope="row">${nome}</th><td class="num">${n0(x.novos)}</td><td class="num">${n0(x.atualizados)}</td><td class="num">${n0(x.inalterados)}</td>
      <td>${extras.filter(([, v]) => Number(v) > 0).map(([l, v]) => `${l}: <strong>${n0(v)}</strong>`).join(' · ') || '—'}</td>
      <td class="num">${n0(x.conflitos)}</td><td class="num">${n0(x.erros)}</td></tr>`;
    const status = Object.entries(o.por_status || {}).map(([k, v]) => `${STATUS_PEDIDO[k] || k}: <strong>${n0(v)}</strong>`).join(' · ');
    return `<div class="table-wrap"><table class="tabela-sync" id="nuvemshopContadores"><thead><tr><th></th><th class="num">Novos</th><th class="num">Atualizados</th><th class="num">Sem mudança</th><th>Observações</th><th class="num">Conflitos</th><th class="num">Erros</th></tr></thead><tbody>
      ${linha('Produtos', p, [['vinculados por SKU', p.vinculados_sku], ['itens de pedido religados', p.itens_religados]])}
      ${linha('Clientes', cl, [['contato suprimido (não importado)', cl.suprimidos]])}
      ${linha('Pedidos', o, [['cliente indisponível', o.cliente_indisponivel], ['suprimidos', o.suprimidos], ['mudaram de status', o.mudaram_de_status], ['itens sem produto', o.itens_sem_produto], ['reembolso parcial', o.parcialmente_reembolsados]])}
      </tbody></table></div>
      ${status ? `<p class="small">Pedidos por status: ${status}. Faturamento considera só os pagos.</p>` : ''}
      ${c.marketing ? `<p class="small" id="nuvemshopNewsletter">Newsletter (e-mail): ${[['inscrições registradas', c.marketing.concedidas], ['cancelamentos registrados', c.marketing.revogadas],
          ['pendentes de comprovação', c.marketing.pendentes_sem_comprovacao], ['cancelamentos não aplicados', c.marketing.revogacoes_nao_aplicadas],
          ['recusa ou supressão anterior', c.marketing.conflitos], ['erros', c.marketing.erros]].filter(([, v]) => Number(v) > 0).map(([l, v]) => `${l}: <strong>${n0(v)}</strong>`).join(' · ') || 'nenhuma mudança'}.
        <span class="muted">Só vira permissão de e-mail com a data da inscrição e o texto da newsletter da loja cadastrado antes dela. WhatsApp não é alterado.</span></p>` : ''}
      ${Number(p.novos) > 0 ? `<p class="small muted">${n0(p.novos)} produto(s) novo(s) chegam sem ciclo de recompra: defina o ciclo na <a href="#/produtos" class="link">Tela Produtos</a> para gerar oportunidades.</p>` : ''}`;
  }

  function blocoSync() {
    if (nuv.erroSync) return `<div class="auth-msg auth-msg-erro" role="alert" id="nuvemshopSyncErro">${ui.esc(nuv.erroSync)}</div>`;
    const d = nuv.sync;
    if (!d) return '';
    const l = d.lidos || {};
    const avisos = Array.isArray(d.avisos) ? d.avisos : [];
    return `<div class="${d.simulacao ? 'nuvemshop-previa' : 'nuvemshop-ok'}" role="status" id="nuvemshopSyncResultado">
      <p><strong>${d.simulacao ? 'Prévia — nada foi gravado' : 'Importação concluída'}</strong>
        <span class="muted small">· ${d.incremental ? 'só o que mudou desde a última importação' : 'leitura completa da loja'} · lidos da loja: ${n0(l.produtos)} produtos (${n0(l.variantes)} variantes), ${n0(l.clientes)} clientes${Number(l.clientes_via_pedido) > 0 ? ` + ${n0(l.clientes_via_pedido)} só nos pedidos` : ''}, ${n0(l.pedidos)} pedidos</span></p>
      ${quadroContadores(d.contadores || {})}
      ${avisos.length ? `<details class="historico" ${d.simulacao ? 'open' : ''}><summary>Avisos (${n0(avisos.length)}${Number(d.contadores && d.contadores.avisos_total) > avisos.length ? ` de ${n0(d.contadores.avisos_total)}` : ''})</summary>
        <ul class="list-plain" id="nuvemshopAvisos">${avisos.map(a => `<li><strong>${ui.esc(alvoAviso(a))}</strong><small class="block">${ui.esc(textoAviso(a))}</small></li>`).join('')}</ul></details>` : ''}
      ${d.simulacao ? '<p class="small">Se estiver tudo certo, use <strong>Sincronizar agora</strong>. Produtos em conflito não são criados; corrija e sincronize de novo quando quiser.</p>' : ''}
    </div>`;
  }

  function blocoPainel() {
    if (nuv.erroPainel) return `<p class="small aviso-inline" id="nuvemshopPainelErro">${ui.esc(nuv.erroPainel)}</p>`;
    const p = nuv.painel;
    if (!p) return '<p class="small muted" aria-busy="true">Carregando o histórico de importações…</p>';
    const e = p.estado;
    const execs = p.execucoes || [];
    return `<dl class="resumo-recompra" id="nuvemshopEstado">
        <div><dt>Loja</dt><dd>${e ? ui.esc(String(e.loja_id)) : '—'}</dd></div>
        <div><dt>Última importação</dt><dd>${e && e.ultima_sincronizacao_em ? dataHora(e.ultima_sincronizacao_em) : 'Ainda não houve importação'}</dd></div>
        <div><dt>Atualização automática</dt><dd>${e && e.agendamento_ativo ? ui.badge('Ligada', 'sage') : ui.badge('Desligada', 'muted')}<small class="block muted">${e && e.agendamento_ativo ? 'roda no servidor, sem depender do navegador' : 'será ligada depois de validarmos a 1ª importação'}</small></dd></div>
      </dl>
      ${execs.length ? `<details class="historico"><summary>Últimas execuções (${n0(execs.length)})</summary><div class="table-wrap"><table id="nuvemshopHistorico"><thead><tr><th>Início</th><th>Tipo</th><th>Situação</th><th>Resumo</th></tr></thead><tbody>
        ${execs.map(x => { const c = x.contadores || {}; const s = SITUACAO[x.status] || [x.status, 'neutral'];
          const res = x.status === 'falhou' || x.status === 'abandonada' ? ui.esc(x.erro_codigo || '—')
            : `${n0((c.produtos || {}).novos)} produtos novos · ${n0((c.clientes || {}).novos)} clientes novos · ${n0((c.pedidos || {}).novos)} pedidos novos · ${n0((c.pedidos || {}).atualizados)} pedidos atualizados`;
          return `<tr><td class="nowrap">${dataHora(x.iniciada_em)}</td><td>${ui.esc(MODO[x.modo] || x.modo)}</td><td>${ui.badge(s[0], s[1])}</td><td class="small">${res}</td></tr>`; }).join('')}
      </tbody></table></div></details>` : '<p class="small muted">Nenhuma prévia ou importação registrada ainda.</p>'}`;
  }

  function secaoNuvemshop(admin) {
    let teste = '';
    if (nuv.erro) {
      teste = `<div class="auth-msg auth-msg-erro" role="alert" id="nuvemshopErro">${ui.esc(nuv.erro)}</div>`;
    } else if (nuv.resultado) {
      const r = nuv.resultado;
      const hora = r.em.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      teste = `<div class="nuvemshop-ok" role="status" id="nuvemshopResultado">
          <p><strong>Conexão bem-sucedida</strong> <span class="muted small">· testada às ${hora}</span></p>
          ${r.reconhecido ? `<p>Pedidos retornados pela consulta: <strong id="nuvemshopQtd">${r.pedidos === null ? '—' : ui.num(r.pedidos)}</strong></p>
            ${r.status.length ? `<ul class="list-plain" id="nuvemshopStatus">${r.status.map(s => `<li>${ui.esc(ROTULO_PAGAMENTO[s.status] || s.status)}: <strong>${ui.num(s.n)}</strong></li>`).join('')}</ul>`
                             : '<p class="small muted" id="nuvemshopStatus">A resposta não trouxe status de pagamento.</p>'}`
            : '<p class="small muted">A função respondeu, mas em um formato sem quantidade de pedidos reconhecível. Nada foi exibido por segurança.</p>'}
        </div>`;
    }
    const oc = nuv.ocupado;
    const dis = oc ? 'disabled aria-busy="true"' : '';
    return `<section class="card" id="secaoNuvemshop">
        <header class="card-head"><h2>Nuvemshop</h2>${ui.badge('Importação pelo administrador', 'sand')}</header>
        <p class="small">Importa produtos (com variantes), clientes e pedidos da loja pelo servidor do Supabase — o token da loja nunca passa pelo navegador.
          <strong>Nada é alterado na Nuvemshop</strong> (só leitura). Os dados fictícios de teste continuam separados. As preferências de e-mail marketing da Newsletter são sincronizadas somente com data e texto de consentimento comprovados. WhatsApp não é autorizado automaticamente.</p>
        ${admin ? `${blocoPainel()}
          <div class="btn-row">
            <button class="btn btn-ghost" type="button" id="testarNuvemshop" ${dis}>${oc === 'teste' ? 'Testando…' : 'Testar conexão'}</button>
            <button class="btn btn-ghost" type="button" id="previaNuvemshop" ${dis}>${oc === 'previa' ? 'Pré-visualizando…' : 'Pré-visualizar importação'}</button>
            <button class="btn btn-primary" type="button" id="sincronizarNuvemshop" ${dis}>${oc === 'execucao' ? 'Sincronizando…' : 'Sincronizar agora'}</button>
          </div>
          ${oc === 'previa' || oc === 'execucao' ? '<p class="small muted" id="nuvemshopAguarde">Lendo a loja e gravando no banco. Pode levar alguns minutos; não feche esta aba.</p>' : ''}
          ${teste}${blocoSync()}`
        : '<p class="muted small" id="nuvemshopSoAdmin">O teste de conexão e a importação são restritos a administradores.</p>'}
      </section>`;
  }

  const naTela = () => A.router.parse().name === 'configuracoes';

  async function carregarPainel() {
    if (nuv.carregandoPainel || !A.session.isAdmin()) return;
    nuv.carregandoPainel = true;
    try { nuv.painel = await A.repositorio.nuvemshopPainel(); nuv.erroPainel = null; }
    catch (e) { nuv.erroPainel = (e && e.message) || 'Não foi possível ler o histórico de importações.'; }
    finally { nuv.carregandoPainel = false; }
    if (naTela()) A.router.render();
  }

  async function testar() {
    if (nuv.ocupado || !A.session.isAdmin()) return;
    nuv.ocupado = 'teste'; nuv.erro = null; nuv.resultado = null;
    if (naTela()) A.router.render();
    try { nuv.resultado = await A.repositorio.testarNuvemshop(); }
    catch (e) { nuv.erro = (e && e.message) || 'Erro inesperado ao testar a conexão.'; }
    finally { nuv.ocupado = null; }
    if (naTela()) A.router.render();
  }

  async function verificarNuvemMarketing() {
    if (nm.ocupado || !A.session.isAdmin()) return;
    nm.ocupado = true; nm.erro = null; nm.resultado = null;
    if (naTela()) A.router.render();
    try { nm.resultado = await A.repositorio.nuvemMarketingVerificar(); }
    catch (e) { nm.erro = (e && e.message) || 'Erro inesperado ao verificar o Nuvem Marketing.'; }
    finally { nm.ocupado = false; }
    if (naTela()) A.router.render();
  }
  function blocoNuvemMarketing(admin) {
    if (!admin) return '';
    const r = nm.resultado;
    return `<div class="btn-row"><button class="btn btn-ghost btn-sm" type="button" id="verificarNuvemMarketing" ${nm.ocupado ? 'disabled' : ''}>${nm.ocupado ? 'Verificando…' : 'Verificar Nuvem Marketing'}</button></div>
      <p class="small" id="resultadoNuvemMarketing" role="status" aria-live="polite">${
        nm.erro ? `<span class="aviso-inline">${ui.esc(nm.erro)}</span>`
        : r ? `${r.configurada ? ui.badge('Chave encontrada', 'sage') + ' no Supabase.' : 'Chave não encontrada.'} Envio de e-mail: <strong>${r.envioHabilitado ? 'ligado' : 'desligado'}</strong>. <span class="muted">Verificado às ${r.em.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.</span>`
        : '<span class="muted">Confere só se a chave do Nuvem Marketing está nos segredos do Supabase. Nada é enviado.</span>'}</p>`;
  }

  async function sincronizar(modo) {
    if (nuv.ocupado || !A.session.isAdmin()) return;
    nuv.ocupado = modo; nuv.erroSync = null; nuv.sync = null;
    if (naTela()) A.router.render();
    try {
      nuv.sync = await A.repositorio.nuvemshopSincronizar(modo);
      if (modo === 'previa') nuv.ultimaPrevia = nuv.sync;
      else ui.toast('Importação concluída. Dashboard, Clientes, Produtos e Recompra já usam os dados novos.');
    } catch (e) { nuv.erroSync = (e && e.message) || 'Erro inesperado na importação.'; }
    finally { nuv.ocupado = null; }
    carregarPainel();
    if (naTela()) A.router.render();
  }

  function confirmarSincronizacao() {
    if (nuv.ocupado) return;
    const pv = nuv.ultimaPrevia;
    const c = pv && pv.contadores;
    ui.modal(`<h2>Sincronizar agora?</h2>
      <p>Os produtos, clientes e pedidos da Nuvemshop serão gravados no banco. Executar de novo não duplica nada.</p>
      <ul class="list-plain small">
        <li>Produtos com o mesmo SKU de um produto cadastrado são <strong>vinculados</strong> a ele (custo, ciclo e histórico preservados).</li>
        <li>Produtos em conflito não são criados; o restante segue normalmente.</li>
        <li>Consentimentos de e-mail da Newsletter podem ser registrados automaticamente quando há comprovação válida; WhatsApp não é autorizado. Nada é alterado na loja.</li>
      </ul>
      ${c ? `<p class="small">Última prévia: <strong>${n0(c.produtos && c.produtos.novos)}</strong> produtos novos, <strong>${n0(c.produtos && c.produtos.vinculados_sku)}</strong> vinculados por SKU,
        <strong>${n0(c.clientes && c.clientes.novos)}</strong> clientes novos, <strong>${n0(c.pedidos && c.pedidos.novos)}</strong> pedidos novos,
        <strong>${n0((c.produtos && c.produtos.conflitos) || 0)}</strong> conflitos.</p>`
           : '<p class="small aviso-inline" id="semPrevia">Recomendado: faça antes a <strong>pré-visualização</strong> para conferir vínculos e conflitos.</p>'}
      <div class="btn-row end"><button class="btn btn-ghost" data-close type="button">Cancelar</button>
        <button class="btn btn-primary" type="button" id="confirmarSincronizacao">Sincronizar agora</button></div>`,
    m => m.querySelector('#confirmarSincronizacao').addEventListener('click', () => { ui.closeModal(); sincronizar('execucao'); }));
  }

  // Configurações verdadeiras: a tela nunca usa A.store.db.regras para valores reais.
  const reais = { dados: null, erro: null, carregando: false, salvando: false };
  async function carregarRegras() {
    if (reais.carregando || reais.salvando) return;
    reais.carregando = true;
    reais.erro = null;
    try { reais.dados = await A.repositorio.regrasReais(); }
    catch (e) { reais.dados = null; reais.erro = e.message || 'Falha ao carregar regras reais.'; }
    finally { reais.carregando = false; }
    if (naTela()) A.router.render();
  }
  async function gravarRegras(form) {
    if (reais.salvando || !A.session.isAdmin() || !reais.dados) return;
    const botao = form.querySelector('button[type="submit"]');
    const fd = new FormData(form);
    const valores = {};
    for (const k of ['inativoAposDias', 'fidelidadeMinPedidos', 'janelaAntesDias', 'janelaDepoisDias']) {
      const bruto = String(fd.get(k) || '').trim();
      if (!/^\d+$/.test(bruto)) { ui.toast('Informe números inteiros em todos os campos.'); return; }
      valores[k] = Number(bruto);
    }
    reais.salvando = true;
    if (botao) { botao.disabled = true; botao.textContent = 'Salvando…'; }
    try {
      await A.repositorio.salvarRegrasReais(reais.dados, valores);
      // Leitura posterior confirma que a alteração persistiu no servidor.
      const conferidas = await A.repositorio.regrasReais();
      if (Object.keys(valores).some(k => conferidas[k] !== valores[k]))
        throw new Error('Não foi possível confirmar os valores gravados. Atualize a página e confira as regras.');
      reais.dados = conferidas;
      reais.erro = null;
      ui.toast('Regras reais salvas e confirmadas no Supabase.');
      window.dispatchEvent(new CustomEvent('altum:dados-alterados', { detail: { origem: 'configuracoes' } }));
    } catch (e) {
      reais.erro = e.message || 'Não foi possível salvar as regras no Supabase.';
      ui.toast(reais.erro);
    } finally {
      reais.salvando = false;
      if (naTela()) A.router.render();
    }
  }

  A.views.configuracoes = {
    title: 'Integrações & dados',
    render() {
      const db = A.store.db, admin = A.session.isAdmin(), r = reais.dados;
      const dis = admin ? '' : 'disabled';
      return `
      <section class="grid-3">
        <article class="card integ"><div class="integ-head"><h3>Supabase</h3>${ui.badge('Conectado', 'sage')}</div>
          <p class="small">Login com duas etapas, permissões e dados reais do Supabase para todos os módulos comerciais.</p></article>
        <article class="card integ"><div class="integ-head"><h3>Nuvemshop</h3>${ui.badge(nuv.painel && nuv.painel.estado && nuv.painel.estado.agendamento_ativo ? 'Automática ligada' : 'Automação desligada / verificando', nuv.painel && nuv.painel.estado && nuv.painel.estado.agendamento_ativo ? 'sage' : 'sand')}</div>
          <p class="small">Produtos, clientes, pedidos e preferências de e-mail da Newsletter via API oficial, somente leitura. Verifique o status e o histórico da sincronização abaixo.</p></article>
        <article class="card integ"><div class="integ-head"><h3>WhatsApp / e-mail</h3>${ui.badge('Fora da V1', 'muted')}</div>
          <p class="small">Sem disparo automático na primeira versão. Futuro: somente soluções oficiais, com consentimento e descadastro.</p>
          ${blocoNuvemMarketing(admin)}</article>
      </section>

      ${secaoNuvemshop(admin)}

      <section class="card">
        <header class="card-head"><h2>Base local de teste — NÃO é backup do Supabase</h2>${ui.badge('Dados fictícios', 'warn')}</header>
        <p>${ui.esc(db.meta.aviso)} Gerada em ${ui.date(db.meta.geradoEm)}: ${db.clientes.length} clientes, ${db.pedidos.length} pedidos, ${db.leads.length} contatos no funil. Fica salva apenas neste navegador.</p>
        <div class="btn-row">
          <button class="btn btn-ghost" id="exportAll">Exportar dados FICTÍCIOS (JSON)</button>
          <button class="btn btn-danger" id="resetDb" ${dis}>Recriar base fictícia</button>
        </div>
        ${admin ? '' : '<p class="muted small">Recriar a base é restrito ao administrador.</p>'}
      </section>

      <section class="grid-2">
        <article class="card" id="regrasReais">
          <header class="card-head"><h2>Regras de segmentação — Supabase REAL</h2>${ui.badge('Supabase', 'sage')}</header>
          ${reais.erro ? `<p class="aviso-inline" role="alert">${ui.esc(reais.erro)}</p>` : ''}
          ${!r ? `<p class="muted small" aria-busy="${reais.carregando}">Regras indisponíveis até confirmar a leitura do banco.</p><button class="btn btn-ghost" id="recarregarRegras" type="button">Tentar novamente</button>` : `
          <form id="rulesForm" class="form">
            <div class="form-grid">
              <label>Inativo após (dias sem pedido)<input type="number" min="15" max="720" step="1" required name="inativoAposDias" value="${r.inativoAposDias}" ${dis}></label>
              <label>Fidelização a partir de (pedidos)<input type="number" min="2" max="20" step="1" required name="fidelidadeMinPedidos" value="${r.fidelidadeMinPedidos}" ${dis}></label>
              <label>Janela: dias antes da reposição<input type="number" min="0" max="60" step="1" required name="janelaAntesDias" value="${r.janelaAntesDias}" ${dis}></label>
              <label>Janela: dias depois da reposição<input type="number" min="0" max="120" step="1" required name="janelaDepoisDias" value="${r.janelaDepoisDias}" ${dis}></label>
            </div>
            ${admin ? '<div class="btn-row end"><button class="btn btn-ghost" id="recarregarRegras" type="button">Atualizar do banco</button><button class="btn btn-primary" type="submit">Salvar regras reais</button></div>' : '<p class="small muted">Somente administradores podem alterar estas regras.</p>'}
          </form>`}
          <p class="small muted">As regras impactam Dashboard, segmentação, Inteligência e oportunidades de recompra. A gravação exige administrador com MFA.</p>
        </article>
        <article class="card">
          <header class="card-head"><h2>Ciclo de recompra por produto</h2></header>
          <p class="small">Os ciclos reais são editados individualmente na <a class="link" href="#/produtos">Tela Produtos</a>, com os custos e históricos preservados.</p>
          <p class="muted small">Revise os produtos importados que ainda estão com 15 dias ou sem ciclo. Não use os valores fictícios desta tela.</p>
          <a class="btn btn-ghost" href="#/produtos">Abrir Produtos</a>
        </article>
      </section>

      <section class="card">
        <header class="card-head"><h2>Registro local dos dados fictícios</h2><span class="muted small">não é auditoria do Supabase</span></header>
        ${admin ? `<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Perfil</th><th>Ação</th><th>Detalhe</th></tr></thead><tbody>
          ${db.auditoria.slice(0, 50).map(a => `<tr><td class="nowrap">${new Date(a.data).toLocaleString('pt-BR')}</td><td>${ui.esc(a.usuario)}</td><td>${ui.esc(a.acao)}</td><td>${ui.esc(a.detalhe)}</td></tr>`).join('')}
        </tbody></table></div>` : ui.empty('Visível apenas para administradores.')}
      </section>`;
    },
    bind(root) {
      const tn = root.querySelector('#testarNuvemshop');
      if (tn) tn.addEventListener('click', testar);
      const vm = root.querySelector('#verificarNuvemMarketing');
      if (vm) vm.addEventListener('click', verificarNuvemMarketing);
      const pv = root.querySelector('#previaNuvemshop');
      if (pv) pv.addEventListener('click', () => sincronizar('previa'));
      const sn = root.querySelector('#sincronizarNuvemshop');
      if (sn) sn.addEventListener('click', confirmarSincronizacao);
      if (A.session.isAdmin() && !nuv.painel && !nuv.erroPainel && !nuv.carregandoPainel) carregarPainel();
      root.querySelector('#exportAll').addEventListener('click', () => {
        ui.download(`altum-si-backup-${A.analytics.iso(new Date())}.json`, A.store.exportJSON());
        A.store.audit('Backup exportado', 'Arquivo JSON completo');
      });
      const rs = root.querySelector('#resetDb');
      if (rs && A.session.isAdmin()) rs.addEventListener('click', () => {
        ui.modal(`<h2>Recriar a base fictícia?</h2><p>Todas as alterações feitas nos dados de teste (contatos, campanhas, interações) serão perdidas.</p>
          <div class="btn-row end"><button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-danger" id="confReset">Recriar</button></div>`,
        m => m.querySelector('#confReset').addEventListener('click', () => { A.store.reset(); ui.closeModal(); ui.toast('Base fictícia recriada.'); A.router.render(); }));
      });
      if (!reais.dados && !reais.erro && !reais.carregando) carregarRegras();
      const rec = root.querySelector('#recarregarRegras');
      if (rec) rec.addEventListener('click', carregarRegras);
      const rf = root.querySelector('#rulesForm');
      if (rf && A.session.isAdmin()) rf.addEventListener('submit', e => { e.preventDefault(); gravarRegras(rf); });
    }
  };
})(window.ALTUM);
