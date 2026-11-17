// ============================================================================
// 1. CONFIGURAÇÃO DA API DO GOOGLE APPS SCRIPT
// ============================================================================
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxKDTDYYSygcNIiy81VhFlIR0bXPqqijUfPRNp-EANSwpovYERGNB8X_P9biycg9Ui1/exec';
const EMPTY_IMG_SRC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const ACTION_MAP = {
  listar: 'listarDemandas',
  criar: 'criarDemanda',
  atualizar: 'atualizarDemanda',
  excluirDemanda: 'excluirDemanda',
  pdf: 'gerarOrdemServicoPDF',
  pdfCompras: 'gerarListaComprasPDF'
};

const PAINEL_AUTH_KEY = 'painel_zelador_auth';
const SENHA_PAINEL = 'Zeladoria2026';
const SENHA_EXCLUSAO = 'Ferrovias@2026';
const SENHA_PDF = 'Ferrovias@2026';

// ============================================================================
// 2. ESTADO GLOBAL DA APLICAÇÃO
// ============================================================================
const state = {
  demandas: [],
  filtro: 'Pendente',
  filtroGuarita: '',
  guaritaSelecionada: '',
  fotoBase64: '',
  demandaSelecionada: null
};

// ============================================================================
// 3. COMUNICAÇÃO COM O BACK-END (google.script.run OU Fetch API POST)
// ============================================================================
async function callBackend(action, payload = {}) {
  const backendAction = ACTION_MAP[action];
  if (!backendAction) {
    throw new Error('Ação inválida: ' + action);
  }

  // Modo 1: Execução nativa dentro do Google Apps Script (HtmlService)
  if (typeof google !== 'undefined' && google.script && google.script.run) {
    return new Promise((resolve, reject) => {
      const runner = google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler(err => reject(new Error(err.message || String(err))));

      if (action === 'listar') runner.listarDemandas();
      else if (action === 'criar') runner.criarDemanda(payload);
      else if (action === 'atualizar') runner.atualizarDemanda(payload);
      else if (action === 'excluirDemanda') runner.excluirDemanda(payload);
      else if (action === 'pdf') runner.gerarOrdemServicoPDF(payload);
      else if (action === 'pdfCompras') runner.gerarListaComprasPDF(payload);
    });
  }

  // Modo 2: Front-end hospedado externamente via Fetch API (POST sem preflight CORS)
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL === 'https://script.google.com/macros/s/AKfycbzNBMajAu9qp5ltapauebCd28vBiy9T2RYbBsZUmyic9F8ORPOL2TbUX8c5p5xvVpjM/exec') {
    throw new Error('Configure a constante APPS_SCRIPT_URL no arquivo app.js.');
  }

  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify({ action: backendAction, ...payload })
  });

  if (!response.ok) {
    throw new Error('Falha na comunicação HTTP: ' + response.status);
  }

  const result = await response.json();
  if (!result || !result.ok) {
    throw new Error((result && result.error) || 'Erro desconhecido no servidor.');
  }

  return result.data;
}

// ============================================================================
// 4. NAVEGAÇÃO ENTRE ABAS & AUTENTICAÇÃO DO PAINEL
// ============================================================================
const modalAuthBackdrop = document.getElementById('modalAuthBackdrop');
const inputSenhaPainel = document.getElementById('inputSenhaPainel');

function ativarAba(target) {
  document.querySelectorAll('.nav-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === target);
  });
  document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
  document.getElementById('tab-' + target).classList.add('active');

  const btnGerarPdf = document.getElementById('btnGerarPdf');
  if (btnGerarPdf) {
    btnGerarPdf.style.display = target === 'painel' ? 'inline-flex' : 'none';
  }

  if (target === 'painel' && state.demandas.length === 0) {
    carregarDemandas();
  }
}

document.querySelectorAll('.nav-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    if (target === 'painel' && sessionStorage.getItem(PAINEL_AUTH_KEY) !== 'true') {
      inputSenhaPainel.value = '';
      modalAuthBackdrop.classList.add('open');
      setTimeout(() => inputSenhaPainel.focus(), 50);
      return;
    }
    ativarAba(target);
  });
});

