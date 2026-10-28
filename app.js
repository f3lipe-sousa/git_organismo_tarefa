/* ORGANISMO_MELHORIAS_V4 */
/* ORGANISMO_COMPACTO_V2 */
/* ORGANISMO_COMPACTO_V1 */
(function () {
  "use strict";

  const {
    Store, TYPES, URGENCIES, WORLD, CENTER,
    today, validDate, appearance, setWorldBounds
  } = window.TaskCore;

  const $ = id => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";
  const svg = $("organism");
  const camera = $("camera");

  let currentView = "list";
  let modalState = null;
  let dependencyId = null;
  let organizing = false;
  let paused = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let speed = 1;
  let gesture = null;
  let lastInteraction = Date.now();
  let lastFrame = performance.now();
  let lastPaint = 0;
  let lastAgeRefresh = Date.now();
  let storageWarningShown = false;
  let focusedTaskId = null;

  const selected = new Set();
  const runtime = new Map();
  const nodes = new Map();
  const lines = [];
  const cam = { x: CENTER.x, y: CENTER.y, scale: 1 };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svgElement(tag, attributes = {}) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attributes).forEach(([key, value]) =>
      node.setAttribute(key, value));
    return node;
  }

  function toast(message, type = "") {
    const node = element("div", "toast " + type, message);
    $("toasts").appendChild(node);
    setTimeout(() => node.remove(), 5000);
  }

  function checkStorage() {
    if (Store.hasStorageError() && !storageWarningShown) {
      storageWarningShown = true;
      toast(
        "Não foi possível salvar no navegador. Exporte um backup para proteger suas tarefas.",
        "warn"
      );
    }
  }

  function persist() {
    Store.save();
    checkStorage();
  }

  function formatDate(value) {
    if (!validDate(value)) return "Data indisponível";
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }

  function formatTimestamp(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? "Data indisponível"
      : date.toLocaleString("pt-BR", {
          dateStyle: "short",
          timeStyle: "short"
        });
  }

  function matches(task) {
    const search = $("filterSearch").value.trim()
      .toLocaleLowerCase("pt-BR");
    const types = [...$("filterType").selectedOptions]
      .map(option => option.value).filter(Boolean);
    const urgency = $("filterUrgency").value;
    const status = $("filterStatus").value;

    if (search && !`${task.keyword} ${task.description}`
        .toLocaleLowerCase("pt-BR").includes(search)) return false;

    if (types.length && !types.includes(task.type)) return false;
    if (urgency && task.urgency !== Number(urgency)) return false;
    if (status === "active" && task.completed) return false;
    if (status === "completed" && !task.completed) return false;
    if (status === "alert" && !appearance(task).alert) return false;

    return true;
  }

  function visibleTasks() {
    return Store.all().filter(matches);
  }

  function visibleActive() {
    return visibleTasks().filter(task => !task.completed);
  }

  function action(label, callback, disabled = false, title = "") {
    const button = element("button", "", label);
    button.type = "button";
    button.disabled = disabled;
    if (title) button.title = title;
    button.addEventListener("click", callback);
    return button;
  }

  function isReady(task) {
    return !!task && !task.completed &&
      Store.getParents(task.id).every(parent => parent.completed);
  }

  function availabilityLabel(task) {
    if (task.completed) return "Concluída";
    return isReady(task)
      ? "Pronta para resolução"
      : "Bloqueada por pré-requisito pendente";
  }

  function showTaskDetails(task) {
    if (!task.completed) {
      openTaskModal({ mode: "edit", id: task.id });
      return;
    }

    const dialog = element("dialog", "taskDetailsDialog");
    const heading = element("h2", "", task.keyword);
    heading.id = "completedTaskDetailsTitle";
    dialog.setAttribute("aria-labelledby", heading.id);

    const details = element("div", "completedDetails");

    details.append(
      element("p", "", "Tipo: " + TYPES[task.type]),
      element("p", "", "Situação: Concluída"),
      element("p", "", "Início: " + formatDate(task.startDate)),
      element("p", "", "Conclusão: " + formatTimestamp(task.completedAt)),
      element("p", "", "Urgência: " + URGENCIES[task.urgency].label)
    );

    if (task.description) {
      details.appendChild(element("p", "description", task.description));
    }

    const footer = element("div", "modalActions");
    footer.appendChild(action("Fechar", () => dialog.close()));

    dialog.append(heading, details, footer);
    document.body.appendChild(dialog);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.showModal();
    footer.querySelector("button").focus();
  }

  function openTaskActions(id) {
    const task = Store.get(id);
    if (!task || task.completed) return;

    const dialog = element("dialog", "taskActionsDialog");
    const heading = element("h2", "", task.keyword);
    heading.id = "taskActionsTitle";
    dialog.setAttribute("aria-labelledby", heading.id);

    const status = element("p",
      isReady(task) ? "availability readyText" : "availability",
      availabilityLabel(task)
    );

    const options = element("div", "taskActionOptions");

    function option(label, callback) {
      return action(label, () => {
        dialog.close();
        callback();
      });
    }

    options.append(
      option("Detalhes / editar", () =>
        openTaskModal({ mode: "edit", id: task.id })),

      option("+ Pré-requisito", () =>
        openTaskModal({
          mode: "create",
          relation: "prerequisite",
          targetId: task.id
        })),

      option("+ Dependente", () =>
        openTaskModal({
          mode: "create",
          relation: "dependent",
          targetId: task.id
        })),

      option("Gerenciar dependências", () => openDependencies(task.id)),

      option("Excluir tarefa", () => {
        if (!confirm(
          'Excluir "' + task.keyword + '" e remover suas conexões?'
        )) return;

        Store.deleteTask(task.id);
        selected.delete(task.id);
        runtime.delete(task.id);
        refresh();
        toast("Tarefa excluída.");
      })
    );

    options.lastElementChild.classList.add("danger");

    const footer = element("div", "modalActions");
    footer.appendChild(action("Fechar", () => dialog.close()));

    dialog.append(heading, status, options, footer);
    document.body.appendChild(dialog);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.showModal();
    options.querySelector("button").focus();
  }

  function taskCard(task, context = false) {
    const visual = appearance(task);
    const ready = isReady(task);

    const card = element(
      "div",
      "card compactCard" +
        (context ? " context" : "") +
        (task.completed ? " completed" : "") +
        (visual.alert ? " alert" : "") +
        (ready ? " ready" : "")
    );

    card.dataset.taskId = task.id;
    card.classList.toggle("selectedTask", selected.has(task.id));

    if (context) {
      card.title =
        "Exibida para contextualizar a dependência; não corresponde ao filtro.";
    }

    const weight = element("span", "weightPip",
      String(Store.getWeight(task.id)));
    weight.title = "Quantidade de pré-requisitos acumulados";
    weight.setAttribute("aria-label",
      Store.getWeight(task.id) + " pré-requisitos acumulados");

    const typeIcon = svgElement("svg", {
      class: "taskTypeIcon",
      viewBox: "-9 -9 18 18",
      width: 18,
      height: 18,
      "aria-hidden": "true",
      focusable: "false"
    });

    const miniShape = shape(task.type, 6);
    miniShape.setAttribute("fill", "none");
    miniShape.setAttribute("stroke", "currentColor");
    miniShape.setAttribute("stroke-width", "1.6");
    typeIcon.appendChild(miniShape);

    const typeBadge = element("span", "compactType");
    typeBadge.title = TYPES[task.type];
    typeBadge.setAttribute("aria-label", "Tipo: " + TYPES[task.type]);
    typeBadge.appendChild(typeIcon);

    const keyword = action(task.keyword, () => showTaskDetails(task));
    keyword.className = "taskTitleButton";
    keyword.title = task.keyword + " — " + TYPES[task.type] +
      " — abrir detalhes";
    keyword.setAttribute("aria-label",
      task.keyword + " — abrir detalhes da tarefa");

    const status = element("span",
      "taskStatus" + (ready ? " readyStatus" : ""),
      task.completed ? "✓" : ready ? "●" : "🔒");
    status.title = availabilityLabel(task);
    status.setAttribute("aria-label", availabilityLabel(task));

    const actions = element("div", "actions compactActions");

    if (!task.completed) {
      const complete = action("✓", () => {
        const result = Store.completeTask(task.id);

        if (!result.ok) {
          toast("Conclua os pré-requisitos primeiro.", "warn");
          return;
        }

        selected.delete(task.id);
        runtime.delete(task.id);
        refresh();
        toast("Tarefa concluída e depositada no sedimento.");
      }, !ready, ready
        ? "Concluir tarefa"
        : "Conclua os pré-requisitos primeiro");

      complete.className = "completeTaskButton";
      complete.setAttribute("aria-label", "Concluir " + task.keyword);

      const menu = action("⋯", () => openTaskActions(task.id));
      menu.className = "taskMenuButton";
      menu.title = "Editar, criar tarefas relacionadas e gerenciar dependências";
      menu.setAttribute("aria-label", "Mais ações para " + task.keyword);
      menu.setAttribute("aria-haspopup", "dialog");

      actions.append(complete, menu);
    } else {
      const details = action("⋯", () => showTaskDetails(task));
      details.title = "Detalhes da tarefa concluída";
      details.setAttribute("aria-label", "Detalhes de " + task.keyword);
      actions.appendChild(details);
    }

    card.append(weight, typeBadge, keyword, status, actions);
    return card;
  }

  function renderList() {
    const root = $("treeRoot");
    root.replaceChildren();

    const matched = visibleTasks();
    const included = new Set();

    matched.filter(task => !task.completed).forEach(task => {
      const stack = [task.id];

      while (stack.length) {
        const id = stack.pop();
        if (included.has(id)) continue;
        included.add(id);
        stack.push(...(Store.get(id)?.parents || []));
      }
    });

    const active = Store.getActiveTasks()
      .filter(task => included.has(task.id));

    const prerequisites = new Set(active.flatMap(task => task.parents));
    const roots = active.filter(task => !prerequisites.has(task.id));
    const visited = new Set();

    function build(task) {
      const item = element("li", "node-row");

      if (visited.has(task.id)) {
        item.appendChild(element("div", "duplicate",
          `↺ ${task.keyword} — compartilhada, já exibida acima`));
        return item;
      }

      visited.add(task.id);
      item.appendChild(taskCard(task, !matches(task)));

      const parents = Store.getParents(task.id)
        .filter(parent => included.has(parent.id));

      if (parents.length) {
        const list = element("ul", "tree");
        parents.forEach(parent => list.appendChild(build(parent)));
        item.appendChild(list);
      }
      return item;
    }

    if (roots.length) {
      const list = element("ul", "tree top");
      roots.forEach(task => list.appendChild(build(task)));
      root.appendChild(list);
    }

    matched.filter(task => task.completed)
      .sort((a, b) => b.completedAt - a.completedAt)
      .forEach(task => root.appendChild(taskCard(task)));

    if (!matched.length) {
      root.appendChild(element("div", "emptyState",
        Store.all().length
          ? "Nenhuma tarefa corresponde aos filtros."
          : "Nenhuma tarefa. Clique em + Nova tarefa para começar."));
    }

    $("filterCount").textContent =
      `${matched.length} de ${Store.all().length} tarefa(s)`;
  }

  function renderHistory() {
    const root = $("historyList");
    root.replaceChildren();

    const completed = Store.all()
      .filter(task => task.completed)
      .sort((a, b) => b.completedAt - a.completedAt);

    if (!completed.length) {
      root.appendChild(element("p", "", "Nenhuma tarefa concluída."));
      return;
    }

    completed.forEach(task => {
      const item = element("div", "histItem");
      item.append(
        element("strong", "", task.keyword),
        element("p", "", `Início: ${formatDate(task.startDate)}`),
        element("p", "", `Conclusão: ${formatTimestamp(task.completedAt)}`)
      );
      root.appendChild(item);
    });
  }

  function fillTaskSelect(select, excludeId = null) {
    select.replaceChildren();

    Store.getActiveTasks()
      .filter(task => task.id !== excludeId)
      .sort((a, b) => a.keyword.localeCompare(b.keyword, "pt-BR"))
      .forEach(task =>
        select.add(new Option(task.keyword, task.id)));
  }

  function inheritRelatedType() {
    if (!modalState || modalState.mode !== "create" ||
        modalState.typeTouched || !$("fieldRelation").value) return;

    const origin = Store.get($("fieldTarget").value);
    if (origin && !origin.completed) {
      $("fieldType").value = origin.type;
    }
  }

  function updateRelationField() {
    $("fieldTarget").disabled = !$("fieldRelation").value;
    inheritRelatedType();
  }

  function openTaskModal(state) {
    const task = state.mode === "edit" ? Store.get(state.id) : null;
    if (state.mode === "edit" && (!task || task.completed)) return;

    modalState = { ...state, typeTouched: !!state.type };
    $("modalTitle").textContent = task ? "Editar tarefa" : "Nova tarefa";
    $("fieldKeyword").value = task?.keyword || "";
    $("fieldDesc").value = task?.description || "";
    const origin = state.relation && state.targetId
      ? Store.get(state.targetId)
      : null;

    $("fieldType").value = task?.type || state.type || origin?.type || "pessoal";
    $("fieldUrgency").value = String(task?.urgency || 3);
    $("fieldStartDate").value = task?.startDate || today();
    $("fieldStartDate").max = today();
    $("relationFields").hidden = !!task;

    fillTaskSelect($("fieldTarget"));
    $("fieldRelation").value = state.relation || "";
    if (state.targetId) $("fieldTarget").value = state.targetId;
    updateRelationField();

    let availability = $("taskAvailability");

    if (!availability) {
      availability = element("p", "availability");
      availability.id = "taskAvailability";
      availability.setAttribute("role", "status");
      $("modalTitle").insertAdjacentElement("afterend", availability);
    }

    availability.hidden = !task;
    availability.textContent = task ? availabilityLabel(task) : "";
    availability.classList.toggle("readyText", !!task && isReady(task));

    $("taskDialog").showModal();
    $("fieldKeyword").focus();
  }

  $("fieldRelation").addEventListener("change", updateRelationField);
  $("fieldTarget").addEventListener("change", inheritRelatedType);
  $("fieldType").addEventListener("change", () => {
    if (modalState) modalState.typeTouched = true;
  });
  $("newTaskBtn").addEventListener("click", openTypePicker);
  $("modalCancel").addEventListener("click", () =>
    $("taskDialog").close());
  $("taskDialog").addEventListener("close", () => {
    modalState = null;
  });

  $("taskForm").addEventListener("submit", event => {
    event.preventDefault();
    if (!modalState) return;

    const keyword = $("fieldKeyword").value.trim();
    const startDate = $("fieldStartDate").value;
    const relation = $("fieldRelation").value;
    const targetId = $("fieldTarget").value;

    if (!keyword) {
      toast("Informe uma palavra-chave.", "warn");
      return;
    }

    if (!validDate(startDate) || startDate > today()) {
      toast("Escolha uma data inicial válida, até hoje.", "warn");
      return;
    }

    if (modalState.mode === "create" && relation &&
        (!Store.get(targetId) || Store.get(targetId).completed)) {
      toast("Escolha uma tarefa ativa para criar a dependência.", "warn");
      return;
    }

    const values = {
      keyword,
      startDate,
      description: $("fieldDesc").value.trim(),
      type: $("fieldType").value,
      urgency: Number($("fieldUrgency").value),
      relation,
      targetId
    };

    if (modalState.mode === "edit") {
      Store.editTask(modalState.id, values);
    } else {
      Store.createTask(values);
    }

    $("taskDialog").close();
    refresh();
    toast("Tarefa salva.");
  });

  function renderDependencies() {
    const task = Store.get(dependencyId);
    if (!task || task.completed) {
      $("dependencyDialog").close();
      return;
    }

    $("dependencyTitle").textContent = task.keyword;
    const root = $("dependencyList");
    root.replaceChildren();

    const parents = Store.getParents(task.id);

    if (!parents.length) {
      root.appendChild(element("p", "", "Nenhum pré-requisito."));
    }

    parents.forEach(parent => {
      const row = element("div", "dependencyRow");
      row.append(
        element("span", "", parent.keyword),
        action("Remover vínculo", () => {
          Store.disconnectTask(parent.id, task.id);
          renderDependencies();
          refresh();
        })
      );
      root.appendChild(row);
    });

    fillTaskSelect($("dependencyTarget"), task.id);
  }

  function openDependencies(id) {
    dependencyId = id;
    renderDependencies();
    $("dependencyDialog").showModal();
  }

  $("dependencyClose").addEventListener("click", () =>
    $("dependencyDialog").close());

  $("dependencyForm").addEventListener("submit", event => {
    event.preventDefault();

    const targetId = $("dependencyTarget").value;
    if (!targetId) {
      toast("Não há outra tarefa ativa disponível.", "warn");
      return;
    }

    const prerequisite = $("dependencyRelation").value === "prerequisite";
    const result = prerequisite
      ? Store.connectTask(targetId, dependencyId)
      : Store.connectTask(dependencyId, targetId);

    if (!result.ok) {
      const messages = {
        cycle: "Essa ligação criaria um ciclo de dependências.",
        exists: "Essa ligação já existe.",
        same: "Uma tarefa não pode depender de si mesma.",
        missing: "Uma das tarefas não está disponível.",
        completed: "Só é possível conectar tarefas ativas."
      };
      toast(messages[result.reason] || "Não foi possível conectar.", "warn");
      return;
    }

    renderDependencies();
    refresh();
    toast("Dependência adicionada.");
  });

  function shape(type, radius) {
    if (type === "terceiros") {
      return svgElement("rect", {
        x: -radius * .88,
        y: -radius * .88,
        width: radius * 1.76,
        height: radius * 1.76,
        rx: 5
      });
    }

    if (type === "familia") {
      return svgElement("polygon", {
        points: `0,${-radius} ${radius},0 0,${radius} ${-radius},0`
      });
    }

    if (type === "trabalho") {
      const points = Array.from({ length: 6 }, (_, index) => {
        const angle = index * Math.PI / 3 - Math.PI / 2;
        return `${Math.cos(angle) * radius},${Math.sin(angle) * radius}`;
      }).join(" ");
      return svgElement("polygon", { points });
    }

    return svgElement("circle", { r: radius });
  }

  function truncate(text, length) {
    return text.length > length
      ? text.slice(0, length - 1) + "…"
      : text;
  }

  function renderOrganism() {
    if (currentView !== "organism") return;

    camera.replaceChildren();
    nodes.clear();
    lines.length = 0;

    camera.appendChild(svgElement("rect", {
      x: -10000,
      y: -10000,
      width: 20000,
      height: 20000,
      fill: "#070911"
    }));

    camera.appendChild(svgElement("rect", {
      x: 0,
      y: WORLD.h * .78,
      width: WORLD.w,
      height: WORLD.h * .22,
      fill: "url(#floorLight)"
    }));

    const visible = visibleTasks();
    const visibleIds = new Set(visible.map(task => task.id));

    visible.filter(task => !task.completed).forEach(task => {
      Store.getParents(task.id).forEach(parent => {
        if (parent.completed || !visibleIds.has(parent.id)) return;

        const path = svgElement("path", { class: "connLine" });
        camera.appendChild(path);
        lines.push({ path, parentId: parent.id, taskId: task.id });
      });
    });

    visible.forEach(task => {
      const visual = appearance(task);
      const ready = isReady(task);
      const color = task.completed
        ? "#b88b55"
        : `hsl(${visual.hue.toFixed(1)} 75% 57%)`;

      const group = svgElement("g", {
        class: "node" +
          (task.completed ? " sediment" : "") +
          (visual.alert ? " alert" : "") +
          (ready ? " ready" : "") +
          (selected.has(task.id) ? " selected" : ""),
        "data-id": task.id
      });

      group.style.setProperty("--cell-color", color);

      const title = svgElement("title");
      title.textContent =
        `${task.keyword} — ${TYPES[task.type]} — ` +
        `${visual.age} dias — ${URGENCIES[task.urgency].label}` +
        (visual.alert ? " — alerta máximo" : "") +
        " — " + availabilityLabel(task);

      group.appendChild(title);

      const cellBody = svgElement("g", { class: "cellBody" });
      const base = shape(task.type, visual.radius);
      base.setAttribute("class", "membrane");
      base.setAttribute("fill", task.completed
        ? "url(#sedimentLight)"
        : color);
      cellBody.appendChild(base);

      const light = shape(task.type, visual.radius);
      light.setAttribute("fill", "url(#cellLight)");
      light.setAttribute("pointer-events", "none");
      cellBody.appendChild(light);

      if (!task.completed) {
        const nucleusRadius = Math.max(5, visual.radius * .24);

        if (ready) {
          cellBody.appendChild(svgElement("circle", {
            class: "readyHalo",
            r: nucleusRadius * 1.65,
            fill: "#43ff72",
            "fill-opacity": ".18",
            stroke: "#43ff72",
            "stroke-width": "1.5",
            "pointer-events": "none"
          }));
        }

        cellBody.appendChild(svgElement("circle", {
          class: ready ? "readyNucleus" : "blockedNucleus",
          r: nucleusRadius,
          fill: ready ? "#43ff72" : "rgba(255,255,255,.4)",
          stroke: ready ? "#e4ffe9" : "none",
          "stroke-width": ready ? "1.3" : "0",
          "pointer-events": "none"
        }));
      }

      group.appendChild(cellBody);
      group.appendChild(svgElement("circle", {
        class: "selectionRing",
        r: visual.radius + 7
      }));

      const label = svgElement("text", {
        class: "nodeLabel",
        y: task.completed ? 4 : visual.radius + 18
      });
      label.textContent = truncate(task.keyword, task.completed ? 12 : 22);
      group.appendChild(label);

      if (!task.completed) {
        const age = svgElement("text", {
          class: "nodeAge",
          y: visual.radius + 32
        });
        age.textContent = visual.alert
          ? `${visual.age} dias · ALERTA`
          : `${visual.age}/${visual.days} dias`;
        group.appendChild(age);
      }

      camera.appendChild(group);
      nodes.set(task.id, group);
    });

    paintPositions();
    applyCamera();
    updateControls();
  }

  function paintPositions() {
    nodes.forEach((node, id) => {
      const task = Store.get(id);
      if (!task) return;

      node.setAttribute("transform",
        `translate(${task.x},${task.y})` +
        (task.completed ? " scale(1,.85)" : ""));
    });

    lines.forEach(({ path, parentId, taskId }) => {
      const parent = Store.get(parentId);
      const task = Store.get(taskId);
      if (!parent || !task) return;

      const middleX = (parent.x + task.x) / 2;
      const middleY = (parent.y + task.y) / 2 - 25;
      path.setAttribute("d",
        `M ${parent.x} ${parent.y} Q ${middleX} ${middleY} ${task.x} ${task.y}`);
    });
  }

  function applyCamera() {
    camera.setAttribute("transform",
      `translate(${WORLD.w / 2 - cam.x * cam.scale},` +
      `${WORLD.h / 2 - cam.y * cam.scale}) scale(${cam.scale})`);
  }

  function fitCamera() {
    cam.x = CENTER.x;
    cam.y = CENTER.y;
    cam.scale = 1;
    applyCamera();
  }

  function resizeViewport() {
    if (currentView !== "organism") return;

    const rect = svg.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (WORLD.w === width && WORLD.h === height) return;

    setWorldBounds(width, height);
    svg.setAttribute("viewBox", `0 0 ${WORLD.w} ${WORLD.h}`);
    runtime.clear();
    fitCamera();
    renderOrganism();
  }

  function point(event) {
    const rect = svg.getBoundingClientRect();
    const x = (event.clientX - rect.left) / (rect.width || 1) * WORLD.w;
    const y = (event.clientY - rect.top) / (rect.height || 1) * WORLD.h;

    return {
      x: (x - WORLD.w / 2) / cam.scale + cam.x,
      y: (y - WORLD.h / 2) / cam.scale + cam.y
    };
  }

  function zoom(factor, event = null) {
    const before = event ? point(event) : null;
    cam.scale = Math.max(.2, Math.min(2.5, cam.scale * factor));

    if (event) {
      const after = point(event);
      cam.x += before.x - after.x;
      cam.y += before.y - after.y;
    }
    applyCamera();
  }

  function updateSelectionVisual() {
    nodes.forEach((node, id) =>
      node.classList.toggle("selected", selected.has(id)));
    renderList();
    updateControls();
  }

  svg.addEventListener("pointerdown", event => {
    if (gesture || (event.pointerType === "mouse" && event.button !== 0))
      return;

    lastInteraction = Date.now();
    const node = event.target.closest(".node");
    const task = node ? Store.get(node.dataset.id) : null;
    const start = point(event);

    if (task) {
      const dragIds = task.completed ? [] : organizing && selected.has(task.id)
        ? selectedTasks().map(item => item.id)
        : [task.id];

      const origins = dragIds.map(id => {
        const item = Store.get(id);
        return { id, x: item.x, y: item.y };
      });

      gesture = {
        kind: "node",
        id: task.id,
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        start,
        origins,
        moved: false
      };
    } else {
      gesture = {
        kind: "pan",
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        camX: cam.x,
        camY: cam.y,
        moved: false
      };
    }

    svg.setPointerCapture(event.pointerId);
  });

  svg.addEventListener("pointermove", event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    lastInteraction = Date.now();

    const dx = event.clientX - gesture.clientX;
    const dy = event.clientY - gesture.clientY;
    if (Math.hypot(dx, dy) > 5) gesture.moved = true;
    if (!gesture.moved) return;

    if (gesture.kind === "node") {
      const position = point(event);
      const moveX = position.x - gesture.start.x;
      const moveY = position.y - gesture.start.y;

      gesture.origins.forEach(origin =>
        Store.updatePosition(
          origin.id,
          origin.x + moveX,
          origin.y + moveY
        ));
      paintPositions();
    } else {
      const rect = svg.getBoundingClientRect();
      cam.x = gesture.camX - dx * WORLD.w /
        (rect.width || 1) / cam.scale;
      cam.y = gesture.camY - dy * WORLD.h /
        (rect.height || 1) / cam.scale;
      svg.classList.add("panning");
      applyCamera();
    }
  });

  function finishGesture(event, cancelled = false) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const previous = gesture;
    gesture = null;
    lastInteraction = Date.now();
    svg.classList.remove("panning");

    if (svg.hasPointerCapture(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId);
    }

    if (!cancelled && !previous.moved && previous.kind === "node") {
      const task = Store.get(previous.id);
      if (task) {
        if (organizing && !task.completed) {
          if (selected.has(task.id)) selected.delete(task.id);
          else selected.add(task.id);
        } else {
          selected.clear();
          selected.add(task.id);
        }
        focusedTaskId = selected.has(task.id)
          ? task.id : [...selected].at(-1) || null;
        updateSelectionVisual();
      }
    }

    if (previous.moved) persist();
  }

  svg.addEventListener("pointerup", event => finishGesture(event));
  svg.addEventListener("pointercancel", event =>
    finishGesture(event, true));
  svg.addEventListener("lostpointercapture", event =>
    finishGesture(event, true));

  svg.addEventListener("wheel", event => {
    event.preventDefault();
    lastInteraction = Date.now();
    zoom(event.deltaY < 0 ? 1.1 : .9, event);
  }, { passive: false });

  $("zoomIn").addEventListener("click", () => zoom(1.2));
  $("zoomOut").addEventListener("click", () => zoom(.83));
  $("zoomReset").addEventListener("click", fitCamera);

  function updateControls() {
    $("organizeTools").hidden = !organizing;

    const compactTools = $("compactOrganizeMenu");
    if (compactTools) compactTools.hidden = !organizing;

    const toolbar = document.querySelector(".organismToolbar");
    if (toolbar) toolbar.hidden = currentView !== "organism";
    const strip = $("compactControlStrip");
    if (strip) strip.hidden = currentView !== "organism";
    $("selectedCount").textContent = `${selected.size} selecionadas`;
    $("pauseBtn").disabled = organizing;
    $("pauseBtn").textContent = paused ? "▶" : "Ⅱ";
    $("pauseBtn").title = paused ? "Retomar movimento" : "Pausar movimento";
    $("pauseBtn").setAttribute("aria-label",
      paused ? "Retomar movimento" : "Pausar movimento");
    $("restoreLayoutBtn").disabled = !Store.hasLayout();
    const editableSelectionCount = selectedTasks().length;
    $("alignBtn").disabled = editableSelectionCount < 2;
    $("distributeXBtn").disabled = editableSelectionCount < 3;
    $("distributeYBtn").disabled = editableSelectionCount < 3;

    $("hintBar").textContent = organizing
      ? "Toque para selecionar ou desmarcar. Arraste para mover. As ferramentas atuam só nas selecionadas."
      : paused
        ? "Movimento pausado. Arraste as células ou use Organizar."
        : "Clique para destacar na Lista; arraste para posicionar. Edição e conclusão ficam na Lista.";
  }

  function autoOrganize() {
    organizing = true;
    paused = true;
    selected.clear();
    focusedTaskId = null;
    runtime.clear();
    updateControls();
    resizeViewport();
    fitCamera();

    const groups = Object.keys(TYPES).map(type => ({
      type,
      tasks: visibleActive().filter(task => task.type === type)
        .sort((a, b) => a.keyword.localeCompare(b.keyword, "pt-BR"))
    })).filter(group => group.tasks.length);

    if (!groups.length) {
      renderOrganism();
      toast("Não há células ativas visíveis para organizar.", "warn");
      return;
    }

    let crowded = false;

    function positionGroup(group, box) {
      const inset = 10;
      const width = Math.max(1, box.w - inset * 2);
      const height = Math.max(1, box.h - inset * 2);
      const count = group.tasks.length;
      const columns = Math.max(1, Math.min(count,
        Math.ceil(Math.sqrt(count * width / height))));
      const rows = Math.ceil(count / columns);
      const maxRadius = Math.max(...group.tasks.map(task => appearance(task).radius));
      if (width / columns < maxRadius * 2 + 12 ||
          height / rows < maxRadius * 2 + 44) crowded = true;

      group.tasks.forEach((task, index) => {
        Store.updatePosition(task.id,
          box.x + inset + (index % columns + .5) * width / columns,
          box.y + inset + (Math.floor(index / columns) + .5) * height / rows);
      });
    }

    // Divide a tela em regiões contíguas, proporcionais ao tamanho dos grupos.
    function partition(items, box) {
      if (items.length === 1) {
        positionGroup(items[0], box);
        return;
      }
      const total = items.reduce((sum, group) => sum + group.tasks.length, 0);
      let split = 1;
      let best = Infinity;
      let accumulated = 0;
      for (let i = 1; i < items.length; i++) {
        accumulated += items[i - 1].tasks.length;
        const distance = Math.abs(total / 2 - accumulated);
        if (distance < best) {
          best = distance;
          split = i;
        }
      }
      const first = items.slice(0, split);
      const second = items.slice(split);
      const fraction = first.reduce((sum, group) =>
        sum + group.tasks.length, 0) / total;
      if (box.w >= box.h) {
        const width = box.w * fraction;
        partition(first, { x: box.x, y: box.y, w: width, h: box.h });
        partition(second, { x: box.x + width, y: box.y,
          w: box.w - width, h: box.h });
      } else {
        const height = box.h * fraction;
        partition(first, { x: box.x, y: box.y, w: box.w, h: height });
        partition(second, { x: box.x, y: box.y + height,
          w: box.w, h: box.h - height });
      }
    }

    const hasSediment = visibleTasks().some(task => task.completed);
    const top = Math.min(44, WORLD.h * .1);
    const bottom = hasSediment ? WORLD.h * .76 : WORLD.h - 20;
    partition(groups, { x: 0, y: top, w: WORLD.w,
      h: Math.max(1, bottom - top) });

    persist();
    renderOrganism();
    toast(crowded
      ? "Agrupadas por tipo. Há pouco espaço: use filtros ou ajuste as posições."
      : "Células agrupadas por tipo; ordem alfabética dentro de cada grupo.",
      crowded ? "warn" : "");
  }

  function selectedTasks() {
    return [...selected].map(id => Store.get(id))
      .filter(task => task && !task.completed && matches(task));
  }

  function extents(task) {
    const radius = appearance(task).radius;
    const halfX = task.type === "terceiros" ? radius * .88 : radius;
    const halfY = task.type === "terceiros" ? radius * .88 : radius;
    return { halfX, halfY };
  }

  function alignSelection() {
    const tasks = selectedTasks();
    if (tasks.length < 2) return;

    const left = Math.min(...tasks.map(task =>
      task.x - extents(task).halfX));
    const right = Math.max(...tasks.map(task =>
      task.x + extents(task).halfX));
    const top = Math.min(...tasks.map(task =>
      task.y - extents(task).halfY));
    const bottom = Math.max(...tasks.map(task =>
      task.y + extents(task).halfY));

    const choice = $("alignChoice").value;

    tasks.forEach(task => {
      const { halfX, halfY } = extents(task);
      let x = task.x;
      let y = task.y;

      if (choice === "left") x = left + halfX;
      if (choice === "right") x = right - halfX;
      if (choice === "centerX") x = (left + right) / 2;
      if (choice === "top") y = top + halfY;
      if (choice === "bottom") y = bottom - halfY;
      if (choice === "centerY") y = (top + bottom) / 2;

      Store.updatePosition(task.id, x, y);
    });

    paintPositions();
    persist();
  }

  function distribute(axis) {
    const tasks = selectedTasks().sort((a, b) => a[axis] - b[axis]);
    if (tasks.length < 3) return;

    const sizeKey = axis === "x" ? "halfX" : "halfY";
    const first = tasks[0];
    const last = tasks[tasks.length - 1];
    const start = first[axis] - extents(first)[sizeKey];
    const end = last[axis] + extents(last)[sizeKey];
    const totalSize = tasks.reduce((sum, task) =>
      sum + 2 * extents(task)[sizeKey], 0);

    const gap = (end - start - totalSize) / (tasks.length - 1);

    if (gap < 0) {
      toast(
        "Falta espaço nesse intervalo. Afaste as células das extremidades e tente novamente.",
        "warn"
      );
      return;
    }

    let cursor = start;
    tasks.forEach(task => {
      const half = extents(task)[sizeKey];
      const coordinate = cursor + half;

      Store.updatePosition(
        task.id,
        axis === "x" ? coordinate : task.x,
        axis === "y" ? coordinate : task.y
      );

      cursor += half * 2 + gap;
    });

    paintPositions();
    persist();
  }

  $("organizeBtn").addEventListener("click", autoOrganize);
  $("alignBtn").addEventListener("click", alignSelection);
  $("distributeXBtn").addEventListener("click", () => distribute("x"));
  $("distributeYBtn").addEventListener("click", () => distribute("y"));

  $("selectAllBtn").addEventListener("click", () => {
    visibleActive().forEach(task => selected.add(task.id));
    updateSelectionVisual();
  });

  $("clearSelectionBtn").addEventListener("click", () => {
    selected.clear();
    updateSelectionVisual();
  });

  $("saveLayoutBtn").addEventListener("click", () => {
    Store.saveLayout();
    checkStorage();
    updateControls();
    toast("Memória salva. Ela guarda as posições de todas as tarefas ativas.");
  });

  $("restoreLayoutBtn").addEventListener("click", () => {
    organizing = true;
    paused = true;
    selected.clear();
    runtime.clear();
    updateControls();
    resizeViewport();

    const count = Store.restoreLayout();
    renderOrganism();
    checkStorage();

    toast(count
      ? `${count} posição(ões) restaurada(s). Tarefas novas mantêm suas posições.`
      : "A memória não contém posições de tarefas ativas atuais.", count ? "" : "warn");
  });

  $("resumeBtn").addEventListener("click", () => {
    organizing = false;
    paused = false;
    selected.clear();
    runtime.clear();
    updateControls();
    resizeViewport();
    renderOrganism();
  });

  $("pauseBtn").addEventListener("click", () => {
    if (organizing) return;
    paused = !paused;
    updateControls();
    persist();
  });

  function changeSpeed(change) {
    speed = Math.max(.2, Math.min(3,
      Math.round((speed + change) * 10) / 10));
    $("speedLabel").textContent = speed.toFixed(1).replace(".", ",") + "×";
  }

  $("speedDown").addEventListener("click", () => changeSpeed(-.2));
  $("speedUp").addEventListener("click", () => changeSpeed(.2));

  function target() {
    return {
      x: Math.random() * WORLD.w,
      y: Math.random() * WORLD.h
    };
  }

  function step(dt) {
    const active = Store.getActiveTasks();
    const delta = Math.min(dt, .05) * speed;

    active.forEach(task => {
      if (!runtime.has(task.id)) {
        runtime.set(task.id, {
          target: target(),
          remaining: 3 + Math.random() * 5,
          vx: 0,
          vy: 0
        });
      }

      const state = runtime.get(task.id);
      state.remaining -= delta;

      if (state.remaining <= 0 ||
          Math.hypot(state.target.x - task.x, state.target.y - task.y) < 30) {
        state.target = target();
        state.remaining = 3 + Math.random() * 5;
      }

      const dx = state.target.x - task.x;
      const dy = state.target.y - task.y;
      const distance = Math.hypot(dx, dy) || 1;
      let vx = dx / distance * Math.min(55, distance * .35);
      let vy = dy / distance * Math.min(55, distance * .35);

      const linked = [
        ...Store.getParents(task.id),
        ...Store.getChildren(task.id)
      ].filter(other => !other.completed);

      linked.forEach(other => {
        const lx = other.x - task.x;
        const ly = other.y - task.y;
        const length = Math.hypot(lx, ly) || 1;
        const correction = Math.max(-12,
          Math.min(12, (length - 180) * .07));
        vx += lx / length * correction;
        vy += ly / length * correction;
      });

      const smoothing = Math.min(1, delta * 2);
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
        const minDistance =
          appearance(a).radius + appearance(b).radius + 12;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        if (distance >= minDistance) continue;

        const nx = distance > .01 ? dx / distance : 1;
        const ny = distance > .01 ? dy / distance : 0;
        const push = Math.min(8, (minDistance - distance) / 2) *
          Math.min(1, delta * 12);

        Store.updatePosition(a.id, a.x - nx * push, a.y - ny * push);
        Store.updatePosition(b.id, b.x + nx * push, b.y + ny * push);
      }
    }
  }

  function tick(now) {
    const dt = Math.min(.05, (now - lastFrame) / 1000);
    lastFrame = now;

    if (currentView === "organism" && !paused && !organizing &&
        !gesture && !document.hidden &&
        Date.now() - lastInteraction > 700 &&
        now - lastPaint > 30) {
      step((now - lastPaint) / 1000 || dt);
      paintPositions();
      lastPaint = now;
    }

    if (!document.hidden && Date.now() - lastAgeRefresh > 60000) {
      lastAgeRefresh = Date.now();
      refresh();
    }

    requestAnimationFrame(tick);
  }

  function switchView(view) {
    currentView = view;
    updateControls();
    $("listView").classList.toggle("active", view === "list");
    $("organismWrap").classList.toggle("active", view === "organism");

    for (const [id, active] of [
      ["toListBtn", view === "list"],
      ["toOrgBtn", view === "organism"]
    ]) {
      $(id).classList.toggle("active", active);
      $(id).setAttribute("aria-pressed", String(active));
    }

    if (view === "organism") {
      requestAnimationFrame(() => {
        resizeViewport();
        renderOrganism();
      });
    } else {
      renderList();
      requestAnimationFrame(revealSelectedTask);
      persist();
    }
  }

  $("toListBtn").addEventListener("click", () => switchView("list"));
  $("toOrgBtn").addEventListener("click", () => switchView("organism"));

  function refresh() {
    const visibleIds = new Set(visibleTasks().map(task => task.id));
    [...selected].forEach(id => {
      if (!visibleIds.has(id)) selected.delete(id);
    });

    renderList();
    renderHistory();
    renderOrganism();
    updateControls();
    checkStorage();
  }

  for (const id of [
    "filterSearch", "filterType", "filterUrgency", "filterStatus"
  ]) {
    $(id).addEventListener(id === "filterSearch" ? "input" : "change",
      refresh);
  }

  $("clearFilters").addEventListener("click", () => {
    $("filterSearch").value = "";
    for (const option of $("filterType").options) option.selected = false;
    document.querySelectorAll(".typeFilterCheckbox").forEach(input => {
      input.checked = false;
    });
    $("filterUrgency").value = "";
    $("filterStatus").value = "active";
    refresh();
  });

  function setHistory(open) {
    $("historyPanel").classList.toggle("open", open);
    $("historyPanel").inert = !open;

    if (open) {
      renderHistory();
      $("historyClose").focus();
    } else {
      $("historyToggle").focus();
    }
  }

  $("historyToggle").addEventListener("click", () => setHistory(true));
  $("historyClose").addEventListener("click", () => setHistory(false));

  $("exportBtn").addEventListener("click", () => {
    const blob = new Blob([Store.exportData()], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `organismo-de-tarefas-${today()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Backup completo exportado, incluindo datas e memória de posições.");
  });

  $("importBtn").addEventListener("click", () => $("importFile").click());

  $("importFile").addEventListener("change", async () => {
    const file = $("importFile").files?.[0];
    if (!file) return;

    try {
      if (!confirm(
        "Adicionar as tarefas novas deste arquivo? Tarefas com IDs já existentes não serão alteradas."
      )) return;

      const result = Store.importData(await file.text());

      if (!result.ok) {
        toast(result.reason === "parse"
          ? "O arquivo não contém um JSON válido."
          : "O arquivo não está no formato de tarefas esperado.", "error");
        return;
      }

      runtime.clear();
      refresh();

      toast(
        `${result.added} adicionada(s), ${result.skipped} já existente(s).` +
        (result.ignoredLinks
          ? ` ${result.ignoredLinks} vínculo(s) inválido(s) ou indisponível(is) ignorado(s).`
          : "")
      );

      if (!result.persisted) checkStorage();
    } catch {
      toast("Não foi possível processar esse arquivo.", "error");
    } finally {
      $("importFile").value = "";
    }
  });

  $("resetBtn").addEventListener("click", () => {
    if (!confirm(
      "Apagar todas as tarefas, o histórico e a memória de posições? Exporte um backup antes."
    )) return;

    Store.resetAll();
    selected.clear();
    runtime.clear();
    refresh();
    toast("Dados apagados.");
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" ||
        $("taskDialog").open || $("dependencyDialog").open) return;

    if ($("historyPanel").classList.contains("open")) {
      setHistory(false);
    } else {
      selected.clear();
      updateSelectionVisual();
    }
  });

  if ("ResizeObserver" in window) {
    new ResizeObserver(resizeViewport).observe($("canvasArea"));
  } else {
    window.addEventListener("resize", resizeViewport);
  }

  setInterval(() => {
    if (currentView === "organism" && !document.hidden) persist();
  }, 5000);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) persist();
    else {
      lastInteraction = Date.now();
      refresh();
    }
  });

  window.addEventListener("pagehide", persist);
  window.addEventListener("beforeunload", persist);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(error => {
        console.warn("Service worker não registrado:", error);
      });
    });
  }

  function setupCompactControls() {
    const filters = document.querySelector(".filters");
    const toolbar = document.querySelector(".organismToolbar");
    const tools = $("organizeTools");

    const strip = element("div", "controlStrip");
    strip.id = "compactControlStrip";
    const header = document.querySelector("#app > header");
    const brand = header && header.querySelector(".brand");
    if (!header || !brand) {
      throw new Error("Cabeçalho do aplicativo não encontrado.");
    }

    header.classList.add("compactHeaderV2");
    brand.after(filters);
    header.after(strip);
    strip.appendChild(toolbar);

    const toolsMenu = element("details", "compactOrganizeMenu");
    toolsMenu.id = "compactOrganizeMenu";
    toolsMenu.hidden = true;

    const summary = element("summary", "", "Ajustes ▾");
    summary.title = "Seleção, alinhamento, distribuição e memória";
    summary.setAttribute("aria-label",
      "Ferramentas de seleção, alinhamento e distribuição");

    toolsMenu.append(summary, tools);
    toolbar.appendChild(toolsMenu);

    const menus = [
      $("compactFilterMenu"),
      toolsMenu
    ].filter(Boolean);

    menus.forEach(menu => {
      menu.addEventListener("toggle", () => {
        if (menu.open) {
          menus.forEach(other => {
            if (other !== menu) other.open = false;
          });
        }
      });
    });

    document.addEventListener("click", event => {
      menus.forEach(menu => {
        if (menu.open && !menu.contains(event.target)) {
          menu.open = false;
        }
      });
    });

    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;

      menus.forEach(menu => {
        if (!menu.open) return;
        menu.open = false;
        menu.querySelector("summary").focus();
      });
    });

    $("toListBtn").addEventListener("click", () => {
      toolsMenu.open = false;
    });
  }


  function openTypePicker() {
    const dialog = element("dialog", "typePickerDialog");
    const heading = element("h2", "", "Qual tipo de tarefa?");
    heading.id = "typePickerTitle";
    dialog.setAttribute("aria-labelledby", heading.id);
    const options = element("div", "typePickerOptions");
    Object.entries(TYPES).forEach(([type, name]) => {
      const button = action(name, () => {
        dialog.close();
        openTaskModal({ mode: "create", type });
      });
      const icon = svgElement("svg", {
        viewBox: "-12 -12 24 24", width: 24, height: 24,
        "aria-hidden": "true", focusable: "false"
      });
      const outline = shape(type, 8);
      outline.setAttribute("fill", "none");
      outline.setAttribute("stroke", "currentColor");
      outline.setAttribute("stroke-width", "1.6");
      icon.appendChild(outline);
      button.prepend(icon);
      options.appendChild(button);
    });
    const footer = element("div", "modalActions");
    footer.appendChild(action("Cancelar", () => dialog.close()));
    dialog.append(heading, options, footer);
    document.body.appendChild(dialog);
    let chosen = false;
    options.addEventListener("click", event => {
      if (event.target.closest("button")) chosen = true;
    }, true);
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (!chosen) $("newTaskBtn").focus();
    }, { once: true });
    dialog.showModal();
    options.querySelector("button").focus();
  }

  function revealSelectedTask() {
    if (currentView !== "list" || !selected.size) return;
    const cards = [...$("treeRoot").querySelectorAll(".compactCard")];
    const card = cards.find(item =>
      item.dataset.taskId === focusedTaskId && selected.has(focusedTaskId)) ||
      cards.find(item => selected.has(item.dataset.taskId));
    if (!card) return;
    const viewport = $("listView");
    const cardRect = card.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    viewport.scrollTop += cardRect.top - viewportRect.top -
      Math.max(8, (viewport.clientHeight - cardRect.height) / 2);
    const title = card.querySelector(".taskTitleButton");
    if (title) title.focus({ preventScroll: true });
  }

  function setupEnhancements() {
    const select = $("filterType");
    const fieldset = element("fieldset", "typeFilterGroup");
    fieldset.appendChild(element("legend", "", "Tipo / forma"));
    const hint = element("p", "typeFilterHint",
      "Marque um ou mais. Sem marcação: todos os tipos.");
    fieldset.appendChild(hint);
    Object.entries(TYPES).forEach(([type, name]) => {
      const label = element("label", "typeFilterOption");
      const input = element("input", "typeFilterCheckbox");
      input.type = "checkbox";
      input.value = type;
      input.checked = [...select.selectedOptions].some(option => option.value === type);
      input.addEventListener("change", () => {
        for (const option of select.options) {
          if (option.value === type) option.selected = input.checked;
        }
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      label.append(input, element("span", "", name));
      fieldset.appendChild(label);
    });
    select.parentElement.replaceWith(fieldset);
    select.hidden = true;
    fieldset.appendChild(select);

    const symbols = {
      left: ["⇤", "Alinhar à esquerda"],
      centerX: ["↔", "Alinhar ao centro horizontal"],
      right: ["⇥", "Alinhar à direita"],
      top: ["⤒", "Alinhar ao topo"],
      centerY: ["↕", "Alinhar ao centro vertical"],
      bottom: ["⤓", "Alinhar à base"]
    };
    const choice = $("alignChoice");
    const choiceLabel = choice.parentElement;
    [...choiceLabel.childNodes].filter(node => node.nodeType === 3)
      .forEach(node => node.textContent = "");
    choice.setAttribute("aria-label", "Direção do alinhamento");
    for (const option of choice.options) {
      const entry = symbols[option.value];
      if (entry) {
        option.textContent = entry[0];
        option.title = entry[1];
        option.setAttribute("aria-label", entry[1]);
      }
    }
    const updateChoiceTitle = () => {
      choice.title = symbols[choice.value][1];
    };
    choice.addEventListener("change", updateChoiceTitle);
    updateChoiceTitle();

    function iconButton(id, path, label) {
      const button = $(id);
      button.replaceChildren();
      button.classList.add("symbolToolButton");
      button.title = label;
      button.setAttribute("aria-label", label);
      const icon = svgElement("svg", {
        viewBox: "0 0 24 24", width: 20, height: 20,
        "aria-hidden": "true", focusable: "false"
      });
      icon.appendChild(svgElement("path", {
        d: path, fill: "none", stroke: "currentColor",
        "stroke-width": "1.8", "stroke-linecap": "round",
        "stroke-linejoin": "round"
      }));
      button.appendChild(icon);
    }
    iconButton("alignBtn", "M4 3v18 M8 6h12 M8 12h8 M8 18h12",
      "Aplicar o alinhamento escolhido");
    iconButton("distributeXBtn",
      "M3 4v16 M21 4v16 M10 7h4v10h-4z M5 12h3 M16 12h3",
      "Distribuir horizontalmente");
    iconButton("distributeYBtn",
      "M4 3h16 M4 21h16 M7 10h10v4H7z M12 5v3 M12 16v3",
      "Distribuir verticalmente");
    $("organizeBtn").title = "Organizar células visíveis em grupos por tipo";
  }

  setupCompactControls();
  setupEnhancements();

  refresh();
  requestAnimationFrame(tick);
})();
