/* ALTUM Sales Intelligence — autenticação (Supabase Auth)
 * ---------------------------------------------------------------
 * Etapa 1 da autenticação: links de convite/recuperação, definição de senha,
 * login e logout. As 7 telas continuam BLOQUEADAS: só abrem depois da
 * verificação em 2 etapas (aal2) e da leitura do perfil no banco (próximas etapas).
 *
 * Segurança:
 *  • Só usa a Project URL e a chave publishable (config.js). Nunca secret/service_role.
 *  • Tokens que chegam no endereço (?token_hash=… ou #access_token=…) são lidos e
 *    APAGADOS do endereço por link-auth.js, antes de qualquer outro recurso carregar.
 *  • Sessão guardada em sessionStorage (fecha a aba = sai).
 *  • Nenhum dado de cliente é carregado antes da autenticação completa.
 */
(function (A) {
  'use strict';

  const cfg = (A.config && A.config.supabase) || {};
  const TIPOS_DE_LINK = ['invite', 'recovery'];
  const SENHA_MIN = 12, SENHA_MAX = 72;               // 72 = limite do bcrypt usado pelo Supabase
  const CHAVE_SESSAO = 'altum-si-auth';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let sb = null;            // cliente Supabase
  let raiz = null;          // contêiner das telas de autenticação
  let telasLiberadas = false;

  // ---------------------------------------------------------------
  // 0. Proteção contra o app ser exibido dentro de outro site (clickjacking)
  // ---------------------------------------------------------------
  function emMoldura() {
    try { return window.top !== window.self; } catch (e) { return true; }
  }

  // ---------------------------------------------------------------
  // 1. O link (convite/recuperação) já foi capturado e APAGADO do endereço
  //    por link-auth.js, no início do <head>, antes de qualquer outro recurso.
  // ---------------------------------------------------------------
  function capturarLink() {
    return typeof A.consumirLinkAuth === 'function' ? A.consumirLinkAuth() : null;
  }

  // ---------------------------------------------------------------
  // 2. Telas de autenticação
  // ---------------------------------------------------------------
  function marca() {
    return `<div class="auth-brand"><span class="brand-mark" aria-hidden="true">A</span>
      <div><div class="brand-name">ALTUM</div><div class="brand-sub">Sales Intelligence</div></div></div>`;
  }
  function aviso(msg, tom) {
    return msg ? `<div class="auth-msg auth-msg-${tom || 'info'}" role="${tom === 'erro' ? 'alert' : 'status'}">${esc(msg)}</div>` : '';
  }
  function renderizar(html) {
    raiz.innerHTML = `<div class="auth-card">${marca()}${html}</div>`;
    const foco = raiz.querySelector('[autofocus]') || raiz.querySelector('h1');
    if (foco) foco.focus();
  }
  function ocupado(form, sim) {
    form.querySelectorAll('button, input').forEach(el => { el.disabled = sim; });
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.textContent = sim ? 'Aguarde…' : btn.dataset.rotulo;
  }

  function telaCarregando(texto) {
    renderizar(`<h1 class="auth-title" tabindex="-1">${esc(texto || 'Verificando acesso…')}</h1><p class="auth-sub">Um instante.</p>`);
  }

  function telaErroConfiguracao() {
    renderizar(`<h1 class="auth-title" tabindex="-1">Configuração incompleta</h1>
      ${aviso('O endereço do projeto ou a chave pública do Supabase não foram configurados (assets/js/config.js).', 'erro')}`);
  }

  function telaLogin(msg, tom) {
    renderizar(`
      <h1 class="auth-title" tabindex="-1">Entrar</h1>
      <p class="auth-sub">Acesso restrito à equipe ALTUM.</p>
      ${aviso(msg, tom)}
      <form id="formLogin" class="auth-form" method="post" action="#" novalidate>
        <label class="auth-field">E-mail
          <input type="email" name="email" autocomplete="username" required maxlength="254" autofocus></label>
        <label class="auth-field">Senha
          <input type="password" name="senha" autocomplete="current-password" required maxlength="${SENHA_MAX}"></label>
        <div class="auth-msg auth-msg-erro" id="erroLogin" role="alert" hidden></div>
        <button class="btn btn-primary auth-submit" type="submit" data-rotulo="Entrar">Entrar</button>
      </form>
      <p class="auth-foot small muted">Esqueceu a senha ou o convite expirou? Peça ao administrador um novo link.</p>`);
    const form = raiz.querySelector('#formLogin');
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const erroEl = form.querySelector('#erroLogin');
      const email = form.email.value.trim();
      const senha = form.senha.value;
      erroEl.hidden = true;
      if (!email || !senha) { erroEl.textContent = 'Informe e-mail e senha.'; erroEl.hidden = false; return; }
      ocupado(form, true);
      const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
      form.senha.value = '';
      if (error || !data || !data.session) {
        ocupado(form, false);
        erroEl.textContent = mensagemErroLogin(error);
        erroEl.hidden = false;
        form.senha.focus();
        return;
      }
      await aposLogin();
    });
  }

  function mensagemErroLogin(error) {
    const cod = error && (error.code || '');
    const status = error && error.status;
    if (cod === 'email_not_confirmed') return 'Este e-mail ainda não foi confirmado. Use o link do convite.';
    if (status === 429 || /rate_limit/.test(cod)) return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
    if (!status || status >= 500) return 'Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.';
    return 'E-mail ou senha incorretos.';               // mensagem neutra: não revela se o e-mail existe
  }

  function telaLinkInvalido(motivo) {
    const texto = motivo === 'expirado'
      ? 'Este link expirou ou já foi usado. Por segurança, cada link vale uma única vez e por tempo limitado.'
      : motivo === 'formato'
        ? 'Este tipo de link não é aceito por este sistema.'
        : 'Este link é inválido ou já foi usado.';
    renderizar(`<h1 class="auth-title" tabindex="-1">Link não pôde ser usado</h1>
      ${aviso(texto, 'erro')}
      <p class="auth-sub">Peça ao administrador um novo convite ou um novo link de recuperação de senha.</p>
      <div class="btn-row"><button class="btn btn-ghost" id="irLogin" type="button">Ir para o login</button></div>`);
    raiz.querySelector('#irLogin').addEventListener('click', () => telaLogin());
  }

  function telaRecuperacaoComMfa() {
    renderizar(`<h1 class="auth-title" tabindex="-1">Confirmação em 2 etapas necessária</h1>
      ${aviso('Esta conta já tem verificação em 2 etapas. A troca de senha pedirá o código do autenticador e será liberada na próxima etapa de implantação.', 'info')}
      <div class="btn-row"><button class="btn btn-ghost" id="irLogin" type="button">Ir para o login</button></div>`);
    raiz.querySelector('#irLogin').addEventListener('click', () => telaLogin());
  }

  function regrasSenha(senha, confirmacao, email) {
    const regras = [
      { ok: senha.length >= SENHA_MIN, texto: `Pelo menos ${SENHA_MIN} caracteres` },
      { ok: senha.length <= SENHA_MAX, texto: `No máximo ${SENHA_MAX} caracteres` },
      { ok: /[A-Za-zÀ-ÿ]/.test(senha), texto: 'Pelo menos uma letra' },
      { ok: /[0-9]/.test(senha), texto: 'Pelo menos um número' },
      { ok: !email || senha.toLowerCase().indexOf(email.split('@')[0].toLowerCase()) === -1 || email.split('@')[0].length < 4,
        texto: 'Não conter o seu e-mail' },
      { ok: senha.length > 0 && senha === confirmacao, texto: 'Confirmação igual à senha' }
    ];
    return regras;
  }

  function telaDefinirSenha(tipo, email) {
    const titulo = tipo === 'invite' ? 'Defina sua senha de acesso' : 'Defina uma nova senha';
    renderizar(`
      <h1 class="auth-title" tabindex="-1">${esc(titulo)}</h1>
      <p class="auth-sub">${email ? `Conta: <strong>${esc(email)}</strong>` : ''}</p>
      <form id="formSenha" class="auth-form" method="post" action="#" novalidate>
        <input type="email" name="username" autocomplete="username" value="${esc(email || '')}" hidden readonly>
        <label class="auth-field">Nova senha
          <input type="password" name="senha" autocomplete="new-password" required maxlength="${SENHA_MAX}" autofocus aria-describedby="regrasSenha"></label>
        <label class="auth-field">Repita a nova senha
          <input type="password" name="confirmacao" autocomplete="new-password" required maxlength="${SENHA_MAX}"></label>
        <ul class="auth-rules" id="regrasSenha" aria-live="polite"></ul>
        <div class="auth-msg auth-msg-erro" id="erroSenha" role="alert" hidden></div>
        <button class="btn btn-primary auth-submit" type="submit" data-rotulo="Salvar senha" disabled>Salvar senha</button>
      </form>`);
    const form = raiz.querySelector('#formSenha');
    const lista = form.querySelector('#regrasSenha');
    const btn = form.querySelector('button[type="submit"]');
    const atualizar = () => {
      const regras = regrasSenha(form.senha.value, form.confirmacao.value, email);
      lista.innerHTML = regras.map(r => `<li class="${r.ok ? 'ok' : ''}">${r.ok ? '✓' : '•'} ${esc(r.texto)}</li>`).join('');
      btn.disabled = !regras.every(r => r.ok);
      return regras.every(r => r.ok);
    };
    form.addEventListener('input', atualizar);
    atualizar();
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const erroEl = form.querySelector('#erroSenha');
      erroEl.hidden = true;
      if (!atualizar()) return;
      ocupado(form, true);
      const { error } = await sb.auth.updateUser({ password: form.senha.value });
      if (error) {
        ocupado(form, false);
        atualizar();
        erroEl.textContent = mensagemErroSenha(error);
        erroEl.hidden = false;
        if (error.status === 401 || error.code === 'session_not_found' || error.code === 'session_expired') {
          await sair(false);
          telaLinkInvalido('expirado');
        }
        return;
      }
      form.senha.value = ''; form.confirmacao.value = '';
      await sair(false);
      telaLogin('Senha definida com sucesso. Entre com o seu e-mail e a nova senha.', 'ok');
    });
  }

  function mensagemErroSenha(error) {
    const cod = error.code || '';
    if (cod === 'same_password') return 'A nova senha precisa ser diferente da anterior.';
    if (cod === 'weak_password') return 'A senha não atende às regras de segurança do servidor. Escolha uma senha mais longa e variada.';
    if (/aal2|mfa/i.test(cod + ' ' + (error.message || ''))) return 'Esta conta exige o código do autenticador para trocar a senha.';
    if (error.status === 401) return 'Sua sessão do link expirou. Peça um novo link.';
    if (error.status === 429) return 'Muitas tentativas. Aguarde alguns minutos.';
    return 'Não foi possível salvar a senha. Tente de novo.';
  }

  function telaVerificacaoPendente(email) {
    renderizar(`
      <h1 class="auth-title" tabindex="-1">Verificação em 2 etapas pendente</h1>
      <p class="auth-sub">Conectado como <strong>${esc(email || '')}</strong>.</p>
      ${aviso('Por segurança, as telas do sistema só são liberadas depois da verificação em 2 etapas (código do aplicativo autenticador). Essa configuração será habilitada na próxima etapa de implantação.', 'info')}
      <div class="btn-row"><button class="btn btn-ghost" id="btnSair" type="button">Sair</button></div>`);
    raiz.querySelector('#btnSair').addEventListener('click', async () => { await sair(true); telaLogin('Você saiu do sistema.', 'ok'); });
  }

  // ---------------------------------------------------------------
  // 3. Fluxos
  // ---------------------------------------------------------------
  async function tratarLink(link) {
    if (link.formatoNaoSuportado) return telaLinkInvalido('formato');
    if (link.erro) return telaLinkInvalido(/expired|otp/.test(link.erro) ? 'expirado' : 'invalido');
    if (!TIPOS_DE_LINK.includes(link.tipo)) return telaLinkInvalido('invalido');

    telaCarregando('Validando o link…');
    await sb.auth.signOut({ scope: 'local' }).catch(() => {});      // descarta qualquer sessão anterior desta aba

    let resultado;
    if (link.tokenHash) {
      resultado = await sb.auth.verifyOtp({ token_hash: link.tokenHash, type: link.tipo });
    } else if (link.accessToken && link.refreshToken) {
      resultado = await sb.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken });
    } else {
      return telaLinkInvalido('invalido');
    }
    if (resultado.error || !resultado.data || !resultado.data.session) {
      await sair(false);
      const cod = (resultado.error && (resultado.error.code || '')) || '';
      return telaLinkInvalido(/expired/.test(cod) || (resultado.error && resultado.error.status === 403) ? 'expirado' : 'invalido');
    }

    // conta com autenticador: o link de recuperação gera só aal1 e o Supabase exige aal2 para trocar a senha
    const aal = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal.data && aal.data.nextLevel === 'aal2' && aal.data.currentLevel !== 'aal2') {
      await sair(false);
      return telaRecuperacaoComMfa();
    }
    const usuario = resultado.data.session.user || resultado.data.user || {};
    telaDefinirSenha(link.tipo, usuario.email);
  }

  async function aposLogin() {
    const { data } = await sb.auth.getSession();
    const sessao = data && data.session;
    if (!sessao) return telaLogin();
    // Próximas etapas: exigir aal2 (MFA) e ler o perfil (papel/ativo) antes de liberar as telas.
    // Nesta etapa as telas NUNCA são liberadas.
    if (!podeLiberarTelas()) return telaVerificacaoPendente(sessao.user && sessao.user.email);
  }

  function podeLiberarTelas() {
    return false;          // Etapas 3 (MFA/aal2) e 4 (perfil ativo no banco) — ainda não implantadas
  }

  async function sair(global) {
    try { if (sb) await sb.auth.signOut({ scope: global ? 'global' : 'local' }); } catch (e) { /* segue limpando */ }
    try { window.sessionStorage.removeItem(CHAVE_SESSAO); } catch (e) { /* ignore */ }
    if (telasLiberadas) window.location.reload();      // garante que nada carregado fique na memória
  }

  // ---------------------------------------------------------------
  // 4. Início
  // ---------------------------------------------------------------
  async function iniciar() {
    raiz = document.getElementById('authRoot');
    const link = capturarLink();                          // já limpo do endereço por link-auth.js
    try { window.localStorage.removeItem('altum-si-role'); } catch (e) { /* perfil simulado antigo */ }

    if (emMoldura()) { document.body.innerHTML = ''; return; }
    if (!cfg.url || !cfg.publishableKey || !window.supabase || !window.supabase.createClient) return telaErroConfiguracao();

    sb = window.supabase.createClient(cfg.url, cfg.publishableKey, {
      auth: {
        storage: window.sessionStorage,
        storageKey: CHAVE_SESSAO,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,          // o link é tratado aqui, com limpeza imediata do endereço
        flowType: 'implicit'
      }
    });
    sb.auth.onAuthStateChange(ev => {
      if (ev === 'SIGNED_OUT' && telasLiberadas) window.location.reload();
    });

    try {
      if (link) return await tratarLink(link);
      telaCarregando();
      const { data } = await sb.auth.getSession();
      if (data && data.session) return await aposLogin();
      telaLogin();
    } catch (e) {
      console.error(e);
      telaLogin('Não foi possível verificar o acesso agora. Tente de novo.', 'erro');
    }
  }

  A.auth = {
    // usado pelos testes e pelas próximas etapas; não expõe o cliente nem tokens
    get telasLiberadas() { return telasLiberadas; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})(window.ALTUM);
