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
    const onOpenCard = options && options.onOpenCard;
    const onOpenAgent = options && (options.onOpenAgent || options.onOpen);
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
    const cardButton = doc.createElement('button');
    cardButton.type = 'button';
    cardButton.className = 'routine-alert-popup__card';
    cardButton.textContent = '\ub300\ud654\ucc3d\uc5d0\uc11c \uce74\ub4dc \ubcf4\uae30';
    const agentButton = doc.createElement('button');
    agentButton.type = 'button';
    agentButton.className = 'routine-alert-popup__agent';
    agentButton.textContent = '\uc5d0\uc774\uc804\ud2b8\ub85c \uc774\ub3d9';
    const dismissButton = doc.createElement('button');
    dismissButton.type = 'button';
    dismissButton.className = 'routine-alert-popup__dismiss';
    dismissButton.textContent = '\ub2eb\uae30';
    actions.appendChild(cardButton);
    actions.appendChild(agentButton);
    actions.appendChild(dismissButton);

    const cardHint = doc.createElement('div');
    cardHint.className = 'routine-alert-popup__card-hint';
    cardHint.textContent = '\uc774 \uc54c\ub78c\uc5d0 \uc124\uc815\ub41c \uba54\uc778 \uce74\ub4dc\uac00 \uc5c6\uc5b4 \ub300\ud654\ucc3d\uc73c\ub85c \uc5f4 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.';
    cardHint.hidden = true;

    root.appendChild(header);
    root.appendChild(title);
    root.appendChild(sub);
    root.appendChild(time);
    root.appendChild(cardHint);
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
        mainCard: room.mainCard && typeof room.mainCard === 'object' ? room.mainCard : null,
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
      cardButton.disabled = !current.mainCard;
      cardButton.title = current.mainCard ? current.mainCard.title || '' : cardHint.textContent;
      cardHint.hidden = !!current.mainCard;
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

    // 늦게 도착한 상세(main_card)은 아직 팝업에 남아 있는 같은 알람만 갱신한다.
    // show()를 쓰면 사람이 이미 닫은 알람이 다시 살아나거나 큐 뒤에 재삽입된다.
    function update(id, patch) {
      const key = String(id);
      let target = current && current.key === key ? current : null;
      if (!target) target = queue.find((item) => item.key === key) || null;
      if (!target) return false;
      const normalized = normalize(Object.assign({}, target, patch || {}, { id: target.id }));
      if (!normalized) return false;
      if (target === current) current = normalized;
      else queue[queue.indexOf(target)] = normalized;
      render();
      return true;
    }

    cardButton.addEventListener('click', () => {
      if (!current || !current.mainCard) return;
      const id = current.id;
      if (typeof onOpenCard === 'function') onOpenCard(id);
      advance();
    });
    agentButton.addEventListener('click', () => {
      if (!current) return;
      const id = current.id;
      if (typeof onOpenAgent === 'function') onOpenAgent(id);
      advance();
    });
    dismissButton.addEventListener('click', dismiss);

    return {
      show,
      update,
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
