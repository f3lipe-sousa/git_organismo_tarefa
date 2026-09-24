(function () {
  "use strict";

  /* =====================================================================
     CAMADA DE ESTADO / REGRAS — sem acesso direto ao DOM
  ===================================================================== */
  const STORAGE_KEY = "organismo-de-tarefas-v2";

  /*
    Estes valores são alterados pelo app.js conforme o tamanho disponível
    da tela, já descontando o cabeçalho por meio da área <main>.
  */
  const WORLD = {
    w: 1200,
    h: 800,
    padding: 48
  };

  const CENTER = {
    x: WORLD.w / 2,
    y: WORLD.h / 2
  };

  /*
    Mantido por compatibilidade com a visualização de sedimentos.
    As células ativas não ficam mais limitadas por esta linha.
  */
  let SEDIMENT_TOP = WORLD.h - 130;

  function uid() {
    return "t_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function getBounds() {
    return {
      width: WORLD.w,
      height: WORLD.h,
      padding: WORLD.padding,
      centerX: CENTER.x,
      centerY: CENTER.y,
      sedimentTop: SEDIMENT_TOP
    };
  }

  /*
    Deve ser chamado pelo app.js sempre que a área útil da tela mudar.
    Exemplo:
      Store.setWorldBounds(larguraDoSVG, alturaDoSVG);
  */
  function setWorldBounds(width, height) {
    const safeWidth = Number(width);
    const safeHeight = Number(height);

    if (!Number.isFinite(safeWidth) || !Number.isFinite(safeHeight)) {
      return getBounds();
    }

    WORLD.w = Math.max(320, Math.round(safeWidth));
    WORLD.h = Math.max(300, Math.round(safeHeight));

    /*
      A margem protege as células contra corte nas bordas.
      Em telas menores, ela também diminui proporcionalmente.
    */
    WORLD.padding = Math.max(28, Math.min(54, Math.round(Math.min(WORLD.w, WORLD.h) * 0.055)));

    CENTER.x = WORLD.w / 2;
    CENTER.y = WORLD.h / 2;

    /*
      Região visual destinada ao sedimento concluído, perto do rodapé.
      Não é mais um teto para as células vivas.
    */
    SEDIMENT_TOP = Math.max(WORLD.h - 145, WORLD.h * 0.82);

    Store.clampAllPositions();

    return getBounds();
  }

  const Store = (function () {
    let tasks = {};
    let history = [];

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function activeLimits() {
      return {
        minX: WORLD.padding,
        maxX: WORLD.w - WORLD.padding,
        minY: WORLD.padding,
        maxY: WORLD.h - WORLD.padding
      };
    }

    function sanitize(t) {
      const limits = activeLimits();

      return {
        id: String(t.id),
        keyword: String(t.keyword || "Sem nome").slice(0, 120),
        description: t.description ? String(t.description).slice(0, 600) : "",
        completed: !!t.completed,
        parents: Array.isArray(t.parents)
          ? [...new Set(t.parents.filter(p => typeof p === "string"))]
          : [],
        x: typeof t.x === "number"
          ? t.x
          : CENTER.x + (Math.random() * 280 - 140),
        y: typeof t.y === "number"
          ? t.y
          : CENTER.y + (Math.random() * 220 - 110),
        createdAt: t.createdAt || Date.now(),
        completedAt: t.completedAt || null,
        sedimentIndex: typeof t.sedimentIndex === "number" ? t.sedimentIndex : null
      };
    }

    function load() {
      try {
        /*
          Compatível com dados armazenados na versão anterior.
        */
        const raw =
          localStorage.getItem(STORAGE_KEY) ||
          localStorage.getItem("organismo-de-tarefas-v1");

        if (!raw) return;

        const data = JSON.parse(raw);

        tasks = {};
        (data.tasks || []).forEach(t => {
          const sanitized = sanitize(t);
          tasks[sanitized.id] = sanitized;
        });

        Object.values(tasks).forEach(task => {
          task.parents = task.parents.filter(parentId => tasks[parentId] && parentId !== task.id);
        });

        history = Array.isArray(data.history)
          ? data.history.filter(item => item && tasks[item.id])
          : [];

        clampAllPositions();
      } catch (error) {
        tasks = {};
        history = [];
      }
    }

    function save() {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            tasks: Object.values(tasks),
            history
          })
        );
      } catch (error) {
        /* armazenamento indisponível */
      }
    }

    function all() {
      return Object.values(tasks);
    }

    function get(id) {
      return tasks[id];
    }

    function exists(id) {
      return !!tasks[id];
    }

    function createTask({ keyword, description, prereqOfId }) {
      const limits = activeLimits();

      const task = sanitize({
        id: uid(),
        keyword,
        description,
        parents: [],
        x: clamp(CENTER.x + (Math.random() * 180 - 90), limits.minX, limits.maxX),
        y: clamp(CENTER.y + (Math.random() * 160 - 80), limits.minY, limits.maxY),
        createdAt: Date.now()
      });

      tasks[task.id] = task;

      if (prereqOfId && tasks[prereqOfId] && !tasks[prereqOfId].completed) {
        tasks[prereqOfId].parents.push(task.id);
      }

      save();
      return task;
    }

    function editTask(id, { keyword, description }) {
      const task = tasks[id];
      if (!task) return null;

      if (keyword !== undefined) {
        task.keyword = String(keyword).slice(0, 120) || task.keyword;
      }

      if (description !== undefined) {
        task.description = String(description).slice(0, 600);
      }

      save();
      return task;
    }

    function deleteTask(id) {
      if (!tasks[id]) return;

      delete tasks[id];

      all().forEach(task => {
        task.parents = task.parents.filter(parentId => parentId !== id);
      });

      history = history.filter(item => item.id !== id);

      save();
    }

    function isAncestor(candidateId, ofId) {
      const seen = new Set();
      const stack = [ofId];

      while (stack.length) {
        const currentId = stack.pop();

        if (seen.has(currentId)) continue;
        seen.add(currentId);

        const task = tasks[currentId];
        if (!task) continue;

        for (const parentId of task.parents) {
          if (parentId === candidateId) return true;
          stack.push(parentId);
        }
      }

      return false;
    }

    function connectTask(prereqId, taskId) {
      if (prereqId === taskId) {
        return { ok: false, reason: "same" };
      }

      if (!tasks[prereqId] || !tasks[taskId]) {
        return { ok: false, reason: "missing" };
      }

      if (tasks[prereqId].completed || tasks[taskId].completed) {
        return { ok: false, reason: "completed" };
      }

      const task = tasks[taskId];

      if (task.parents.includes(prereqId)) {
        return { ok: false, reason: "exists" };
      }

      if (isAncestor(taskId, prereqId)) {
        return { ok: false, reason: "cycle" };
      }

      task.parents.push(prereqId);

      save();
      return { ok: true };
    }

    function toggleComplete(id) {
      const task = tasks[id];

      if (!task) {
        return { ok: false, reason: "missing" };
      }

      if (task.completed) {
        return { ok: false, reason: "already" };
      }

      const blocked = task.parents.some(parentId => {
        return tasks[parentId] && !tasks[parentId].completed;
      });

      if (blocked) {
        return { ok: false, reason: "blocked" };
      }

      task.completed = true;
      task.completedAt = Date.now();

      /*
        A tarefa concluída deixa de ser pré-requisito e também perde
        suas conexões para se transformar em sedimento visual.
      */
      all().forEach(otherTask => {
        if (otherTask.id !== id) {
          otherTask.parents = otherTask.parents.filter(parentId => parentId !== id);
        }
      });

      task.parents = [];

      task.sedimentIndex = history.length;
      history.push({
        id: task.id,
        completedAt: task.completedAt
      });

      const position = sedimentPosition(task.sedimentIndex);
      task.x = position.x;
      task.y = position.y;

      save();

      return { ok: true };
    }

    function sedimentPosition(index) {
      const padding = Math.max(WORLD.padding + 10, 56);
      const usableWidth = Math.max(160, WORLD.w - padding * 2);

      /*
        A quantidade por linha se adapta à largura atual da tela.
      */
      const perRow = Math.max(3, Math.floor(usableWidth / 100));
      const row = Math.floor(index / perRow);
      const col = index % perRow;
      const colWidth = usableWidth / Math.max(1, perRow - 1);

      const jitterX = (Math.sin(index * 12.9898) * 43758.5453 % 1) * 18 - 9;
      const jitterY = (Math.sin(index * 78.233) * 12543.123 % 1) * 8 - 4;
      const alternateOffset = row % 2 === 0 ? 0 : colWidth * 0.35;

      return {
        x: clamp(
          padding + col * colWidth + alternateOffset + jitterX,
          padding,
          WORLD.w - padding
        ),
        y: clamp(
          WORLD.h - padding - 12 - row * 42 + jitterY,
          padding,
          WORLD.h - padding
        )
      };
    }

    function getChildren(id) {
      return all().filter(task => task.parents.includes(id));
    }

    function getParents(id) {
      const task = tasks[id];

      return task
        ? task.parents.map(parentId => tasks[parentId]).filter(Boolean)
        : [];
    }

    function getActiveTasks() {
      return all().filter(task => !task.completed);
    }

    function getRootTasks() {
      const depended = new Set();

      getActiveTasks().forEach(task => {
        task.parents.forEach(parentId => depended.add(parentId));
      });

      return getActiveTasks().filter(task => !depended.has(task.id));
    }

    function getAncestors(id) {
      const result = new Set();
      const stack = [id];

      while (stack.length) {
        const currentId = stack.pop();
        const task = tasks[currentId];

        if (!task) continue;

        task.parents.forEach(parentId => {
          if (!result.has(parentId)) {
            result.add(parentId);
            stack.push(parentId);
          }
        });
      }

      return Array.from(result)
        .map(taskId => tasks[taskId])
        .filter(Boolean);
    }

    function getDescendants(id) {
      const result = new Set();
      const stack = [id];

      while (stack.length) {
        const currentId = stack.pop();

        all().forEach(task => {
          if (task.parents.includes(currentId) && !result.has(task.id)) {
            result.add(task.id);
            stack.push(task.id);
          }
        });
      }

      return Array.from(result)
        .map(taskId => tasks[taskId])
        .filter(Boolean);
    }

    function getWeight(id) {
      return getAncestors(id).length;
    }

    function getDepth(id, seen) {
      const visited = seen || new Set();

      if (visited.has(id)) return 0;
      visited.add(id);

      const task = tasks[id];

      if (!task || task.parents.length === 0) {
        return 0;
      }

      return 1 + Math.max(
        ...task.parents.map(parentId => getDepth(parentId, new Set(visited)))
      );
    }

    /*
      Limita manualmente uma célula à área inteira disponível do mundo.
      Não usa mais o antigo limite fixo SEDIMENT_TOP.
    */
    function updatePosition(id, x, y) {
      const task = tasks[id];
      if (!task || task.completed) return;

      const limits = activeLimits();

      task.x = clamp(Number(x) || CENTER.x, limits.minX, limits.maxX);
      task.y = clamp(Number(y) || CENTER.y, limits.minY, limits.maxY);
    }

    function clampAllPositions() {
      const limits = activeLimits();

      all().forEach(task => {
        if (task.completed) {
          const sedimentPositionValue = sedimentPosition(
            Number.isFinite(task.sedimentIndex) ? task.sedimentIndex : 0
          );

          task.x = sedimentPositionValue.x;
          task.y = sedimentPositionValue.y;
          return;
        }

        task.x = clamp(Number(task.x) || CENTER.x, limits.minX, limits.maxX);
        task.y = clamp(Number(task.y) || CENTER.y, limits.minY, limits.maxY);
      });
    }

    function exportData() {
      return JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          tasks: all(),
          history
        },
        null,
        2
      );
    }

    function importData(raw) {
      let data;

      try {
        data = JSON.parse(raw);
      } catch (error) {
        return { ok: false, reason: "parse" };
      }

      if (!data || !Array.isArray(data.tasks)) {
        return { ok: false, reason: "shape" };
      }

      const newTasks = {};

      data.tasks.forEach(task => {
        if (task && task.id) {
          const sanitized = sanitize(task);
          newTasks[sanitized.id] = sanitized;
        }
      });

      Object.values(newTasks).forEach(task => {
        task.parents = task.parents.filter(parentId => {
          return newTasks[parentId] && parentId !== task.id;
        });
      });

      tasks = newTasks;

      history = Array.isArray(data.history)
        ? data.history.filter(item => item && newTasks[item.id])
        : [];

      clampAllPositions();
      save();

      return { ok: true };
    }

    function resetAll() {
      tasks = {};
      history = [];

      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem("organismo-de-tarefas-v1");
      } catch (error) {
        /* armazenamento indisponível */
      }
    }

    load();

    return {
      all,
      get,
      exists,
      createTask,
      editTask,
      deleteTask,
      connectTask,
      toggleComplete,
      getChildren,
      getParents,
      getRootTasks,
      getActiveTasks,
      getAncestors,
      getDescendants,
      getWeight,
      getDepth,
      updatePosition,
      clampAllPositions,
      save,
      exportData,
      importData,
      resetAll
    };
  })();

  window.TaskCore = {
    Store,
    WORLD,
    CENTER,

    /*
      Novo: o app.js utilizará estas funções para sincronizar o mundo
      com o espaço disponível abaixo do cabeçalho.
    */
    setWorldBounds,
    getBounds,

    /*
      Mantido para não quebrar referências existentes.
      Para valores atualizados, prefira getBounds().sedimentTop.
    */
    get SEDIMENT_TOP() {
      return SEDIMENT_TOP;
    }
  };
})();
