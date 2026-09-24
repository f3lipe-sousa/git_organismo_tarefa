(function () {
  "use strict";

  const STORAGE_KEY = "organismo-de-tarefas-v2";
  const LEGACY_KEY = "organismo-de-tarefas-v1";

  // Dimensões iniciais usadas somente até o app medir a área real do SVG.
  const WORLD = { w: 1200, h: 800, padding: 48 };
  const CENTER = { x: 600, y: 400 };

  const TYPES = Object.freeze({
    pessoal: "Pessoal",
    terceiros: "Terceiros",
    familia: "Família",
    trabalho: "Trabalho"
  });

  const tasks = new Map();

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function finiteOr(value, fallback) {
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : fallback;
  }

  function timestampOr(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function storedWorld(source) {
    return {
      w: Number.isFinite(source?.w) && source.w > 0 ? source.w : 1200,
      h: Number.isFinite(source?.h) && source.h > 0 ? source.h : 800
    };
  }

  function getBounds() {
    return {
      w: WORLD.w,
      h: WORLD.h,
      padding: WORLD.padding,
      centerX: CENTER.x,
      centerY: CENTER.y,
      sedimentTop: WORLD.h - Math.min(145, WORLD.h * 0.18)
    };
  }

  function setWorldBounds(width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) ||
        width < 1 || height < 1) {
      return getBounds();
    }

    const nextWidth = Math.round(width);
    const nextHeight = Math.round(height);

    if (nextWidth === WORLD.w && nextHeight === WORLD.h) {
      return getBounds();
    }

    const previousWidth = WORLD.w;
    const previousHeight = WORLD.h;

    WORLD.w = nextWidth;
    WORLD.h = nextHeight;
    WORLD.padding = Math.min(
      82,
      Math.max(24, Math.min(WORLD.w, WORLD.h) * 0.14)
    );

    CENTER.x = WORLD.w / 2;
    CENTER.y = WORLD.h / 2;

    for (const task of tasks.values()) {
      if (task.completed) continue;

      task.x = task.x / previousWidth * WORLD.w;
      task.y = task.y / previousHeight * WORLD.h;
    }

    clampAllPositions();
    save();

    return getBounds();
  }

  function uid() {
    let id;

    do {
      id = "t_" + Date.now().toString(36) +
        Math.random().toString(36).slice(2, 10);
    } while (tasks.has(id));

    return id;
  }

  function sanitize(source) {
    const completed = !!source.completed;
    const rawType = String(source.type || "pessoal").toLowerCase();

    return {
      id: String(source.id),
      keyword:
        String(source.keyword || "Sem nome").trim().slice(0, 120) ||
        "Sem nome",
      description: String(source.description || "").slice(0, 600),
      type: Object.prototype.hasOwnProperty.call(TYPES, rawType)
        ? rawType
        : "pessoal",
      completed,
      parents: Array.isArray(source.parents)
        ? [...new Set(source.parents.filter(id => typeof id === "string"))]
        : [],
      x: finiteOr(source.x, CENTER.x),
      y: finiteOr(source.y, CENTER.y),
      createdAt: timestampOr(source.createdAt, Date.now()),
      completedAt: completed
        ? timestampOr(source.completedAt, null)
        : null,
      sedimentIndex:
        Number.isInteger(source.sedimentIndex) &&
        source.sedimentIndex >= 0
          ? source.sedimentIndex
          : null
    };
  }

  function all() {
    return [...tasks.values()];
  }

  function get(id) {
    return tasks.get(id);
  }

  function getParents(id) {
    const task = get(id);

    return task
      ? task.parents.map(parentId => get(parentId)).filter(Boolean)
      : [];
  }

  function getChildren(id) {
    return all().filter(task => task.parents.includes(id));
  }

  function getActiveTasks() {
    return all().filter(task => !task.completed);
  }

  function getRootTasks() {
    const active = getActiveTasks();
    const prerequisites = new Set(
      active.flatMap(task => task.parents)
    );

    return active.filter(task => !prerequisites.has(task.id));
  }

  function getAncestors(id) {
    const found = new Set();
    const stack = get(id)?.parents.slice() || [];

    while (stack.length) {
      const parentId = stack.pop();

      if (found.has(parentId) || !get(parentId)) continue;

      found.add(parentId);
      stack.push(...get(parentId).parents);
    }

    return found;
  }

  function getWeight(id) {
    return getAncestors(id).size;
  }

  function getDepth(id) {
    const memo = new Map();

    function depth(taskId, visiting) {
      if (memo.has(taskId)) return memo.get(taskId);
      if (visiting.has(taskId)) return 0;

      const task = get(taskId);
      if (!task || !task.parents.length) return 0;

      visiting.add(taskId);

      const result = 1 + Math.max(
        ...task.parents.map(parentId => depth(parentId, visiting))
      );

      visiting.delete(taskId);
      memo.set(taskId, result);
      return result;
    }

    return depth(id, new Set());
  }

  function limits() {
    const paddingX = Math.min(WORLD.padding, WORLD.w / 2);
    const paddingY = Math.min(WORLD.padding, WORLD.h / 2);

    return {
      minX: paddingX,
      maxX: WORLD.w - paddingX,
      minY: paddingY,
      maxY: WORLD.h - paddingY
    };
  }

  function sedimentPosition(index) {
    const area = limits();
    const usableWidth = area.maxX - area.minX;
    const perRow = Math.max(1, Math.floor(usableWidth / 90) + 1);
    const row = Math.floor(index / perRow);
    const col = index % perRow;
    const step = perRow > 1 ? usableWidth / (perRow - 1) : 0;

    return {
      x: clamp(
        area.minX + col * step + (row % 2 ? step * 0.25 : 0),
        area.minX,
        area.maxX
      ),
      y: clamp(
        area.maxY - 12 - row * 42,
        area.minY,
        area.maxY
      )
    };
  }

  function clampAllPositions() {
    const area = limits();

    for (const task of tasks.values()) {
      if (task.completed) {
        const position = sedimentPosition(task.sedimentIndex ?? 0);
        task.x = position.x;
        task.y = position.y;
      } else {
        task.x = clamp(
          finiteOr(task.x, CENTER.x),
          area.minX,
          area.maxX
        );
        task.y = clamp(
          finiteOr(task.y, CENTER.y),
          area.minY,
          area.maxY
        );
      }
    }
  }

  function wouldCycle(prereqId, taskId) {
    return getAncestors(prereqId).has(taskId);
  }

  function restore(data) {
    const next = new Map();
    const requestedParents = new Map();
    const history = Array.isArray(data.history) ? data.history : [];
    const historyOrder = new Map();

    history.forEach((item, index) => {
      if (item && typeof item.id === "string" &&
          !historyOrder.has(item.id)) {
        historyOrder.set(item.id, index);
      }
    });

    for (const source of data.tasks) {
      if (!source || typeof source !== "object" ||
          typeof source.id !== "string" || !source.id) {
        continue;
      }

      const task = sanitize(source);
      requestedParents.set(task.id, task.parents);
      task.parents = [];
      next.set(task.id, task);
    }

    tasks.clear();

    for (const [id, task] of next) {
      tasks.set(id, task);
    }

    for (const [id, parents] of requestedParents) {
      const task = get(id);
      if (task.completed) continue;

      for (const parentId of parents) {
        const parent = get(parentId);

        if (!parent || parent.completed || parentId === id ||
            task.parents.includes(parentId) ||
            wouldCycle(parentId, id)) {
          continue;
        }

        task.parents.push(parentId);
      }
    }

    const completed = all().filter(task => task.completed);

    completed.sort((a, b) => {
      const positionA =
        a.sedimentIndex ?? historyOrder.get(a.id) ?? Infinity;
      const positionB =
        b.sedimentIndex ?? historyOrder.get(b.id) ?? Infinity;

      return positionA - positionB ||
        (a.completedAt || a.createdAt) -
        (b.completedAt || b.createdAt);
    });

    completed.forEach((task, index) => {
      task.sedimentIndex = index;

      if (!task.completedAt) {
        const record = history.find(
          item => item && item.id === task.id
        );

        task.completedAt = timestampOr(
          record?.completedAt,
          task.createdAt
        );
      }
    });

    // Arquivos anteriores não registravam as dimensões do mundo.
    // Nesse caso, usa-se o mundo original de 1200 × 800.
    const original = storedWorld(data.world);

    for (const task of tasks.values()) {
      if (task.completed) continue;

      task.x = task.x / original.w * WORLD.w;
      task.y = task.y / original.h * WORLD.h;
    }

    clampAllPositions();
  }

  function getHistory() {
    return all()
      .filter(task => task.completed)
      .sort((a, b) => a.sedimentIndex - b.sedimentIndex)
      .map(task => ({
        id: task.id,
        completedAt: task.completedAt
      }));
  }

  function save() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          world: { w: WORLD.w, h: WORLD.h },
          tasks: all(),
          history: getHistory()
        })
      );

      return true;
    } catch {
      return false;
    }
  }

  function load() {
    try {
      const raw =
        localStorage.getItem(STORAGE_KEY) ||
        localStorage.getItem(LEGACY_KEY);

      if (!raw) return;

      const data = JSON.parse(raw);

      if (data && Array.isArray(data.tasks)) {
        restore(data);
      }
    } catch {
      tasks.clear();
    }
  }

  function createTask({ keyword, description, type, prereqOfId }) {
    const task = sanitize({
      id: uid(),
      keyword,
      description,
      type,
      parents: [],
      x: CENTER.x + Math.random() * 180 - 90,
      y: CENTER.y + Math.random() * 160 - 80,
      createdAt: Date.now()
    });

    tasks.set(task.id, task);

    const dependent = get(prereqOfId);

    if (dependent && !dependent.completed) {
      dependent.parents.push(task.id);
    }

    clampAllPositions();
    save();
    return task;
  }

  function editTask(id, { keyword, description, type }) {
    const task = get(id);
    if (!task || task.completed) return null;

    const updated = sanitize({
      ...task,
      keyword,
      description,
      type
    });

    task.keyword = updated.keyword;
    task.description = updated.description;
    task.type = updated.type;

    save();
    return task;
  }

  function deleteTask(id) {
    if (!tasks.delete(id)) return false;

    for (const task of tasks.values()) {
      task.parents = task.parents.filter(
        parentId => parentId !== id
      );
    }

    save();
    return true;
  }

  function connectTask(prereqId, taskId) {
    if (prereqId === taskId) {
      return { ok: false, reason: "same" };
    }

    const prerequisite = get(prereqId);
    const task = get(taskId);

    if (!prerequisite || !task) {
      return { ok: false, reason: "missing" };
    }

    if (prerequisite.completed || task.completed) {
      return { ok: false, reason: "completed" };
    }

    if (task.parents.includes(prereqId)) {
      return { ok: false, reason: "exists" };
    }

    if (wouldCycle(prereqId, taskId)) {
      return { ok: false, reason: "cycle" };
    }

    task.parents.push(prereqId);
    save();
    return { ok: true };
  }

  function toggleComplete(id) {
    const task = get(id);

    if (!task) return { ok: false, reason: "missing" };
    if (task.completed) return { ok: false, reason: "already" };

    if (getParents(id).some(parent => !parent.completed)) {
      return { ok: false, reason: "blocked" };
    }

    task.completed = true;
    task.completedAt = Date.now();
    task.sedimentIndex =
      all().filter(item => item.completed).length - 1;

    for (const other of tasks.values()) {
      other.parents = other.parents.filter(
        parentId => parentId !== id
      );
    }

    task.parents = [];

    const position = sedimentPosition(task.sedimentIndex);
    task.x = position.x;
    task.y = position.y;

    save();
    return { ok: true };
  }

  function updatePosition(id, x, y) {
    const task = get(id);
    if (!task || task.completed) return;

    const area = limits();

    task.x = clamp(
      finiteOr(x, task.x),
      area.minX,
      area.maxX
    );

    // Células vivas podem ocupar toda a altura, inclusive a região
    // onde o gradiente visual do sedimento aparece.
    task.y = clamp(
      finiteOr(y, task.y),
      area.minY,
      area.maxY
    );
  }

  function exportData() {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      world: { w: WORLD.w, h: WORLD.h },
      tasks: all(),
      history: getHistory()
    }, null, 2);
  }

  function importData(raw) {
    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "parse" };
    }

    if (!data || !Array.isArray(data.tasks) ||
        data.tasks.some(task =>
          !task || typeof task !== "object" ||
          typeof task.id !== "string" || !task.id
        )) {
      return { ok: false, reason: "shape" };
    }

    restore(data);
    save();
    return { ok: true };
  }

  function resetAll() {
    tasks.clear();

    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      // O estado desta sessão continua apagado.
    }
  }

  load();

  window.TaskCore = {
    Store: {
      all,
      get,
      getParents,
      getChildren,
      getActiveTasks,
      getRootTasks,
      getWeight,
      getDepth,
      createTask,
      editTask,
      deleteTask,
      connectTask,
      toggleComplete,
      updatePosition,
      save,
      exportData,
      importData,
      resetAll
    },
    WORLD,
    CENTER,
    TYPES,
    getBounds,
    setWorldBounds
  };
})();
