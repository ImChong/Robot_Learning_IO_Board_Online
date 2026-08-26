/** 详情抽屉：模块的维度构成、真机如何获得、出处。 */

import { el, clear } from "./dom.js";
import { nodeColor } from "./data.js";

const REPO_URLS = {
  whole_body_tracking: "https://github.com/HybridRobotics/whole_body_tracking",
  "GR00T-WholeBodyControl": "https://github.com/NVlabs/GR00T-WholeBodyControl",
  MimicKit: "https://github.com/xbpeng/MimicKit",
};

export function renderDetail({ emptyEl, bodyEl, node, taxonomy, onClose }) {
  if (!node) {
    emptyEl.hidden = false;
    bodyEl.hidden = true;
    clear(bodyEl);
    return;
  }

  emptyEl.hidden = true;
  bodyEl.hidden = false;
  clear(bodyEl);

  const cls = node.class ? taxonomy.classById.get(node.class) : null;
  const acq = node.acquisition ? taxonomy.acquisitionById.get(node.acquisition) : null;
  const avail = node.availability ? taxonomy.availabilityById.get(node.availability) : null;
  const conf = taxonomy.confidenceById.get(node.confidence);
  const kindName = taxonomy.nodeKinds.find((k) => k.id === node.kind)?.name;

  bodyEl.append(
    el("div", { class: "dd-head" }, [
      el("h2", { text: node.label }),
      el("button", {
        class: "dd-close",
        type: "button",
        "aria-label": "关闭详情",
        text: "✕",
        onClick: onClose,
      }),
    ])
  );

  if (node.sub) bodyEl.append(el("p", { class: "dd-sub", text: node.sub }));

  const badges = el("div", { class: "dd-badges" }, [
    cls
      ? el("span", {
          class: "badge strong",
          style: { background: cls.color },
          text: `${cls.id} · ${cls.name}`,
          title: cls.desc,
        })
      : el("span", { class: "badge", text: kindName ?? node.kind }),
    avail && avail.id !== "n/a"
      ? el("span", {
          class: avail.id === "deploy-ok" ? "badge" : "badge warn",
          text: avail.name,
          title: avail.desc,
        })
      : null,
    conf && conf.id !== "verified"
      ? el("span", { class: "badge warn", text: conf.name, title: conf.desc })
      : conf
      ? el("span", { class: "badge", text: conf.name, title: conf.desc })
      : null,
    node.freqHz ? el("span", { class: "badge", text: `${node.freqHz} Hz` }) : null,
  ]);
  bodyEl.append(badges);

  if (node.dim != null) {
    bodyEl.append(
      el("div", { class: "dd-dim", style: { borderLeft: `3px solid ${nodeColor(node, taxonomy)}` } }, [
        el("div", { class: "dd-dim-val", text: `${node.dim} 维` }),
        node.dimExpr ? el("div", { class: "dd-dim-expr", text: node.dimExpr }) : null,
      ])
    );
  }

  if (node.desc) {
    bodyEl.append(el("div", { class: "dd-section" }, [el("p", { text: node.desc })]));
  }

  const kv = [];
  if (acq && acq.id !== "none") kv.push(["真机如何获得", `${acq.icon} ${acq.name}`]);
  if (node.unit) kv.push(["单位", node.unit]);
  if (node.noise) kv.push(["训练噪声", node.noise]);
  if (kv.length) {
    const dl = el("dl", { class: "dd-kv" });
    for (const [key, value] of kv) {
      dl.append(el("dt", { text: key }), el("dd", { text: value }));
    }
    bodyEl.append(el("div", { class: "dd-section" }, [el("h3", { text: "获取与量纲" }), dl]));
  }

  if (acq && acq.id !== "none" && acq.desc) {
    bodyEl.append(
      el("div", { class: "dd-section" }, [el("h3", { text: acq.name }), el("p", { text: acq.desc })])
    );
  }

  if (node.note) {
    bodyEl.append(el("div", { class: "dd-section note" }, [el("p", { text: node.note })]));
  }

  if (node.source) {
    const link = sourceLink(node.source);
    bodyEl.append(
      el("div", { class: "dd-section" }, [
        el("h3", { text: "出处" }),
        el("div", { class: "dd-links" }, [
          link
            ? el("a", { href: link, target: "_blank", rel: "noopener", text: node.source.path })
            : el("code", { text: node.source.path }),
          node.source.symbol ? el("code", { text: node.source.symbol }) : null,
        ]),
      ])
    );
  } else if (node.dim != null) {
    bodyEl.append(
      el("div", { class: "dd-section" }, [
        el("h3", { text: "出处" }),
        el("p", { text: "与本项目另一模式下的同名模块同源，出处见该模块。" }),
      ])
    );
  }
}

/** 把 source.path 拼成可点的仓库链接；带省略号的路径无法定位，就只显示文本。 */
function sourceLink(source) {
  const base = REPO_URLS[source.repo];
  if (!base) return null;
  if (!source.path || source.path.includes("...")) return base;
  if (source.path.startsWith("http")) return source.path;
  if (source.path.includes("huggingface.co")) return `https://${source.path}`;
  return `${base}/blob/main/${source.path}`;
}
