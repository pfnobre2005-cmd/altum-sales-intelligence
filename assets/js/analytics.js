/* ALTUM Sales Intelligence — regras de negócio e indicadores
 * ---------------------------------------------------------------
 * Funções puras: recebem a base (db) e devolvem números/listas.
 * Não inventam nada: tudo é derivado de clientes/pedidos existentes.
 * Serão reaproveitadas sem mudança quando os dados vierem do Supabase.
 */
(function (A) {
  'use strict';
  const DAY = 864e5;

  function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function parse(s) { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
  function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function daysBetween(a, b) { return Math.round((a - b) / DAY); }
  const inRange = (s, a, b) => s >= iso(a) && s <= iso(b);

  const SEGMENTOS = {
    primeira_compra: { label: 'Primeira compra', desc: 'Exatamente 1 pedido pago, ainda ativo' },
    recorrentes: { label: 'Recorrentes ativos', desc: '2+ pedidos pagos e ainda não inativos' },
    fieis: { label: 'Elegíveis à fidelização', desc: 'Pedidos pagos ≥ mínimo de fidelização e ainda não inativos' },
    inativos: { label: 'Inativos', desc: 'Sem pedido pago há mais dias que o limite de inatividade' },
    janela: { label: 'Na janela de recompra', desc: 'Data estimada de reposição dentro da janela configurada' },
    atrasado: { label: 'Recompra atrasada', desc: 'Passou da janela estimada, mas ainda não está inativo' }
  };

  function paid(db) { return db.pedidos.filter(o => o.status === 'pago'); }

  /** Estatística por cliente considerando pedidos pagos até asOf. */
  function customerStats(db, asOf) {
    asOf = asOf || today();
    const end = iso(asOf);
    const regras = db.regras;
    const map = new Map();
    db.clientes.forEach(c => map.set(c.id, { cliente: c, pedidos: [], n: 0, total: 0, primeira: null, ultima: null, produtos: {}, diasSemComprar: null }));
    paid(db).forEach(o => {
      if (o.data > end) return;
      const s = map.get(o.clienteId); if (!s) return;
      s.pedidos.push(o);
    });
    map.forEach(s => {
      s.pedidos.sort((a, b) => a.data.localeCompare(b.data));
      s.n = s.pedidos.length;
      s.total = s.pedidos.reduce((t, o) => t + o.total, 0);
      if (s.n) {
        s.primeira = s.pedidos[0].data;
        s.ultima = s.pedidos[s.n - 1].data;
        s.diasSemComprar = daysBetween(asOf, parse(s.ultima));
      }
      s.pedidos.forEach(o => o.itens.forEach(it => { s.produtos[it.produtoId] = (s.produtos[it.produtoId] || 0) + it.qtd; }));
      s.inativo = s.n > 0 && s.diasSemComprar > regras.inativoAposDias;
      s.segmento = s.n === 0 ? 'sem_pedido'
        : s.inativo ? 'inativos'
          : s.n >= regras.fidelidadeMinPedidos ? 'fieis'
            : s.n >= 2 ? 'recorrentes' : 'primeira_compra';
    });
    return map;
  }

  function snapshot(db, s, e) {
    const orders = paid(db).filter(o => inRange(o.data, s, e));
    const stats = [...customerStats(db, e).values()];
    const compradores = stats.filter(x => x.n >= 1);
    const recorrentes = stats.filter(x => x.n >= 2);
    const fat = orders.reduce((t, o) => t + o.total, 0);
    return {
      clientes: db.clientes.filter(c => c.criadoEm <= iso(e)).length,
      novos: stats.filter(x => x.primeira && inRange(x.primeira, s, e)).length,
      compradores: compradores.length,
      recorrentes: recorrentes.length,
      inativos: stats.filter(x => x.inativo).length,
      faturamento: fat,
      pedidos: orders.length,
      ticket: orders.length ? fat / orders.length : 0,
      taxaRecompra: compradores.length ? recorrentes.length / compradores.length : 0
    };
  }

  /** KPIs do período (últimos N dias) e do período anterior de mesmo tamanho. */
  function kpis(db, days) {
    const end = today();
    const start = addDays(end, -days + 1);
    const pEnd = addDays(start, -1);
    const pStart = addDays(pEnd, -days + 1);
    return { atual: snapshot(db, start, end), anterior: snapshot(db, pStart, pEnd), periodo: { start: iso(start), end: iso(end), pStart: iso(pStart), pEnd: iso(pEnd) } };
  }

  /** Oportunidades de recompra a partir do último pedido e do ciclo (configurável) de cada produto. */
  function repurchase(db) {
    const t = today();
    const { janelaAntesDias, janelaDepoisDias, inativoAposDias } = db.regras;
    const prod = Object.fromEntries(db.produtos.map(p => [p.id, p]));
    const out = [];
    customerStats(db, t).forEach(s => {
      if (!s.n || s.cliente.statusComercial === 'nao_contatar') return;
      const last = s.pedidos[s.n - 1];
      let best = null;
      last.itens.forEach(it => {
        const p = prod[it.produtoId]; if (!p || !p.cicloDias) return;
        const est = addDays(parse(last.data), p.cicloDias * it.qtd);
        const delta = daysBetween(t, est); // >0 = passou da data estimada
        let status = null;
        if (delta >= -janelaAntesDias && delta <= janelaDepoisDias) status = 'janela';
        else if (delta > janelaDepoisDias && s.diasSemComprar <= inativoAposDias) status = 'atrasado';
        if (status && (!best || delta < best.delta)) best = { status, delta, estimada: iso(est), produto: p };
      });
      if (best) out.push({ clienteId: s.cliente.id, cliente: s.cliente, stats: s, ...best });
    });
    return out.sort((a, b) => (a.status === b.status ? a.delta - b.delta : a.status === 'janela' ? -1 : 1));
  }

  /** Clientes de um público (segmento) — sempre excluindo "não contatar". */
  function audience(db, key) {
    const stats = [...customerStats(db).values()].filter(s => s.cliente.statusComercial !== 'nao_contatar' && !s.cliente.anonimizado);
    switch (key) {
      case 'primeira_compra': return stats.filter(s => s.segmento === 'primeira_compra');
      case 'recorrentes': return stats.filter(s => s.n >= 2 && !s.inativo);
      case 'fieis': return stats.filter(s => s.segmento === 'fieis');
      case 'inativos': return stats.filter(s => s.inativo);
      case 'janela':
      case 'atrasado': {
        const ids = new Set(repurchase(db).filter(o => o.status === key).map(o => o.clienteId));
        return stats.filter(s => ids.has(s.cliente.id));
      }
      default: return [];
    }
  }

  function eligible(list, canal) { return list.filter(s => s.cliente.consentimento && s.cliente.consentimento[canal]); }

  /** Faturamento mensal separado em 1ª compra x recompra. */
  function monthlySeries(db, months) {
    const t = today();
    const firstIds = new Set();
    const seen = new Set();
    paid(db).slice().sort((a, b) => a.data.localeCompare(b.data)).forEach(o => {
      if (!seen.has(o.clienteId)) { seen.add(o.clienteId); firstIds.add(o.id); }
    });
    const out = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(t.getFullYear(), t.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') + '/' + String(d.getFullYear()).slice(2);
      out.push({ key, label, primeira: 0, recompra: 0 });
    }
    const idx = Object.fromEntries(out.map((m, i) => [m.key, i]));
    paid(db).forEach(o => {
      const i = idx[o.data.slice(0, 7)]; if (i === undefined) return;
      if (firstIds.has(o.id)) out[i].primeira += o.total; else out[i].recompra += o.total;
    });
    return out;
  }

  /** Produtos: compradores, recompradores do mesmo produto e presença em pedidos de recompra. */
  function productInsights(db) {
    const byCli = new Map();
    paid(db).slice().sort((a, b) => a.data.localeCompare(b.data)).forEach(o => {
      if (!byCli.has(o.clienteId)) byCli.set(o.clienteId, []);
      byCli.get(o.clienteId).push(o);
    });
    const rows = db.produtos.map(p => ({ produto: p, compradores: 0, recompradores: 0, pedidosRecompra: 0, receita: 0 }));
    const r = Object.fromEntries(rows.map(x => [x.produto.id, x]));
    byCli.forEach(orders => {
      const count = {};
      orders.forEach((o, i) => {
        const inOrder = new Set(o.itens.map(it => it.produtoId));
        inOrder.forEach(pid => {
          count[pid] = (count[pid] || 0) + 1;
          if (i > 0 && r[pid]) r[pid].pedidosRecompra++;
        });
        o.itens.forEach(it => { if (r[it.produtoId]) r[it.produtoId].receita += it.precoUnit * it.qtd; });
      });
      Object.entries(count).forEach(([pid, c]) => {
        if (!r[pid]) return;
        r[pid].compradores++;
        if (c >= 2) r[pid].recompradores++;
      });
    });
    rows.forEach(x => { x.taxa = x.compradores ? x.recompradores / x.compradores : 0; });
    return rows.sort((a, b) => b.pedidosRecompra - a.pedidosRecompra);
  }

  /** Taxa de recompra agrupada por uma chave (origem, produto de entrada, UF). */
  function recurrenceBy(db, keyFn) {
    const groups = {};
    customerStats(db).forEach(s => {
      if (!s.n) return;
      const k = keyFn(s) || '—';
      groups[k] = groups[k] || { chave: k, compradores: 0, recorrentes: 0 };
      groups[k].compradores++;
      if (s.n >= 2) groups[k].recorrentes++;
    });
    return Object.values(groups).map(g => ({ ...g, taxa: g.recorrentes / g.compradores, amostraPequena: g.compradores < 15 }))
      .sort((a, b) => b.taxa - a.taxa);
  }

  /** Resultado de campanha: só conta pedidos pagos de destinatários, com o cupom da campanha, após o envio. */
  function campaignResults(db, camp) {
    const sent = (camp.destinatarios || []).filter(d => d.enviadoEm);
    const sentMap = new Map(sent.map(d => [d.clienteId, d.enviadoEm]));
    const conv = camp.cupom ? paid(db).filter(o => o.cupom === camp.cupom && sentMap.has(o.clienteId) && o.data >= sentMap.get(o.clienteId)) : [];
    const outside = camp.cupom ? paid(db).filter(o => o.cupom === camp.cupom && !sentMap.has(o.clienteId)).length : 0;
    const convClientes = new Set(conv.map(o => o.clienteId));
    return {
      destinatarios: (camp.destinatarios || []).length,
      enviados: sent.length,
      pedidos: conv.length,
      clientesConvertidos: convClientes.size,
      receita: conv.reduce((t, o) => t + o.total, 0),
      taxa: sent.length ? convClientes.size / sent.length : 0,
      usosForaDoPublico: outside
    };
  }

  /** Hipóteses de marketing derivadas dos dados — sempre para testar, nunca conclusões. */
  function hypotheses(db) {
    const out = [];
    const base = recurrenceBy(db, () => 'todos')[0];
    const media = base ? base.taxa : 0;
    const all = productInsights(db);
    const somaC = all.reduce((t, p) => t + p.compradores, 0), somaR = all.reduce((t, p) => t + p.recompradores, 0);
    const mediaProd = somaC ? somaR / somaC : 0;
    const prods = all.filter(p => p.compradores >= 15).sort((a, b) => b.taxa - a.taxa);
    if (prods.length && prods[0].taxa - mediaProd >= 0.05) {
      const p = prods[0];
      out.push({
        titulo: `Clientes de ${p.produto.nome} recompram o mesmo produto com mais frequência`,
        evidencia: `${p.recompradores} de ${p.compradores} compradores (${A.ui.pct(p.taxa)}) compraram ${p.produto.nome} 2+ vezes. Média dos produtos nesse mesmo indicador: ${A.ui.pct(mediaProd)}.`,
        teste: `Campanha de lembrete de reposição só para quem está na janela de ${p.produto.nome}, comparando com um grupo que não recebe.`
      });
    }
    const opp = repurchase(db);
    const janela = opp.filter(o => o.status === 'janela');
    const janelaOk = janela.filter(o => o.cliente.consentimento.whatsapp || o.cliente.consentimento.email);
    if (janela.length) out.push({
      titulo: 'Há clientes na janela estimada de reposição',
      evidencia: `${janela.length} clientes estão na janela estimada; ${janelaOk.length} autorizaram contato por WhatsApp ou e-mail.`,
      teste: 'Mensagem de recompra sem cupom para metade e com cupom para a outra metade, para medir se o desconto é necessário.'
    });
    const camps = db.campanhas.filter(c => c.status !== 'rascunho').map(c => ({ c, r: campaignResults(db, c) })).filter(x => x.r.enviados >= 10);
    if (camps.length >= 2) {
      camps.sort((a, b) => b.r.taxa - a.r.taxa);
      const b = camps[0];
      out.push({
        titulo: `"${b.c.nome}" teve a maior conversão entre as campanhas enviadas`,
        evidencia: `${b.r.clientesConvertidos} de ${b.r.enviados} destinatários (${A.ui.pct(b.r.taxa)}) compraram com o cupom ${b.c.cupom} após o envio.`,
        teste: 'Repetir o mesmo formato num público semelhante e conferir se a taxa se mantém.'
      });
    }
    const origens = recurrenceBy(db, s => s.cliente.origem).filter(g => !g.amostraPequena);
    if (origens.length >= 2 && origens[0].taxa - media >= 0.05) {
      const o = origens[0];
      out.push({
        titulo: `Clientes vindos de "${o.chave}" recompram mais`,
        evidencia: `Recompra de ${A.ui.pct(o.taxa)} nessa origem (${o.compradores} compradores) vs ${A.ui.pct(media)} na base toda.`,
        teste: `Reforçar a captação por "${o.chave}" por um período e medir se a recompra dos novos clientes acompanha.`
      });
    }
    const inativos = audience(db, 'inativos');
    const inativosOk = inativos.filter(s => s.cliente.consentimento.email || s.cliente.consentimento.whatsapp);
    if (inativos.length) out.push({
      titulo: 'Base inativa com permissão de contato',
      evidencia: `${inativos.length} clientes inativos; ${inativosOk.length} com permissão para e-mail ou WhatsApp.`,
      teste: 'Campanha de reativação para os autorizados, medindo pedidos com o cupom nos 30 dias seguintes.'
    });
    return out;
  }

  /** Follow-ups do funil vencidos ou para hoje. */
  function followUps(db) {
    const t = iso(today());
    return db.leads.filter(l => l.proximoContato && !['comprou', 'perdido'].includes(l.etapa) && l.proximoContato <= t)
      .sort((a, b) => a.proximoContato.localeCompare(b.proximoContato));
  }

  A.analytics = { SEGMENTOS, today, parse, iso, addDays, daysBetween, paid, customerStats, kpis, repurchase, audience, eligible, monthlySeries, productInsights, recurrenceBy, campaignResults, hypotheses, followUps };
})(window.ALTUM);
