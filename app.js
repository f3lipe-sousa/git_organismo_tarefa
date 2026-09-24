(function () {
  "use strict";

  const {
    Store,
    WORLD,
    CENTER,
    TYPES,
    getBounds,
    setWorldBounds
  } = window.TaskCore;

  const SVG_NS = "http://www.w3.org/2000/svg";
  const $ = id => document.getElementById(id);

  const listView = $("listView");
  const orgWrap = $("organismWrap");
  const svg = $("organism");
  const camera = $("camera");
  const overlay = $("overlay");
  const historyPanel = $("historyPanel");

  let currentView = "list";
  let modalState = null;
  let pendingConnectId = null;
  let drag = null;
  let pan = null;
  let lastTap = null;
  let lastInteraction = Date.now();
  let paused = false;
  let speed = 1;
  let engineRunning = false;
  let rafId = null;
  let autosaveTimer = null;

  const runtime = new Map();
  const cam = { x: CENTER.x, y: CENTER.y, scale: 1 };

  function toast(message, type = "") {
    const element = document.createElement("div");
    element.className = "toast" + (type ? " " + type : "");
    element.textContent = message;
    $("toasts").appendChild(element);

    requestAnimationFrame(() => element.classList.add("show"));

    setTimeout(() => {
      element.classList.remove("show");
      setTimeout(() => element.remove(), 300);
    }, 3200);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function showHint(message) {
    $("hintBar").textContent = message;
    $("hintBar").classList.toggle("show", !!message);
  }

  function clearConnection() {
    pendingConnectId = null;
    showHint("");
  }

  function switchView(view) {
    if (view === currentView) return;

    currentView = view;
    listView.classList.toggle("active", view === "list");
    orgWrap.classList.toggle("active", view === "organism");
    $("toListBtn").classList.toggle("active", view === "list");
    $("toOrgBtn").classList.toggle("active", view === "organism");

    if (view === "organism") {
      requestAnimationFrame(() => {
        if (currentView !== "organism") return;

        resizeViewport();
        renderOrganism();
        startEngine();
      });
    } else {
      stopEngine();
      clearConnection();
      renderList();
    }
  }

  $("toListBtn").addEventListener("click", () => switchView("list"));
  $("toOrgBtn").addEventListener("click", () => switchView("organism"));

  function renderList() {
    const root = $("treeRoot");
    root.replaceChildren();

    const roots = Store.getRootTasks();

    if (!roots.length) {
      root.innerHTML =
        '<div class="emptyState">Nenhuma tarefa ativa. Toque em + para criar uma.</div>';
      return;
    }

    const list = document.createElement("ul");
    list.className = "tree top";

    const visited = new Set();
    roots.forEach(task => list.appendChild(buildNode(task, visited)));
    root.appendChild(list);
  }

  function buildNode(task, visited) {
    const item = document.createElement("li");
    item.className = "node-row";

    if (visited.has(task.id)) {
      item.innerHTML =
        '<div class="card duplicate"><div class="body">↺ ' +
        escapeHtml(task.keyword) +
        " (já exibida acima)</div></div>";
      return item;
    }

    visited.add(task.id);

    const parents = Store.getParents(task.id);
    const card = document.createElement("div");
    card.className = "card";

    card.innerHTML = `
      <span class="weightPip" title="Pré-requisitos acumulados">${Store.getWeight(task.id)}</span>
      <div class="body">
        <div class="cardHeading">
          <span class="kw">${escapeHtml(task.keyword)}</span>
          <span class="typeTag">${escapeHtml(TYPES[task.type] || TYPES.pessoal)}</span>
        </div>
        ${task.description
          ? `<div class="desc">${escapeHtml(task.description)}</div>`
          : ""}
        <div class="meta">${parents.length} pré-requisito(s) direto(s)</div>
      </div>
      <div class="actions">
        <button class="iconBtn complete" type="button" title="Concluir" aria-label="Concluir" data-act="complete">✓</button>
        <button class="iconBtn" type="button" title="Editar" aria-label="Editar" data-act="edit">✎</button>
        <button class="iconBtn" type="button" title="Adicionar pré-requisito" aria-label="Adicionar pré-requisito" data-act="add">＋</button>
        <button class="iconBtn del" type="button" title="Excluir" aria-label="Excluir" data-act="delete">✕</button>
      </div>
    `;

    const completeButton =
      card.querySelector('[data-act="complete"]');

    if (parents.some(parent => !parent.completed)) {
      completeButton.disabled = true;
      completeButton.title =
        "Conclua os pré-requisitos primeiro";
    }

    completeButton.addEventListener(
      "click",
      () => doComplete(task.id)
    );

    card.querySelector('[data-act="edit"]')
      .addEventListener("click", () => {
        openModal({ mode: "edit", taskId: task.id });
      });

    card.querySelector('[data-act="add"]')
      .addEventListener("click", () => {
        openModal({ mode: "create", prereqOfId: task.id });
      });

    card.querySelector('[data-act="delete"]')
      .addEventListener("click", () => {
        if (!confirm(
          `Excluir "${task.keyword}"? Isso removerá suas conexões.`
        )) {
          return;
        }

        Store.deleteTask(task.id);

        if (pendingConnectId === task.id) {
          clearConnection();
        }

        runtime.delete(task.id);
        toast("Tarefa excluída.");
        renderList();
        renderHistory();
      });

    item.appendChild(card);

    if (parents.length) {
      const children = document.createElement("ul");
      children.className = "tree";

      parents.forEach(parent => {
        children.appendChild(buildNode(parent, visited));
      });

      item.appendChild(children);
    }

    return item;
  }

  function doComplete(id) {
    const result = Store.toggleComplete(id);

    if (!result.ok) {
      if (result.reason === "blocked") {
        toast("Conclua antes os pré-requisitos.", "warn");
      }
      return;
    }

    if (pendingConnectId === id) clearConnection();

    runtime.delete(id);
    toast("Tarefa concluída — depositada no sedimento.");
    renderList();
    renderHistory();

    if (currentView === "organism") {
      renderOrganism();
    }
  }

  function renderHistory() {
    const list = $("historyList");

    const items = Store.all()
      .filter(task => task.completed)
      .sort((a, b) => b.completedAt - a.completedAt);

    if (!items.length) {
      list.innerHTML =
        '<div class="histEmpty">Nenhuma tarefa concluída.</div>';
      return;
    }

    list.innerHTML = items.map(task => {
      const date = new Date(task.completedAt);
      const when = Number.isNaN(date.getTime())
        ? "Data indisponível"
        : date.toLocaleDateString("pt-BR") + " às " +
          date.toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit"
          });

      return `
        <div class="histItem">
          <div class="kw">${escapeHtml(task.keyword)}</div>
          <div class="when">${escapeHtml(when)}</div>
        </div>
      `;
    }).join("");
  }

  $("historyToggle").addEventListener("click", () => {
    historyPanel.classList.add("open");
    renderHistory();
  });

  $("historyClose").addEventListener("click", () => {
    historyPanel.classList.remove("open");
  });

  function openModal(state) {
    const task = state.mode === "edit"
      ? Store.get(state.taskId)
      : null;

    if (state.mode === "edit" && !task) return;

    modalState = state;

    $("modalTitle").textContent =
      state.mode === "edit" ? "Editar tarefa" : "Nova tarefa";

    $("fieldKeyword").value = task?.keyword || "";
    $("fieldDesc").value = task?.description || "";
    $("fieldType").value = task?.type || "pessoal";
    $("prereqField").hidden = state.mode === "edit";

    if (state.mode === "edit") {
      $("modalHint").textContent =
        "Altere os campos desejados e toque em Salvar.";
    } else {
      const select = $("fieldPrereq");

      select.replaceChildren(
        new Option("Nenhum (tarefa raiz)", "")
      );

      Store.getActiveTasks().forEach(activeTask => {
        select.add(
          new Option(activeTask.keyword, activeTask.id)
        );
      });

      select.value = state.prereqOfId || "";
      select.disabled = !!state.prereqOfId;

      $("modalHint").textContent = state.prereqOfId
        ? `Esta tarefa será pré-requisito de "${Store.get(state.prereqOfId)?.keyword || "outra tarefa"}".`
        : "Somente a palavra-chave é obrigatória.";
    }

    overlay.classList.add("open");
    requestAnimationFrame(() => $("fieldKeyword").focus());
  }

  function closeModal() {
    overlay.classList.remove("open");
    modalState = null;
  }

  $("newTaskBtn").addEventListener("click", () => {
    openModal({ mode: "create" });
  });

  $("modalCancel").addEventListener("click", closeModal);

  overlay.addEventListener("click", event => {
    if (event.target === overlay) closeModal();
  });

  $("modal").addEventListener("submit", event => {
    event.preventDefault();
    if (!modalState) return;

    const keyword = $("fieldKeyword").value.trim();

    if (!keyword) {
      toast("Informe uma palavra-chave.", "err");
      $("fieldKeyword").focus();
      return;
    }

    const values = {
      keyword,
      description: $("fieldDesc").value.trim(),
      type: $("fieldType").value
    };

    if (modalState.mode === "edit") {
      Store.editTask(modalState.taskId, values);
      toast("Tarefa atualizada.");
    } else {
      Store.createTask({
        ...values,
        prereqOfId:
          modalState.prereqOfId ||
          $("fieldPrereq").value ||
          null
      });

      toast("Tarefa criada.");
    }

    closeModal();
    renderList();

    if (currentView === "organism") {
      renderOrganism();
    }
  });

  function fitCamera() {
    cam.x = CENTER.x;
    cam.y = CENTER.y;
    cam.scale = 1;
    applyCamera();
  }

  function resizeViewport() {
    if (currentView !== "organism") return;

    const rect = svg.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const box = svg.viewBox.baseVal;

    if (box.width === width && box.height === height &&
        WORLD.w === width && WORLD.h === height) {
      return;
    }

    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    setWorldBounds(width, height);

    // Uma mudança real de tela reposiciona o mundo no espaço novo.
    // Isso evita manter uma câmera deslocada para fora da área visível.
    fitCamera();
    renderOrganism();
  }

  function applyCamera() {
    const box = svg.viewBox.baseVal;
    if (!box.width || !box.height) return;

    camera.setAttribute(
      "transform",
      `translate(${box.width / 2 - cam.x * cam.scale},` +
      `${box.height / 2 - cam.y * cam.scale}) scale(${cam.scale})`
    );
  }

  function shapeFor(task, radius) {
    let shape;

    switch (task.type) {
      case "terceiros":
        shape = document.createElementNS(SVG_NS, "rect");
        shape.setAttribute("x", -radius * 0.88);
        shape.setAttribute("y", -radius * 0.88);
        shape.setAttribute("width", radius * 1.76);
        shape.setAttribute("height", radius * 1.76);
        shape.setAttribute("rx", 5);
        break;

      case "familia":
        shape = document.createElementNS(SVG_NS, "ellipse");
        shape.setAttribute("rx", radius * 0.78);
        shape.setAttribute("ry", radius * 1.12);
        break;

      case "trabalho": {
        shape = document.createElementNS(SVG_NS, "polygon");

        const points = Array.from({ length: 6 }, (_, index) => {
          const angle = Math.PI / 3 * index - Math.PI / 2;

          return `${Math.cos(angle) * radius},${Math.sin(angle) * radius}`;
        });

        shape.setAttribute("points", points.join(" "));
        break;
      }

      default:
        shape = document.createElementNS(SVG_NS, "circle");
        shape.setAttribute("r", radius);
    }

    return shape;
  }

  function truncate(text, length) {
    return text.length > length
      ? text.slice(0, length - 1) + "…"
      : text;
  }

  function renderOrganism() {
    if (currentView !== "organism") return;

    camera.replaceChildren();

    const background = document.createElementNS(SVG_NS, "rect");
    background.setAttribute("x", -2000);
    background.setAttribute("y", -2000);
    background.setAttribute("width", WORLD.w + 4000);
    background.setAttribute("height", WORLD.h + 4000);
    background.setAttribute("fill", "#070911");
    camera.appendChild(background);

    const sedimentTop = getBounds().sedimentTop;

    const floor = document.createElementNS(SVG_NS, "rect");
    floor.setAttribute("x", 0);
    floor.setAttribute("y", sedimentTop - 150);
    floor.setAttribute("width", WORLD.w);
    floor.setAttribute(
      "height",
      WORLD.h - sedimentTop + 550
    );
    floor.setAttribute("fill", "url(#gradFloor)");
    camera.appendChild(floor);

    const tasks = Store.all();

    tasks.filter(task => !task.completed).forEach(task => {
      Store.getParents(task.id).forEach(parent => {
        if (parent.completed) return;

        const path = document.createElementNS(SVG_NS, "path");
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

    const palette = [
      "url(#gradGreen)",
      "url(#gradViolet)",
      "url(#gradBlue)",
      "url(#gradOrange)"
    ];

    tasks.forEach(task => {
      const weight = task.completed
        ? 0
        : Store.getWeight(task.id);

      const radius = task.completed
        ? 22
        : Math.min(70, 24 + weight * 5);

      const depth = task.completed
        ? 0
        : Store.getDepth(task.id);

      const group = document.createElementNS(SVG_NS, "g");

      group.setAttribute(
        "class",
        "node" +
          (task.completed ? " sediment" : "") +
          (pendingConnectId === task.id ? " selected" : "")
      );

      group.setAttribute("data-id", task.id);

      group.setAttribute(
        "transform",
        `translate(${task.x},${task.y})` +
          (task.completed ? " scale(1,0.82)" : "")
      );

      const membrane = shapeFor(task, radius);
      membrane.setAttribute("class", "membrane");

      membrane.setAttribute(
        "fill",
        task.completed
          ? "url(#gradSediment)"
          : palette[Math.min(depth, palette.length - 1)]
      );

      membrane.setAttribute(
        "stroke",
        task.completed
          ? "rgba(255,224,170,0.72)"
          : "rgba(232,255,250,0.68)"
      );

      membrane.setAttribute(
        "stroke-width",
        task.completed ? 2.1 : 2.4
      );

      if (!task.completed) {
        membrane.setAttribute(
          "filter",
          "url(#membraneGlow)"
        );
      }

      group.appendChild(membrane);

      if (!task.completed) {
        const nucleus =
          document.createElementNS(SVG_NS, "circle");

        nucleus.setAttribute(
          "r",
          Math.max(4, radius * 0.22)
        );

        nucleus.setAttribute(
          "fill",
          "rgba(255,255,255,0.35)"
        );

        group.appendChild(nucleus);
      }

      const label =
        document.createElementNS(SVG_NS, "text");

      label.setAttribute("class", "nodeLabel");
      label.setAttribute("text-anchor", "middle");
      label.setAttribute(
        "y",
        task.completed ? 4 : radius * 1.12 + 17
      );
      label.setAttribute(
        "font-size",
        task.completed ? 10 : 12
      );

      label.textContent = truncate(
        task.keyword,
        task.completed ? 12 : 20
      );

      group.appendChild(label);
      camera.appendChild(group);
    });

    applyCamera();
  }

  function svgPoint(event) {
    const rect = svg.getBoundingClientRect();
    const box = svg.viewBox.baseVal;

    const screenX =
      (event.clientX - rect.left) /
      (rect.width || 1) * box.width;

    const screenY =
      (event.clientY - rect.top) /
      (rect.height || 1) * box.height;

    return {
      x: (screenX - box.width / 2) / cam.scale + cam.x,
      y: (screenY - box.height / 2) / cam.scale + cam.y
    };
  }

  function handleNodeTap(id) {
    const task = Store.get(id);
    if (!task || task.completed) return;

    if (pendingConnectId === null) {
      pendingConnectId = id;

      showHint(
        `Pré-requisito: "${task.keyword}". Toque na tarefa dependente ou no fundo para cancelar.`
      );

      renderOrganism();
      return;
    }

    if (pendingConnectId === id) {
      clearConnection();
      renderOrganism();
      return;
    }

    const result =
      Store.connectTask(pendingConnectId, id);

    clearConnection();

    if (!result.ok) {
      const messages = {
        exists: "Essa conexão já existe.",
        cycle: "Isso criaria um ciclo.",
        same: "Não é possível conectar a si mesma."
      };

      toast(
        messages[result.reason] ||
          "Não foi possível conectar.",
        "err"
      );
    } else {
      toast("Conexão criada.");
    }

    renderList();
    renderOrganism();
  }

  svg.addEventListener("pointerdown", event => {
    lastInteraction = Date.now();

    const node = event.target.closest(".node");

    if (node) {
      const id = node.getAttribute("data-id");
      const task = Store.get(id);

      if (!task || task.completed) return;

      const point = svgPoint(event);

      drag = {
        id,
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        offsetX: point.x - task.x,
        offsetY: point.y - task.y,
        moved: false
      };

      svg.setPointerCapture(event.pointerId);
      return;
    }

    pan = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      camX: cam.x,
      camY: cam.y,
      moved: false
    };

    svg.classList.add("panning");
    svg.setPointerCapture(event.pointerId);
  });

  svg.addEventListener("pointermove", event => {
    if (drag?.pointerId === event.pointerId) {
      lastInteraction = Date.now();

      const point = svgPoint(event);

      if (Math.hypot(
        point.x - drag.startX,
        point.y - drag.startY
      ) > 4) {
        drag.moved = true;
      }

      if (drag.moved) {
        Store.updatePosition(
          drag.id,
          point.x - drag.offsetX,
          point.y - drag.offsetY
        );

        renderOrganism();
      }

      return;
    }

    if (pan?.pointerId === event.pointerId) {
      lastInteraction = Date.now();

      const dx = event.clientX - pan.clientX;
      const dy = event.clientY - pan.clientY;

      if (Math.hypot(dx, dy) > 4) {
        pan.moved = true;
      }

      cam.x = pan.camX - dx / cam.scale;
      cam.y = pan.camY - dy / cam.scale;
      applyCamera();
    }
  });

  svg.addEventListener("pointerup", event => {
    if (drag?.pointerId === event.pointerId) {
      const { id, moved } = drag;
      drag = null;

      if (moved) {
        lastTap = null;
        Store.save();
      } else {
        const now = Date.now();

        if (lastTap?.id === id &&
            now - lastTap.time < 350) {
          clearTimeout(lastTap.timer);
          lastTap = null;
          doComplete(id);
        } else {
          if (lastTap) clearTimeout(lastTap.timer);

          const tap = {
            id,
            time: now,
            timer: setTimeout(() => {
              if (lastTap !== tap) return;

              lastTap = null;
              handleNodeTap(id);
            }, 350)
          };

          lastTap = tap;
        }
      }
    }

    if (pan?.pointerId === event.pointerId) {
      const moved = pan.moved;
      pan = null;
      svg.classList.remove("panning");

      if (!moved && pendingConnectId) {
        clearConnection();
        renderOrganism();
      }
    }
  });

  svg.addEventListener("pointercancel", () => {
    drag = null;
    pan = null;
    svg.classList.remove("panning");
    Store.save();
  });

  function zoomAt(factor, clientX, clientY) {
    const anchored = clientX !== undefined;

    const before = anchored
      ? svgPoint({ clientX, clientY })
      : null;

    cam.scale = Math.max(
      0.12,
      Math.min(2.2, cam.scale * factor)
    );

    if (anchored) {
      const after = svgPoint({ clientX, clientY });
      cam.x += before.x - after.x;
      cam.y += before.y - after.y;
    }

    applyCamera();
  }

  svg.addEventListener("wheel", event => {
    event.preventDefault();

    zoomAt(
      event.deltaY < 0 ? 1.1 : 0.9,
      event.clientX,
      event.clientY
    );
  }, { passive: false });

  $("zoomIn").addEventListener(
    "click",
    () => zoomAt(1.2)
  );

  $("zoomOut").addEventListener(
    "click",
    () => zoomAt(0.83)
  );

  $("zoomReset").addEventListener(
    "click",
    fitCamera
  );

  if ("ResizeObserver" in window) {
    new ResizeObserver(resizeViewport).observe(orgWrap);
  } else {
    window.addEventListener("resize", resizeViewport);
  }

  function randomTarget() {
    const margin = WORLD.padding;

    return {
      x: margin + Math.random() *
        Math.max(0, WORLD.w - 2 * margin),
      y: margin + Math.random() *
        Math.max(0, WORLD.h - 2 * margin)
    };
  }

  function step(dt) {
    const active = Store.getActiveTasks();
    const delta = Math.min(dt, 0.05) * speed;

    active.forEach(task => {
      if (drag?.id === task.id) return;

      if (!runtime.has(task.id)) {
        runtime.set(task.id, {
          target: randomTarget(),
          remaining: 3 + Math.random() * 5,
          vx: 0,
          vy: 0
        });
      }

      const state = runtime.get(task.id);
      state.remaining -= delta;

      const targetDistance = Math.hypot(
        state.target.x - task.x,
        state.target.y - task.y
      );

      if (state.remaining <= 0 ||
          targetDistance < 35) {
        state.target = randomTarget();
        state.remaining = 3 + Math.random() * 5;
      }

      const dx = state.target.x - task.x;
      const dy = state.target.y - task.y;
      const distance = Math.hypot(dx, dy) || 1;

      // Alvos distribuídos por toda a área, sem atração ao centro.
      let vx = dx / distance * Math.min(90, distance * 0.45);
      let vy = dy / distance * Math.min(90, distance * 0.45);

      const links = [
        ...Store.getParents(task.id),
        ...Store.getChildren(task.id)
      ].filter(other => !other.completed);

      links.forEach(other => {
        const linkX = other.x - task.x;
        const linkY = other.y - task.y;
        const linkDistance =
          Math.hypot(linkX, linkY) || 1;

        // Vínculos influenciam o movimento sem confinar a rede
        // em um círculo no meio da tela.
        const correction = Math.max(
          -24,
          Math.min(24, (linkDistance - 200) * 0.12)
        );

        vx += linkX / linkDistance * correction;
        vy += linkY / linkDistance * correction;
      });

      const smoothing = Math.min(1, delta * 2.2);

      state.vx += (vx - state.vx) * smoothing;
      state.vy += (vy - state.vy) * smoothing;

      Store.updatePosition(
        task.id,
        task.x + state.vx * delta,
        task.y + state.vy * delta
      );
    });

    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];

        if (drag?.id === a.id ||
            drag?.id === b.id) {
          continue;
        }

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);

        if (distance >= 90) continue;

        const directionX =
          distance > 0 ? dx / distance : 1;

        const directionY =
          distance > 0 ? dy / distance : 0;

        const push = (90 - distance) / 2;

        Store.updatePosition(
          a.id,
          a.x - directionX * push,
          a.y - directionY * push
        );

        Store.updatePosition(
          b.id,
          b.x + directionX * push,
          b.y + directionY * push
        );
      }
    }
  }

  function startEngine() {
    if (engineRunning) return;

    engineRunning = true;
    let last = performance.now();

    function tick(now) {
      if (!engineRunning) return;

      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (!paused &&
          Date.now() - lastInteraction > 700 &&
          !document.hidden) {
        step(dt);
        renderOrganism();
      }

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);

    autosaveTimer = setInterval(
      () => Store.save(),
      3000
    );
  }

  function stopEngine() {
    engineRunning = false;

    if (rafId !== null) {
      cancelAnimationFrame(rafId);
    }

    if (autosaveTimer !== null) {
      clearInterval(autosaveTimer);
    }

    rafId = null;
    autosaveTimer = null;
    Store.save();
  }

  $("pauseBtn").addEventListener("click", () => {
    paused = !paused;

    $("pauseBtn").classList.toggle(
      "paused",
      paused
    );

    $("pauseBtn").classList.toggle(
      "running",
      !paused
    );

    $("pauseBtn").textContent =
      paused ? "▶" : "⏸";

    $("pauseBtn").title =
      paused ? "Retomar animação" : "Pausar animação";

    $("pauseBtn").setAttribute(
      "aria-label",
      paused ? "Retomar animação" : "Pausar animação"
    );
  });

  function updateSpeed(change) {
    speed = Math.max(
      0.2,
      Math.min(
        3,
        Math.round((speed + change) * 10) / 10
      )
    );

    $("speedLabel").textContent =
      speed.toFixed(1).replace(".", ",") + "×";
  }

  $("speedUp").addEventListener(
    "click",
    () => updateSpeed(0.2)
  );

  $("speedDown").addEventListener(
    "click",
    () => updateSpeed(-0.2)
  );

  $("exportBtn").addEventListener("click", () => {
    const blob = new Blob(
      [Store.exportData()],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    const stamp = new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, "-");

    link.href = url;
    link.download =
      `organismo-de-tarefas-${stamp}.json`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(
      () => URL.revokeObjectURL(url),
      1000
    );

    toast("Tarefas exportadas.");
  });

  function refreshAfterReplacement() {
    runtime.clear();
    clearConnection();

    if (lastTap) {
      clearTimeout(lastTap.timer);
    }

    lastTap = null;

    renderList();
    renderHistory();

    if (currentView === "organism") {
      renderOrganism();
    }
  }

  const importFile = $("importFile");

  $("importBtn").addEventListener(
    "click",
    () => importFile.click()
  );

  importFile.addEventListener("change", async () => {
    const file = importFile.files?.[0];
    if (!file) return;

    if (!confirm(
      "Importar substituirá todas as tarefas atuais. Deseja continuar?"
    )) {
      importFile.value = "";
      return;
    }

    try {
      const result =
        Store.importData(await file.text());

      if (!result.ok) {
        toast(
          result.reason === "parse"
            ? "Arquivo inválido: JSON ilegível."
            : "Formato inesperado de arquivo.",
          "err"
        );
      } else {
        refreshAfterReplacement();
        toast("Tarefas importadas.");
      }
    } catch {
      toast(
        "Não foi possível ler o arquivo.",
        "err"
      );
    } finally {
      importFile.value = "";
    }
  });

  $("resetBtn").addEventListener("click", () => {
    if (!confirm(
      "Isto apagará todas as tarefas e o histórico. Deseja continuar?"
    )) {
      return;
    }

    Store.resetAll();
    refreshAfterReplacement();
    toast("Tarefas apagadas.");
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;

    if (overlay.classList.contains("open")) {
      closeModal();
    } else if (pendingConnectId) {
      clearConnection();
      renderOrganism();
    } else {
      historyPanel.classList.remove("open");
    }
  });

  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) {
        Store.save();
      }
    }
  );

  window.addEventListener(
    "beforeunload",
    () => Store.save()
  );

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js")
        .catch(error => {
          console.warn(
            "Service worker não registrado:",
            error
          );
        });
    });
  }

  renderList();
  renderHistory();
})();
