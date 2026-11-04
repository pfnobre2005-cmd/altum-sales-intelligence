/* ALTUM Sales Intelligence — Inteligência comercial (Supabase, somente leitura)
 * Mesmo layout da versão anterior, com análises calculadas sobre os dados REAIS:
 * pedidos pagos (com itens), produtos, clientes (só id e origem), resultados de campanhas
 * (atribuição com evidência, 016), oportunidades de recompra (013), segmentos (012) e
 * follow-ups do funil (004). Nada fictício entra; nenhum nome ou contato de cliente é lido.
 * Hipóteses só aparecem quando os números sustentam o critério; cada uma mostra a amostra.
 */
(function (A) {
  'use strict';
  const { ui } = A;
  const MIN_COMPRADORES = 15;      // mesmo critério de "amostra pequena" da versão anterior
  const MIN_ENVIADOS = 10;

  const estado = { dados: null, erro: null, carregando: false, g: 0 };

  async function carregar() {
    const g = ++estado.g;
    estado.carregando = true; estado.erro = null;
    try {
      const d = await A.repositorio.inteligencia();
      if (g !== estado.g) return;
      estado.dados = d;
    } catch (e) { if (g !== estado.g) return; console.error(e); estado.erro = e; estado.dados = null; }
    finally { if (g === estado.g) estado.carregando = false; }
    if (A.router.parse().name === 'inteligencia') A.router.render();
  }

  // produto da 1ª compra: item de maior valor do 1º pedido pago (empate: nome)
  function produtoEntrada(nomes) {
    return s => {
      const itens = (s.pedidos[0] && s.pedidos[0].itens) || [];
      if (!itens.length) return 'Pedido sem itens identificados';
      const top = itens.slice().sort((a, b) => (b.precoUnit * b.qtd) - (a.precoUnit * a.qtd)
        || String(nomes[a.produtoId] || '').localeCompare(String(nomes[b.produtoId] || '')))[0];
      return nomes[top.produtoId] || 'Produto não identificado';
    };
  }

  // Hipóteses: só quando o critério é atingido com dados reais; sempre com a amostra
  function hipoteses(d, an, porOrigem, prods) {
    const out = [];
    const geral = an.recurrenceBy(d.base, () => 'todos')[0];
    const ac = d.acompanhamento;
    const somaC = prods.reduce((t, p) => t + p.compradores, 0), somaR = prods.reduce((t, p) => t + p.recompradores, 0);
    const mediaProd = somaC ? somaR / somaC : 0;
    const fortes = prods.filter(p => p.compradores >= MIN_COMPRADORES).sort((a, b) => b.taxa - a.taxa);
    if (fortes.length && fortes[0].taxa - mediaProd >= 0.05) {
      const p = fortes[0];
      out.push({
        titulo: `Clientes de ${p.produto.nome} recompram o mesmo produto com mais frequência`,
        evidencia: `${p.recompradores} de ${p.compradores} compradores (${ui.pct(p.taxa)}) compraram ${p.produto.nome} 2+ vezes. Média dos produtos nesse indicador: ${ui.pct(mediaProd)}.`,
        amostra: `${p.compradores} compradores do produto (mínimo ${MIN_COMPRADORES}); pedidos pagos reais.`,
        teste: `Lembrete de reposição só para quem está na janela de ${p.produto.nome}, comparando com um grupo que não recebe.`
      });
    }
    if (ac.janela) out.push({
      titulo: 'Há clientes na janela estimada de reposição',
      evidencia: `${ac.janela} ${ac.janela === 1 ? 'cliente está' : 'clientes estão'} na janela estimada; ${ac.janelaComPermissao} com algum canal de contato permitido.`,
      amostra: `${ac.janela} ${ac.janela === 1 ? 'cliente' : 'clientes'} da Tela Recompra (acompanhamento em aberto).`,
      teste: 'Mensagem de recompra sem cupom para metade e com cupom para a outra metade, para medir se o desconto é necessário.'
    });
    const camps = d.campanhas.filter(c => c.cupom && c.enviados >= MIN_ENVIADOS).sort((a, b) => b.compradores / b.enviados - a.compradores / a.enviados);
    if (camps.length >= 2) {
      const b = camps[0];
      out.push({
        titulo: `"${b.nome}" teve a maior conversão entre as campanhas enviadas`,
        evidencia: `${b.compradores} de ${b.enviados} destinatários (${ui.pct(b.compradores / b.enviados)}) compraram com o cupom ${b.cupom} depois do envio.`,
        amostra: `${camps.length} campanhas com cupom e ao menos ${MIN_ENVIADOS} envios marcados.`,
        teste: 'Repetir o mesmo formato num público semelhante e conferir se a taxa se mantém.'
      });
    }
    const origens = porOrigem.filter(g => !g.amostraPequena);
    if (geral && origens.length >= 2 && origens[0].taxa - geral.taxa >= 0.05) {
      const o = origens[0];
      out.push({
        titulo: `Clientes vindos de "${o.chave}" recompram mais`,
        evidencia: `Recompra de ${ui.pct(o.taxa)} nessa origem vs ${ui.pct(geral.taxa)} na base toda.`,
        amostra: `${o.compradores} compradores nessa origem; ${geral.compradores} compradores no total.`,
        teste: `Reforçar a captação por "${o.chave}" por um período e medir se a recompra dos novos clientes acompanha.`
      });
    }
    if (ac.inativos) out.push({
      titulo: 'Base inativa com permissão de contato',
      evidencia: `${ac.inativos} ${ac.inativos === 1 ? 'cliente inativo' : 'clientes inativos'}; ${ac.inativosComPermissao} com permissão para e-mail ou WhatsApp.`,
      amostra: `${ac.inativos} ${ac.inativos === 1 ? 'cliente' : 'clientes'} sem pedido pago há mais de ${d.base.regras.inativoAposDias} dias (fora "não contatar" e anonimizados).`,
      teste: 'Campanha de reativação para os autorizados, medindo pedidos com o cupom nos 30 dias seguintes.'
    });
    return out;
  }

  function conteudo(d) {
    const an = A.analytics;
    const nomes = Object.fromEntries(d.base.produtos.map(p => [p.id, p.nome]));
    const porOrigem = an.recurrenceBy(d.base, s => s.cliente.origem);
    const porEntrada = an.recurrenceBy(d.base, produtoEntrada(nomes));
    const prods = an.productInsights(d.base).filter(p => p.compradores > 0);
    const hip = hipoteses(d, an, porOrigem, prods);
    const camps = d.campanhas.filter(c => c.enviados > 0).map(c => ({ c, taxa: c.cupom ? c.compradores / c.enviados : NaN }))
      .sort((a, b) => (isNaN(b.taxa) ? -1 : b.taxa) - (isNaN(a.taxa) ? -1 : a.taxa));
    const ac = d.acompanhamento;
    const compradores = porOrigem.reduce((t, g) => t + g.compradores, 0);
    const semDados = 'Ainda não há pedidos pagos reais suficientes para esta análise.';
    const bars = rows => rows.length ? ui.hbars(rows.map(g => ({ label: g.chave, sub: `${g.recorrentes}/${g.compradores} compradores${g.amostraPequena ? ' · amostra pequena' : ''}`, value: g.taxa, dim: g.amostraPequena })))
      + (rows.every(g => g.amostraPequena) ? `<p class="muted small">Todas as amostras têm menos de ${MIN_COMPRADORES} compradores: use só como indício.</p>` : '')
      : ui.empty(semDados);

    return `
      <section class="card">
        <header class="card-head"><h2>Hipóteses para testar</h2><span class="muted small">geradas a partir dos dados — validar com teste antes de concluir</span></header>
        ${hip.length ? `<div class="hyp-grid">${hip.map((h, i) => `<div class="hyp"><span class="hyp-n">H${i + 1}</span><h3>${ui.esc(h.titulo)}</h3>
          <p><b>Evidência:</b> ${ui.esc(h.evidencia)}</p><p><b>Amostra:</b> ${ui.esc(h.amostra)}</p><p><b>Teste sugerido:</b> ${ui.esc(h.teste)}</p></div>`).join('')}</div>`
          : ui.empty(`Dados insuficientes para hipóteses. Com ${compradores} ${compradores === 1 ? 'comprador real' : 'compradores reais'}, nenhum critério foi atingido (ex.: produto com ${MIN_COMPRADORES}+ compradores e recompra 5 pontos acima da média; 2+ campanhas com cupom e ${MIN_ENVIADOS}+ envios).`)}
      </section>

      <section class="grid-2">
        <article class="card"><header class="card-head"><h2>Recorrência por origem do cliente</h2></header>${bars(porOrigem)}</article>
        <article class="card"><header class="card-head"><h2>Recorrência por produto da 1ª compra</h2></header>${bars(porEntrada)}
          ${porEntrada.length ? '<p class="muted small">Produto da 1ª compra = item de maior valor no primeiro pedido pago do cliente.</p>' : ''}</article>
      </section>

      <section class="card">
        <header class="card-head"><h2>Produtos em pedidos repetidos</h2></header>
        ${prods.length ? `<div class="table-wrap"><table id="tabelaProdutosRepetidos"><thead><tr><th>Produto</th><th class="num">Compradores</th><th class="num">Recompraram o mesmo</th><th class="num">Taxa</th><th class="num">Presença em recompras</th><th class="num">Receita (itens)</th><th class="num hide-sm">Ciclo usado</th></tr></thead><tbody>
        ${prods.map(p => `<tr><td>${ui.esc(p.produto.nome)}</td><td class="num">${p.compradores}</td><td class="num">${p.recompradores}</td><td class="num">${ui.pct(p.taxa)}</td><td class="num">${p.pedidosRecompra}</td><td class="num">${ui.brl0(p.receita)}</td><td class="num hide-sm">${p.produto.cicloDias ? `${p.produto.cicloDias} d` : '—'}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="muted small">"Presença em recompras" = quantos pedidos a partir do 2º de cada cliente contêm o produto. Só pedidos pagos reais.</p>` : ui.empty(semDados)}
      </section>

      <section class="grid-2">
        <article class="card"><header class="card-head"><h2>Campanhas que geraram vendas</h2><a href="#/campanhas" class="link">campanhas</a></header>
          ${camps.length ? `<div class="table-wrap"><table id="tabelaCampanhasIntel"><thead><tr><th>Campanha</th><th class="num">Enviados</th><th class="num">Conversão</th><th class="num">Receita</th></tr></thead><tbody>
          ${camps.map(x => `<tr><td><a class="link-strong" href="#/campanhas/${ui.esc(x.c.id)}">${ui.esc(x.c.nome)}</a>${x.c.cupom ? '' : '<small class="block muted">sem cupom: vendas não atribuídas</small>'}</td><td class="num">${x.c.enviados}</td><td class="num">${x.c.cupom ? ui.pct(x.taxa) : '—'}</td><td class="num">${x.c.cupom ? ui.brl0(x.c.receita) : '—'}</td></tr>`).join('')}
          </tbody></table></div>
          <p class="muted small">Venda atribuída = pedido pago na Nuvemshop com o cupom da campanha, depois do envio e dentro da janela.</p>` : ui.empty('Nenhuma campanha real com envio marcado ainda.')}
        </article>
        <article class="card"><header class="card-head"><h2>O que merece acompanhamento agora</h2></header>
          <ul class="list plain" id="listaAcompanhamento">
            <li><a href="#/recompra" data-seg="janela"><span><b>${ac.janela}</b> clientes na janela de recompra</span><span class="link">abrir</span></a></li>
            <li><a href="#/recompra" data-seg="atrasado"><span><b>${ac.atrasado}</b> recompras atrasadas (ainda não inativos)</span><span class="link">abrir</span></a></li>
            <li><a href="#/funil"><span><b>${ac.followUps}</b> follow-ups do funil vencidos ou para hoje</span><span class="link">abrir</span></a></li>
            <li><a href="#/clientes"><span><b>${ac.fieis}</b> clientes elegíveis à fidelização</span><span class="link">abrir</span></a></li>
          </ul>
        </article>
      </section>
      <p class="muted small" id="rodapeIntel">Dados reais do Supabase · lidos às ${d.lidoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · <button class="btn btn-ghost btn-sm" id="atualizarIntel" type="button" ${estado.carregando ? 'disabled' : ''}>Atualizar</button></p>`;
  }

  window.addEventListener('altum:dados-alterados', () => { estado.dados = null; });

  A.views.inteligencia = {
    title: 'Inteligência comercial',
    fonteDados: 'Supabase · dados reais',
    render() {
      if (estado.erro) return `<section class="card error" role="alert" id="erroIntel"><h2>Não foi possível carregar a inteligência comercial</h2><p>${ui.esc(estado.erro.message || 'Erro inesperado.')}</p>
        <div class="btn-row"><button class="btn btn-primary" id="tentarIntel" type="button">Tentar de novo</button></div></section>`;
      if (!estado.dados) return '<section class="card" aria-busy="true" id="carregandoIntel"><p class="muted">Calculando a partir dos dados reais do Supabase…</p></section>';
      return conteudo(estado.dados);
    },
    bind(root) {
      if (!estado.dados && !estado.erro && !estado.carregando) carregar();
      [['#atualizarIntel', () => { carregar(); A.router.render(); }], ['#tentarIntel', () => { estado.erro = null; carregar(); A.router.render(); }]]
        .forEach(([s, fn]) => { const b = root.querySelector(s); if (b) b.addEventListener('click', fn); });
      root.querySelectorAll('[data-seg]').forEach(a => a.addEventListener('click', () => { A.state.recompra.seg = a.dataset.seg; }));
    }
  };
})(window.ALTUM);
