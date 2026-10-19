const estado = { produtos: [] };
const $ = (id) => document.getElementById(id);

const CLASSE_ALERTA = {
  'Vencido': 'vencido',
  'Vence em breve': 'vence',
  'Sem estoque': 'sem',
  'Estoque baixo': 'baixo',
};

/** Escapa texto vindo da planilha antes de colocar no HTML. */
function esc(texto) {
  return String(texto == null ? '' : texto).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

/** Chama uma função do Code.js e devolve uma Promise. */
function chamar(funcao, ...args) {
  return new Promise((ok, erro) => {
    google.script.run.withSuccessHandler(ok).withFailureHandler(erro)[funcao](...args);
  });
}

function mostrarMsg(id, texto, sucesso) {
  const el = $(id);
  el.textContent = texto;
  el.className = 'msg ' + (sucesso ? 'ok' : 'erro');
}

/* ---------- Abas ---------- */
document.querySelectorAll('nav button').forEach((b) => {
  b.addEventListener('click', () => mostrarAba(b.dataset.aba));
});

function mostrarAba(nome) {
  document.querySelectorAll('nav button').forEach((b) => {
    b.classList.toggle('ativo', b.dataset.aba === nome);
  });
  ['estoque', 'cadastro', 'movimentacoes'].forEach((s) => {
    $(s).classList.toggle('oculto', s !== nome);
  });
  if (nome === 'estoque') carregarEstoque();
  if (nome === 'movimentacoes') carregarMovimentacoes();
}

/* ---------- Estoque ---------- */
function carregarEstoque() {
  return chamar('listarProdutos')
    .then((lista) => {
      estado.produtos = lista;
      desenharEstoque();
    })
    .catch((err) => alert('Erro ao carregar o estoque: ' + err.message));
}

function desenharEstoque() {
  const termo = $('busca').value.trim().toLowerCase();
  const lista = estado.produtos.filter((p) =>
    !termo || (p.produto + ' ' + p.categoria).toLowerCase().includes(termo));

  $('corpoEstoque').innerHTML = lista.map((p) => `
    <tr>
      <td>${esc(p.produto)}</td>
      <td>${esc(p.categoria)}</td>
      <td>${esc(p.quantidade)} ${esc(p.unidade)}</td>
      <td>${esc(p.minimo)}</td>
      <td>${esc(p.validade)}</td>
      <td>${p.alerta ? `<span class="alerta ${CLASSE_ALERTA[p.alerta]}">${esc(p.alerta)}</span>` : 'OK'}</td>
      <td class="acoes">
        <button class="btn" data-id="${esc(p.id)}" data-tipo="Entrada">+ Entrada</button>
        <button class="btn btn-sec" data-id="${esc(p.id)}" data-tipo="Saída">− Saída</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="7">Nenhum produto encontrado.</td></tr>';

  const comAlerta = estado.produtos.filter((p) => p.alerta).length;
  $('resumo').textContent = estado.produtos.length + ' produtos · ' + comAlerta + ' com alerta';
}

$('busca').addEventListener('input', desenharEstoque);

$('corpoEstoque').addEventListener('click', (e) => {
  const botao = e.target.closest('button[data-tipo]');
  if (botao) abrirMov(botao.dataset.id, botao.dataset.tipo);
});

function abrirMov(id, tipo) {
  const produto = estado.produtos.find((p) => p.id === id);
  if (!produto) return;
  $('movTitulo').textContent = tipo + ': ' + produto.produto;
  $('movId').value = id;
  $('movTipo').value = tipo;
  $('formMov').reset();
  $('dlgMov').showModal();
  $('movQtd').focus();
}

$('formMov').addEventListener('submit', (e) => {
  e.preventDefault();
  const dados = {
    id: $('movId').value,
    tipo: $('movTipo').value,
    quantidade: $('movQtd').value,
    responsavel: $('movResp').value,
    observacao: $('movObs').value,
  };
  $('btnMov').disabled = true;
  chamar('registrarMovimentacao', dados)
    .then(() => {
      $('dlgMov').close();
      return carregarEstoque();
    })
    .catch((err) => alert(err.message))
    .finally(() => {
      $('btnMov').disabled = false;
    });
});

/* ---------- Cadastro ---------- */
$('formCadastro').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  const dados = Object.fromEntries(new FormData(form));
  chamar('cadastrarProduto', dados)
    .then(() => {
      form.reset();
      mostrarMsg('msgCadastro', 'Produto cadastrado com sucesso!', true);
    })
    .catch((err) => mostrarMsg('msgCadastro', err.message, false));
});

/* ---------- Movimentações ---------- */
function carregarMovimentacoes() {
  return chamar('listarMovimentacoes')
    .then((lista) => {
      $('corpoMov').innerHTML = lista.map((m) => `
        <tr>
          <td>${esc(m.data)}</td>
          <td>${esc(m.tipo)}</td>
          <td>${esc(m.produto)}</td>
          <td>${esc(m.quantidade)}</td>
          <td>${esc(m.responsavel)}</td>
          <td>${esc(m.observacao)}</td>
        </tr>`).join('') || '<tr><td colspan="6">Nenhuma movimentação ainda.</td></tr>';
    })
    .catch((err) => alert('Erro ao carregar movimentações: ' + err.message));
}

carregarEstoque();
