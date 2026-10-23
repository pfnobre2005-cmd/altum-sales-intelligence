/* ALTUM Sales Intelligence — checagem de mensagens
 * ---------------------------------------------------------------
 * Filtro AUXILIAR (não substitui revisão humana nem o responsável técnico).
 * Base: RDC 243/2018 e IN 28/2018 (Anvisa) — suplemento não pode alegar
 * prevenir/tratar/curar doença, nem usar alegação fora da lista positiva.
 * LGPD: mensagem de marketing deve oferecer forma de descadastro.
 */
(function (A) {
  'use strict';
  const RULES = [
    { re: /\bcur(a|ar|ou|am|ando)\b/i, motivo: 'Promessa de cura' },
    { re: /\btrat(a|ar|amento|ando)\b/i, motivo: 'Alegação de tratamento' },
    { re: /\bprevin(e|ir)|\bpreven(ção|ir)/i, motivo: 'Alegação de prevenção de doença' },
    { re: /\bdoen(ça|ças)\b|\bc[aâ]ncer\b|\bdiabetes\b|\bdepress[aã]o\b|\bansiedade\b|\bcovid\b|\bgripe\b/i, motivo: 'Menção a doença' },
    { re: /\bemagre|\bperder peso|\bperda de peso|\bqueima(r)? gordura|\bsecar\b/i, motivo: 'Promessa de emagrecimento' },
    { re: /\brem[eé]dio|\bmedicamento|\bsubstitui/i, motivo: 'Comparação com medicamento' },
    { re: /\bmilagr|\bgarantid|100% (eficaz|natural|seguro)|\bsem efeitos? colatera/i, motivo: 'Promessa absoluta' },
    { re: /\bdetox|\bdesintox/i, motivo: 'Alegação não autorizada (detox)' },
    { re: /\bimunidade\b|\baumenta(r)? a imunidade|\bfortalece(r)? o sistema imun/i, motivo: 'Alegação de imunidade — só com texto exato da IN 28/2018 e produto elegível' }
  ];

  function check(texto, canal) {
    const alertas = [];
    RULES.forEach(r => { const m = (texto || '').match(r.re); if (m) alertas.push({ tipo: 'claim', motivo: r.motivo, trecho: m[0] }); });
    const optout = canal === 'email' ? /descadastr|cancelar inscri|deixar de receber/i : /\bSAIR\b|descadastr|não receber mais|parar de receber/i;
    if (!optout.test(texto || '')) alertas.push({ tipo: 'lgpd', motivo: 'Falta a opção de descadastro (ex.: "responda SAIR")', trecho: '' });
    return { ok: alertas.length === 0, alertas };
  }

  function render(texto, s, camp) {
    const c = s.cliente;
    const last = s.pedidos && s.pedidos[s.pedidos.length - 1];
    const prod = last ? A.store.produto(last.itens[0].produtoId) : null;
    return (texto || '')
      .replaceAll('{primeiro_nome}', (c.nome || '').split(' ')[0])
      .replaceAll('{nome}', c.nome || '')
      .replaceAll('{produto}', prod ? prod.nome : 'seu produto')
      .replaceAll('{data_ultima_compra}', last ? A.ui.date(last.data) : '')
      .replaceAll('{cupom}', (camp && camp.cupom) || '');
  }

  A.compliance = { check, render };
})(window.ALTUM);