document.getElementById('btnFecharAuthModal').addEventListener('click', () => {
  modalAuthBackdrop.classList.remove('open');
});

modalAuthBackdrop.addEventListener('click', (e) => {
  if (e.target === modalAuthBackdrop) modalAuthBackdrop.classList.remove('open');
});

document.getElementById('formAuthPainel').addEventListener('submit', (e) => {
  e.preventDefault();
  if (inputSenhaPainel.value === SENHA_PAINEL) {
    sessionStorage.setItem(PAINEL_AUTH_KEY, 'true');
    modalAuthBackdrop.classList.remove('open');
    inputSenhaPainel.value = '';
    ativarAba('painel');
    if (state.demandas.length > 0) {
      carregarDemandas();
    }
  } else {
    showToast('Senha incorreta!', 'error');
    inputSenhaPainel.select();
  }
});

// ============================================================================
// 5. COMPRESSÃO DE IMAGEM VIA CANVAS (MAX 1280PX / ~350KB JPEG)
// ============================================================================
const MAX_WIDTH = 1280;
const MAX_BYTES = 350 * 1024;

const inputFoto = document.getElementById('inputFoto');
const uploadZone = document.getElementById('uploadZone');
const previewWrapper = document.getElementById('previewWrapper');
const previewImg = document.getElementById('previewImg');
const previewInfo = document.getElementById('previewInfo');

inputFoto.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    showToast('Comprimindo imagem...', 'default');
    const result = await comprimirImagem(file, MAX_WIDTH, MAX_BYTES);
    state.fotoBase64 = result.dataUrl;
    previewImg.src = result.dataUrl;
    previewInfo.textContent = `Pronta para envio • ${Math.round(result.sizeBytes / 1024)} KB`;
    uploadZone.style.display = 'none';
    previewWrapper.classList.add('visible');
  } catch (err) {
    showToast('Erro ao processar imagem: ' + err.message, 'error');
  }
});

document.getElementById('btnRemoverFoto').addEventListener('click', limparFoto);

function limparFoto() {
  state.fotoBase64 = '';
  inputFoto.value = '';
  previewImg.src = EMPTY_IMG_SRC;
  previewWrapper.classList.remove('visible');
  uploadZone.style.display = 'block';
}

function comprimirImagem(file, maxWidth, maxBytes) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Arquivo de imagem inválido.'));
    };

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let width = img.width;
      let height = img.height;

      if (width > maxWidth || height > maxWidth) {
        if (width >= height) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        } else {
          width = Math.round((width * maxWidth) / height);
          height = maxWidth;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      let quality = 0.85;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      let base64 = dataUrl.split(',')[1] || '';
      let sizeBytes = Math.round((base64.length * 3) / 4);

      // Reduz qualidade iterativamente para manter até ~350KB
      while (sizeBytes > maxBytes && quality > 0.35) {
        quality -= 0.08;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
        base64 = dataUrl.split(',')[1] || '';
        sizeBytes = Math.round((base64.length * 3) / 4);
      }

      resolve({ dataUrl, sizeBytes });
    };

    img.src = objectUrl;
  });
}

// ============================================================================
// 6. CRUD DE DEMANDAS (GUARITA, CHIPS DE LOCAL, CADASTRO, LISTAGEM E FILTROS)
// ============================================================================
document.querySelectorAll('#chipsGuarita .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#chipsGuarita .chip').forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
    state.guaritaSelecionada = chip.dataset.value || '';
  });
});

const inputLocal = document.getElementById('inputLocal');
document.querySelectorAll('#chipsLocal .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#chipsLocal .chip').forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
    const val = chip.dataset.value;
    inputLocal.value = val === 'Outro' ? '' : val;
    inputLocal.focus();
  });
});

