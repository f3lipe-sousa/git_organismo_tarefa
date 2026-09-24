(function () {
  "use strict";

  const { Store, CENTER, WORLD, SEDIMENT_TOP } = window.TaskCore;

  /* =====================================================================
     TOASTS
  ===================================================================== */
  function toast(msg, type) {
    const el = document.createElement("div");
    el.className = "toast" + (type ? " " + type : "");
    el.textContent = msg;

    document.getElementById("toasts").appendChild(el);

    requestAnimationFrame(() => el.classList.add("show"));

    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 300);
    }, 3200);
  }

  /* =====================================================================
     VIEW SWITCH
  ===================================================================== */
  const listView = document.getElementById("listView");
  const orgWrap = document.getElementById("organismWrap");
  const toListBtn = document.getElementById("toListBtn");
  const toOrgBtn = document.getElementById("toOrgBtn");

  let currentView = "list";

  function switchView(view) {
    currentView = view;

    listView.classList.toggle("active", view === "list");
    orgWrap.classList.toggle("active", view === "organism");
    toListBtn.classList.toggle("active", view === "list");
    toOrgBtn.classList.toggle("active", view === "organism");

    if (view === "organism") {
      requestAnimationFrame(() => {
        resizeOrganismViewport();
        renderOrganism();
        startEngine();
      });
    } else {
      stopEngine();
      renderList();
    }
  }

  toListBtn.addEventListener("click", () => switchView("list"));
  toOrgBtn.addEventListener("click", () => switchView("organism"));

  /* =====================================================================
     VISÃO EM LISTA
  ===================================================================== */
  const treeRoot = document.getElementById("treeRoot");

  function renderList() {
    treeRoot.innerHTML = "";

    const roots = Store.getRootTasks();

    if (roots.length === 0) {
      treeRoot.innerHTML =
        '<div class="emptyState">Nenhuma tarefa ativa. Crie a primeira com "+ Nova tarefa".</div>';
      return;
    }

    const ul = document.createElement("ul");
    ul.className = "tree top";

    const visited = new Set();

    roots.forEach((task) => {
      ul.appendChild(buildNode(task, visited));
    });

    treeRoot.appendChild(ul);
  }

  function buildNode(task, visited) {
    const li = document.createElement("li");
    li.className = "node-row";

    if (visited.has(task.id)) {
      li.innerHTML =
        '<div class="card"><div class="body"><span class="kw" style="color:var(--text-faint)">↺ ' +
        escapeHtml(task.keyword) +
        " (já exibida acima)</span></div></div>";

      return li;
    }

    visited.add(task.id);

    const weight = Store.getWeight(task.id);
    const card = document.createElement("div");

    card.className = "card";

    card.innerHTML = `
      <div class="weightPip">${weight}</div>

      <div class="body">
        <div class="kw">${escapeHtml(task.keyword)}</div>

        ${
          task.description
            ? '<div class="desc">' + escapeHtml(task.description) + "</div>"
            : ""
        }

        <div class="meta">
          ${Store.getParents(task.id).length} pré-requisito(s) diretos
        </div>
      </div>

      <div class="actions">
        <button class="iconBtn complete" title="Concluir" data-act="complete">✓</button>
        <button class="iconBtn" title="Editar" data-act="edit">✎</button>
        <button class="iconBtn" title="Adicionar pré-requisito" data-act="addprereq">＋</button>
        <button class="iconBtn del" title="Excluir" data-act="del">✕</button>
      </div>
    `;

    const parents = Store.getParents(task.id);
    const canComplete = parents.every((parent) => parent.completed);

    const completeBtn = card.querySelector('[data-act="complete"]');

    if (!canComplete) {
      completeBtn.disabled = true;
      completeBtn.title = "Conclua os pré-requisitos primeiro";
    }

    card
      .querySelector('[data-act="complete"]')
      .addEventListener("click", () => doComplete(task.id));

    card
      .querySelector('[data-act="edit"]')
      .addEventListener("click", () =>
        openModal({
          mode: "edit",
          task,
        })
      );

    card
      .querySelector('[data-act="addprereq"]')
      .addEventListener("click", () =>
        openModal({
          mode: "create",
          prereqOfId: task.id,
          prereqOfLabel: task.keyword,
        })
      );

    card.querySelector('[data-act="del"]').addEventListener("click", () => {
      if (
        confirm(
          'Excluir "' + task.keyword + '"? Isso remove suas conexões.'
        )
      ) {
        Store.deleteTask(task.id);
        toast("Tarefa excluída.");
        renderList();
      }
    });

    li.appendChild(card);

    const kids = Store.getParents(task.id);

    if (kids.length) {
      const ul = document.createElement("ul");
      ul.className = "tree";

      kids.forEach((kid) => {
        ul.appendChild(buildNode(kid, visited));
      });

      li.appendChild(ul);
    }

    return li;
  }

  function doComplete(id) {
    const res = Store.toggleComplete(id);

    if (!res.ok) {
      if (res.reason === "blocked") {
        toast("Conclua antes os pré-requisitos diretos.", "warn");
      }

      return;
    }

    toast("Tarefa concluída — depositada no sedimento.");

    renderList();
    renderHistory();

    if (currentView === "organism") {
      renderOrganism();
    }
  }

  function escapeHtml(value) {
    return String(value).replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character]
    );
  }

  /* =====================================================================
     HISTÓRICO
  ===================================================================== */
  const historyPanel = document.getElementById("historyPanel");

  document.getElementById("historyToggle").addEventListener("click", () => {
    historyPanel.classList.add("open");
    renderHistory();
  });

  document
    .getElementById("historyClose")
    .addEventListener("click", () => historyPanel.classList.remove("open"));

  function renderHistory() {
    const list = document.getElementById("historyList");

    const items = Store.all()
      .filter((task) => task.completed)
      .sort((a, b) => b.completedAt - a.completedAt);

    if (items.length === 0) {
      list.innerHTML =
        '<div class="histEmpty">Nenhuma tarefa depositada ainda.</div>';
      return;
    }

    list.innerHTML = items
      .map((task) => {
        const date = new Date(task.completedAt);

        return `
          <div class="histItem">
            <div class="kw">${escapeHtml(task.keyword)}</div>
            <div class="when">
              ${date.toLocaleDateString("pt-BR")} às
              ${date.toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        `;
      })
      .join("");
  }

  /* =====================================================================
     MODAL
  ===================================================================== */
  const overlay = document.getElementById("overlay");
  const modalTitle = document.getElementById("modalTitle");
  const modalHint = document.getElementById("modalHint");
  const fieldKeyword = document.getElementById("fieldKeyword");
  const fieldDesc = document.getElementById("fieldDesc");
  const prereqField = document.getElementById("prereqField");
  const fieldPrereq = document.getElementById("fieldPrereq");

  let modalState = null;

  function openModal(state) {
    modalState = state;
    overlay.classList.add("open");

    if (state.mode === "edit") {
      modalTitle.textContent = "Editar tarefa";
      modalHint.textContent = "Ajuste a palavra-chave e a descrição.";

      fieldKeyword.value = state.task.keyword;
      fieldDesc.value = state.task.description || "";
      prereqField.style.display = "none";
    } else {
      modalTitle.textContent = "Nova tarefa";

      fieldKeyword.value = "";
      fieldDesc.value = "";

      prereqField.style.display = "";

      fieldPrereq.innerHTML =
        '<option value="">Nenhum (tarefa raiz)</option>' +
        Store.getActiveTasks()
          .map(
            (task) =>
              `<option value="${task.id}">${escapeHtml(task.keyword)}</option>`
          )
          .join("");

      if (state.prereqOfId) {
        fieldPrereq.value = state.prereqOfId;
        fieldPrereq.disabled = true;

        modalHint.textContent =
          'Esta tarefa se tornará pré-requisito de "' +
          state.prereqOfLabel +
          '".';
      } else {
        fieldPrereq.disabled = false;

        modalHint.textContent =
          "Descreva a tarefa e, se necessário, vincule-a como pré-requisito de outra.";
      }
    }

    setTimeout(() => fieldKeyword.focus(), 30);
  }

  function closeModal() {
    overlay.classList.remove("open");
    modalState = null;
  }

  document
    .getElementById("modalCancel")
    .addEventListener("click", closeModal);

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeModal();
    }
  });

  document.getElementById("modalSave").addEventListener("click", () => {
    const keyword = fieldKeyword.value.trim();

    if (!keyword) {
      toast("Informe uma palavra-chave.", "err");
      return;
    }

    if (!modalState) {
      return;
    }

    if (modalState.mode === "edit") {
      Store.editTask(modalState.task.id, {
        keyword,
        description: fieldDesc.value.trim(),
      });

      toast("Tarefa atualizada.");
    } else {
      const prereqOfId = fieldPrereq.value || null;

      Store.createTask({
        keyword,
        description: fieldDesc.value.trim(),
        prereqOfId,
      });

      toast("Tarefa criada.");
    }

    closeModal();
    renderList();

    if (currentView === "organism") {
      renderOrganism();
    }
  });

  document
    .getElementById("newTaskBtn")
    .addEventListener("click", () => openModal({ mode: "create" }));

  /* =====================================================================
     VISÃO EM ORGANISMO — SVG E ÁREA RESPONSIVA
  ===================================================================== */
  const svg = document.getElementById("organism");
  const camera = document.getElementById("camera");
  const hintBar = document.getElementById("hintBar");

  let cam = {
    x: CENTER.x,
    y: CENTER.y,
    scale: 0.82,
  };

  let pendingConnectId = null;
  const runtime = {};

  function showHint(message) {
    hintBar.textContent = message;
    hintBar.classList.toggle("show", !!message);
  }

  /*
    Faz o viewBox usar exatamente as dimensões visíveis do SVG.

    Assim, em celular, tablet, notebook ou monitor ultrawide,
    a câmera passa a calcular sua área usando a dimensão real
    disponível abaixo do header.
  */
  function resizeOrganismViewport() {
    const rect = svg.getBoundingClientRect();

    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    const currentViewBox = svg.viewBox.baseVal;

    if (
      Math.round(currentViewBox.width) !== width ||
      Math.round(currentViewBox.height) !== height
    ) {
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    }

    if (currentView === "organism") {
      applyCamera();
    }
  }

  function applyCamera() {
    const vb = svg.viewBox.baseVal;

    if (!vb.width || !vb.height) {
      return;
    }

    const tx = vb.width / 2 - cam.x * cam.scale;
    const ty = vb.height / 2 - cam.y * cam.scale;

    camera.setAttribute(
      "transform",
      `translate(${tx},${ty}) scale(${cam.scale})`
    );
  }

  function gradFor(depth, completed) {
    if (completed) {
      return "url(#gradSediment)";
    }

    const palette = [
      "url(#gradCyan)",
      "url(#gradViolet)",
      "url(#gradBlue)",
      "url(#gradTeal)",
    ];

    return palette[depth % palette.length];
  }

  function renderOrganism() {
    camera.innerHTML = "";

    const tasks = Store.all();

    const bg = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect"
    );

    bg.setAttribute("x", -2000);
    bg.setAttribute("y", -2000);
    bg.setAttribute("width", WORLD.w + 4000);
    bg.setAttribute("height", WORLD.h + 4000);
    bg.setAttribute("fill", "#070911");

    camera.appendChild(bg);

    const floor = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect"
    );

    floor.setAttribute("x", 0);
    floor.setAttribute("y", SEDIMENT_TOP - 150);
    floor.setAttribute("width", WORLD.w);
    floor.setAttribute(
      "height",
      WORLD.h - SEDIMENT_TOP + 150 + 400
    );
    floor.setAttribute("fill", "url(#gradFloor)");

    camera.appendChild(floor);

    const active = tasks.filter((task) => !task.completed);

    active.forEach((task) => {
      task.parents.forEach((parentId) => {
        const parent = Store.get(parentId);

        if (!parent || parent.completed) {
          return;
        }

        const path = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path"
        );

        const middleX = (task.x + parent.x) / 2;
        const middleY = (task.y + parent.y) / 2 - 40;

        path.setAttribute(
          "d",
          `M ${parent.x} ${parent.y} Q ${middleX} ${middleY} ${task.x} ${task.y}`
        );

        path.setAttribute("class", "connLine");
        path.setAttribute("stroke", "url(#gradConn)");
        path.setAttribute("stroke-width", 2);
        path.setAttribute("opacity", 0.55);

        camera.appendChild(path);
      });
    });

    tasks.forEach((task) => {
      const depth = task.completed ? 0 : Store.getDepth(task.id);
      const weight = task.completed ? 0 : Store.getWeight(task.id);

      const radius = task.completed
        ? 22
        : Math.min(70, 24 + weight * 5);

      const group = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "g"
      );

      group.setAttribute(
        "class",
        "node" +
          (task.completed ? " sediment" : "") +
          (pendingConnectId === task.id ? " selected" : "")
      );

      group.setAttribute("data-id", task.id);

      group.setAttribute(
        "transform",
        `translate(${task.x},${task.y})${
          task.completed ? " scale(1,0.82)" : ""
        }`
      );

      const circle = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle"
      );

      circle.setAttribute("r", radius);
      circle.setAttribute("fill", gradFor(depth, task.completed));
      circle.setAttribute("class", "membrane");

      if (!task.completed) {
        circle.setAttribute("filter", "url(#membraneGlow)");
      }

      circle.setAttribute(
        "stroke",
        task.completed
          ? "rgba(255,224,170,0.72)"
          : "rgba(232,255,250,0.68)"
      );

      circle.setAttribute(
        "stroke-width",
        task.completed ? 2.1 : 2.4
      );

      circle.setAttribute(
        "opacity",
        task.completed ? 0.94 : 0.98
      );

      group.appendChild(circle);

      if (!task.completed) {
        const nucleus = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "circle"
        );

        nucleus.setAttribute("r", Math.max(4, radius * 0.28));
        nucleus.setAttribute("fill", "rgba(255,255,255,0.35)");

        group.appendChild(nucleus);
      }

      const label = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text"
      );

      label.setAttribute("class", "nodeLabel");
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("y", task.completed ? 4 : radius + 16);
      label.setAttribute("font-size", task.completed ? 10 : 12);

      label.textContent = truncate(
        task.keyword,
        task.completed ? 12 : 20
      );

      group.appendChild(label);
      camera.appendChild(group);
    });

    applyCamera();
  }

  function truncate(text, maxLength) {
    return text.length > maxLength
      ? text.slice(0, maxLength - 1) + "…"
      : text;
  }

  /*
    ResizeObserver observa diretamente o espaço do organismo.
    Isso é mais confiável que somente window.resize, pois também
    cobre alterações causadas pelo header ou pelo layout.
  */
  if ("ResizeObserver" in window) {
    const organismResizeObserver = new ResizeObserver(() => {
      resizeOrganismViewport();

      if (currentView === "organism") {
        renderOrganism();
      }
    });

    organismResizeObserver.observe(orgWrap);
  }

  window.addEventListener("resize", () => {
    resizeOrganismViewport();

    if (currentView === "organism") {
      renderOrganism();
    }
  });

  window.addEventListener("orientationchange", () => {
    setTimeout(() => {
      resizeOrganismViewport();

      if (currentView === "organism") {
        renderOrganism();
      }
    }, 150);
  });

  /* =====================================================================
     INTERAÇÃO: ARRASTE, PAN, CONEXÃO E DUPLO CLIQUE
  ===================================================================== */
  let drag = null;
  let panState = null;
  let lastInteraction = Date.now();

  function svgPoint(event) {
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;

    const safeWidth = rect.width || 1;
    const safeHeight = rect.height || 1;

    const screenX =
      ((event.clientX - rect.left) / safeWidth) * vb.width;

    const screenY =
      ((event.clientY - rect.top) / safeHeight) * vb.height;

    const worldX =
      (screenX - vb.width / 2) / cam.scale + cam.x;

    const worldY =
      (screenY - vb.height / 2) / cam.scale + cam.y;

    return {
      x: worldX,
      y: worldY,
    };
  }

  svg.addEventListener("pointerdown", (event) => {
    lastInteraction = Date.now();

    const nodeEl = event.target.closest(".node");

    if (nodeEl) {
      const id = nodeEl.getAttribute("data-id");
      const task = Store.get(id);

      if (task.completed) {
        return;
      }

      const point = svgPoint(event);

      drag = {
        id,
        startX: point.x,
        startY: point.y,
        moved: false,
        offX: point.x - task.x,
        offY: point.y - task.y,
      };

      svg.setPointerCapture(event.pointerId);
      return;
    }

    panState = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      camX: cam.x,
      camY: cam.y,
    };

    svg.classList.add("panning");
    svg.setPointerCapture(event.pointerId);
  });

  svg.addEventListener("pointermove", (event) => {
    lastInteraction = Date.now();

    if (drag) {
      const point = svgPoint(event);

      if (
        Math.hypot(
          point.x - drag.startX,
          point.y - drag.startY
        ) > 4
      ) {
        drag.moved = true;
      }

      if (drag.moved) {
        Store.updatePosition(
          drag.id,
          point.x - drag.offX,
          point.y - drag.offY
        );

        renderOrganism();
      }

      return;
    }

    if (panState) {
      const rect = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;

      const dx =
        ((event.clientX - panState.startClientX) /
          (rect.width || 1)) *
        vb.width /
        cam.scale;

      const dy =
        ((event.clientY - panState.startClientY) /
          (rect.height || 1)) *
        vb.height /
        cam.scale;

      cam.x = panState.camX - dx;
      cam.y = panState.camY - dy;

      applyCamera();
    }
  });

  svg.addEventListener("pointerup", () => {
    if (drag) {
      if (!drag.moved) {
        handleNodeClick(drag.id);
      } else {
        Store.save();
      }

      drag = null;
    }

    if (panState) {
      panState = null;
      svg.classList.remove("panning");
    }
  });

  svg.addEventListener("pointercancel", () => {
    drag = null;
    panState = null;
    svg.classList.remove("panning");
  });

  svg.addEventListener("dblclick", (event) => {
    const nodeEl = event.target.closest(".node");

    if (!nodeEl) {
      return;
    }

    doComplete(nodeEl.getAttribute("data-id"));
  });

  function handleNodeClick(id) {
    const task = Store.get(id);

    if (task.completed) {
      return;
    }

    if (pendingConnectId === null) {
      pendingConnectId = id;

      showHint(
        'Pré-requisito selecionado: "' +
          task.keyword +
          '". Clique na tarefa que depende dele (ou no fundo para cancelar).'
      );

      renderOrganism();
      return;
    }

    if (pendingConnectId === id) {
      pendingConnectId = null;
      showHint("");
      renderOrganism();
      return;
    }

    const res = Store.connectTask(pendingConnectId, id);

    pendingConnectId = null;
    showHint("");

    if (!res.ok) {
      const messages = {
        exists: "Essa conexão já existe.",
        cycle: "Isso criaria um ciclo — conexão bloqueada.",
        same: "Não é possível conectar a si mesma.",
      };

      toast(messages[res.reason] || "Não foi possível conectar.", "err");
    } else {
      toast("Conexão criada.");
    }

    renderOrganism();

    if (currentView === "list") {
      renderList();
    }
  }

  svg.addEventListener("click", (event) => {
    if (!event.target.closest(".node") && pendingConnectId) {
      pendingConnectId = null;
      showHint("");
      renderOrganism();
    }
  });

  /* =====================================================================
     ZOOM
  ===================================================================== */
  function zoomAt(factor, clientX, clientY) {
    const before =
      clientX !== undefined
        ? svgPoint({ clientX, clientY })
        : { x: cam.x, y: cam.y };

    cam.scale = Math.max(0.12, Math.min(2.2, cam.scale * factor));

    if (clientX !== undefined) {
      const after = svgPoint({ clientX, clientY });

      cam.x += before.x - after.x;
      cam.y += before.y - after.y;
    }

    applyCamera();
  }

  svg.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();

      zoomAt(
        event.deltaY < 0 ? 1.1 : 0.9,
        event.clientX,
        event.clientY
      );
    },
    { passive: false }
  );

  document
    .getElementById("zoomIn")
    .addEventListener("click", () => zoomAt(1.2));

  document
    .getElementById("zoomOut")
    .addEventListener("click", () => zoomAt(0.83));

  document.getElementById("zoomReset").addEventListener("click", () => {
    cam = {
      x: CENTER.x,
      y: CENTER.y,
      scale: 0.82,
    };

    applyCamera();
  });

  /* =====================================================================
     MOTOR DE VIDA
  ===================================================================== */
  let engineRunning = false;
  let paused = false;
  let speed = 1.0;
  let rafId = null;
  let autosaveTimer = null;

  const IDLE_MS = 700;
  const WANDER_R = 360;

  function startEngine() {
    if (engineRunning) {
      return;
    }

    engineRunning = true;

    let last = performance.now();

    function tick(now) {
      const dt = Math.min(0.05, (now - last) / 1000);

      last = now;

      if (!paused && Date.now() - lastInteraction > IDLE_MS) {
        step(dt);
        renderOrganism();
      }

      if (engineRunning) {
        rafId = requestAnimationFrame(tick);
      }
    }

    rafId = requestAnimationFrame(tick);

    autosaveTimer = setInterval(() => Store.save(), 3000);
  }

  function stopEngine() {
    engineRunning = false;

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    if (autosaveTimer) {
      clearInterval(autosaveTimer);
      autosaveTimer = null;
    }

    Store.save();
  }

  function step(dt) {
    const active = Store.getActiveTasks();

    active.forEach((task) => {
      if (drag && drag.id === task.id) {
        return;
      }

      if (!runtime[task.id]) {
        runtime[task.id] = {
          heading: Math.random() * Math.PI * 2,
          vx: 0,
          vy: 0,
        };
      }

      const state = runtime[task.id];

      state.heading += (Math.random() - 0.5) * 0.9 * speed;

      let ax = Math.cos(state.heading) * 6 * speed;
      let ay = Math.sin(state.heading) * 6 * speed;

      const links = [
        ...Store.getParents(task.id),
        ...Store.getChildren(task.id),
      ].filter((other) => other && !other.completed);

      links.forEach((other) => {
        const dx = other.x - task.x;
        const dy = other.y - task.y;
        const distance = Math.hypot(dx, dy) || 1;

        const idealDistance = 200;
        const difference =
          (distance - idealDistance) / idealDistance;

        ax += (dx / distance) * difference * 14;
        ay += (dy / distance) * difference * 14;
      });

      const centerDX = CENTER.x - task.x;
      const centerDY = CENTER.y - task.y;
      const centerDistance = Math.hypot(centerDX, centerDY);

      if (centerDistance > WANDER_R) {
        ax +=
          (centerDX / centerDistance) *
          (centerDistance - WANDER_R) *
          0.02;

        ay +=
          (centerDY / centerDistance) *
          (centerDistance - WANDER_R) *
          0.02;
      }

      state.vx = (state.vx + ax * dt) * 0.94;
      state.vy = (state.vy + ay * dt) * 0.94;

      Store.updatePosition(
        task.id,
        task.x + state.vx,
        Math.min(task.y + state.vy, SEDIMENT_TOP - 40)
      );
    });

    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];

        if (
          (drag && drag.id === a.id) ||
          (drag && drag.id === b.id)
        ) {
          continue;
        }

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy) || 1;

        const minDistance = 90;

        if (distance < minDistance) {
          const push = (minDistance - distance) / 2;

          const nx = dx / distance;
          const ny = dy / distance;

          Store.updatePosition(
            a.id,
            a.x - nx * push,
            a.y - ny * push
          );

          Store.updatePosition(
            b.id,
            b.x + nx * push,
            b.y + ny * push
          );
        }
      }
    }
  }

  document.getElementById("pauseBtn").addEventListener("click", function () {
    paused = !paused;

    this.classList.toggle("paused", paused);
    this.classList.toggle("running", !paused);

    this.textContent = paused
      ? "▶ Vida pausada"
      : "⏸ Vida ativa";
  });

  document.getElementById("speedUp").addEventListener("click", () => {
    speed = Math.min(
      3.0,
      Math.round((speed + 0.2) * 10) / 10
    );

    document.getElementById("speedLabel").textContent =
      speed.toFixed(1) + "x";
  });

  document.getElementById("speedDown").addEventListener("click", () => {
    speed = Math.max(
      0.2,
      Math.round((speed - 0.2) * 10) / 10
    );

    document.getElementById("speedLabel").textContent =
      speed.toFixed(1) + "x";
  });

  /* =====================================================================
     EXPORTAR / IMPORTAR / RESET
  ===================================================================== */
  document.getElementById("exportBtn").addEventListener("click", () => {
    const blob = new Blob([Store.exportData()], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    const stamp = new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, "-");

    link.href = url;
    link.download = `organismo-de-tarefas-${stamp}.json`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);

    toast("Tarefas exportadas.");
  });

  const importFile = document.getElementById("importFile");

  document
    .getElementById("importBtn")
    .addEventListener("click", () => importFile.click());

  importFile.addEventListener("change", () => {
    const file = importFile.files[0];

    if (!file) {
      return;
    }

    if (
      !confirm(
        "Importar substituirá todas as tarefas atuais por este arquivo. Continuar?"
      )
    ) {
      importFile.value = "";
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const res = Store.importData(reader.result);

      if (!res.ok) {
        toast(
          res.reason === "parse"
            ? "Arquivo inválido — não é um JSON legível."
            : "Formato inesperado — verifique o arquivo.",
          "err"
        );
      } else {
        Object.keys(runtime).forEach((key) => delete runtime[key]);

        pendingConnectId = null;

        renderList();
        renderHistory();

        if (currentView === "organism") {
          renderOrganism();
        }

        toast("Tarefas importadas.");
      }

      importFile.value = "";
    };

    reader.readAsText(file);
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    if (
      !confirm(
        "Isto apaga permanentemente todas as tarefas e o histórico. Deseja continuar?"
      )
    ) {
      return;
    }

    Store.resetAll();

    Object.keys(runtime).forEach((key) => delete runtime[key]);

    pendingConnectId = null;

    renderList();
    renderHistory();

    if (currentView === "organism") {
      renderOrganism();
    }

    toast("Tudo apagado. Começando do zero.");
  });

  /* =====================================================================
     TECLADO
  ===================================================================== */
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    if (overlay.classList.contains("open")) {
      closeModal();
    } else if (pendingConnectId) {
      pendingConnectId = null;
      renderOrganism();
      showHint("");
    } else if (historyPanel.classList.contains("open")) {
      historyPanel.classList.remove("open");
    }
  });

  /* =====================================================================
     INIT
  ===================================================================== */
  renderList();
  renderHistory();

  requestAnimationFrame(() => {
    resizeOrganismViewport();
    applyCamera();
  });

  window.addEventListener("beforeunload", () => {
    Store.save();
  });
})();
