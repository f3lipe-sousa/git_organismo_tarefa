(function () {
  "use strict";

  const STORAGE_KEY = "organismo-de-tarefas-v2";
  const LEGACY_KEY = "organismo-de-tarefas-v1";

  const TYPES = Object.freeze({
    pessoal: "Pessoal",
    terceiros: "Terceiros",
    familia: "Família",
    trabalho: "Trabalho"
  });

  const URGENCIES = Object.freeze({
    1: { label: "1 · Máxima", days: 7 },
    2: { label: "2 · Alta", days: 15 },
    3: { label: "3 · Média", days: 30 },
    4: { label: "4 · Baixa", days: 90 },
    5: { label: "5 · Mínima", days: 180 }
  });

  const WORLD = { w: 1200, h: 800, padding: 28 };
  const CENTER = { x: 600, y: 400 };
  const tasks = new Map();
  let savedLayout = null;
  let storageFailed = false;

  const clamp = (value, min, max) =>
    Math.max(min, Math.min(max, value));

  function finite(value, fallback) {
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : fallback;
  }

  function today() {
    const date = new Date();
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function validDate(value) {
    if (typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

    const [year, month, day] = value.split("-").map(Number);
    if (year < 1 || year > 9999) return false;

    const date = new Date(0);
    date.setFullYear(year, month - 1, day);
    date.setHours(12, 0, 0, 0);

    return date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day;
  }

  function dateFromTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return today();

    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function dayNumber(value) {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(0, 0, 0, 0);
    return Math.floor(date.getTime() / 86400000);
  }

  function ageDays(task) {
    return Math.max(0, dayNumber(today()) - dayNumber(task.startDate));
  }

  function appearance(task) {
    const age = ageDays(task);
    const days = URGENCIES[task.urgency].days;
    const progress = clamp(age / days, 0, 1);

    return {
      age,
      days,
      progress,
      radius: task.completed ? 18 : 20 + 40 * progress,
      hue: 166 - 166 * progress,
      alert: !task.completed && progress >= 1
    };
  }

  function uid() {
    let id;
    do {
      id = "t_" + Date.now().toString(36) +
        Math.random().toString(36).slice(2, 11);
    } while (tasks.has(id));
    return id;
  }

  function sanitize(source, id = source.id) {
    const type = String(source.type || "pessoal").toLowerCase();
    const urgency = Number(source.urgency);
    const completed = !!source.completed;
    const completedAt = Number(source.completedAt);

    return {
      id,
      keyword: String(source.keyword || "Sem nome").trim()
        .slice(0, 120) || "Sem nome",
      description: String(source.description || "").slice(0, 600),
      type: Object.hasOwn(TYPES, type) ? type : "pessoal",
      urgency: Object.hasOwn(URGENCIES, urgency) ? urgency : 3,
      startDate: validDate(source.startDate)
        ? source.startDate
        : source.createdAt
          ? dateFromTimestamp(source.createdAt)
          : today(),
      completed,
      completedAt: completed
        ? Number.isFinite(completedAt) && completedAt > 0
          ? completedAt
          : Date.now()
        : null,
      parents: Array.isArray(source.parents)
        ? [...new Set(source.parents.filter(id =>
            typeof id === "string" && id.length > 0))]
        : [],
      x: finite(source.x, CENTER.x),
      y: finite(source.y, CENTER.y)
    };
  }

  function all() {
    return [...tasks.values()];
  }

  function get(id) {
    return tasks.get(id);
  }

  function getParents(id) {
    return (get(id)?.parents || []).map(get).filter(Boolean);
  }

  function getChildren(id) {
    return all().filter(task => task.parents.includes(id));
  }

  function getActiveTasks() {
    return all().filter(task => !task.completed);
  }

  function getAncestors(id) {
    const found = new Set();
    const stack = [...(get(id)?.parents || [])];

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

  function getRootTasks() {
    const active = getActiveTasks();
    const used = new Set(active.flatMap(task => task.parents));
    return active.filter(task => !used.has(task.id));
  }

  function updatePosition(id, x, y) {
    const task = get(id);
    if (!task || task.completed) return;

    const radius = appearance(task).radius;
    const mx = Math.min(radius + 8, WORLD.w / 2);
    const my = Math.min(radius + 24, WORLD.h / 2);

    task.x = clamp(finite(x, task.x), mx, WORLD.w - mx);
    task.y = clamp(finite(y, task.y), my, WORLD.h - my);
  }

  function placeSediment() {
    const completed = all().filter(task => task.completed)
      .sort((a, b) => a.completedAt - b.completedAt);

    const columns = Math.max(1, Math.floor(WORLD.w / 65));

    completed.forEach((task, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      task.x = (column + 0.5) * WORLD.w / columns;
      task.y = Math.max(22, WORLD.h - 28 - row * 42);
    });
  }

  function clampPositions() {
    getActiveTasks().forEach(task =>
      updatePosition(task.id, task.x, task.y));
    placeSediment();
  }

  function setWorldBounds(width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) ||
        width < 1 || height < 1) return;

    width = Math.round(width);
    height = Math.round(height);
    if (WORLD.w === width && WORLD.h === height) return;

    const oldWidth = WORLD.w;
    const oldHeight = WORLD.h;

    WORLD.w = width;
    WORLD.h = height;
    CENTER.x = width / 2;
    CENTER.y = height / 2;

    getActiveTasks().forEach(task => {
      task.x = task.x / oldWidth * width;
      task.y = task.y / oldHeight * height;
    });

    clampPositions();
  }

  function connectInternal(prereqId, taskId) {
    if (prereqId === taskId) return { ok: false, reason: "same" };

    const prerequisite = get(prereqId);
    const task = get(taskId);

    if (!prerequisite || !task)
      return { ok: false, reason: "missing" };

    if (prerequisite.completed || task.completed)
      return { ok: false, reason: "completed" };

    if (task.parents.includes(prereqId))
      return { ok: false, reason: "exists" };

    if (getAncestors(prereqId).has(taskId))
      return { ok: false, reason: "cycle" };

    task.parents.push(prereqId);
    return { ok: true };
  }

  function connectTask(prereqId, taskId) {
    const result = connectInternal(prereqId, taskId);
    if (result.ok) save();
    return result;
  }

  function disconnectTask(prereqId, taskId) {
    const task = get(taskId);
    if (!task || task.completed) return false;

    task.parents = task.parents.filter(id => id !== prereqId);
    save();
    return true;
  }

  function createTask(values) {
    const task = sanitize({
      ...values,
      id: uid(),
      completed: false,
      parents: [],
      x: CENTER.x + Math.random() * 140 - 70,
      y: CENTER.y + Math.random() * 140 - 70
    });

    tasks.set(task.id, task);

    if (values.targetId) {
      if (values.relation === "prerequisite") {
        connectInternal(task.id, values.targetId);
      } else if (values.relation === "dependent") {
        connectInternal(values.targetId, task.id);
      }
    }

    clampPositions();
    save();
    return task;
  }

  function editTask(id, values) {
    const task = get(id);
    if (!task || task.completed) return false;

    const updated = sanitize({ ...task, ...values, id });
    for (const key of [
      "keyword", "description", "type", "urgency", "startDate"
    ]) {
      task[key] = updated[key];
    }

    clampPositions();
    save();
    return true;
  }

  function deleteTask(id) {
    if (!tasks.delete(id)) return false;

    all().forEach(task => {
      task.parents = task.parents.filter(parentId => parentId !== id);
    });

    if (savedLayout) delete savedLayout.positions[id];
    placeSediment();
    save();
    return true;
  }

  function completeTask(id) {
    const task = get(id);
    if (!task || task.completed)
      return { ok: false, reason: "missing" };

    if (getParents(id).some(parent => !parent.completed))
      return { ok: false, reason: "blocked" };

    task.completed = true;
    task.completedAt = Date.now();
    task.parents = [];

    all().forEach(other => {
      other.parents = other.parents.filter(parentId => parentId !== id);
    });

    if (savedLayout) delete savedLayout.positions[id];
    placeSediment();
    save();
    return { ok: true };
  }

  function saveLayout() {
    const positions = Object.create(null);
    getActiveTasks().forEach(task => {
      positions[task.id] = {
        x: task.x / WORLD.w,
        y: task.y / WORLD.h
      };
    });

    savedLayout = {
      savedAt: new Date().toISOString(),
      positions
    };

    save();
  }

  function restoreLayout() {
    if (!savedLayout) return 0;

    let count = 0;
    getActiveTasks().forEach(task => {
      const position = savedLayout.positions[task.id];
      if (!position) return;

      updatePosition(
        task.id,
        position.x * WORLD.w,
        position.y * WORLD.h
      );
      count++;
    });

    save();
    return count;
  }

  function sanitizeLayout(source) {
    if (!source || !source.positions ||
        typeof source.positions !== "object") return null;

    const positions = Object.create(null);

    for (const [id, position] of Object.entries(source.positions)) {
      if (!get(id) || get(id).completed || !position ||
          !Number.isFinite(position.x) ||
          !Number.isFinite(position.y)) continue;

      positions[id] = {
        x: clamp(position.x, 0, 1),
        y: clamp(position.y, 0, 1)
      };
    }

    return {
      savedAt: typeof source.savedAt === "string"
        ? source.savedAt
        : null,
      positions
    };
  }

  function data() {
    return {
      schemaVersion: 3,
      world: { w: WORLD.w, h: WORLD.h },
      tasks: all(),
      layout: savedLayout
    };
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data()));
      storageFailed = false;
      return true;
    } catch {
      storageFailed = true;
      return false;
    }
  }

  function validImport(data) {
    return data && Array.isArray(data.tasks) &&
      data.tasks.every(task =>
        task && typeof task === "object" &&
        typeof task.id === "string" && task.id.length > 0);
  }

  function ingest(data, merge) {
    const sourceWidth = finite(data.world?.w, 1200) > 0
      ? finite(data.world?.w, 1200)
      : 1200;

    const sourceHeight = finite(data.world?.h, 800) > 0
      ? finite(data.world?.h, 800)
      : 800;

    if (!merge) {
      tasks.clear();
      savedLayout = null;
    }

    const pending = new Map();
    let added = 0;
    let skipped = 0;
    let ignoredLinks = 0;

    for (const source of data.tasks) {
      if (tasks.has(source.id)) {
        skipped++;
        continue;
      }

      const task = sanitize(source);

      if (task.completed && !source.completedAt) {
        const record = Array.isArray(data.history)
          ? data.history.find(item => item?.id === task.id)
          : null;

        task.completedAt = Number(record?.completedAt) > 0
          ? Number(record.completedAt)
          : Number(source.createdAt) > 0
            ? Number(source.createdAt)
            : Date.now();
      }

      pending.set(task.id, task.parents);
      task.parents = [];
      task.x = task.x / sourceWidth * WORLD.w;
      task.y = task.y / sourceHeight * WORLD.h;
      tasks.set(task.id, task);
      added++;
    }

    for (const [id, parents] of pending) {
      if (get(id).completed) continue;

      for (const parentId of parents) {
        const parent = get(parentId);

        // Um pré-requisito já concluído está satisfeito:
        // não é necessário recriar essa ligação.
        if (parent?.completed) continue;

        const result = connectInternal(parentId, id);
        if (!result.ok) ignoredLinks++;
      }
    }

    // Mesclar tarefas não altera a memória de posições já existente.
    if (!merge) savedLayout = sanitizeLayout(data.layout);

    clampPositions();
    return { added, skipped, ignoredLinks };
  }

  function importData(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "parse" };
    }

    if (!validImport(parsed))
      return { ok: false, reason: "shape" };

    const result = ingest(parsed, true);
    const persisted = save();
    return { ok: true, persisted, ...result };
  }

  function exportData() {
    return JSON.stringify({
      ...data(),
      exportedAt: new Date().toISOString()
    }, null, 2);
  }

  function resetAll() {
    tasks.clear();
    savedLayout = null;

    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      storageFailed = true;
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) ||
        localStorage.getItem(LEGACY_KEY);

      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (validImport(parsed)) ingest(parsed, false);
    } catch {
      storageFailed = true;
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
      createTask,
      editTask,
      deleteTask,
      connectTask,
      disconnectTask,
      completeTask,
      updatePosition,
      save,
      exportData,
      importData,
      resetAll,
      saveLayout,
      restoreLayout,
      hasLayout: () => !!savedLayout,
      hasStorageError: () => storageFailed
    },
    TYPES,
    URGENCIES,
    WORLD,
    CENTER,
    today,
    validDate,
    ageDays,
    appearance,
    setWorldBounds
  };
})();
