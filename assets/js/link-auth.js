/* ALTUM Sales Intelligence — captura do link de autenticação
 * ---------------------------------------------------------------
 * Carregado no INÍCIO do <head>, antes de qualquer outro recurso.
 * Lê o token de convite/recuperação que vem no endereço
 * (?token_hash=…&type=… ou #access_token=…&type=…, ou #error=…),
 * guarda só em memória para o auth.js e APAGA o token do endereço
 * e do histórico do navegador imediatamente.
 */
(function () {
  'use strict';
  window.ALTUM = window.ALTUM || {};
  var link = null;
  try {
    var url = new URL(window.location.href);
    var q = url.searchParams;
    var hashBruto = window.location.hash || '';
    // "#/clientes" é rota das telas; "#access_token=…" ou "#error=…" vem do Supabase
    var ehHashDeAuth = hashBruto.length > 1 && hashBruto.charAt(1) !== '/';
    var h = ehHashDeAuth ? new URLSearchParams(hashBruto.slice(1)) : new URLSearchParams();

    var l = {};
    if (q.has('token_hash')) { l.tokenHash = q.get('token_hash'); l.tipo = q.get('type'); }
    if (h.has('access_token')) {
      l.accessToken = h.get('access_token');
      l.refreshToken = h.get('refresh_token');
      l.tipo = l.tipo || h.get('type');
    }
    var erro = h.get('error_code') || h.get('error') || q.get('error_code') || q.get('error');
    if (erro) l.erro = erro;
    if (q.has('code')) l.formatoNaoSuportado = true;             // fluxo PKCE: não usado neste app

    if (Object.keys(l).length > 0) link = l;
    if (link || q.toString() || ehHashDeAuth) {
      window.history.replaceState(null, '', url.pathname);     // remove ?… e #… do endereço e do histórico
    }
  } catch (e) {
    try { window.history.replaceState(null, '', window.location.pathname); } catch (e2) { /* ignore */ }
  }
  var entregue = false;
  // entrega o link UMA vez ao auth.js; depois disso não fica acessível
  window.ALTUM.consumirLinkAuth = function () {
    if (entregue) return null;
    entregue = true;
    var x = link; link = null;
    return x;
  };
})();