document.getElementById('formNovaDemanda').addEventListener('submit', async (e) => {
  e.preventDefault();
  const guarita = state.guaritaSelecionada;
  const local = inputLocal.value.trim();
  const descricao = document.getElementById('inputDescricao').value.trim();

  if (!guarita) {
    showToast('Selecione uma guarita (G1 a G5).', 'error');
    return;
  }

  if (!local || !descricao) {
    showToast('Preencha o local e a descrição.', 'error');
    return;
  }

  const btn = document.getElementById('btnRegistrar');
  setButtonLoading(btn, true, 'Registrando...');

  try {
    const nova = await callBackend('criar', {
      guarita,
      local,
      descricao,
      fotoBase64: state.fotoBase64
    });

    state.demandas.unshift(nova);
    e.target.reset();
    limparFoto();
    state.guaritaSelecionada = '';
    document.querySelectorAll('#chipsGuarita .chip').forEach(c => c.classList.remove('selected'));
    document.querySelectorAll('#chipsLocal .chip').forEach(c => c.classList.remove('selected'));
    showToast('Demanda registrada com sucesso!', 'success');
    renderDemandas();
  } catch (err) {
    showToast('Erro ao registrar: ' + err.message, 'error');
  } finally {
    setButtonLoading(btn, false, 'Registrar Demanda');
  }
});

