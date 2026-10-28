/* ALTUM Sales Intelligence — leitura de dados no Supabase
 * ---------------------------------------------------------------
 * Fonte ÚNICA das telas já conectadas ao banco (Produtos; Dashboard preparado).
 * Nunca lê nem grava o localStorage: os dados do Supabase não se misturam
 * com a base fictícia local que as demais telas ainda usam.
 *
 * Segurança:
 *  • Usa o cliente Supabase da sessão autenticada (chave publishable + token do
 *    usuário). Quem decide o que pode ser lido é o RLS das migrações 001–010:
 *    leitura só para perfil ATIVO com verificação em 2 etapas (aal2).
 *  • Só pede as colunas que a tela usa (sem e-mail/telefone de clientes).
 *  • Sem aal2 o RLS devolve listas VAZIAS (não erro). Para não exibir zeros
 *    enganosos, toda leitura confere a linha única de configuracoes: se ela
 *    não vier, o acesso não está liberado e a tela mostra erro.
 */
(function (A) {
  'use strict';

  const PAGINA = 1000;                  // limite padrão de linhas por resposta no Supabase
  const LIMITE_SEGURANCA = 100000;      // evita laço infinito se o servidor responder algo inesperado
  let sb = null;

  class ErroDados extends Error {
    constructor(tipo, mensagem, detalhe) { super(mensagem); this.tipo = tipo; this.detalhe = detalhe; }
  }

  function traduzirErro(error, oque) {
    const cod = String((error && (error.code || '')) || '');
    const status = error && error.status;
    const msg = String((error && error.message) || '');
    if (status === 401 || /PGRST30[0-9]|jwt|JWT/.test(cod + ' ' + msg))
      return new ErroDados('sessao', 'Sua sessão expirou. Saia e entre novamente.', cod);
    if (cod === '42501' || status === 403)
      return new ErroDados('permissao', `Sem permissão para ler ${oque}. Verifique se o seu perfil está ativo.`, cod);
    if (!status || status >= 500 || /fetch|network|Failed/i.test(msg))
      return new ErroDados('rede', 'Não foi possível falar com o Supabase. Verifique a conexão e tente de novo.', cod || msg);
    return new ErroDados('consulta', `Erro ao ler ${oque}.`, cod || msg);
  }

  // Lê todas as linhas, página a página, até o total informado pelo servidor
  // (funciona mesmo que o limite de linhas do projeto seja menor que PAGINA).
  async function lerTudo(montar, oque) {
    const linhas = [];
    let total = null;
    while (linhas.length < LIMITE_SEGURANCA) {
      let r;
      try {
        r = await montar(total === null ? { count: 'exact' } : undefined).range(linhas.length, linhas.length + PAGINA - 1);
      } catch (e) { throw traduzirErro(e, oque); }
      if (r.error) throw traduzirErro(r.error, oque);
      if (total === null) total = typeof r.count === 'number' ? r.count : null;
      const dados = r.data || [];
      linhas.push(...dados);
      if (dados.length === 0) break;
      if (total !== null ? linhas.length >= total : dados.length < PAGINA) break;
    }
    if (total !== null && linhas.length !== total)
      throw new ErroDados('consulta', `Leitura incompleta de ${oque} (${linhas.length} de ${total}). Tente de novo.`);
    return linhas;
  }

  function exigirCliente() {
    if (!sb) throw new ErroDados('acesso', 'Conexão com o banco não iniciada. Recarregue a página.');
  }

  // Data/hora do banco (timestamptz) → dia no fuso do navegador (mesma regra das telas)
  function diaLocal(ts) {
    if (!ts) return null;
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : A.analytics.iso(d);
  }
  const num = v => (v === null || v === undefined ? 0 : Number(v));

  // Origem dos registros (coluna "fonte" de clientes, pedidos, leads e produtos).
  // "real" = manual + nuvemshop + importacao · "ficticio" = carga de teste da migração 010.
  // As duas NUNCA se misturam num mesmo cálculo.
  const ORIGENS_DASHBOARD = ['real', 'ficticio'];
  const filtrarOrigem = (q, origem) => (origem === 'ficticio' ? q.eq('fonte', 'ficticio') : q.neq('fonte', 'ficticio'));
  const daOrigem = (fonte, origem) => (origem === 'ficticio' ? fonte === 'ficticio' : fonte !== 'ficticio');

  /**
   * Dados do Dashboard comercial, todos do Supabase, de UMA origem (real ou fictícia).
   * Devolve a "base" no formato de A.analytics + oportunidades de recompra da visão
   * v_oportunidades_recompra (regras da 006/011: só produto ativo, sem anonimizados).
   */
  async function dashboard(origem) {
    exigirCliente();
    if (!ORIGENS_DASHBOARD.includes(origem)) throw new ErroDados('consulta', 'Origem de dados inválida.');
    const hoje = A.analytics.iso(A.analytics.today());

    const [cfg, clientes, pedidos, leads, oportunidades, produtos, ficticios] = await Promise.all([
      lerTudo(o => sb.from('configuracoes')
        .select('id, inativo_apos_dias, fidelidade_min_pedidos, janela_antes_dias, janela_depois_dias', o).order('id'), 'as configurações'),
      lerTudo(o => filtrarOrigem(sb.from('clientes')
        .select('id, nome, origem, cadastrado_em, status_comercial, anonimizado_em, fonte', o), origem).order('id'), 'os clientes'),
      lerTudo(o => filtrarOrigem(sb.from('pedidos')
        .select('id, cliente_id, data_pedido, status, total, cupom_codigo, fonte', o).eq('status', 'pago'), origem).order('id'), 'os pedidos'),
      lerTudo(o => filtrarOrigem(sb.from('leads')
        .select('id, nome, empresa, origem, etapa, proximo_contato, fonte', o)
        .is('anonimizado_em', null).not('etapa', 'in', '(comprou,perdido)')
        .not('proximo_contato', 'is', null).lte('proximo_contato', hoje), origem).order('id'), 'os follow-ups do funil'),
      lerTudo(o => sb.from('v_oportunidades_recompra')
        .select('cliente_id, produto_id, produto, reposicao_estimada, dias_apos_estimativa, situacao, pode_whatsapp, pode_email', o)
        .eq('situacao', 'janela').order('cliente_id').order('produto_id'), 'as oportunidades de recompra'),
      lerTudo(o => sb.from('produtos').select('id, fonte', o).order('id'), 'os produtos'),
      (async () => {
        let r;
        try { r = await sb.from('clientes').select('id', { count: 'exact', head: true }).eq('fonte', 'ficticio'); }
        catch (e) { throw traduzirErro(e, 'os dados de teste'); }
        if (r.error) throw traduzirErro(r.error, 'os dados de teste');
        return r.count || 0;
      })()
    ]);

    // Sem a linha única de configurações, o RLS não liberou o acesso (sem aal2 ou perfil inativo)
    if (cfg.length !== 1) {
      throw new ErroDados('acesso', 'O banco não liberou a leitura dos dados. Saia e entre novamente com o código do autenticador.');
    }
    // Conferência defensiva: o filtro foi feito no banco; nada de outra origem passa daqui.
    if ([clientes, pedidos, leads].some(l => l.some(x => !daOrigem(x.fonte, origem)))) {
      throw new ErroDados('consulta', 'O banco devolveu registros de outra origem. Nenhum número foi exibido.');
    }
    const c = cfg[0];
    const idsClientes = new Set(clientes.map(x => x.id));
    // Pedido desta origem ligado a cliente de OUTRA origem: fica fora de todos os indicadores e é informado.
    const pedidosValidos = pedidos.filter(p => idsClientes.has(p.cliente_id));
    const pedidosForaDaOrigem = pedidos.length - pedidosValidos.length;

    const base = {
      fonte: 'supabase', origem,
      regras: {
        inativoAposDias: c.inativo_apos_dias,
        fidelidadeMinPedidos: c.fidelidade_min_pedidos,
        janelaAntesDias: c.janela_antes_dias,
        janelaDepoisDias: c.janela_depois_dias
      },
      clientes: clientes.map(x => ({
        id: x.id,
        nome: x.anonimizado_em ? null : x.nome,          // anonimizado: nenhum dado pessoal (o banco já guarda nulo)
        origem: x.origem,
        criadoEm: diaLocal(x.cadastrado_em),
        statusComercial: x.status_comercial,
        anonimizado: !!x.anonimizado_em,
        consentimento: {}
      })),
      pedidos: pedidosValidos.map(p => ({
        id: p.id, clienteId: p.cliente_id, data: diaLocal(p.data_pedido), status: p.status,
        total: num(p.total), cupom: p.cupom_codigo, itens: []       // itens não são usados pelos indicadores do Dashboard
      })),
      leads: leads.map(l => ({
        id: l.id, nome: l.nome, empresa: l.empresa, origem: l.origem, etapa: l.etapa, proximoContato: l.proximo_contato
      })),
      produtos: [],
      campanhas: []
    };

    // Recompra: só clientes e produtos desta origem; uma linha por cliente (reposição mais adiantada
    // na janela); fora "não contatar" e anonimizados. Ícones = regra real do banco (app.marketing_permitido).
    const fonteProduto = new Map(produtos.map(p => [p.id, p.fonte]));
    const porId = new Map(base.clientes.map(x => [x.id, x]));
    const melhor = new Map();
    oportunidades.forEach(o => {
      const cli = porId.get(o.cliente_id);
      if (!cli || cli.anonimizado || cli.statusComercial === 'nao_contatar') return;
      if (!fonteProduto.has(o.produto_id) || !daOrigem(fonteProduto.get(o.produto_id), origem)) return;
      const atual = melhor.get(o.cliente_id);
      if (!atual || o.dias_apos_estimativa < atual.delta) {
        melhor.set(o.cliente_id, {
          clienteId: o.cliente_id,
          cliente: Object.assign({}, cli, { consentimento: { whatsapp: o.pode_whatsapp === true, email: o.pode_email === true } }),
          produto: { id: o.produto_id, nome: o.produto },
          estimada: o.reposicao_estimada,
          delta: o.dias_apos_estimativa,
          status: 'janela'
        });
      }
    });
    const janela = [...melhor.values()].sort((a, b) => a.delta - b.delta || String(a.cliente.nome).localeCompare(String(b.cliente.nome)));

    return {
      origem, base, janela, lidoEm: new Date(),
      vazio: clientes.length === 0 && pedidos.length === 0 && leads.length === 0,
      pedidosForaDaOrigem,
      existemFicticios: ficticios > 0
    };
  }

  // ---------------------------------------------------------------
  // Produtos (migração 011)
  // ---------------------------------------------------------------
  const BUCKET = 'produtos';
  const IMAGEM_MAX_BYTES = 1024 * 1024;
  const TIPOS_IMAGEM = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const CODIGOS_DO_BANCO = { '22023': 'validacao', '23505': 'duplicado', 'PT409': 'conflito', 'P0002': 'nao_encontrado', '23503': 'historico' };

  // Erros das funções de gravação: as mensagens do banco já vêm em português e são exibidas como estão.
  function traduzirErroGravacao(error, oque) {
    const cod = String((error && error.code) || '');
    if (CODIGOS_DO_BANCO[cod]) return new ErroDados(CODIGOS_DO_BANCO[cod], String(error.message || 'Dados inválidos.'), cod);
    if (cod === '42501') return new ErroDados('permissao', String(error.message || 'Sem permissão.'), cod);
    return traduzirErro(error, oque);
  }

  async function rpc(nome, args, oque) {
    exigirCliente();
    let r;
    try { r = await sb.rpc(nome, args); } catch (e) { throw traduzirErro(e, oque); }
    if (r.error) throw traduzirErroGravacao(r.error, oque);
    return r.data;
  }

  function urlImagemProduto(caminho) {
    if (!caminho || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(caminho)) return null;
    const base = (A.config && A.config.supabase && A.config.supabase.url) || '';
    return `${base}/storage/v1/object/public/${BUCKET}/${caminho}`;
  }

  // Lista de produtos (todos os perfis com 2 etapas) + custos (SOMENTE administrador: o banco recusa os demais).
  async function produtos() {
    exigirCliente();
    const admin = A.session.isAdmin();
    const [cfg, lista, custos] = await Promise.all([
      lerTudo(o => sb.from('configuracoes').select('id', o).order('id'), 'as configurações'),
      lerTudo(o => sb.from('produtos')
        .select('id, nome, sku, categoria, preco, ciclo_recompra_dias, ativo, fonte, imagem_path, nuvemshop_produto_id, nuvemshop_variante_id, sincronizado_em, versao, criado_em, atualizado_em', o)
        .order('nome').order('id'), 'os produtos'),
      admin ? lerTudo(o => sb.from('produto_custos').select('produto_id, custo, atualizado_em', o).order('produto_id'), 'os custos') : Promise.resolve(null)
    ]);
    if (cfg.length !== 1) {
      throw new ErroDados('acesso', 'O banco não liberou a leitura dos dados. Saia e entre novamente com o código do autenticador.');
    }
    const mapaCustos = custos ? new Map(custos.map(c => [c.produto_id, num(c.custo)])) : null;
    return {
      lidoEm: new Date(),
      comCusto: !!mapaCustos,
      itens: lista.map(p => ({
        id: p.id, nome: p.nome, sku: p.sku, categoria: p.categoria,
        preco: p.preco === null ? null : num(p.preco),
        custo: mapaCustos ? (mapaCustos.has(p.id) ? mapaCustos.get(p.id) : null) : undefined,
        ciclo: p.ciclo_recompra_dias, ativo: p.ativo, fonte: p.fonte,
        imagemPath: p.imagem_path, imagemUrl: urlImagemProduto(p.imagem_path),
        nuvemshopProdutoId: p.nuvemshop_produto_id, nuvemshopVarianteId: p.nuvemshop_variante_id,
        sincronizadoEm: p.sincronizado_em, versao: num(p.versao), criadoEm: p.criado_em, atualizadoEm: p.atualizado_em
      }))
    };
  }

  function salvarProduto(d) {
    return rpc('produto_salvar', {
      p_id: d.id || null, p_versao: d.id ? d.versao : null,
      p_nome: d.nome, p_sku: d.sku, p_categoria: d.categoria || null,
      p_preco: d.preco, p_custo: d.custo === undefined ? null : d.custo, p_ciclo: d.ciclo === undefined ? null : d.ciclo
    }, 'o produto');
  }

  function alterarStatusProduto(id, ativo, versao) {
    return rpc('produto_alterar_status', { p_id: id, p_ativo: !!ativo, p_versao: versao }, 'o produto');
  }

  // Confere o conteúdo real do arquivo (não só a extensão): JPG, PNG ou WebP.
  async function tipoRealDaImagem(arquivo) {
    const b = new Uint8Array(await arquivo.slice(0, 12).arrayBuffer());
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    return null;
  }

  async function validarImagem(arquivo) {
    if (!arquivo) throw new ErroDados('validacao', 'Escolha um arquivo de imagem.');
    if (arquivo.size > IMAGEM_MAX_BYTES) throw new ErroDados('validacao', `Imagem muito grande (${(arquivo.size / 1048576).toFixed(1).replace('.', ',')} MB). O limite é 1 MB.`);
    if (arquivo.size === 0) throw new ErroDados('validacao', 'O arquivo de imagem está vazio.');
    const tipo = await tipoRealDaImagem(arquivo);
    if (!tipo || !TIPOS_IMAGEM[tipo]) throw new ErroDados('validacao', 'Formato não aceito. Use JPG, PNG ou WebP.');
    return tipo;
  }

  async function apagarArquivo(caminho) {
    if (!caminho) return;
    try { await sb.storage.from(BUCKET).remove([caminho]); } catch (e) { /* arquivo órfão não afeta o produto */ }
  }

  function erroDoStorage(error) {
    const msg = String((error && (error.message || error.error)) || '');
    const status = Number(error && (error.statusCode || error.status));
    if (status === 413 || /too large|size/i.test(msg)) return new ErroDados('validacao', 'Imagem acima do limite de 1 MB.');
    if (/mime|type/i.test(msg)) return new ErroDados('validacao', 'Formato não aceito. Use JPG, PNG ou WebP.');
    if (status === 403 || /row-level security|unauthorized|policy/i.test(msg)) return new ErroDados('permissao', 'O armazenamento recusou o envio: só administrador com verificação em 2 etapas pode enviar imagens.');
    if (status === 401) return new ErroDados('sessao', 'Sua sessão expirou. Saia e entre novamente.');
    return new ErroDados('rede', 'Não foi possível enviar a imagem. Verifique a conexão e tente de novo.');
  }

  // Envia a imagem para o Storage e liga ao produto. Se a ligação falhar, apaga o arquivo enviado.
  async function enviarImagemProduto(id, versao, arquivo) {
    exigirCliente();
    const tipo = await validarImagem(arquivo);
    const caminho = `${id}/${crypto.randomUUID()}.${TIPOS_IMAGEM[tipo]}`;
    let r;
    try {
      // envia com o tipo detectado no conteúdo (não o informado pelo nome do arquivo)
      const corpo = new Blob([arquivo], { type: tipo });
      r = await sb.storage.from(BUCKET).upload(caminho, corpo, { contentType: tipo, upsert: false, cacheControl: '31536000' });
    } catch (e) { throw erroDoStorage(e); }
    if (r.error) throw erroDoStorage(r.error);
    let res;
    try {
      res = await rpc('produto_definir_imagem', { p_id: id, p_caminho: caminho, p_versao: versao }, 'a imagem');
    } catch (e) {
      await apagarArquivo(caminho);
      throw e;
    }
    if (res && res.imagem_anterior && res.imagem_anterior !== caminho) await apagarArquivo(res.imagem_anterior);
    return res;
  }

  async function removerImagemProduto(id, versao) {
    const res = await rpc('produto_definir_imagem', { p_id: id, p_caminho: null, p_versao: versao }, 'a imagem');
    if (res && res.imagem_anterior) await apagarArquivo(res.imagem_anterior);
    return res;
  }

  let configuradorEntregue = false;
  A.repositorio = Object.freeze({
    ErroDados,
    dashboard,
    produtos,
    salvarProduto,
    alterarStatusProduto,
    enviarImagemProduto,
    removerImagemProduto,
    validarImagem,
    urlImagemProduto,
    IMAGEM_MAX_BYTES,
    // entregue uma única vez (para app.js, no carregamento); o cliente só chega após aal2
    entregarConfigurador() {
      if (configuradorEntregue) return null;
      configuradorEntregue = true;
      return function configurar(cliente) { if (sb || !cliente) return false; sb = cliente; return true; };
    }
  });
})(window.ALTUM);
