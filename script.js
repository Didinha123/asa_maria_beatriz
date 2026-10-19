const NIVEL = { leitura: 1, voluntario: 2, admin: 3 };

const state = {
  sessao: null,
  produtos: [],
  locais: [],
  abaAtual: 'painel',
};

const $ = (id) => document.getElementById(id);

/* ============================ UTILITÁRIOS ============================ */

/** Chama uma função do Code.js e devolve uma Promise. */
function chamar(funcao, ...args) {
  return new Promise((ok, erro) => {
    google.script.run.withSuccessHandler(ok).withFailureHandler(erro)[funcao](...args);
  });
}

/** Escapa texto antes de colocar no HTML (dados vêm da planilha). */
function esc(texto) {
  return String(texto == null ? '' : texto).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** Transforma o texto de situação em classe CSS: "Vence em breve" -> "vence-em-breve". */
function classeSituacao(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-');
}

function badge(texto) {
  if (!texto) return '<span class="badge ok">OK</span>';
  return `<span class="badge ${classeSituacao(texto)}">${esc(texto)}</span>`;
}

function hojeISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function mostrarToast(texto, erro) {
  const el = $('toast');
  el.textContent = texto;
  el.className = 'toast mostrar' + (erro ? ' erro' : '');
  clearTimeout(mostrarToast.timer);
  mostrarToast.timer = setTimeout(() => { el.className = 'toast'; }, erro ? 5000 : 2500);
}

function podeVer(minimo) {
  return NIVEL[state.sessao.perfil] >= NIVEL[minimo];
}

/* ============================ INÍCIO ============================ */

async function iniciar() {
  if (typeof google === 'undefined' || !google.script) {
    $('carregando').classList.add('oculto');
    $('menu').classList.add('oculto');
    $('acessoNegado').textContent = 'Esta página só funciona pelo link do aplicativo no Apps Script (a URL termina em /exec). Abra o sistema por essa URL.';
    $('acessoNegado').classList.remove('oculto');
    return;
  }

  try {
    state.sessao = await chamar('getSessao');
  } catch (err) {
    $('carregando').classList.add('oculto');
    $('menu').classList.add('oculto');
    $('acessoNegado').textContent = err.message;
    $('acessoNegado').classList.remove('oculto');
    return;
  }

  $('usuario').textContent = state.sessao.nome + ' · ' + state.sessao.perfil;
  aplicarPermissoes();
  await carregarBase();
  $('carregando').classList.add('oculto');
  mostrarAba('painel');
}

/** Esconde menus, botões e formulários que o perfil não pode usar. */
function aplicarPermissoes() {
  document.querySelectorAll('[data-min]').forEach((el) => {
    el.classList.toggle('oculto', !podeVer(el.dataset.min));
  });
}

async function carregarBase() {
  const base = await chamar('carregarBase');
  state.produtos = base.produtos;
  state.locais = base.locais;
  preencherLocais();
}

function preencherLocais() {
  const opcoes = state.locais.map((l) => `<option value="${esc(l.id)}">${esc(l.nome)}</option>`).join('');
  document.querySelectorAll('select.select-local').forEach((sel) => {
    sel.innerHTML = '<option value="">Escolha...</option>' + opcoes;
  });
  $('filtroLocal').innerHTML = '<option value="">Todos os locais</option>' + opcoes;
}

/* ============================ NAVEGAÇÃO ============================ */

document.querySelectorAll('.aba').forEach((b) => {
  b.addEventListener('click', () => mostrarAba(b.dataset.aba));
});

function mostrarAba(nome) {
  state.abaAtual = nome;
  document.querySelectorAll('.aba').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === nome));
  document.querySelectorAll('.secao').forEach((s) => s.classList.toggle('oculto', s.id !== nome));

  if (nome === 'painel') carregarPainel();
  if (nome === 'estoque') carregarEstoque();
  if (nome === 'entrada') iniciarFormulario('entrada');
  if (nome === 'entrega') iniciarFormulario('entrega');
  if (nome === 'produtos') renderProdutos();
  if (nome === 'historico') carregarHistorico();
  if (nome === 'locais') renderLocais();
}

