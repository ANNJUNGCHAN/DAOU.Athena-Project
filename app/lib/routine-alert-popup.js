(function (root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.AthenaLib = root.AthenaLib || {};
    root.AthenaLib.RoutineAlertPopup = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function createRoutineAlertPopup(options) {
    const doc = options && options.document;
    const onOpen = options && options.onOpen;
    if (!doc || typeof doc.createElement !== 'function' || !doc.body) {
      throw new TypeError('document is required');
    }

    const queue = [];
    let current = null;

    const root = doc.createElement('aside');
    root.className = 'routine-alert-popup';
    root.setAttribute('role', 'alert');
    root.setAttribute('aria-live', 'assertive');
    root.setAttribute('aria-atomic', 'true');
    root.setAttribute('aria-labelledby', 'routineAlertPopupHeading');
    root.hidden = true;

    const header = doc.createElement('div');
    header.className = 'routine-alert-popup__header';
    const bell = doc.createElement('span');
    bell.className = 'routine-alert-popup__bell';
    bell.setAttribute('aria-hidden', 'true');
    bell.textContent = '\ud83d\udd14';
    const heading = doc.createElement('strong');
    heading.id = 'routineAlertPopupHeading';
    heading.textContent = '\uc0c8 \uc54c\ub78c';
    const count = doc.createElement('span');
    count.className = 'routine-alert-popup__count';
    header.appendChild(bell);
    header.appendChild(heading);
    header.appendChild(count);

    const title = doc.createElement('div');
    title.className = 'routine-alert-popup__title';
    const sub = doc.createElement('div');
    sub.className = 'routine-alert-popup__sub';
    const time = doc.createElement('time');
    time.className = 'routine-alert-popup__time';

    const actions = doc.createElement('div');
    actions.className = 'routine-alert-popup__actions';
    const openButton = doc.createElement('button');
    openButton.type = 'button';
    openButton.className = 'routine-alert-popup__open';
    openButton.textContent = '\uc54c\ub78c \ud655\uc778';
    const dismissButton = doc.createElement('button');
    dismissButton.type = 'button';
    dismissButton.className = 'routine-alert-popup__dismiss';
    dismissButton.textContent = '\ub2eb\uae30';
    actions.appendChild(openButton);
    actions.appendChild(dismissButton);

    root.appendChild(header);
    root.appendChild(title);
    root.appendChild(sub);
    root.appendChild(time);
    root.appendChild(actions);
    doc.body.appendChild(root);

    function normalize(room) {
      if (!room || room.id == null || String(room.id).trim() === '') return null;
      if (room.title == null || String(room.title).trim() === '') return null;
      const firedAt = Number(room.firedAt);
      return {
        id: room.id,
        key: String(room.id),
        title: String(room.title),
        sub: room.sub == null ? '' : String(room.sub),
        firedAt: Number.isFinite(firedAt) ? firedAt : Date.now(),
      };
    }

    function formatTime(value) {
      const d = new Date(value);
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function render() {
      root.hidden = !current;
      if (!current) return;
      title.textContent = current.title;
      sub.textContent = current.sub;
      sub.hidden = !current.sub;
      time.dateTime = new Date(current.firedAt).toISOString();
      time.textContent = formatTime(current.firedAt);
      count.textContent = queue.length ? `\uc678 ${queue.length}\uac74` : '';
      count.hidden = queue.length === 0;
    }

    function advance() {
      current = queue.shift() || null;
      render();
    }

    function show(room) {
      const normalized = normalize(room);
      if (!normalized) return false;
      if (current && current.key === normalized.key) {
        current = normalized;
        render();
        return true;
      }
      const queuedIndex = queue.findIndex((item) => item.key === normalized.key);
      if (queuedIndex >= 0) queue[queuedIndex] = normalized;
      else queue.push(normalized);
      if (!current) advance();
      else render();
      return true;
    }

    function dismiss() {
      if (!current) return false;
      advance();
      return true;
    }

    openButton.addEventListener('click', () => {
      if (!current) return;
      const id = current.id;
      if (typeof onOpen === 'function') onOpen(id);
      advance();
    });
    dismissButton.addEventListener('click', dismiss);

    return {
      show,
      dismiss,
      destroy() {
        current = null;
        queue.length = 0;
        if (root.parentNode) root.parentNode.removeChild(root);
      },
      getState() {
        return {
          currentId: current ? current.id : null,
          queuedIds: queue.map((item) => item.id),
        };
      },
    };
  }

  return { createRoutineAlertPopup };
});
