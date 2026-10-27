/* ALTUM Sales Intelligence — autenticação (Supabase Auth)
 * ---------------------------------------------------------------
 * Links de convite/recuperação, definição de senha, login, verificação em
 * 2 etapas (TOTP), perfil real lido do banco, logout e encerramento por inatividade.
 * As 7 telas só abrem com: senha + código do autenticador (sessão aal2)
 * + perfil ATIVO lido da tabela perfis (papel admin/operador vem do banco).
 *
 * Segurança:
 *  • Só usa a Project URL e a chave publishable (config.js). Nunca secret/service_role.
 *  • Tokens que chegam no endereço (?token_hash=… ou #access_token=…) são lidos e
 *    APAGADOS do endereço por link-auth.js, antes de qualquer outro recurso carregar.
 *  • Sessão guardada em sessionStorage (fecha a aba = sai).
 *  • Nenhum dado de cliente é carregado antes da autenticação completa.
 *  • 30 minutos sem atividade (configurável em config.js) = sessão encerrada.
 */
(function (A) {
  'use strict';

  const cfg = (A.config && A.config.supabase) || {};
  const TIPOS_DE_LINK = ['invite', 'recovery'];
  const SENHA_MIN = 12, SENHA_MAX = 72;               // 72 = limite do bcrypt usado pelo Supabase
  const CHAVE_SESSAO = 'altum-si-auth';
  const CHAVE_ATIVIDADE = 'altum-si-ultima-atividade';
  const CHAVE_AVISO = 'altum-si-aviso';
  const INATIVIDADE_MS = Math.max(1, Number((A.config && A.config.inatividadeMinutos) || 30)) * 60 * 1000;
  const AVISO_ANTES_MS = 60 * 1000;
  const EMISSOR_TOTP = 'ALTUM Sales Intelligence';     // nome que aparece no aplicativo autenticador
  const iniciarApp = A.app && A.app.entregarIniciador ? A.app.entregarIniciador() : null;   // só auth.js recebe
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
      await continuarAcesso();
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

  // ---- Verificação em 2 etapas (TOTP) -------------------------------
  function campoCodigo() {
    return `<label class="auth-field">Código de 6 dígitos
          <input type="text" name="codigo" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}"
                 maxlength="7" required autofocus spellcheck="false" class="auth-code"></label>`;
  }
  function lerCodigo(form) {
    const c = String(form.codigo.value || '').replace(/\D/g, '');
    return c.length === 6 ? c : null;
  }
  function mensagemErroCodigo(error) {
    const cod = (error && error.code) || '';
    if (error && error.status === 429 || /rate_limit/.test(cod)) return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
    if (/challenge_expired/.test(cod)) return 'O código expirou. Digite o código atual do aplicativo.';
    if (/verification_failed|invalid/.test(cod) || (error && error.status === 422) || (error && error.status === 400))
      return 'Código incorreto. Confira se o horário do celular está automático e digite o código atual.';
    if (error && error.status === 401) return 'Sua sessão expirou. Entre novamente.';
    if (!error || !error.status || error.status >= 500) return 'Não foi possível falar com o servidor. Tente de novo.';
    return 'Não foi possível confirmar o código. Tente de novo.';
  }
  function botaoSair(id) {
    return `<button class="btn btn-ghost" id="${id}" type="button">Sair</button>`;
  }
  function ligarSair(id) {
    const b = raiz.querySelector('#' + id);
    if (b) b.addEventListener('click', async () => { await sair(true); telaLogin('Você saiu do sistema.', 'ok'); });
  }

  // Cadastro do autenticador (primeiro acesso): QR Code + chave manual + código para ativar.
  async function telaCadastroMfa(email, fatoresPendentes) {
    telaCarregando('Preparando a verificação em 2 etapas…');
    // QR Codes gerados antes e não confirmados são descartados (só fatores NÃO verificados)
    for (const f of fatoresPendentes || []) {
      await sb.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
    }
    const { data, error } = await sb.auth.mfa.enroll({
      factorType: 'totp', issuer: EMISSOR_TOTP, friendlyName: 'ALTUM SI ' + Date.now().toString(36)
    });
    if (error || !data || !data.totp) return telaFalha(
      /not_enabled|disabled/.test((error && error.code) || '')
        ? 'A verificação em 2 etapas (TOTP) não está habilitada no projeto. Peça ao administrador para habilitá-la no painel do Supabase.'
        : 'Não foi possível iniciar o cadastro do autenticador.', email);

    const fatorId = data.id;
    const segredo = String(data.totp.secret || '').replace(/(.{4})/g, '$1 ').trim();
    renderizar(`
      <h1 class="auth-title" tabindex="-1">Ative a verificação em 2 etapas</h1>
      <p class="auth-sub">Conta: <strong>${esc(email || '')}</strong></p>
      <ol class="auth-steps">
        <li>Instale um aplicativo autenticador no celular (Google Authenticator, Microsoft Authenticator, 1Password ou similar).</li>
        <li>No aplicativo, toque em <strong>adicionar</strong> e leia o QR Code abaixo.</li>
        <li>Digite o código de 6 dígitos que aparecer no aplicativo.</li>
      </ol>
      <div class="auth-qr"><img id="qrMfa" alt="QR Code para cadastrar o ALTUM Sales Intelligence no aplicativo autenticador" width="200" height="200"></div>
      <details class="auth-details"><summary>Não consegue ler o QR Code? Digite a chave</summary>
        <p class="small">Chave (sem os espaços): <code class="auth-secret" id="segredoMfa"></code></p>
        <p class="small muted">Não compartilhe esta chave nem tire foto dela. Ela some ao sair desta tela.</p>
      </details>
      <form id="formAtivarMfa" class="auth-form" method="post" action="#" novalidate>
        ${campoCodigo()}
        <div class="auth-msg auth-msg-erro" id="erroMfa" role="alert" hidden></div>
        <button class="btn btn-primary auth-submit" type="submit" data-rotulo="Ativar e entrar">Ativar e entrar</button>
      </form>
      <div class="btn-row">${botaoSair('btnSair')}</div>`);
    raiz.querySelector('#qrMfa').src = data.totp.qr_code;        // atribuição direta: nada é interpretado como HTML
    raiz.querySelector('#segredoMfa').textContent = segredo;
    ligarSair('btnSair');
    const form = raiz.querySelector('#formAtivarMfa');
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const erroEl = form.querySelector('#erroMfa');
      erroEl.hidden = true;
      const codigo = lerCodigo(form);
      if (!codigo) { erroEl.textContent = 'Digite os 6 números do aplicativo.'; erroEl.hidden = false; return; }
      ocupado(form, true);
      const r = await sb.auth.mfa.challengeAndVerify({ factorId: fatorId, code: codigo });
      form.codigo.value = '';
      if (r.error) {
        ocupado(form, false);
        erroEl.textContent = mensagemErroCodigo(r.error); erroEl.hidden = false; form.codigo.focus();
        if (r.error.status === 401) { await sair(false); telaLogin('Sua sessão expirou. Entre novamente.', 'erro'); }
        return;
      }
      await continuarAcesso();
    });
  }

  // Código do autenticador (logins seguintes, ou antes de trocar a senha).
  function telaCodigoMfa(email, fatorId, aoConfirmar, opcoes) {
    const o = opcoes || {};
    renderizar(`
      <h1 class="auth-title" tabindex="-1">${esc(o.titulo || 'Verificação em 2 etapas')}</h1>
      <p class="auth-sub">Conta: <strong>${esc(email || '')}</strong></p>
      <p class="auth-sub">${esc(o.texto || 'Abra o aplicativo autenticador e digite o código de 6 dígitos do ALTUM Sales Intelligence.')}</p>
      <form id="formCodigoMfa" class="auth-form" method="post" action="#" novalidate>
        ${campoCodigo()}
        <div class="auth-msg auth-msg-erro" id="erroMfa" role="alert" hidden></div>
        <button class="btn btn-primary auth-submit" type="submit" data-rotulo="Confirmar">Confirmar</button>
      </form>
      <div class="btn-row">${botaoSair('btnSair')}</div>
      <p class="auth-foot small muted">Perdeu o acesso ao aplicativo autenticador? Fale com o administrador.</p>`);
    ligarSair('btnSair');
    const form = raiz.querySelector('#formCodigoMfa');
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const erroEl = form.querySelector('#erroMfa');
      erroEl.hidden = true;
      const codigo = lerCodigo(form);
      if (!codigo) { erroEl.textContent = 'Digite os 6 números do aplicativo.'; erroEl.hidden = false; return; }
      ocupado(form, true);
      const r = await sb.auth.mfa.challengeAndVerify({ factorId: fatorId, code: codigo });
      form.codigo.value = '';
      if (r.error) {
        ocupado(form, false);
        erroEl.textContent = mensagemErroCodigo(r.error); erroEl.hidden = false; form.codigo.focus();
        if (r.error.status === 401) { await sair(false); telaLogin('Sua sessão expirou. Entre novamente.', 'erro'); }
        return;
      }
      await aoConfirmar();
    });
  }

  function telaFalha(texto, email) {
    renderizar(`<h1 class="auth-title" tabindex="-1">Não foi possível continuar</h1>
      ${email ? `<p class="auth-sub">Conta: <strong>${esc(email)}</strong></p>` : ''}
      ${aviso(texto, 'erro')}
      <div class="btn-row"><button class="btn btn-primary" id="btnTentar" type="button">Tentar de novo</button>${botaoSair('btnSair')}</div>`);
    raiz.querySelector('#btnTentar').addEventListener('click', () => continuarAcesso());
    ligarSair('btnSair');
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

    iniciarVigiaInatividade(true);
    const usuario = resultado.data.session.user || resultado.data.user || {};
    // conta com autenticador: o link de recuperação gera só aal1 e o Supabase exige aal2
    // para trocar a senha → pede o código ANTES de mostrar o formulário de senha
    const fatores = await sb.auth.mfa.listFactors();
    if (fatores.error) { await sair(false); return telaLinkInvalido('invalido'); }
    const totp = (fatores.data.totp || [])[0];
    if (totp) {
      return telaCodigoMfa(usuario.email, totp.id, () => telaDefinirSenha(link.tipo, usuario.email), {
        titulo: 'Confirme o código para trocar a senha',
        texto: 'Esta conta usa verificação em 2 etapas. Digite o código do aplicativo autenticador para continuar.'
      });
    }
    telaDefinirSenha(link.tipo, usuario.email);
  }

  // Decide a próxima tela a partir do estado REAL (servidor), nunca de algo guardado no navegador:
  // sem sessão → login · perfil inativo → bloqueado · sem autenticador → cadastro
  // · com autenticador e aal1 → código · aal2 + perfil ativo → libera as 7 telas.
  async function continuarAcesso() {
    if (telasLiberadas) return;
    const { data } = await sb.auth.getSession();
    const sessao = data && data.session;
    if (!sessao) return telaLogin();
    if (!iniciarVigiaInatividade(false)) return;              // sessão parada há mais de 30 min
    const email = sessao.user && sessao.user.email;
    telaCarregando();

    const perfil = await lerPerfil(sessao.user.id);
    if (perfil.erro) return telaFalha('Não foi possível ler o seu perfil de acesso. Verifique a conexão.', email);
    if (!perfil.dados || perfil.dados.ativo !== true) {
      await sair(false);
      return telaLogin('Esta conta está desativada ou sem acesso ao sistema. Fale com o administrador.', 'erro');
    }

    const fatores = await sb.auth.mfa.listFactors();            // consulta o servidor (getUser)
    if (fatores.error) {
      if (fatores.error.status === 401 || fatores.error.status === 403) { await sair(false); return telaLogin('Sua sessão expirou. Entre novamente.', 'erro'); }
      return telaFalha('Não foi possível verificar a configuração em 2 etapas.', email);
    }
    const totp = (fatores.data.totp || [])[0];
    if (!totp) {
      const pendentes = (fatores.data.all || []).filter(f => f.factor_type === 'totp' && f.status !== 'verified');
      return telaCadastroMfa(email, pendentes);
    }
    const nivel = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!nivel.data || nivel.data.currentLevel !== 'aal2') {
      return telaCodigoMfa(email, totp.id, () => continuarAcesso());
    }
    liberarTelas(perfil.dados, email);
  }

  // Leitura do próprio perfil: o RLS (002/008) permite ler só a própria linha antes do aal2.
  async function lerPerfil(uid) {
    try {
      const { data, error } = await sb.from('perfis').select('nome, papel, ativo').eq('id', uid).maybeSingle();
      if (error) return { erro: error };
      return { dados: data };
    } catch (e) { return { erro: e }; }
  }

  function liberarTelas(perfil, email) {
    if (!iniciarApp || !iniciarApp({ papel: perfil.papel })) {
      return telaFalha('Recarregue a página para continuar.', email);
    }
    telasLiberadas = true;
    raiz.innerHTML = '';
    const papelTexto = perfil.papel === 'admin' ? 'Administrador' : 'Operador';
    const info = document.getElementById('sessaoInfo');
    if (info) {
      info.innerHTML = `<div class="sessao-nome">${esc(perfil.nome || '')}</div>
        <div class="small">${esc(email || '')}</div>
        <div class="sessao-papel">${esc(papelTexto)}</div>
        <button class="btn btn-ghost btn-sm" id="btnSairApp" type="button">Sair</button>`;
      info.querySelector('#btnSairApp').addEventListener('click', () => sair(true));
    }
  }

  // ---------------------------------------------------------------
  // 4. Encerramento por inatividade (30 min, valendo também após recarregar a aba)
  // ---------------------------------------------------------------
  let ultimaAtividade = 0, vigia = null, avisado = false;
  const EVENTOS_ATIVIDADE = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove', 'wheel'];

  function lerAtividadeGuardada() {
    try { const v = Number(window.sessionStorage.getItem(CHAVE_ATIVIDADE)); return Number.isFinite(v) && v > 0 ? v : 0; } catch (e) { return 0; }
  }
  function registrarAtividade(forcar) {
    const agora = Date.now();
    if (!forcar && agora - ultimaAtividade < 5000) return;     // grava no máximo a cada 5 s
    ultimaAtividade = agora; avisado = false;
    try { window.sessionStorage.setItem(CHAVE_ATIVIDADE, String(agora)); } catch (e) { /* ignore */ }
  }
  const aoAtivar = () => registrarAtividade(false);

  // Retorna false se a sessão já estava inativa (e a encerra).
  function iniciarVigiaInatividade(novaSessao) {
    if (vigia) return true;
    const guardada = novaSessao ? 0 : lerAtividadeGuardada();
    if (guardada && Date.now() - guardada >= INATIVIDADE_MS) { encerrarPorInatividade(); return false; }
    ultimaAtividade = guardada || 0;
    registrarAtividade(true);
    EVENTOS_ATIVIDADE.forEach(ev => window.addEventListener(ev, aoAtivar, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', verificarInatividade);
    vigia = window.setInterval(verificarInatividade, 15000);
    return true;
  }
  function pararVigia() {
    if (vigia) window.clearInterval(vigia);
    vigia = null;
    EVENTOS_ATIVIDADE.forEach(ev => window.removeEventListener(ev, aoAtivar, { capture: true }));
    document.removeEventListener('visibilitychange', verificarInatividade);
    try { window.sessionStorage.removeItem(CHAVE_ATIVIDADE); } catch (e) { /* ignore */ }
  }
  function verificarInatividade() {
    if (!vigia) return;
    const parado = Date.now() - ultimaAtividade;
    if (parado >= INATIVIDADE_MS) return encerrarPorInatividade();
    if (telasLiberadas && !avisado && parado >= INATIVIDADE_MS - AVISO_ANTES_MS && A.ui && A.ui.toast) {
      avisado = true;
      A.ui.toast('Sem atividade: a sessão será encerrada em 1 minuto.', 'warn');
    }
  }
  async function encerrarPorInatividade() {
    const recarrega = telasLiberadas;      // com as telas abertas, sair() recarrega a página (limpa a memória)
    if (recarrega) { try { window.sessionStorage.setItem(CHAVE_AVISO, 'inatividade'); } catch (e) { /* ignore */ } }
    await sair(false);
    if (!recarrega) telaLogin('Sua sessão foi encerrada após ' + Math.round(INATIVIDADE_MS / 60000) + ' minutos sem atividade. Entre novamente.', 'info');
  }

  async function sair(global) {
    pararVigia();
    try { if (sb) await sb.auth.signOut({ scope: global ? 'global' : 'local' }); } catch (e) { /* segue limpando */ }
    try { window.sessionStorage.removeItem(CHAVE_SESSAO); } catch (e) { /* ignore */ }
    if (telasLiberadas) window.location.reload();      // garante que nada carregado fique na memória
  }

  // ---------------------------------------------------------------
  // 5. Início
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

    let avisoPendente = null;
    try { avisoPendente = window.sessionStorage.getItem(CHAVE_AVISO); window.sessionStorage.removeItem(CHAVE_AVISO); } catch (e) { /* ignore */ }

    try {
      if (link) return await tratarLink(link);
      if (avisoPendente === 'inatividade') {
        return telaLogin('Sua sessão foi encerrada após ' + Math.round(INATIVIDADE_MS / 60000) + ' minutos sem atividade. Entre novamente.', 'info');
      }
      telaCarregando();
      const { data } = await sb.auth.getSession();
      if (data && data.session) return await continuarAcesso();
      telaLogin();
    } catch (e) {
      console.error(e);
      telaLogin('Não foi possível verificar o acesso agora. Tente de novo.', 'erro');
    }
  }

  A.auth = Object.freeze({
    // só leitura; não expõe o cliente Supabase nem tokens
    get telasLiberadas() { return telasLiberadas; }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})(window.ALTUM);