async function recarregar() {
  await carregarBase();
  mostrarAba(state.abaAtual);
}

/* ============================ PAINEL ============================ */

async function carregarPainel() {
  try {
    const p = await chamar('getPainel');
    $('numProdutos').textContent = p.produtosAtivos;
    $('numComEstoque').textContent = p.produtosComEstoque;
    $('numVencidos').textContent = p.lotesVencidos;
    $('numAVencer').textContent = p.lotesAVencer;

    $('listaAlertas').innerHTML = p.alertas.length
      ? p.alertas.map((a) => `
          <div class="alerta-item">
            <span>${esc(a.nome)} <small>(${esc(a.quantidade)} ${esc(a.unidade)})</small></span>
            ${badge(a.alerta)}
          </div>`).join('')
      : '<p class="vazio">Nenhum alerta no momento.</p>';

    $('corpoUltimas').innerHTML = p.ultimasMovimentacoes.map((m) => `
      <tr>
        <td>${esc(m.data)}</td>
        <td>${esc(m.tipo)}</td>
        <td>${esc(m.produto)}</td>
        <td>${esc(m.quantidade)}</td>
        <td>${esc(m.local)}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="vazio">Nenhuma movimentação ainda.</td></tr>';
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

/* ============================ ESTOQUE ============================ */

let estoqueCache = [];

async function carregarEstoque() {
  try {
    estoqueCache = await chamar('listarEstoque');
    desenharEstoque();
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

function desenharEstoque() {
  const busca = $('buscaEstoque').value.trim().toLowerCase();
  const filtro = $('filtroLocal');
  const localNome = filtro.value ? filtro.selectedOptions[0].textContent : '';
  const situacao = $('filtroSituacao').value;

  const lista = estoqueCache.filter((l) =>
    (!busca || l.produto.toLowerCase().includes(busca)) &&
    (!localNome || l.local === localNome) &&
    (!situacao || l.situacao === situacao));

  $('resumoEstoque').textContent = lista.length + ' lote(s) com estoque';

  $('corpoEstoque').innerHTML = lista.map((l) => `
    <tr>
      <td>${esc(l.produto)}</td>
      <td>${esc(l.local)}</td>
      <td>${esc(l.validade) || '—'}</td>
      <td>${esc(l.quantidade)}</td>
      <td>${esc(l.doador)}</td>
      <td>${l.situacao ? badge(l.situacao) : '—'}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhum lote com estoque.</td></tr>';
}

$('buscaEstoque').addEventListener('input', desenharEstoque);
$('filtroLocal').addEventListener('change', desenharEstoque);
$('filtroSituacao').addEventListener('change', desenharEstoque);

/* ============================ ENTRADA / ENTREGA ============================ */

function opcoesProdutos() {
  return '<option value="">Escolha...</option>' + state.produtos
    .map((p) => `<option value="${esc(p.id)}">${esc(p.nome)} (${esc(p.unidade)})</option>`).join('');
}

function linhaItem(tipo) {
  const validade = tipo === 'entrada'
    ? `<td><input name="validade" type="date"></td>`
    : '';
  return `
    <tr data-item>
      <td><select name="produtoId" required>${opcoesProdutos()}</select></td>
      <td><input name="quantidade" type="number" step="any" min="0.01" required></td>
      ${validade}
      <td><button type="button" class="btn secundario pequeno" data-remover>✕</button></td>
    </tr>`;
}

function iniciarFormulario(tipo) {
  const form = $(tipo === 'entrada' ? 'formEntrada' : 'formEntrega');
  const corpo = $(tipo === 'entrada' ? 'itensEntrada' : 'itensEntrega');
  form.reset();
  form.querySelector('[name="data"]').value = hojeISO();
  corpo.innerHTML = linhaItem(tipo);
}

document.querySelectorAll('[data-add]').forEach((b) => {
  b.addEventListener('click', () => {
    const tipo = b.dataset.add;
    $(tipo === 'entrada' ? 'itensEntrada' : 'itensEntrega').insertAdjacentHTML('beforeend', linhaItem(tipo));
  });
});

document.addEventListener('click', (e) => {
  const remover = e.target.closest('[data-remover]');
  if (!remover) return;
  const linhas = remover.closest('tbody').querySelectorAll('tr[data-item]');
  if (linhas.length > 1) remover.closest('tr').remove();
});

/** Lê as linhas de itens do formulário. */
function lerItens(tbodyId, tipo) {
  return Array.from(document.querySelectorAll('#' + tbodyId + ' tr[data-item]')).map((tr) => ({
    produtoId: tr.querySelector('[name="produtoId"]').value,
    quantidade: tr.querySelector('[name="quantidade"]').value,
    validade: tipo === 'entrada' ? tr.querySelector('[name="validade"]').value : '',
  }));
}

function dadosDoFormulario(form) {
  return Object.fromEntries(new FormData(form));
}

$('formEntrada').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const botao = form.querySelector('button[type="submit"]');
  const dados = dadosDoFormulario(form);
  dados.itens = lerItens('itensEntrada', 'entrada');
  botao.disabled = true;
  try {
    await chamar('registrarEntrada', dados);
    mostrarToast('Entrada registrada!');
    await recarregar();
    iniciarFormulario('entrada');
  } catch (err) {
    mostrarToast(err.message, true);
  } finally {
    botao.disabled = false;
  }
});

