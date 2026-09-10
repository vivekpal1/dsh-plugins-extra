(() => {
  const svg = document.getElementById("canvas");
  const empty = document.getElementById("empty");
  const NS = "http://www.w3.org/2000/svg";

  let elements = [];
  let version = 0;
  let scale = 1;
  let panX = 40;
  let panY = 40;
  let drag = null;
  let dirty = false;

  function live() {
    return elements.filter((el) => el && el.isDeleted !== true);
  }

  function byId(id) {
    return live().find((el) => el.id === id);
  }

  function center(el) {
    return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
  }

  function edgeToward(from, to) {
    const a = center(from);
    const b = center(to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) return { x: from.x + from.width, y: from.y + from.height / 2 };
    const t = Math.min(from.width / 2 / (Math.abs(dx) || 1e-6), from.height / 2 / (Math.abs(dy) || 1e-6));
    return { x: a.x + dx * t, y: a.y + dy * t };
  }

  function el(name, attrs, text) {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== undefined && value !== null) node.setAttribute(key, String(value));
    }
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function diamondPoints(item) {
    const mx = item.x + item.width / 2;
    const my = item.y + item.height / 2;
    return `${mx},${item.y} ${item.x + item.width},${my} ${mx},${item.y + item.height} ${item.x},${my}`;
  }

  function render() {
    const items = live();
    empty.classList.toggle("hidden", items.length > 0);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const root = el("g", { transform: `translate(${panX} ${panY}) scale(${scale})` });
    const defs = el("defs", {});
    defs.append(el("marker", {
      id: "arrow",
      viewBox: "0 0 10 10",
      refX: "8",
      refY: "5",
      markerWidth: "8",
      markerHeight: "8",
      orient: "auto-start-reverse",
    }, null));
    defs.lastChild.append(el("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#1e1e1e" }));
    root.append(defs);

    for (const item of items) {
      if (item.type === "arrow" || item.type === "line") {
        const from = item.startBinding?.elementId ? byId(item.startBinding.elementId) : null;
        const to = item.endBinding?.elementId ? byId(item.endBinding.elementId) : null;
        const start = from && to ? edgeToward(from, to) : { x: item.x, y: item.y };
        const end = from && to ? edgeToward(to, from) : { x: item.x + (item.points?.[1]?.[0] ?? item.width), y: item.y + (item.points?.[1]?.[1] ?? item.height) };
        root.append(el("line", {
          x1: start.x,
          y1: start.y,
          x2: end.x,
          y2: end.y,
          stroke: item.strokeColor || "#1e1e1e",
          "stroke-width": item.strokeWidth || 2,
          fill: "none",
          "marker-end": item.type === "arrow" ? "url(#arrow)" : null,
        }));
        continue;
      }
      if (item.type === "text") {
        if (item.containerId) {
          const host = byId(item.containerId);
          if (host) {
            root.append(el("text", {
              class: "label",
              x: host.x + host.width / 2,
              y: host.y + host.height / 2,
              "text-anchor": "middle",
              "dominant-baseline": "middle",
              fill: item.strokeColor || "#1e1e1e",
            }, item.text || ""));
          }
        } else {
          root.append(el("text", {
            class: "label",
            x: item.x,
            y: item.y + (item.fontSize || 20),
            fill: item.strokeColor || "#1e1e1e",
            "data-id": item.id,
          }, item.text || ""));
        }
        continue;
      }
      const common = {
        class: "shape",
        "data-id": item.id,
        fill: item.backgroundColor && item.backgroundColor !== "transparent" ? item.backgroundColor : "#a5d8ff",
        stroke: item.strokeColor || "#1e1e1e",
        "stroke-width": item.strokeWidth || 2,
      };
      if (item.type === "ellipse") {
        root.append(el("ellipse", {
          ...common,
          cx: item.x + item.width / 2,
          cy: item.y + item.height / 2,
          rx: item.width / 2,
          ry: item.height / 2,
        }));
      } else if (item.type === "diamond") {
        root.append(el("polygon", { ...common, points: diamondPoints(item) }));
      } else {
        root.append(el("rect", {
          ...common,
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          rx: 8,
        }));
      }
    }
    svg.append(root);
  }

  function postChange() {
    dirty = false;
    window.parent.postMessage({ type: "change", version, elements }, "*");
  }

  function applyScene(next) {
    if (dirty) return;
    version = next.version ?? version;
    elements = Array.isArray(next.elements) ? next.elements.map((el) => ({ ...el })) : [];
    render();
  }

  svg.addEventListener("pointerdown", (event) => {
    const id = event.target?.getAttribute?.("data-id");
    svg.setPointerCapture(event.pointerId);
    if (id) {
      const item = byId(id);
      if (!item) return;
      const worldX = (event.clientX - panX) / scale;
      const worldY = (event.clientY - panY) / scale;
      drag = { kind: "shape", id, dx: worldX - item.x, dy: worldY - item.y };
      svg.classList.add("dragging");
      return;
    }
    drag = { kind: "pan", x: event.clientX - panX, y: event.clientY - panY };
    svg.classList.add("dragging");
  });

  svg.addEventListener("pointermove", (event) => {
    if (!drag) return;
    if (drag.kind === "pan") {
      panX = event.clientX - drag.x;
      panY = event.clientY - drag.y;
      render();
      return;
    }
    const item = byId(drag.id);
    if (!item) return;
    item.x = (event.clientX - panX) / scale - drag.dx;
    item.y = (event.clientY - panY) / scale - drag.dy;
    dirty = true;
    render();
  });

  function endDrag() {
    if (!drag) return;
    const moved = drag.kind === "shape";
    drag = null;
    svg.classList.remove("dragging");
    if (moved && dirty) postChange();
  }

  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);

  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const next = Math.min(2.5, Math.max(0.4, scale * (event.deltaY > 0 ? 0.92 : 1.08)));
    scale = next;
    render();
  }, { passive: false });

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.type !== "scene") return;
    applyScene(data);
  });

  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      const document = JSON.parse(text);
      if (document.type !== "excalidraw" || !Array.isArray(document.elements)) return;
      elements = document.elements;
      dirty = true;
      render();
      postChange();
    }).catch(() => {});
  });

  window.parent.postMessage({ type: "ready" }, "*");
  render();
})();
