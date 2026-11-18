// Small enhancements on top of a page that works without them:
// 1. the road bar: shows once the intro is scrolled past, marks the section you
//    are in, and moves the sun along the road where CSS scroll timelines are
//    missing or switched off (reduced motion keeps the progress, not the motion);
// 2. the board clips: play only while on screen (never with reduced motion), and
//    a tap, click, Space or Enter plays or pauses one (without JS they keep
//    their native controls);
// 3. the travel maps: drawn inline once they get close, so they can play
//    (home first, then the light spreading out to every country I've been
//    to, while the count climbs to the total) and name a country you point
//    at; without this they stay plain images showing the end state; a photo
//    pin you point at or focus finds its country too, and the photo it opens
//    (a popover, which works on its own) hands the focus back to its pin;
// 4. "Copy email" copies the address and says so.
(() => {
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
  const hasIO = "IntersectionObserver" in window;

  // ---------- The road bar ----------
  const bar = document.getElementById("bar");
  const hero = document.querySelector(".hero");
  const nav = bar && bar.querySelector(".bar-nav");
  const links = bar ? [...bar.querySelectorAll(".bar-links a")] : [];
  const byId = new Map(links.map((a) => [a.hash.slice(1), a]));
  let current = null;

  const setCurrent = (link) => {
    if (link === current) return;
    if (current) current.removeAttribute("aria-current");
    current = link;
    if (!link) return;
    link.setAttribute("aria-current", "location");
    // Keep the current link in view inside the bar on narrow screens.
    const left = link.offsetLeft - (nav.clientWidth - link.offsetWidth) / 2;
    nav.scrollTo({ left, behavior: calm.matches ? "auto" : "smooth" });
  };

  // Called once per frame at most, from the observers and from scrolling.
  let onFrame = () => {};
  let queued = false;
  const schedule = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        onFrame();
      });
    }
  };

  if (bar && hero && hasIO) {
    new IntersectionObserver(([entry]) => {
      bar.classList.toggle("on", !entry.isIntersecting);
    }, { rootMargin: "-80px 0px 0px 0px" }).observe(hero);

    // The section crossing a thin line just above the middle is the one being
    // read; when two do, the lower one wins. At the very bottom of the page the
    // last section can never reach that line, so it wins there.
    const sections = [...byId.keys()].map((id) => document.getElementById(id)).filter(Boolean);
    const visible = new Set();
    const pick = () => {
      const root = document.documentElement;
      const atBottom = window.scrollY + window.innerHeight >= root.scrollHeight - 2;
      const here = atBottom ? sections[sections.length - 1] : sections.filter((s) => visible.has(s)).pop();
      if (here) setCurrent(byId.get(here.id));
      else if (window.scrollY < hero.offsetHeight / 2) setCurrent(null);
    };
    const watch = new IntersectionObserver((entries) => {
      for (const { target, isIntersecting } of entries) {
        if (isIntersecting) visible.add(target);
        else visible.delete(target);
      }
      pick();
    }, { rootMargin: "-40% 0px -55% 0px" });
    sections.forEach((s) => watch.observe(s));
    onFrame = pick;
  }

  // Where CSS cannot tie the road to the scroll (no scroll timelines, or
  // reduced motion, which turns CSS animations off), set the progress here.
  const cssRoad = window.CSS && CSS.supports("animation-timeline: scroll()");
  const progress = () => {
    if (cssRoad && !calm.matches) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    bar.style.setProperty("--progress", p.toFixed(4));
  };

  if (bar) {
    const pickOnly = onFrame;
    onFrame = () => {
      pickOnly();
      progress();
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    calm.addEventListener("change", schedule);
    progress();
  }

  // ---------- Board clips ----------
  const clips = document.querySelectorAll("video.clip");
  const held = new WeakSet();

  // Without this script the clips keep their native controls; with it, the
  // whole clip is the play/pause control, so the hint says how to use it.
  const hint = document.getElementById("clip-hint");
  if (clips.length && hint) hint.hidden = false;

  clips.forEach((clip) => {
    clip.controls = false;
    if (hint) clip.setAttribute("aria-describedby", hint.id);
    const badge = document.createElement("span");
    badge.className = "clip-state";
    badge.setAttribute("aria-hidden", "true");
    clip.after(badge);
    const sync = () => badge.classList.toggle("playing", !clip.paused);
    clip.addEventListener("play", sync);
    clip.addEventListener("pause", sync);
  });

  const toggle = (clip) => {
    if (clip.paused) {
      held.delete(clip);
      clip.play().catch(() => {});
    } else {
      held.add(clip);
      clip.pause();
    }
  };

  clips.forEach((clip) => {
    clip.addEventListener("click", () => toggle(clip));
    clip.addEventListener("keydown", (event) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        toggle(clip);
      }
    });
  });

  if (clips.length && hasIO) {
    const seen = new IntersectionObserver((entries) => {
      for (const { target, isIntersecting } of entries) {
        if (isIntersecting && !calm.matches && !held.has(target)) {
          target.play().catch(() => {});
        } else if (!isIntersecting) {
          target.pause();
        }
      }
    }, { threshold: 0.5 });

    clips.forEach((clip) => {
      seen.observe(clip);
    });
  }

  // ---------- Travel maps ----------
  const maps = [...document.querySelectorAll(".map")];
  const mapBox = document.querySelector(".maps");
  const tip = document.querySelector(".map-tip");
  const chips = [...document.querySelectorAll(".countries li[data-name]")];
  const pins = [...document.querySelectorAll(".pin[data-name]")];
  const tally = document.querySelector(".tally");
  const total = tally && tally.nextElementSibling ? tally.nextElementSibling.textContent : "";

  // Which country each small cell of a map belongs to (made by
  // scripts/travel-map.mjs from the full-detail shapes), unpacked per row.
  const grids = new WeakMap();
  const loadGrid = async (fig, src) => {
    const res = await fetch(src.replace(/\.svg$/, "-hit.json"));
    if (!res.ok) return;
    const { step, names, rows } = await res.json();
    grids.set(fig, { step, names, rows, cache: new Map() });
  };

  // The code of one cell, read from its row's runs (each row is unpacked
  // into run ends and codes the first time it is needed).
  const cellAt = (grid, x, y) => {
    const text = grid.rows[y];
    if (!text || x < 0) return 0;
    let row = grid.cache.get(y);
    if (!row) {
      const ends = [];
      const codes = [];
      let at = 0;
      for (let i = 0; i < text.length; i += 3) {
        at += parseInt(text.slice(i + 1, i + 3), 36);
        ends.push(at);
        codes.push(parseInt(text[i], 36));
      }
      row = { ends, codes };
      grid.cache.set(y, row);
    }
    let lo = 0;
    let hi = row.ends.length - 1;
    if (x >= row.ends[hi]) return 0;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (row.ends[mid] > x) hi = mid;
      else lo = mid + 1;
    }
    return row.codes[lo];
  };

  // Every lit dot of the world map and every route end, as [x, y, name] in
  // the map's own units: over open sea, pointing near one names it (that is
  // how the Maldives get found).
  let worldPoints = [];
  const indexWorld = (svg) => {
    worldPoints = [];
    svg.querySelectorAll(".m-dots.m-been").forEach((path) => {
      for (const [, x, y] of path.getAttribute("d").matchAll(/M(-?[\d.]+) (-?[\d.]+)h0/g)) {
        worldPoints.push([+x, +y, path.dataset.name]);
      }
    });
    svg.querySelectorAll(".m-end").forEach((end) => {
      worldPoints.push([+end.getAttribute("cx"), +end.getAttribute("cy"), end.dataset.end]);
    });
  };

  // Swaps the <img> for the same SVG inline. Its own colours are dropped:
  // styles.css draws it with the page's theme instead.
  const inline = async (fig) => {
    if (fig.dataset.inline) return;
    fig.dataset.inline = "loading";
    const img = fig.querySelector("img");
    if (!img) return;
    const src = img.getAttribute("src");
    loadGrid(fig, src).catch(() => {});
    const res = await fetch(src);
    if (!res.ok) return;
    const svg = new DOMParser().parseFromString(await res.text(), "image/svg+xml").documentElement;
    if (svg.nodeName !== "svg" || !fig.contains(img)) return;
    svg.querySelector("style")?.remove();
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("class", "map-svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", img.alt);
    // A map already on screen (say, after following a link to #travel) is
    // shown as it ends: dimming it now to play it would only flash.
    const box = fig.getBoundingClientRect();
    const onScreen = box.bottom > 0 && box.top < window.innerHeight;
    const world = fig.classList.contains("map-world");
    if (!calm.matches && !onScreen) fig.dataset.play = "ready";
    const node = document.importNode(svg, true);
    img.replaceWith(node);
    fig.dataset.inline = "done";
    if (world) indexWorld(node);
    // The count gets to climb when its line comes into view, but only if the
    // reader hasn't reached it yet: it is never reset in sight.
    if (world && tally && !calm.matches && tally.getBoundingClientRect().top > window.innerHeight) {
      tally.textContent = "0";
      tally.dataset.count = "ready";
    }
  };

  // The count climbs from 0 to the total at the pace the countries light up
  // on the map, starting when its line comes fully into view.
  const count = () => {
    if (!tally || tally.dataset.count !== "ready") return;
    tally.dataset.count = "on";
    const lit = [...document.querySelectorAll(".map-world .m-been[data-name]")].map((el) => parseFloat(el.style.getPropertyValue("--d")) || 0);
    const start = performance.now();
    const tick = (now) => {
      if (tally.dataset.count !== "on") return;
      const t = (now - start) / 1000;
      const n = lit.filter((d) => d + 0.3 <= t).length;
      if (n >= lit.length) {
        tally.textContent = total;
        delete tally.dataset.count;
        return;
      }
      tally.textContent = String(n);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const countDone = () => {
    if (tally && tally.dataset.count) {
      delete tally.dataset.count;
      tally.textContent = total;
    }
  };

  // Ends a map's play at once: when it is over, or when reduced motion is
  // switched on halfway.
  const finish = (fig) => {
    delete fig.dataset.play;
  };

  const play = (fig) => {
    if (fig.dataset.play !== "ready") return;
    if (calm.matches) {
      finish(fig);
      if (fig.classList.contains("map-world")) countDone();
      return;
    }
    fig.dataset.play = "on";
    const lit = [...fig.querySelectorAll(".m-been[data-name]")].map((el) => parseFloat(el.style.getPropertyValue("--d")) || 0);
    const end = Math.max(0, ...lit) + 1.2;
    setTimeout(() => finish(fig), end * 1000);
  };

  calm.addEventListener("change", () => {
    if (calm.matches) {
      maps.forEach(finish);
      countDone();
    }
  });

  // Lights one country up on both maps and in the list, and dims the rest.
  let litName = null;
  const light = (name) => {
    if (name === litName) return;
    litName = name;
    maps.forEach((fig) => {
      const svg = fig.querySelector("svg");
      if (!svg) return;
      svg.classList.toggle("dim", Boolean(name));
      svg.querySelectorAll("[data-name]").forEach((el) => el.classList.toggle("lit", el.dataset.name === name));
      svg.querySelectorAll("[data-to]").forEach((el) => el.classList.toggle("lit", el.dataset.to === name));
    });
    chips.forEach((chip) => chip.classList.toggle("lit", chip.dataset.name === name));
    pins.forEach((pin) => pin.classList.toggle("lit", pin.dataset.name === name));
  };

  // The name sits above the pointer, or below it when the top bar (or the
  // top of the screen) would cover it.
  const showTip = (name, event) => {
    if (!tip || !mapBox) return;
    tip.textContent = name;
    const box = mapBox.getBoundingClientRect();
    const half = tip.offsetWidth / 2;
    const x = Math.min(Math.max(event.clientX - box.left, half), box.width - half);
    const roof = bar && bar.classList.contains("on") ? bar.getBoundingClientRect().bottom : 0;
    tip.classList.toggle("below", event.clientY - tip.offsetHeight - 20 < roof);
    tip.style.left = `${x}px`;
    tip.style.top = `${event.clientY - box.top}px`;
    tip.classList.add("on");
  };

  const hideTip = () => {
    if (tip) tip.classList.remove("on");
  };

  // Which country the pointer is on. On the world map: the lit dot or route
  // end nearest to it, if one is close; on Europe: the shape under it.
  const countryAt = (event) => {
    const fig = event.target.closest && event.target.closest(".map");
    const svg = fig && fig.querySelector("svg");
    const matrix = svg && svg.getScreenCTM();
    if (!matrix) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const grid = grids.get(fig);
    if (grid) {
      // The cell under the pointer, or just off a coast the nearest land
      // cell within a few units: a coast is never more exact than that.
      const cx = Math.floor(p.x / grid.step);
      const cy = Math.floor(p.y / grid.step);
      const reach = Math.ceil(3 / grid.step);
      let code = 0;
      let near = Infinity;
      for (let dy = -reach; dy <= reach; dy += 1) {
        for (let dx = -reach; dx <= reach; dx += 1) {
          const c = cellAt(grid, cx + dx, cy + dy);
          const d = dx * dx + dy * dy;
          if (c && d < near) {
            near = d;
            code = c;
          }
        }
      }
      if (code >= 2) return grid.names[code - 2];
      if (code === 1) return null;
    } else if (!fig.classList.contains("map-world")) {
      const shape = event.target.closest("[data-name]");
      return shape ? shape.dataset.name : null;
    }
    // Open sea: only the world map's islands and route ends answer there.
    if (!fig.classList.contains("map-world") || !worldPoints.length) return null;
    let best = null;
    let bestDistance = 7 * 7;
    for (const [x, y, name] of worldPoints) {
      const d = (x - p.x) ** 2 + (y - p.y) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = name;
      }
    }
    return best;
  };

  if (maps.length && mapBox && hasIO && window.fetch && window.DOMParser) {
    const seen = new IntersectionObserver((entries) => {
      for (const { target, isIntersecting } of entries) {
        if (isIntersecting) {
          seen.unobserve(target);
          play(target);
        }
      }
    }, { threshold: 0.25 });

    const load = (fig) => {
      inline(fig)
        .then(() => seen.observe(fig))
        .catch(() => {});
    };

    const near = new IntersectionObserver((entries) => {
      for (const { target, isIntersecting } of entries) {
        if (!isIntersecting) continue;
        near.unobserve(target);
        load(target);
      }
    }, { rootMargin: "600px 0px" });
    maps.forEach((fig) => near.observe(fig));

    // Once the page has settled, get the maps ready anyway, so even a jump
    // straight to them finds them waiting to play.
    window.addEventListener("load", () => {
      const later = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
      later(() => maps.forEach((fig) => {
        near.unobserve(fig);
        load(fig);
      }), { timeout: 3000 });
    });

    if (tally) {
      new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          if (calm.matches) countDone();
          else count();
        }
      }, { threshold: 1 }).observe(tally);
    }

    // With a mouse, pointing names a country. On a touch screen a tap does
    // (not the touch that starts a scroll), until the next tap elsewhere.
    let fromMap = false;
    let touched = false;
    let lastPointer = "mouse";
    document.addEventListener("pointerdown", (event) => {
      lastPointer = event.pointerType;
    });

    mapBox.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") return;
      // A pin speaks for its own country, whatever is under its head.
      const pin = event.target.closest && event.target.closest(".pin");
      if (pin) {
        if (fromMap) hideTip();
        fromMap = false;
        light(pin.dataset.name);
        return;
      }
      const name = countryAt(event);
      if (name) {
        fromMap = true;
        light(name);
        showTip(name, event);
      } else if (fromMap) {
        fromMap = false;
        light(null);
        hideTip();
      }
    });
    mapBox.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "touch" || !fromMap) return;
      fromMap = false;
      light(null);
      hideTip();
    });
    mapBox.addEventListener("click", (event) => {
      if (lastPointer !== "touch") return;
      const pin = event.target.closest && event.target.closest(".pin");
      if (pin) {
        hideTip();
        light(pin.dataset.name);
        return;
      }
      const name = countryAt(event);
      touched = Boolean(name);
      light(name);
      if (name) showTip(name, event);
      else hideTip();
    });
    document.addEventListener("click", (event) => {
      if (lastPointer !== "touch" || mapBox.contains(event.target)) return;
      if (event.target.closest && event.target.closest(".countries li")) return;
      touched = false;
      light(null);
      hideTip();
    });
    window.addEventListener("scroll", () => {
      if (fromMap) {
        fromMap = false;
        light(null);
        hideTip();
      }
    }, { passive: true });

    // Pointing at a country in the list finds it on the maps; on a touch
    // screen a tap does, and a second tap lets go.
    chips.forEach((chip) => {
      chip.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "mouse" || event.pointerType === "pen") light(chip.dataset.name);
      });
      chip.addEventListener("pointerleave", (event) => {
        if (event.pointerType === "mouse" || event.pointerType === "pen") light(null);
      });
      chip.addEventListener("click", () => {
        if (lastPointer !== "touch") return;
        // A second tap on the chip lets go, unless the light came from the map.
        const release = chip.classList.contains("lit") && !touched;
        touched = false;
        hideTip();
        light(release ? null : chip.dataset.name);
      });
    });
  }

  // A photo pin finds its country on the maps and in the list while it is
  // pointed at, focused or open. Its photo is a popover: the focus goes to
  // its close button when it opens and back to the pin when it closes
  // (Esc, the close button, or a click anywhere else).
  let openPin = null;
  pins.forEach((pin) => {
    const photo = document.getElementById(pin.getAttribute("popovertarget"));
    const name = pin.dataset.name;
    const letGo = () => {
      if (litName === name && openPin !== pin && document.activeElement !== pin) light(null);
    };
    pin.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse" || event.pointerType === "pen") light(name);
    });
    pin.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "mouse" || event.pointerType === "pen") letGo();
    });
    pin.addEventListener("focus", () => light(name));
    pin.addEventListener("blur", letGo);
    if (!photo) return;
    photo.addEventListener("toggle", (event) => {
      if (event.newState === "open") {
        openPin = pin;
        light(name);
        const close = photo.querySelector(".pin-close");
        if (close) close.focus({ preventScroll: true });
        return;
      }
      if (openPin === pin) openPin = null;
      const focus = document.activeElement;
      // Unless a click outside put the focus somewhere else on purpose. (A
      // browser may hand it back to whatever had it before: Safari doesn't
      // focus a button on click, so that can be another pin.)
      const stray = !focus || focus === document.body || photo.contains(focus) || focus.classList.contains("pin");
      if (stray) pin.focus({ preventScroll: true });
      letGo();
    });
  });

  // ---------- Copy email ----------
  const copy = document.querySelector(".copy");
  const status = document.querySelector(".copy-status");
  if (copy && status && navigator.clipboard && window.isSecureContext) {
    let timer;
    copy.hidden = false;
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(copy.dataset.copy);
        status.textContent = "Copied to clipboard";
      } catch {
        status.textContent = "Could not copy. Select the address above instead.";
      }
      status.classList.add("shown");
      clearTimeout(timer);
      timer = setTimeout(() => {
        status.classList.remove("shown");
        status.textContent = "";
      }, 2500);
    });
  }
})();