$('formEntrega').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const botao = form.querySelector('button[type="submit"]');
  const dados = dadosDoFormulario(form);
  dados.itens = lerItens('itensEntrega', 'entrega');
  botao.disabled = true;
  try {
    await chamar('registrarEntrega', dados);
    mostrarToast('Entrega registrada!');
    await recarregar();
    iniciarFormulario('entrega');
  } catch (err) {
    mostrarToast(err.message, true);
  } finally {
    botao.disabled = false;
  }
});

/* ============================ PRODUTOS ============================ */

function renderProdutos() {
  const busca = $('buscaProduto').value.trim().toLowerCase();
  const lista = state.produtos.filter((p) => p.nome.toLowerCase().includes(busca));
  const admin = podeVer('admin');

  $('corpoProdutos').innerHTML = lista.map((p) => `
    <tr>
      <td>${esc(p.nome)}</td>
      <td>${esc(p.categoria)}</td>
      <td>${esc(p.unidade)}</td>
      <td>${esc(p.minimo)}</td>
      <td>${esc(p.quantidade)}</td>
      <td>${esc(p.proximaValidade) || '—'}</td>
      <td>${badge(p.alerta)}</td>
      <td>
        ${podeVer('voluntario') ? `<button class="btn secundario pequeno" data-editar="${esc(p.id)}">Editar</button>` : ''}
        ${admin ? `<button class="btn perigo pequeno" data-desativar="${esc(p.id)}">Desativar</button>` : ''}
      </td>
    </tr>`).join('') || '<tr><td colspan="8" class="vazio">Nenhum produto cadastrado.</td></tr>';
}

$('buscaProduto').addEventListener('input', renderProdutos);

$('btnNovoProduto').addEventListener('click', () => abrirProduto(null));

$('corpoProdutos').addEventListener('click', async (e) => {
  const editar = e.target.closest('[data-editar]');
  const desativar = e.target.closest('[data-desativar]');
  if (editar) abrirProduto(state.produtos.find((p) => p.id === editar.dataset.editar));
  if (desativar && confirm('Desativar este produto? Ele deixa de aparecer nas listas, mas o histórico é mantido.')) {
    try {
      await chamar('desativarProduto', desativar.dataset.desativar);
      mostrarToast('Produto desativado.');
      await recarregar();
    } catch (err) {
      mostrarToast(err.message, true);
    }
  }
});

