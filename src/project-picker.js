/**
 * 项目选择器：可搜索的下拉列表，替代放不下的顶栏页签。
 *
 * 项目数量增长后，页签会挤爆顶栏，纯下拉又难翻。所以这里是「下拉 + 搜索 +
 * 分组」：鼠标可点，键盘可上下选，输入可按项目名、副标题、关键词（机器人、
 * 仿真器、算法、机构、arXiv 号等）过滤。
 */

import { el, clear } from "./dom.js";

export function createProjectPicker({ trigger, currentLabel, panel, search, list, empty, entries, groups, onPick }) {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  // 只要注册表用了分组就一直显示分组标题：项目多起来之后这是唯一的导航结构，
  // 项目还少时它也能告诉读者当前看的是哪一族方法。
  const showGroupHeads = entries.some((entry) => entry.group);

  let open = false;
  let currentId = null;
  let filtered = entries;
  let activeIndex = 0;

  /** 搜索词按空格切成多个条件，全部命中才算匹配。 */
  function matches(entry, tokens) {
    if (!tokens.length) return true;
    const haystack = [
      entry.name,
      entry.subtitle,
      entry.id,
      groupById.get(entry.group)?.name,
      ...(entry.keywords ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  }

  function optionId(entry) {
    return `picker-opt-${entry.id}`;
  }

  function renderList() {
    clear(list);
    const tokens = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    filtered = entries.filter((entry) => matches(entry, tokens));

    if (!filtered.length) {
      empty.hidden = false;
      search.setAttribute("aria-activedescendant", "");
      return;
    }
    empty.hidden = true;

    if (activeIndex >= filtered.length) activeIndex = 0;

    let lastGroup = Symbol("none");
    for (const [index, entry] of filtered.entries()) {
      if (showGroupHeads && entry.group !== lastGroup) {
        lastGroup = entry.group;
        const group = groupById.get(entry.group);
        list.append(
          el("div", { class: "picker-group", role: "presentation" }, [
            el("span", { text: group?.name ?? "未分组" }),
            group?.desc ? el("small", { text: group.desc }) : null,
          ])
        );
      }
      const isCurrent = entry.id === currentId;
      list.append(
        el(
          "div",
          {
            class: `picker-option${index === activeIndex ? " active" : ""}${isCurrent ? " current" : ""}`,
            id: optionId(entry),
            role: "option",
            "aria-selected": String(isCurrent),
            dataset: { id: entry.id, index: String(index) },
          },
          [
            el("span", { class: "picker-check", text: isCurrent ? "✓" : "", "aria-hidden": "true" }),
            el("span", { class: "picker-option-text" }, [
              el("span", { class: "picker-name", text: entry.name }),
              entry.subtitle ? el("span", { class: "picker-sub", text: entry.subtitle }) : null,
            ]),
          ]
        )
      );
    }
    syncActive();
  }

  function syncActive() {
    const options = [...list.querySelectorAll(".picker-option")];
    options.forEach((option, i) => option.classList.toggle("active", i === activeIndex));
    const active = options[activeIndex];
    if (active) {
      search.setAttribute("aria-activedescendant", active.id);
      active.scrollIntoView({ block: "nearest" });
    }
  }

  function move(delta) {
    if (!filtered.length) return;
    activeIndex = (activeIndex + delta + filtered.length) % filtered.length;
    syncActive();
  }

  function setOpen(next) {
    if (open === next) return;
    open = next;
    panel.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    search.setAttribute("aria-expanded", String(open));
    if (open) {
      search.value = "";
      // 打开时先落在当前项目上，方便直接上下翻到邻居。
      activeIndex = Math.max(0, entries.findIndex((entry) => entry.id === currentId));
      renderList();
      search.focus();
    } else {
      trigger.focus();
    }
  }

  function pick(id) {
    setOpen(false);
    if (id !== currentId) onPick(id);
  }

  /* ---------- 事件 ---------- */

  trigger.addEventListener("click", () => setOpen(!open));

  search.addEventListener("input", () => {
    activeIndex = 0;
    renderList();
  });

  search.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = filtered[activeIndex];
      if (entry) pick(entry.id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  });

  list.addEventListener("click", (event) => {
    const option = event.target.closest(".picker-option");
    if (option) pick(option.dataset.id);
  });

  list.addEventListener("pointermove", (event) => {
    const option = event.target.closest(".picker-option");
    if (!option) return;
    const next = Number(option.dataset.index);
    if (next === activeIndex) return;
    activeIndex = next;
    syncActive();
  });

  document.addEventListener("pointerdown", (event) => {
    if (!open) return;
    if (panel.contains(event.target) || trigger.contains(event.target)) return;
    setOpen(false);
  });

  return {
    setCurrent(id) {
      currentId = id;
      const entry = entries.find((e) => e.id === id);
      clear(currentLabel).append(
        el("span", { class: "picker-trigger-name", text: entry?.name ?? id }),
        entries.length > 1
          ? el("span", {
              class: "picker-trigger-count",
              text: `${entries.findIndex((e) => e.id === id) + 1}/${entries.length}`,
            })
          : null
      );
      // 不等打开就渲染：首次展开无延迟，也让列表内容可被静态检查。
      renderList();
    },
    open: () => setOpen(true),
    close: () => setOpen(false),
    get isOpen() {
      return open;
    },
  };
}
