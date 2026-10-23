/* ALTUM Sales Intelligence — gerador de DADOS FICTÍCIOS (somente Etapa 1)
 * ---------------------------------------------------------------
 * Tudo aqui é inventado para testar as telas: nomes com sobrenome "Exemplo",
 * "Teste" etc., e-mails no domínio reservado .test e telefones de faixa fictícia.
 * Preços e ciclos de recompra são VALORES DE EXEMPLO, editáveis na tela
 * "Integrações & Dados". Na Etapa 3 este arquivo deixa de ser usado.
 */
(function (A) {
  'use strict';
  A.mock_VERSION = 2; // aumentar quando o formato da base fictícia mudar (força nova geração)

  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const iso = d => {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
  const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const FIRST = ['Ana', 'Bruno', 'Carla', 'Diego', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'João',
    'Karina', 'Lucas', 'Mariana', 'Nicolas', 'Olívia', 'Paulo', 'Rafaela', 'Sérgio', 'Tatiane', 'Vinícius',
    'Yasmin', 'Rodrigo', 'Camila', 'Thiago', 'Letícia', 'Gustavo', 'Beatriz', 'André', 'Fernanda', 'Marcelo'];
  const LAST = ['Exemplo', 'Teste', 'Demo', 'Fictício', 'Modelo', 'Amostra', 'Simulado', 'Protótipo'];
  const CIDADES = [['São Paulo', 'SP'], ['Campinas', 'SP'], ['Piracicaba', 'SP'], ['Rio de Janeiro', 'RJ'],
    ['Belo Horizonte', 'MG'], ['Curitiba', 'PR'], ['Porto Alegre', 'RS'], ['Salvador', 'BA'],
    ['Goiânia', 'GO'], ['Florianópolis', 'SC']];
  const ORIGENS_CLIENTE = ['Loja virtual', 'Loja virtual', 'Loja virtual', 'Loja virtual', 'Instagram', 'Indicação', 'WhatsApp'];

  // Linhas Altum. preco e cicloDias = valores de exemplo (configuráveis).
  const PRODUTOS = [
    { id: 'p-nac', nome: 'NAC 600mg', categoria: 'Aminoácidos', preco: 59.90, cicloDias: 30 },
    { id: 'p-col', nome: 'Colágeno', categoria: 'Beleza', preco: 59.90, cicloDias: 30 },
    { id: 'p-5mag', nome: '5Mag', categoria: 'Minerais', preco: 59.90, cicloDias: 30 },
    { id: 'p-d3', nome: 'Vitamina D3', categoria: 'Vitaminas', preco: 59.90, cicloDias: 60 },
    { id: 'p-b12', nome: 'Vitamina B12', categoria: 'Vitaminas', preco: 52.90, cicloDias: 60 },
    { id: 'p-juice', nome: 'Juice Protein 600 g', categoria: 'Proteínas', preco: 159.90, cicloDias: 15 },
    { id: 'p-cpu', nome: 'Cabelo, Pele e Unha', categoria: 'Beleza', preco: 59.90, cicloDias: 30 }
  ];
  const CUPONS = { BEMVINDO10: 0.10, VOLTEI15: 0.15, FIDELIDADE20: 0.20, RETORNO10: 0.10 };

  const STAGES = ['novo', 'autorizado', 'atendimento', 'interessado', 'proposta', 'comprou', 'perdido'];
  const LEAD_ORIGENS = A.config.leadOrigens;
  const NOTAS = ['Perguntou sobre prazo de entrega.', 'Pediu tabela de preços para revenda.', 'Quer saber sobre formas de pagamento.',
    'Retornar após o dia 10.', 'Prefere contato por WhatsApp à tarde.', 'Indicado por cliente atual.'];

  function generate() {
    const r = rng(20261022);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = addDays(today, -300);
    const c1Date = addDays(today, -75);
    const c2Date = addDays(today, -35);
    const price = Object.fromEntries(PRODUTOS.map(p => [p.id, p.preco]));
    const clientes = [], pedidos = [];

    for (let i = 1; i <= 160; i++) {
      const id = 'c-' + String(i).padStart(3, '0');
      const first = pick(r, FIRST), last = pick(r, LAST);
      const mid = String.fromCharCode(65 + Math.floor(r() * 26));
      const [cidade, uf] = pick(r, CIDADES);
      const firstDate = addDays(start, Math.floor(r() * 292));
      const fav = pick(r, PRODUTOS);
      const roll = r();
      const nOrders = roll < 0.52 ? 1 : roll < 0.75 ? 2 : roll < 0.88 ? 3 : roll < 0.96 ? 4 : 5 + Math.floor(r() * 3);
      const wa = r() < 0.62, em = r() < 0.55;

      const cli = {
        id, nuvemshopId: null,
        nome: `${first} ${mid}. ${last}`,
        email: `${slug(first)}.${slug(last)}${i}@email-ficticio.test`,
        telefone: `(00) 90000-${String(1000 + i).slice(-4)}`,  // DDD 00 não existe: nunca é um número real
        cidade, uf,
        origem: pick(r, ORIGENS_CLIENTE),
        criadoEm: iso(firstDate),
        statusComercial: r() < 0.04 ? 'nao_contatar' : 'ativo',
        consentimento: {
          whatsapp: wa, email: em,
          atualizadoEm: iso(firstDate),
          fonte: 'Checkout da loja (fictício)'
        },
        interacoes: []
      };
      if (cli.statusComercial === 'nao_contatar') { cli.consentimento.whatsapp = false; cli.consentimento.email = false; }

      let d = firstDate;
      for (let k = 0; k < nOrders; k++) {
        if (d > today) break;
        const itens = [{ produtoId: fav.id, qtd: r() < 0.18 ? 2 : 1, precoUnit: price[fav.id] }];
        if (r() < 0.3) {
          const ex = pick(r, PRODUTOS);
          if (ex.id !== fav.id) itens.push({ produtoId: ex.id, qtd: 1, precoUnit: price[ex.id] });
        }
        let cupom = null;
        if (k === 0 && r() < 0.3) cupom = 'BEMVINDO10';
        if (k === 1 && d >= c1Date && cli.consentimento.whatsapp && r() < 0.5) cupom = 'VOLTEI15';
        if (k >= 2 && d >= c2Date && cli.consentimento.whatsapp && r() < 0.5) cupom = 'FIDELIDADE20';
        const subtotal = itens.reduce((s, it) => s + it.precoUnit * it.qtd, 0);
        const desconto = cupom ? +(subtotal * CUPONS[cupom]).toFixed(2) : 0;
        pedidos.push({
          id: null, nuvemshopId: null, clienteId: id, data: iso(d),
          status: r() < 0.04 ? 'cancelado' : 'pago',
          itens, subtotal: +subtotal.toFixed(2), desconto, total: +(subtotal - desconto).toFixed(2), cupom
        });
        const cycle = fav.cicloDias * itens[0].qtd;
        d = addDays(d, Math.round(cycle * (0.85 + r() * 0.9)));
      }

      if (r() < 0.4) {
        const n = 1 + Math.floor(r() * 2);
        for (let j = 0; j < n; j++) {
          const dt = addDays(firstDate, Math.floor(r() * Math.max(1, (today - firstDate) / 864e5)));
          cli.interacoes.push({
            data: iso(dt), canal: pick(r, ['WhatsApp', 'E-mail', 'Telefone']),
            nota: pick(r, ['Dúvida sobre entrega respondida.', 'Agradeceu o atendimento.', 'Perguntou sobre outro produto da linha.', 'Solicitou segunda via do pedido.']),
            autor: 'Operador (fictício)'
          });
        }
        cli.interacoes.sort((a, b) => b.data.localeCompare(a.data));
      }
      clientes.push(cli);
    }

    pedidos.sort((a, b) => a.data.localeCompare(b.data));
    pedidos.forEach((p, i) => { p.id = 'PED-' + (10001 + i); });

    // Leads do funil
    const leads = [];
    for (let i = 1; i <= 22; i++) {
      const first = pick(r, FIRST), last = pick(r, LAST);
      const roll = r();
      const etapa = roll < 0.22 ? 'novo' : roll < 0.38 ? 'autorizado' : roll < 0.52 ? 'atendimento' : roll < 0.66 ? 'interessado' : roll < 0.78 ? 'proposta' : roll < 0.9 ? 'comprou' : 'perdido';
      const origem = pick(r, LEAD_ORIGENS);
      const criado = addDays(today, -Math.floor(r() * 45));
      const aberto = !['comprou', 'perdido'].includes(etapa);
      const obs = [];
      if (r() < 0.6) obs.push({ data: iso(addDays(criado, 1)), texto: pick(r, NOTAS), autor: 'Operador (fictício)' });
      leads.push({
        id: 'l-' + String(i).padStart(3, '0'),
        nome: `${first} ${last}`,
        empresa: origem === 'B2B' ? pick(r, ['Academia Exemplo', 'Empório Teste', 'Farmácia Demo', 'Studio Modelo']) : '',
        origem,
        telefone: `(00) 90001-${String(2000 + i).slice(-4)}`,
        email: `${slug(first)}.lead${i}@email-ficticio.test`,
        etapa,
        consentimento: etapa !== 'novo' ? true : r() < 0.3,
        consentimentoFonte: etapa !== 'novo' ? 'Pedido de contato pelo próprio lead (fictício)' : '',
        proximoContato: aberto ? iso(addDays(today, Math.floor(r() * 14) - 4)) : null,
        valorPotencial: origem === 'B2B' ? 400 + Math.round(r() * 1600) : 60 + Math.round(r() * 200),
        criadoEm: iso(criado),
        observacoes: obs
      });
    }

    // Campanhas — destinatários calculados a partir dos pedidos fictícios
    const paidBefore = (cid, date) => pedidos.filter(o => o.clienteId === cid && o.status === 'pago' && o.data < iso(date)).length;
    const c1Rec = clientes.filter(c => c.consentimento.whatsapp && c.statusComercial !== 'nao_contatar' && paidBefore(c.id, c1Date) === 1)
      .map(c => ({ clienteId: c.id, enviadoEm: iso(c1Date) }));
    const c2Rec = clientes.filter(c => c.consentimento.whatsapp && c.statusComercial !== 'nao_contatar' && paidBefore(c.id, c2Date) >= 2)
      .map(c => ({ clienteId: c.id, enviadoEm: iso(c2Date) }));

    const campanhas = [
      {
        id: 'cp-001', nome: 'Segunda compra — 15% off', objetivo: 'recompra', canal: 'whatsapp', publico: 'primeira_compra',
        cupom: 'VOLTEI15', status: 'concluida', criadaEm: iso(addDays(c1Date, -2)),
        mensagem: 'Oi {primeiro_nome}! Aqui é da Altum Nutrition. Vimos que você levou {produto} em {data_ultima_compra}. Se quiser repor, o cupom {cupom} dá 15% de desconto na próxima compra. Para não receber mais mensagens, responda SAIR.',
        destinatarios: c1Rec
      },
      {
        id: 'cp-002', nome: 'Clientes fiéis — 20% off', objetivo: 'fidelizacao', canal: 'whatsapp', publico: 'recorrentes',
        cupom: 'FIDELIDADE20', status: 'concluida', criadaEm: iso(addDays(c2Date, -1)),
        mensagem: 'Oi {primeiro_nome}, obrigado por comprar com a Altum mais de uma vez! Como agradecimento, o cupom {cupom} vale 20% de desconto. Para não receber mais mensagens, responda SAIR.',
        destinatarios: c2Rec
      },
      {
        id: 'cp-003', nome: 'Reativação — inativos', objetivo: 'reativacao', canal: 'email', publico: 'inativos',
        cupom: 'RETORNO10', status: 'rascunho', criadaEm: iso(addDays(today, -2)),
        mensagem: 'Olá {primeiro_nome}, faz um tempo que você não passa pela loja da Altum. Preparamos o cupom {cupom} com 10% de desconto. Para deixar de receber nossos e-mails, clique em descadastrar.',
        destinatarios: []
      }
    ];

    return {
      meta: {
        fonte: 'ficticio', versao: A.mock_VERSION, geradoEm: iso(today),
        aviso: 'Base 100% fictícia gerada no navegador para testar o protótipo. Não representa clientes, pedidos ou vendas reais da Altum.'
      },
      regras: { inativoAposDias: 90, janelaAntesDias: 7, janelaDepoisDias: 21, fidelidadeMinPedidos: 3 },
      produtos: PRODUTOS.map(p => ({ ...p })),
      cupons: CUPONS,
      clientes, pedidos, leads, campanhas,
      auditoria: [{ data: new Date().toISOString(), usuario: 'sistema', acao: 'Base fictícia gerada', detalhe: `${clientes.length} clientes, ${pedidos.length} pedidos, ${leads.length} leads` }]
    };
  }

  A.mock = { generate, STAGES };
})(window.ALTUM);
