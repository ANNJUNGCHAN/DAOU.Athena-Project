// 새 기법의 저장 위치와 이름을 사람이 정하는 대화상자.
// 폴더 생성·목록 등록·새 대화 전환이 모두 끝난 뒤에만 결과를 돌려준다. 앞 단계가
// 성공한 뒤 다음 단계가 실패하면 이미 만든 폴더나 등록을 반복하지 않고 그 단계만 재시도한다.
(function () {
'use strict';

const isNode = typeof module !== 'undefined' && module.exports;

function projectList(value) {
  const list = Array.isArray(value) ? value : (value && value.projects);
  return (Array.isArray(list) ? list : []).filter((project) => (
    project && project.id != null && project.exists !== false
  ));
}

function techniqueNameError(value) {
  const name = String(value == null ? '' : value).trim();
  if (!name) return '기법 이름을 입력하세요';
  if (name === '.' || name === '..') return '다른 이름을 입력하세요';
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(name)) return '폴더 이름에 쓸 수 없는 문자가 있습니다';
  if (/[. ]$/.test(name)) return '이름 끝에는 점이나 공백을 쓸 수 없습니다';
  return '';
}

function messageOf(err) {
  return String((err && err.message) || err || '새 기법을 만들지 못했습니다');
}

function createTechniqueCreateDialog(options) {
  const deps = options || {};
  const doc = deps.document || (typeof document !== 'undefined' ? document : null);
  if (!doc || !doc.body || typeof doc.createElement !== 'function') {
    return Promise.reject(new Error('새 기법 위치를 고를 화면이 없습니다'));
  }

  return new Promise((resolve) => {
    let projects = [];
    let selectedProjectId = '';
    let selectedParent = '';
    let created = null;
    let registration = null;
    let busy = false;
    let finished = false;

    const node = (tag, className, text) => {
      const out = doc.createElement(tag);
      out.className = className || '';
      if (text != null) out.textContent = String(text);
      return out;
    };
    const overlay = node('div', 'technique-create-overlay');
    overlay.setAttribute('role', 'presentation');
    const dialog = node('section', 'technique-create-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'techniqueCreateTitle');
    const title = node('h2', 'technique-create-title', '새 기법 만들기');
    title.id = 'techniqueCreateTitle';
    const note = node('p', 'technique-create-note', '저장할 프로젝트와 폴더, 기법 이름을 정하세요. 새 폴더 안에 기법 파일이 만들어집니다.');
    const form = node('div', 'technique-create-form');

    const projectLabel = node('label', 'technique-create-label', '프로젝트');
    const projectSelect = node('select', 'technique-create-select');
    projectSelect.setAttribute('aria-label', '기법을 저장할 프로젝트');
    projectLabel.appendChild(projectSelect);

    const folderLabel = node('label', 'technique-create-label', '상위 폴더');
    const folderRow = node('div', 'technique-create-folder-row');
    const folderInput = node('input', 'technique-create-input');
    folderInput.type = 'text';
    folderInput.placeholder = '프로젝트 루트';
    folderInput.setAttribute('aria-label', '프로젝트 안의 상위 폴더');
    const folderButton = node('button', 'technique-create-folder-button', '폴더 선택');
    folderButton.type = 'button';
    folderRow.appendChild(folderInput);
    folderRow.appendChild(folderButton);
    folderLabel.appendChild(folderRow);

    const nameLabel = node('label', 'technique-create-label', '기법 이름');
    const nameInput = node('input', 'technique-create-input');
    nameInput.type = 'text';
    nameInput.placeholder = '예: 거래량 돌파';
    nameInput.setAttribute('aria-label', '새 기법 이름');
    nameLabel.appendChild(nameInput);

    const error = node('div', 'technique-create-error');
    error.setAttribute('role', 'alert');
    const actions = node('div', 'technique-create-actions');
    const cancel = node('button', 'technique-create-cancel', '취소');
    cancel.type = 'button';
    const submit = node('button', 'technique-create-submit', '만들기');
    submit.type = 'button';
    actions.appendChild(cancel);
    actions.appendChild(submit);

    form.appendChild(projectLabel);
    form.appendChild(folderLabel);
    form.appendChild(nameLabel);
    form.appendChild(error);
    form.appendChild(actions);
    dialog.appendChild(title);
    dialog.appendChild(note);
    dialog.appendChild(form);
    overlay.appendChild(dialog);

    function close(result) {
      if (finished) return;
      finished = true;
      if (overlay.parentNode && typeof overlay.parentNode.removeChild === 'function') {
        overlay.parentNode.removeChild(overlay);
      } else if (typeof doc.body.removeChild === 'function') {
        try { doc.body.removeChild(overlay); } catch { /* 이미 닫힘 */ }
      }
      resolve(result || null);
    }

    function setError(text) {
      error.textContent = text ? String(text) : '';
      error.hidden = !text;
    }

    function setBusy(next, label) {
      busy = next;
      projectSelect.disabled = next || !!created;
      folderInput.disabled = next || !!created;
      folderButton.disabled = next || !!created;
      nameInput.disabled = next || !!created;
      cancel.disabled = next || !!created;
      submit.disabled = next;
      submit.textContent = label || (
        !created ? '만들기' : (!registration ? '목록 등록 다시 시도' : '대화 다시 연결')
      );
    }

    function fillProjects(list) {
      while (projectSelect.firstChild) projectSelect.removeChild(projectSelect.firstChild);
      projects = projectList(list);
      if (!projects.length) {
        const option = node('option', '', '사용할 수 있는 프로젝트가 없습니다');
        option.value = '';
        projectSelect.appendChild(option);
        selectedProjectId = '';
        projectSelect.disabled = true;
        submit.disabled = true;
        setError('먼저 프로젝트를 만들어야 새 기법을 저장할 수 있습니다');
        return;
      }
      const preferred = deps.preferredProjectId == null ? '' : String(deps.preferredProjectId);
      const selected = projects.some((p) => String(p.id) === preferred) ? preferred : String(projects[0].id);
      projects.forEach((project) => {
        const option = node('option', '', project.name || project.path || String(project.id));
        option.value = String(project.id);
        if (String(project.id) === selected) option.selected = true;
        projectSelect.appendChild(option);
      });
      projectSelect.value = selected;
      selectedProjectId = selected;
      projectSelect.disabled = false;
      submit.disabled = false;
      setError('');
    }

    async function loadProjects() {
      if (typeof deps.listProjects !== 'function'
        || typeof deps.createTechnique !== 'function'
        || typeof deps.registerUserStrategy !== 'function'
        || typeof deps.startTechniqueConversation !== 'function') {
        fillProjects([]);
        setError('새 기법 만들기 연결이 준비되지 않았습니다');
        return;
      }
      setBusy(true, '프로젝트 불러오는 중');
      try { fillProjects(await deps.listProjects()); }
      catch (err) { fillProjects([]); setError(messageOf(err)); }
      finally { if (projects.length) setBusy(false); }
    }

    projectSelect.addEventListener('change', () => {
      selectedProjectId = String(projectSelect.value || '');
      selectedParent = '';
      folderInput.value = '';
      setError('');
    });
    folderInput.addEventListener('input', () => {
      selectedParent = String(folderInput.value || '').trim().replace(/\\/g, '/');
      setError('');
    });
    nameInput.addEventListener('input', () => setError(''));
    folderButton.addEventListener('click', async () => {
      if (busy || !selectedProjectId || typeof deps.pickTechniqueFolder !== 'function') return;
      setBusy(true, '폴더 고르는 중');
      try {
        const picked = await deps.pickTechniqueFolder(selectedProjectId);
        if (picked && !picked.canceled) {
          selectedParent = String(picked.parent || '').replace(/\\/g, '/');
          folderInput.value = selectedParent;
        }
      } catch (err) { setError(messageOf(err)); }
      finally { setBusy(false); }
    });
    cancel.addEventListener('click', () => {
      if (!busy && !created) close(null);
    });
    overlay.addEventListener('keydown', (event) => {
      if (event && event.key === 'Escape' && !busy && !created) close(null);
    });
    submit.addEventListener('click', async () => {
      if (busy) return;
      const name = String(nameInput.value || '').trim();
      const invalid = techniqueNameError(name);
      if (!selectedProjectId) { setError('프로젝트를 선택하세요'); return; }
      if (invalid) { setError(invalid); return; }
      setError('');
      try {
        if (!created) {
          setBusy(true, '폴더 만드는 중');
          created = await deps.createTechnique(selectedProjectId, {
            parent: selectedParent || '.',
            name,
          });
          const technique = created && created.technique;
          if (!created || created.project_id == null || !technique || !technique.name
            || !technique.path || !technique.strategy_path || !technique.test_path) {
            created = null;
            throw new Error('새 기법 폴더 응답이 올바르지 않습니다');
          }
        }
        if (!registration) {
          setBusy(true, '기법 목록에 등록 중');
          registration = await deps.registerUserStrategy({
            project_id: created.project_id,
            path: created.technique.strategy_path,
            name: created.technique.name,
          });
          if (!registration || !registration.id) {
            registration = null;
            throw new Error('기법 목록 등록 응답이 올바르지 않습니다');
          }
        }
        setBusy(true, '새 대화 여는 중');
        const conversation = await deps.startTechniqueConversation(created.project_id);
        if (!conversation) throw new Error('새 대화를 열지 못했습니다');
        close(Object.assign({}, created, { registration, conversation }));
      } catch (err) {
        setError(messageOf(err));
        setBusy(false, !created ? '다시 시도' : (
          registration ? '대화 다시 연결' : '목록 등록 다시 시도'
        ));
      }
    });

    doc.body.appendChild(overlay);
    void loadProjects().then(() => {
      if (!finished && projects.length && typeof nameInput.focus === 'function') nameInput.focus();
    });
  });
}

const api = { createTechniqueCreateDialog, projectList, techniqueNameError };
if (isNode) module.exports = api;
else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.TechniqueCreateDialog = api;
}
})();