function abrirProduto(produto) {
  const form = $('formProduto');
  form.reset();
  $('tituloProduto').textContent = produto ? 'Editar produto' : 'Novo produto';
  if (produto) {
    form.id.value = produto.id;
    form.nome.value = produto.nome;
    form.categoria.value = produto.categoria;
    form.unidade.value = produto.unidade;
    form.minimo.value = produto.minimo;
  }
  $('dlgProduto').showModal();
  form.nome.focus();
}

$('formProduto').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    await chamar('salvarProduto', dadosDoFormulario(form));
    $('dlgProduto').close();
    mostrarToast('Produto salvo!');
    await recarregar();
  } catch (err) {
    mostrarToast(err.message, true);
  }
});

/* ============================ HISTÓRICO ============================ */

async function carregarHistorico() {
  try {
    const docs = await chamar('listarDocumentos');
    $('corpoHistorico').innerHTML = docs.map((d) => `
      <tr class="clicavel" data-documento="${esc(d.id)}" data-titulo="${esc(d.tipo + ' · ' + d.parte + ' · ' + d.data)}">
        <td>${esc(d.data)}</td>
        <td>${badge(d.tipo)}</td>
        <td>${esc(d.parte)}</td>
        <td>${esc(d.local)}</td>
        <td>${esc(d.responsavel)}</td>
        <td>${esc(d.observacao)}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhum registro ainda.</td></tr>';
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

$('corpoHistorico').addEventListener('click', async (e) => {
  const linha = e.target.closest('[data-documento]');
  if (!linha) return;
  $('tituloDetalhe').textContent = linha.dataset.titulo;
  $('corpoDetalhe').innerHTML = '<tr><td colspan="4" class="vazio">Carregando...</td></tr>';
  $('dlgDetalhe').showModal();
  try {
    const itens = await chamar('detalheDocumento', linha.dataset.documento);
    $('corpoDetalhe').innerHTML = itens.map((m) => `
      <tr>
        <td>${esc(m.data)}</td>
        <td>${esc(m.produto)}</td>
        <td>${esc(m.quantidade)}</td>
        <td>${esc(m.validade) || '—'}</td>
      </tr>`).join('') || '<tr><td colspan="4" class="vazio">Sem itens.</td></tr>';
  } catch (err) {
    mostrarToast(err.message, true);
  }
});

/* ============================ LOCAIS ============================ */

function renderLocais() {
  $('corpoLocais').innerHTML = state.locais.map((l) => `
    <tr>
      <td>${esc(l.nome)}</td>
      <td><button class="btn secundario pequeno" data-editar-local="${esc(l.id)}">Editar</button></td>
    </tr>`).join('') || '<tr><td colspan="2" class="vazio">Nenhum local cadastrado.</td></tr>';
}

$('btnNovoLocal').addEventListener('click', () => abrirLocal(null));

$('corpoLocais').addEventListener('click', (e) => {
  const b = e.target.closest('[data-editar-local]');
  if (b) abrirLocal(state.locais.find((l) => l.id === b.dataset.editarLocal));
});

function abrirLocal(local) {
  const form = $('formLocal');
  form.reset();
  $('tituloLocal').textContent = local ? 'Editar local' : 'Novo local';
  if (local) {
    form.id.value = local.id;
    form.nome.value = local.nome;
  }
  $('dlgLocal').showModal();
  form.nome.focus();
}

$('formLocal').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await chamar('salvarLocal', dadosDoFormulario(e.target));
    $('dlgLocal').close();
    mostrarToast('Local salvo!');
    await recarregar();
  } catch (err) {
    mostrarToast(err.message, true);
  }
});

/* ============================ DIÁLOGOS ============================ */

document.querySelectorAll('[data-fechar]').forEach((b) => {
  b.addEventListener('click', () => $(b.dataset.fechar).close());
});

iniciar();