async function carregarDemandas() {
  const container = document.getElementById('demandsList');
  const btnRefresh = document.getElementById('btnAtualizarLista');
  container.innerHTML = '<div class="empty-state">Carregando demandas...</div>';
  btnRefresh.disabled = true;

  try {
    const lista = await callBackend('listar');
    state.demandas = Array.isArray(lista) ? lista : [];
    renderDemandas();
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Erro ao carregar: ${escapeHtml(err.message)}</div>`;
  } finally {
    btnRefresh.disabled = false;
  }
}

document.getElementById('btnAtualizarLista').addEventListener('click', carregarDemandas);

document.querySelectorAll('.filter-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    state.filtro = pill.dataset.filter;
    document.querySelectorAll('.filter-pill').forEach(p => {
      p.classList.remove('active-pending', 'active-done');
    });
    pill.classList.add(state.filtro === 'Pendente' ? 'active-pending' : 'active-done');
    renderDemandas();
  });
});

document.getElementById('filtroGuarita').addEventListener('change', (e) => {
  state.filtroGuarita = e.target.value;
  renderDemandas();
});

function renderDemandas() {
  const baseDemandas = state.filtroGuarita
    ? state.demandas.filter(d => d.guarita === state.filtroGuarita)
    : state.demandas;

  const pendentes = baseDemandas.filter(d => d.status !== 'Concluída');
  const concluidas = baseDemandas.filter(d => d.status === 'Concluída');

  document.getElementById('countPendente').textContent = pendentes.length;
  document.getElementById('countConcluida').textContent = concluidas.length;

  const filtradas = state.filtro === 'Pendente' ? pendentes : concluidas;
  const container = document.getElementById('demandsList');

  if (filtradas.length === 0) {
    container.innerHTML = `<div class="empty-state">Nenhuma demanda ${state.filtro === 'Pendente' ? 'pendente' : 'concluída'} no momento.</div>`;
    return;
  }

  container.innerHTML = filtradas.map(item => {
    const isDone = item.status === 'Concluída';
    const thumbHtml = item.fotoUrl
      ? `<img class="demand-thumb" src="${escapeHtml(item.fotoUrl)}" alt="Foto" loading="lazy" />`
      : `<div class="demand-thumb-empty">Sem foto</div>`;

    const guaritaBadgeHtml = item.guarita
      ? `<span class="tag-materials" style="font-weight: 700; color: var(--text);">${escapeHtml(item.guarita)}</span>`
      : '';

    const materiaisTrim = item.materiais ? item.materiais.trim() : '';
    const materiaisHtml = materiaisTrim
      ? `<div class="demand-materials">
           <span class="demand-materials-label">Materiais:</span>
           <span class="demand-materials-text">${escapeHtml(materiaisTrim)}</span>
         </div>`
      : '';

    const dateInfo = isDone && item.dataConclusao
      ? `Concluída em ${escapeHtml(item.dataConclusao)}`
      : `Aberta em ${escapeHtml(item.dataCriacao)}`;

    return `
      <article class="demand-card ${isDone ? 'is-done' : ''}" data-id="${escapeHtml(item.id)}">
        ${thumbHtml}
        <div class="demand-body">
          <div class="demand-top">
            <div class="demand-top-left">
              <div class="demand-local">${escapeHtml(item.local)}</div>
              ${guaritaBadgeHtml}
            </div>
            <span class="status-badge ${isDone ? 'done' : 'pending'}">${isDone ? 'Concluída' : 'Pendente'}</span>
          </div>
          <p class="demand-desc">${escapeHtml(item.descricao)}</p>
          ${materiaisHtml}
          <div class="demand-meta">
            <span>${dateInfo}</span>
          </div>
        </div>
      </article>
    `;
  }).join('');

  container.querySelectorAll('.demand-card').forEach(card => {
    card.addEventListener('click', () => {
      const item = state.demandas.find(d => d.id === card.dataset.id);
      if (item) abrirModal(item);
    });
  });
}

// ============================================================================
// 7. MODAL DE EDIÇÃO RÁPIDA (MATERIAIS & STATUS)
// ============================================================================
const modalBackdrop = document.getElementById('modalBackdrop');
const toggleConcluido = document.getElementById('toggleConcluido');

function abrirModal(item) {
  state.demandaSelecionada = item;
  document.getElementById('modalLocal').textContent = item.local;
  const guaritaMeta = item.guarita ? `Guarita ${item.guarita} • ` : '';
  document.getElementById('modalMeta').textContent = `${guaritaMeta}ID: ${item.id} • Aberta em ${item.dataCriacao}`;
  document.getElementById('modalDesc').textContent = item.descricao;
  document.getElementById('modalMateriais').value = item.materiais || '';

  const modalPhoto = document.getElementById('modalPhoto');
  if (item.fotoUrl) {
    modalPhoto.src = item.fotoUrl;
    modalPhoto.classList.add('visible');
  } else {
    modalPhoto.src = EMPTY_IMG_SRC;
    modalPhoto.classList.remove('visible');
  }

  atualizarVisualToggle(item.status === 'Concluída');
  modalBackdrop.classList.add('open');
}

function atualizarVisualToggle(isDone) {
  toggleConcluido.classList.toggle('checked', isDone);
  toggleConcluido.setAttribute('aria-checked', String(isDone));
  document.getElementById('toggleSubtext').textContent = isDone
    ? 'Serviço concluído. Toque para reabrir como pendente.'
    : 'Atualiza o status e registra a data de conclusão.';
}

document.getElementById('btnFecharModal').addEventListener('click', () => {
  modalBackdrop.classList.remove('open');
});

modalBackdrop.addEventListener('click', (e) => {
  if (e.target === modalBackdrop) modalBackdrop.classList.remove('open');
});

document.getElementById('btnSalvarMateriais').addEventListener('click', async () => {
  if (!state.demandaSelecionada) return;
  const btn = document.getElementById('btnSalvarMateriais');
  const materiais = document.getElementById('modalMateriais').value;
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  try {
    const atualizada = await callBackend('atualizar', {
      id: state.demandaSelecionada.id,
      materiais
    });
    sincronizarItemLocal(atualizada);
    showToast('Materiais salvos!', 'success');
  } catch (err) {
    showToast('Erro ao salvar: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar Materiais';
  }
});

toggleConcluido.addEventListener('click', alternarStatusModal);
toggleConcluido.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    alternarStatusModal();
  }
});

async function alternarStatusModal() {
  if (!state.demandaSelecionada) return;
  const atual = state.demandaSelecionada.status === 'Concluída';
  const novoStatus = atual ? 'Pendente' : 'Concluída';
  const materiais = document.getElementById('modalMateriais').value;

  atualizarVisualToggle(novoStatus === 'Concluída');
  toggleConcluido.style.pointerEvents = 'none';

  try {
    const atualizada = await callBackend('atualizar', {
      id: state.demandaSelecionada.id,
      status: novoStatus,
      materiais
    });
    sincronizarItemLocal(atualizada);
    showToast(novoStatus === 'Concluída' ? 'Demanda concluída!' : 'Demanda reaberta.', 'success');
    setTimeout(() => modalBackdrop.classList.remove('open'), 250);
  } catch (err) {
    atualizarVisualToggle(atual);
    showToast('Erro ao atualizar status: ' + err.message, 'error');
  } finally {
    toggleConcluido.style.pointerEvents = '';
  }
}

function sincronizarItemLocal(atualizada) {
  const idx = state.demandas.findIndex(d => d.id === atualizada.id);
  if (idx !== -1) state.demandas[idx] = atualizada;
  state.demandaSelecionada = atualizada;
  renderDemandas();
}

// ============================================================================
// 7.1. EXCLUSÃO DE DEMANDA PROTEGIDA POR SENHA
// ============================================================================
const modalExcluirBackdrop = document.getElementById('modalExcluirBackdrop');
const inputSenhaExcluir = document.getElementById('inputSenhaExcluir');

document.getElementById('btnExcluirDemanda').addEventListener('click', () => {
  if (!state.demandaSelecionada) return;
  document.getElementById('modalExcluirInfo').textContent =
    `${state.demandaSelecionada.local} • ${state.demandaSelecionada.id}`;
  inputSenhaExcluir.value = '';
  modalExcluirBackdrop.classList.add('open');
  setTimeout(() => inputSenhaExcluir.focus(), 50);
});

function fecharModalExclusao() {
  modalExcluirBackdrop.classList.remove('open');
  inputSenhaExcluir.value = '';
}

document.getElementById('btnFecharExcluirModal').addEventListener('click', fecharModalExclusao);
document.getElementById('btnCancelarExclusao').addEventListener('click', fecharModalExclusao);
modalExcluirBackdrop.addEventListener('click', (e) => {
  if (e.target === modalExcluirBackdrop) fecharModalExclusao();
});

document.getElementById('formExcluirDemanda').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.demandaSelecionada) return;

  const senha = inputSenhaExcluir.value;
  if (senha !== SENHA_EXCLUSAO) {
    showToast('Senha de exclusão incorreta!', 'error');
    inputSenhaExcluir.select();
    return;
  }

  const btn = document.getElementById('btnConfirmarExclusao');
  const idParaExcluir = state.demandaSelecionada.id;
  setButtonLoading(btn, true, 'Excluindo...');

  try {
    await callBackend('excluirDemanda', { id: idParaExcluir, senha });
    state.demandas = state.demandas.filter(d => d.id !== idParaExcluir);
    state.demandaSelecionada = null;
    renderDemandas();
    fecharModalExclusao();
    modalBackdrop.classList.remove('open');
    showToast('Demanda excluída com sucesso!', 'success');
  } catch (err) {
    showToast('Erro ao excluir: ' + err.message, 'error');
  } finally {
    setButtonLoading(btn, false, 'Confirmar Exclusão');
  }
});

// ============================================================================
// 8. EXPORTAÇÃO DE PDFs PROTEGIDA POR SENHA (ORDEM DE SERVIÇO E COMPRAS)
// ============================================================================
const modalPdfAuthBackdrop = document.getElementById('modalPdfAuthBackdrop');
const inputSenhaPdf = document.getElementById('inputSenhaPdf');
const modalPdfAuthSubtitle = document.getElementById('modalPdfAuthSubtitle');
let pdfPendingAction = null;

function abrirModalSenhaPdf(tipo) {
  pdfPendingAction = tipo;
  modalPdfAuthSubtitle.textContent = tipo === 'pdfCompras'
    ? 'Informe a senha para gerar a Lista de Compras em PDF'
    : 'Informe a senha para gerar a Ordem de Serviço em PDF';
  inputSenhaPdf.value = '';
  modalPdfAuthBackdrop.classList.add('open');
  setTimeout(() => inputSenhaPdf.focus(), 50);
}

function fecharModalSenhaPdf() {
  modalPdfAuthBackdrop.classList.remove('open');
  inputSenhaPdf.value = '';
  pdfPendingAction = null;
}

document.getElementById('btnFecharPdfAuthModal').addEventListener('click', fecharModalSenhaPdf);
modalPdfAuthBackdrop.addEventListener('click', (e) => {
  if (e.target === modalPdfAuthBackdrop) fecharModalSenhaPdf();
});

document.getElementById('formAuthPdf').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (inputSenhaPdf.value !== SENHA_PDF) {
    showToast('Senha incorreta!', 'error');
    inputSenhaPdf.select();
    return;
  }

  const acao = pdfPendingAction;
  fecharModalSenhaPdf();

  if (acao === 'pdf') {
    await executarGeracaoOrdemServicoPDF();
  } else if (acao === 'pdfCompras') {
    await executarGeracaoListaComprasPDF();
  }
});

document.getElementById('btnGerarPdf').addEventListener('click', () => {
  abrirModalSenhaPdf('pdf');
});

async function executarGeracaoOrdemServicoPDF() {
  const btn = document.getElementById('btnGerarPdf');
  setButtonLoading(btn, true, 'Gerando PDF...');

  try {
    const res = await callBackend('pdf', { guarita: state.filtroGuarita });
    const link = document.createElement('a');
    link.href = 'data:application/pdf;base64,' + res.base64;
    link.download = res.fileName || 'Ordem_Servico_Zeladoria.pdf';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`PDF gerado com ${res.count} demanda(s) pendente(s)!`, 'success');
  } catch (err) {
    showToast(err.message || 'Erro ao gerar PDF.', 'error');
  } finally {
    setButtonLoading(btn, false, `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
      <span>Gerar Ordem de Serviço</span>
    `, true);
  }
}

document.getElementById('btnPdfCompras').addEventListener('click', () => {
  const comMateriais = state.demandas.filter(d => {
    const matchStatus = d.status !== 'Concluída' && d.materiais && d.materiais.trim() !== '';
    const matchGuarita = !state.filtroGuarita || d.guarita === state.filtroGuarita;
    return matchStatus && matchGuarita;
  });

  if (comMateriais.length === 0) {
    showToast('Nenhuma demanda pendente possui materiais listados.', 'error');
    return;
  }

  abrirModalSenhaPdf('pdfCompras');
});

async function executarGeracaoListaComprasPDF() {
  const btn = document.getElementById('btnPdfCompras');
  setButtonLoading(btn, true, 'Gerando...', false, true);

  try {
    const res = await callBackend('pdfCompras', { guarita: state.filtroGuarita });
    const link = document.createElement('a');
    link.href = 'data:application/pdf;base64,' + res.base64;
    link.download = res.fileName || 'Lista_Compras_Zeladoria.pdf';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Lista de compras gerada (${res.count} ${res.count === 1 ? 'demanda' : 'demandas'})!`, 'success');
  } catch (err) {
    showToast(err.message || 'Erro ao gerar lista de compras.', 'error');
  } finally {
    setButtonLoading(btn, false, `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="9" cy="21" r="1"></circle>
        <circle cx="20" cy="21" r="1"></circle>
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
      </svg>
      <span>PDF Lista de Compras</span>
    `, true);
  }
}

// ============================================================================
// 9. UTILITÁRIOS DE UI & INICIALIZAÇÃO
// ============================================================================
function setButtonLoading(btn, isLoading, textOrHtml, isHtml = false, darkSpinner = false) {
  btn.disabled = isLoading;
  if (isLoading) {
    const spinnerClass = darkSpinner ? 'spinner spinner-dark' : 'spinner';
    btn.innerHTML = `<span class="${spinnerClass}"></span><span>${escapeHtml(textOrHtml)}</span>`;
  } else if (isHtml) {
    btn.innerHTML = textOrHtml;
  } else {
    btn.innerHTML = `<span>${escapeHtml(textOrHtml)}</span>`;
  }
}

let toastTimer;
function showToast(msg, type = 'default') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast show' + (type !== 'default' ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3200);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.addEventListener('DOMContentLoaded', () => {
  if (sessionStorage.getItem(PAINEL_AUTH_KEY) === 'true') {
    carregarDemandas();
  }
});
