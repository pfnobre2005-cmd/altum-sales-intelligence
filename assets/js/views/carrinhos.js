/* ALTUM Sales Intelligence — Carrinhos abandonados (0.15.0, migração 021 + Edge Function nuvemshop-carrinhos)
 * Fonte: Nuvemshop, API oficial GET /checkouts (somente leitura; só os últimos 30 dias ficam disponíveis na loja).
 * Recuperação só com VÍNCULO DOCUMENTAL (mesmo número coerente, ou cupom exclusivo com um único carrinho candidato).
 * Compra posterior do mesmo cliente aparece SEPARADA, sem atribuição, e nunca entra na receita recuperada.
 * Métricas das automações do Nuvem Marketing: NÃO disponíveis pela API oficial — a tela diz isso e não estima.
 * Nada é enviado a clientes e nenhuma automação é criada ou alterada. Nenhum e-mail aparece na tela.
 */
(function (A) {
  'use strict';
  const { ui } = A;
  const R = () => A.repositorio;
  const est = { dias: 30, painel: null, erro: null, carregando: false, g: 0, ocupado: null, msg: null, erroAcao: null, verificacao: null };
  const naTela = () => A.router.parse().name === 'carrinhos';
  const render = () => { if (naTela()) A.router.render(); };

  const RESULTADO = {
    mesmo_pedido: 'Recuperado: pedido com o mesmo número do carrinho (e-mail, data e produto coerentes)',
    cupom_recuperacao: 'Recuperado: cupom exclusivo da recuperação, com um único carrinho candidato',
    compra_posterior_mesmo_produto: 'Compra posterior do mesmo produto (sem atribuição comprovada)',
    compra_posterior_outro_produto: 'Compra posterior de outro produto (sem atribuição comprovada)', nao_convertido: 'Não convertido',
    concluido_sem_pedido_vinculado: 'Marcado como concluído pela loja, sem pedido vinculado', sem_email: 'Sem e-mail (não dá para ligar a pedidos)',
  };
  const DIA = { 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb', 7: 'Dom' };
  const SYNC = { em_andamento: ['Em andamento', 'sand'], concluida: ['Concluída', 'sage'], concluida_com_avisos: ['Concluída com avisos', 'warn'],
                 falhou: ['Falhou', 'warn'], abandonada: ['Interrompida', 'muted'] };
  const n = v => Number(v) || 0;
  const quando = d => (d ? new Date(d).toLocaleString('pt-BR') : '—');
  const pct = (a, b) => (b > 0 ? a / b : NaN);

  async function carregar() {
    const g = ++est.g; est.carregando = true; est.erro = null; render();
    try { const p = await R().carrinhosPainel(est.dias); if (g === est.g) est.painel = p; }
    catch (e) { if (g === est.g) est.erro = (e && e.message) || 'Não foi possível ler os carrinhos.'; }
    finally { if (g === est.g) est.carregando = false; }
    render();
  }
  async function acao(nome, fn, sucesso) {
    if (est.ocupado) return;
    est.ocupado = nome; est.msg = null; est.erroAcao = null; render();
    try { const r = await fn(); est.msg = typeof sucesso === 'function' ? sucesso(r) : sucesso; }
    catch (e) { est.erroAcao = (e && e.message) || 'Erro inesperado.'; }
    finally { est.ocupado = null; }
    await carregar();
  }

  // ---------- recomendações objetivas (só a partir dos números do banco; nada estimado) ----------
  function recomendacoes(p) {
    const k = p.kpis, out = [];
    const ab = n(k.abandonados), rec = n(k.recuperados_evidencia), post = n(k.compra_posterior_sem_evidencia);
    if (ab === 0) return [{ tom: 'muted', txt: 'Nenhum carrinho abandonado no período. Confira a última leitura e se o agendamento está ligado.' }];
    if (ab < 10) out.push({ tom: 'muted', txt: `Só ${ab} carrinho(s) no período: use as conclusões abaixo com cautela.` });
    if (post > rec) out.push({ tom: 'warn', txt: `${post} compra(s) aconteceram depois do abandono sem atribuição comprovada, contra ${rec} recuperação(ões) com vínculo documental. Para medir a recuperação de verdade, use na automação existente do Nuvem Marketing um cupom exclusivo da recuperação e cadastre-o aqui (não é preciso recriar a automação).` });
    const tot = n(k.compras_total), cedo = n(k.compras_em_ate_3h);
    if (tot >= 3 && cedo / tot >= 0.5) out.push({ tom: 'sand', txt: `${ui.pct(cedo / tot, 0)} das compras após o abandono aconteceram em menos de 3 h — antes do 1º e-mail da automação (intervalos de ~3 h). Essas compras não devem ser creditadas à automação; avalie com a equipe o horário do 1º envio.` });
    const prods = (p.por_produto || []).filter(x => n(x.carrinhos) >= 3);
    const pior = prods.filter(x => n(x.recuperados_evidencia) + n(x.compra_posterior) === 0).sort((a, b) => n(b.valor) - n(a.valor))[0];
    if (pior) out.push({ tom: 'warn', txt: `"${pior.produto}" soma ${ui.brl(n(pior.valor))} em ${ui.num(n(pior.carrinhos))} carrinhos sem nenhuma compra posterior: revise preço, frete, estoque e a página do produto.` });
    const fr = p.frete || {};
    if (fr.carrinhos_pct_medio !== null && fr.pedidos_pagos_pct_medio !== null && n(fr.carrinhos_pct_medio) - n(fr.pedidos_pagos_pct_medio) >= 3)
      out.push({ tom: 'warn', txt: `O frete pesa mais nos carrinhos abandonados (${String(fr.carrinhos_pct_medio).replace('.', ',')}% do total) do que nos pedidos pagos (${String(fr.pedidos_pagos_pct_medio).replace('.', ',')}%): teste frete grátis a partir de um valor ou deixe o frete visível antes do checkout.` });
    const gw = (p.por_gateway || [])[0];
    if (gw && n(gw.carrinhos) >= 5 && n(gw.carrinhos) / ab >= 0.6 && n(gw.recuperados_evidencia) === 0 && gw.gateway !== 'nao_informado')
      out.push({ tom: 'sand', txt: `${ui.pct(n(gw.carrinhos) / ab, 0)} dos abandonos estavam com o meio de pagamento "${gw.gateway}": confira a etapa de pagamento (opções, parcelamento, erros).` });
    const cp = p.cupom || {};
    if (n(cp.com_cupom) >= 3) out.push({ tom: 'sand', txt: `${ui.num(n(cp.com_cupom))} carrinho(s) tinham cupom aplicado e mesmo assim foram abandonados: o desconto não parece ser a barreira principal.` });
    const horas = Object.entries(p.por_hora || {}).sort((a, b) => n(b[1]) - n(a[1]));
    if (horas.length && ab >= 10) out.push({ tom: 'muted', txt: `Pico de abandonos às ${horas[0][0]}h (${ui.num(n(horas[0][1]))} carrinhos): bom horário para a equipe acompanhar a loja e o atendimento.` });
    if (n(k.clientes_reincidentes) >= 3) out.push({ tom: 'sand', txt: `${ui.num(n(k.clientes_reincidentes))} pessoas abandonaram mais de uma vez: são boas candidatas a atendimento consultivo — sempre pelo canal autorizado.` });
    if (n(k.com_email) / ab < 0.7) out.push({ tom: 'muted', txt: `${ui.pct(1 - n(k.com_email) / ab, 0)} dos carrinhos vieram sem e-mail e não podem ser ligados a pedidos.` });
    if (n(k.nao_convertidos)) out.push({ tom: 'muted', txt: `${ui.num(n(k.nao_convertidos))} carrinho(s) sem compra somam ${ui.brl(n(k.valor_nao_convertido))}. A automação do Nuvem Marketing já envia os e-mails: não repita o e-mail; contato humano só pelo canal autorizado (veja as oportunidades).` });
    return out;
  }

  function blocoAdmin(p) {
    const c = p ? p.cobertura : null, oc = est.ocupado, v = est.verificacao;
    return `<section class="card" id="carrinhosAdmin"><header class="card-head"><h2>Leitura dos carrinhos (Nuvemshop)</h2>
        ${c ? ui.badge(c.agendamento_ativo ? 'Atualização automática ligada' : 'Atualização automática desligada', c.agendamento_ativo ? 'sage' : 'muted') : ''}</header>
      <p class="small">Somente leitura na loja (GET /checkouts). Nada é enviado a clientes e o Nuvem Marketing não é tocado.
        ${c && !c.agendamento_ativo ? 'Para atualizar sozinho pelo Supabase (de hora em hora), rode <code>supabase/agendamento/ligar_carrinhos.sql</code> depois da 1ª leitura.' : ''}</p>
      <div class="btn-row">
        <button class="btn btn-ghost btn-sm" type="button" id="carVerificar" ${oc ? 'disabled' : ''}>${oc === 'verificar' ? 'Verificando…' : 'Verificar acesso à API'}</button>
        <button class="btn btn-primary btn-sm" type="button" id="carSincronizar" ${oc ? 'disabled' : ''}>${oc === 'sincronizar' ? 'Lendo…' : 'Ler carrinhos agora'}</button>
      </div>
      ${v ? `<p class="small" id="carVerificacao">${v.permitido ? `${ui.badge('Acesso confirmado', 'sage')} O token da loja lê carrinhos abandonados (função ${ui.esc(v.versao)}). ${v.haCarrinhos ? `Campos recebidos: ${ui.esc(v.campos.join(', '))}.` : 'Nenhum carrinho nos últimos 30 dias.'}`
            : `${ui.badge('Sem acesso', 'warn')} ${ui.esc(v.mensagem || v.erro || '')}`}</p>` : ''}
      ${c ? `<form class="form" id="carConfig"><div class="form-grid">
          <label>Janela para ligar compra ao carrinho (dias)<input type="number" name="janela" min="1" max="30" step="1" value="${n(c.janela_conversao_dias) || 7}"></label>
          <label>Cupons exclusivos da recuperação (separe por vírgula)<input name="cupons" maxlength="600" value="${ui.esc((c.cupons_recuperacao || []).join(', '))}" placeholder="ex.: VOLTA10"></label>
        </div><div class="btn-row end"><button class="btn btn-ghost btn-sm" type="submit" ${oc ? 'disabled' : ''}>Salvar</button></div>
        <p class="small muted">Cupom exclusivo = usado só no e-mail de recuperação da automação existente. Um pedido com ele só conta como recuperação se houver um único carrinho candidato do mesmo cliente, com produto em comum.</p></form>` : ''}
      ${p && p.sincronizacoes.length ? `<div class="table-wrap"><table id="carSincronizacoes"><thead><tr><th>Início</th><th>Origem</th><th>Status</th><th class="num">Lidos</th><th class="num">Novos</th><th>Observação</th></tr></thead><tbody>
        ${p.sincronizacoes.map(s => { const st = SYNC[s.status] || [s.status, 'muted']; const ct = s.contadores || {};
          return `<tr><td class="nowrap">${ui.esc(quando(s.iniciada_em))}</td><td>${s.origem === 'agendada' ? 'Automática' : 'Manual'}</td><td>${ui.badge(st[0], st[1])}</td>
            <td class="num">${ui.num(n(ct.lidos))}</td><td class="num">${ui.num(n(ct.novos))}</td><td class="small">${ui.esc(s.erro_codigo ? (MSG_ERRO[s.erro_codigo] || s.erro_codigo) : (n(ct.sem_email) ? `${n(ct.sem_email)} sem e-mail` : ''))}</td></tr>`; }).join('')}
      </tbody></table></div>` : '<p class="muted small">Nenhuma leitura ainda.</p>'}
    </section>`;
  }
  const MSG_ERRO = { nuvemshop_sem_permissao_401: 'token recusado (401)', nuvemshop_sem_permissao_403: 'sem permissão read_orders (403)',
                     tempo_esgotado: 'tempo esgotado', nuvemshop_limite_de_chamadas: 'limite de chamadas', nuvemshop_indisponivel: 'Nuvemshop indisponível' };

  function painel(p) {
    const k = p.kpis, ab = n(k.abandonados);
    const horas = Array.from({ length: 24 }, (_, h) => ({ label: String(h).padStart(2, '0') + 'h', value: n((p.por_hora || {})[h]) }));
    const dias = [1, 2, 3, 4, 5, 6, 7].map(d => ({ label: DIA[d], value: n((p.por_dia_semana || {})[d]) }));
    const recs = recomendacoes(p);
    return `
      <section class="kpi-grid kpi-grid-6" id="carKpis">
        ${ui.kpi({ label: 'Carrinhos abandonados', value: ui.num(ab), hint: `${ui.brl(n(k.valor_abandonado))} em carrinhos` })}
        ${ui.kpi({ label: 'Recuperados (vínculo comprovado)', value: ui.num(n(k.recuperados_evidencia)), hint: `${ui.brl(n(k.receita_recuperada_evidencia))} de receita recuperada` })}
        ${ui.kpi({ label: 'Taxa de recuperação', value: ab ? ui.pct(pct(n(k.recuperados_evidencia), ab)) : '—', hint: 'só com vínculo comprovado' })}
        ${ui.kpi({ label: 'Compra posterior (sem atribuição)', value: ui.num(n(k.compra_posterior_sem_evidencia)), hint: `${ui.brl(n(k.receita_compra_posterior))} — não somada à receita recuperada` })}
        ${ui.kpi({ label: 'Não convertidos', value: ui.num(n(k.nao_convertidos)), hint: `${ui.brl(n(k.valor_nao_convertido))} em aberto` })}
        ${ui.kpi({ label: 'Tempo até a compra', value: k.mediana_horas_ate_compra === null ? '—' : `${String(k.mediana_horas_ate_compra).replace('.', ',')} h`, hint: 'mediana, quando houve compra' })}
      </section>
      <section class="card" id="carRecomendacoes"><header class="card-head"><h2>Gargalos e recomendações</h2><span class="muted small">calculadas só com os números abaixo</span></header>
        <ul class="lista-simples">${recs.map(r => `<li>${ui.badge(r.tom === 'warn' ? 'Atenção' : r.tom === 'sand' ? 'Oportunidade' : 'Nota', r.tom)} ${ui.esc(r.txt)}</li>`).join('')}</ul></section>
      <section class="grid-2">
        <article class="card"><header class="card-head"><h2>Resultado dos carrinhos</h2></header>
          <div class="table-wrap"><table id="carResultados"><thead><tr><th>Resultado</th><th class="num">Carrinhos</th></tr></thead><tbody>
          ${Object.keys(RESULTADO).filter(r => n((p.por_resultado || {})[r])).map(r => `<tr><td>${ui.esc(RESULTADO[r])}</td><td class="num">${ui.num(n(p.por_resultado[r]))}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">Sem carrinhos no período.</td></tr>'}
          </tbody></table></div>
          <p class="small muted">"Recuperado" só com vínculo documental: o pedido tem o mesmo número do carrinho (com e-mail, data e produto coerentes) ou usou um cupom exclusivo da recuperação com um único carrinho candidato. E-mail, compra posterior ou "concluído" sozinhos não bastam. Cada pedido é contado uma só vez. Janela: ${ui.num(n(p.cobertura.janela_conversao_dias))} dias.</p></article>
        <article class="card"><header class="card-head"><h2>Automações do Nuvem Marketing</h2>${ui.badge('Métricas indisponíveis', 'muted')}</header>
          <p class="small" id="carNuvemMarketing">A API oficial do Nuvem Marketing não oferece métricas das automações (envios, aberturas, cliques). Por isso esta tela <strong>não estima</strong> desempenho de e-mail nem credita vendas à automação sem evidência. Consulte as métricas no painel do Nuvem Marketing. As automações existentes não são alteradas.</p></article>
      </section>
      <section class="card"><header class="card-head"><h2>Desempenho por produto</h2></header>
        ${(p.por_produto || []).length ? `<div class="table-wrap"><table id="carProdutos"><thead><tr><th>Produto</th><th class="num">Carrinhos</th><th class="num">Unidades</th><th class="num">Valor nos carrinhos</th><th class="num">Recuperados (comprovado)</th><th class="num">Compra posterior</th><th class="num">Taxa (comprovado)</th></tr></thead><tbody>
          ${p.por_produto.map(x => `<tr><td>${ui.esc(x.produto)}</td><td class="num">${ui.num(n(x.carrinhos))}</td><td class="num">${ui.num(n(x.unidades))}</td><td class="num">${ui.brl(n(x.valor))}</td>
            <td class="num">${ui.num(n(x.recuperados_evidencia))}</td><td class="num">${ui.num(n(x.compra_posterior))}</td><td class="num">${ui.pct(pct(n(x.recuperados_evidencia), n(x.carrinhos)))}</td></tr>`).join('')}
        </tbody></table></div>` : ui.empty('Sem itens no período.')}
      </section>
      <section class="grid-2">
        <article class="card"><header class="card-head"><h2>Abandonos por horário</h2><span class="muted small">Brasília</span></header>${ab ? ui.hbars(horas.filter(h => h.value), v => ui.num(v)) : ui.empty('Sem dados.')}</article>
        <article class="card"><header class="card-head"><h2>Abandonos por dia da semana</h2></header>${ab ? ui.hbars(dias, v => ui.num(v)) : ui.empty('Sem dados.')}
          <p class="small muted">Frete médio: ${p.frete.carrinhos_pct_medio === null ? '—' : String(p.frete.carrinhos_pct_medio).replace('.', ',') + '%'} do valor nos carrinhos × ${p.frete.pedidos_pagos_pct_medio === null ? '—' : String(p.frete.pedidos_pagos_pct_medio).replace('.', ',') + '%'} nos pedidos pagos.
          Carrinhos com cupom: ${ui.num(n(p.cupom.com_cupom))}. Pessoas que abandonaram mais de uma vez: ${ui.num(n(k.clientes_reincidentes))}.</p></article>
      </section>
      <section class="card"><header class="card-head"><h2>Oportunidades (últimos 7 dias, sem compra)</h2><span class="muted small">maiores valores primeiro</span></header>
        <p class="small muted">A automação do Nuvem Marketing já envia os e-mails de recuperação: não repita o e-mail. Contato humano só pelo canal autorizado.</p>
        ${p.oportunidades.length ? `<div class="table-wrap"><table id="carOportunidades"><thead><tr><th>Cliente</th><th>Produtos</th><th class="num">Valor</th><th class="num">Há</th><th>E-mail</th><th>WhatsApp</th></tr></thead><tbody>
          ${p.oportunidades.map(o => `<tr><td>${o.cliente ? ui.esc(o.cliente) : `<span class="muted">${o.cadastrado ? 'Cliente anonimizado' : 'Contato sem cadastro'}</span>`}</td><td class="small">${ui.esc(o.produtos || '')}</td>
            <td class="num">${ui.brl(n(o.valor))}</td><td class="num">${ui.num(n(o.horas_desde))} h</td>
            <td>${o.email_permitido === null ? '<span class="muted">—</span>' : ui.badge(o.email_permitido ? 'Autorizado' : 'Sem autorização', o.email_permitido ? 'sage' : 'muted')}</td>
            <td>${o.whatsapp_permitido === null ? '<span class="muted">—</span>' : ui.badge(o.whatsapp_permitido ? 'Autorizado' : 'Sem autorização', o.whatsapp_permitido ? 'sage' : 'muted')}</td></tr>`).join('')}
        </tbody></table></div>` : ui.empty('Nenhum carrinho sem compra nos últimos 7 dias.')}
      </section>`;
  }

  A.views.carrinhos = {
    title: 'Carrinhos abandonados',
    fonteDados: 'Supabase · Nuvemshop (somente leitura)',
    render() {
      const p = est.painel, admin = A.session.isAdmin(), c = p && p.cobertura;
      const periodos = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias']];
      return `
        <section class="toolbar"><div class="seg-control" role="group" aria-label="Período">
          ${periodos.map(([d, l]) => `<button type="button" class="${d === est.dias ? 'active' : ''}" data-car-dias="${d}">${l}</button>`).join('')}</div>
          <button class="btn btn-ghost btn-sm" type="button" id="carAtualizar" ${est.carregando ? 'disabled' : ''}>Atualizar</button></section>
        <div class="card fonte-dados small" id="carFonte" role="note">Fonte: carrinhos abandonados da Nuvemshop (API oficial). A loja só disponibiliza os <strong>últimos 30 dias</strong> e cria o carrinho cerca de 6 h após o abandono (quando o cliente chegou ao pagamento com e-mail); o histórico mais antigo fica guardado aqui por até 180 dias.
          ${c ? `Carrinhos guardados: ${ui.num(n(c.carrinhos_guardados))}${c.mais_antigo ? ` (desde ${ui.esc(quando(c.mais_antigo))})` : ''} · última leitura: ${ui.esc(quando(c.ultima_sincronizacao_em))}.` : ''}</div>
        ${est.erro ? `<p class="aviso-inline" role="alert" id="carErro">${ui.esc(est.erro)}</p>` : ''}
        ${est.erroAcao ? `<p class="aviso-inline" role="alert" id="carErroAcao">${ui.esc(est.erroAcao)}</p>` : ''}
        ${est.msg ? `<p class="small kpi-destaque" id="carMsg">${ui.esc(est.msg)}</p>` : ''}
        ${!p ? `<p class="muted small" aria-busy="${est.carregando}">${est.carregando ? 'Carregando…' : ''}</p>` : painel(p)}
        ${admin ? blocoAdmin(p) : ''}`;
    },
    bind(root) {
      if (!est.painel && !est.erro && !est.carregando) carregar();
      root.querySelectorAll('[data-car-dias]').forEach(b => b.addEventListener('click', () => { est.dias = +b.dataset.carDias; est.painel = null; carregar(); }));
      const at = root.querySelector('#carAtualizar'); if (at) at.addEventListener('click', carregar);
      const v = root.querySelector('#carVerificar');
      if (v) v.addEventListener('click', () => acao('verificar', async () => { est.verificacao = await R().carrinhosVerificar(); }, () => null));
      const s = root.querySelector('#carSincronizar');
      if (s) s.addEventListener('click', () => acao('sincronizar', () => R().carrinhosSincronizar(),
        r => `Leitura concluída: ${r.lidos} carrinho(s) lido(s), ${r.novos} novo(s), ${r.atualizados} atualizado(s)${r.semEmail ? `, ${r.semEmail} sem e-mail` : ''}.`));
      const f = root.querySelector('#carConfig');
      if (f) f.addEventListener('submit', ev => {
        ev.preventDefault();
        const fd = new FormData(f);
        const cupons = String(fd.get('cupons') || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
        acao('config', () => R().carrinhosConfigSalvar(Number(fd.get('janela')) || 7, cupons), 'Configuração salva: os números foram recalculados.');
      });
    }
  };
})(window.ALTUM);
