// Loot Goblin: browse free giveaways, cheap deals and free-to-play games,
// and "loot" them into a bank that tracks how much money you've saved.

const API = {
  giveaways: "https://www.gamerpower.com/api/giveaways",
  deals: "https://www.cheapshark.com/api/1.0/deals?pageSize=60&onSale=1",
  stores: "https://www.cheapshark.com/api/1.0/stores",
  f2p: "https://www.freetogame.com/api/games",
  dndBase: "https://www.dnd5eapi.co",
  // Low challenge-rating monsters only, so a 20 HP player can win.
  monsters: "https://www.dnd5eapi.co/api/2014/monsters?challenge_rating=0,0.125,0.25,0.5",
};
const BANK_KEY = "loot-goblin-bank";

const state = {
  tab: "giveaways",
  search: "",
  filter: "all",
  data: { giveaways: null, deals: null, f2p: null }, // null = not loaded yet
  loadError: {}, // tab -> true when its last load failed
  stores: {},
  bank: loadBank(),
  monsterList: null, // [{index, name, url}] from the D&D API
  fight: null, // the current encounter, see startFight()
};

const el = {
  tabs: document.querySelectorAll(".tab"),
  controls: document.getElementById("controls"),
  search: document.getElementById("search"),
  filter: document.getElementById("filter"),
  status: document.getElementById("status"),
  grid: document.getElementById("grid"),
  bankTotal: document.getElementById("bank-total"),
  bankCount: document.getElementById("bank-count"),
  chat: document.getElementById("chat-log"),
  arena: document.getElementById("arena"),
};

// ---------- Helpers ----------

// Safe for both text and quoted attribute values.
function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Only allow http(s) links and images from API data (blocks javascript: URLs).
function safeUrl(url) {
  return /^https?:\/\//i.test(url ?? "") ? url : "#";
}

function money(n) {
  return "$" + n.toFixed(2);
}

function parseWorth(worth) {
  const n = parseFloat(String(worth).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function loadBank() {
  try {
    const saved = JSON.parse(localStorage.getItem(BANK_KEY));
    if (!Array.isArray(saved)) return [];
    // Keep only well-formed items so bad saved data can't crash the app.
    return saved.filter((i) =>
      i && typeof i.id === "string" && typeof i.title === "string" && Number.isFinite(i.value));
  } catch {
    return [];
  }
}

function saveBank() {
  try {
    localStorage.setItem(BANK_KEY, JSON.stringify(state.bank));
  } catch {
    chat("Your bank could not be saved in this browser.");
  }
}

function bankValue() {
  return state.bank.reduce((sum, item) => sum + item.value, 0);
}

function inBank(id) {
  return state.bank.some((item) => item.id === id);
}

function chat(message, kind = "") {
  const line = document.createElement("div");
  line.className = "line " + kind;
  line.innerHTML = `<span class="who">Loot Goblin:</span> ${escapeHtml(message)}`;
  el.chat.appendChild(line);
  el.chat.parentElement.scrollTop = el.chat.parentElement.scrollHeight;
}

// ---------- Data loading ----------
// Each API is normalised into the same item shape so the grid can render any of them.

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const loaders = {
  async giveaways() {
    const list = await fetchJson(API.giveaways);
    return list.map((g) => ({
      id: "gp-" + g.id,
      title: g.title.replace(/\s*Giveaway$/i, ""),
      thumb: g.thumbnail,
      url: g.open_giveaway_url,
      value: parseWorth(g.worth),
      meta: `${g.type} · ${g.platforms}`,
      extra: g.end_date && g.end_date !== "N/A" ? `Ends ${g.end_date.slice(0, 10)}` : "No end date",
      filterValues: g.platforms.split(",").map((p) => p.trim()),
      lootable: true,
    }));
  },

  async deals() {
    const [list, stores] = await Promise.all([
      fetchJson(API.deals),
      fetchJson(API.stores).catch(() => []),
    ]);
    stores.forEach((s) => (state.stores[s.storeID] = s.storeName));
    return list.map((d) => {
      const normal = parseFloat(d.normalPrice);
      const sale = parseFloat(d.salePrice);
      return {
        id: "cs-" + d.dealID,
        title: d.title,
        thumb: d.thumb,
        url: "https://www.cheapshark.com/redirect?dealID=" + d.dealID,
        value: Math.max(0, normal - sale), // what you save by buying on sale
        normal,
        sale,
        savings: Math.round(parseFloat(d.savings)),
        rating: parseInt(d.metacriticScore, 10) || 0,
        meta: `${state.stores[d.storeID] || "Store " + d.storeID}` +
          (d.metacriticScore !== "0" ? ` · Metacritic ${d.metacriticScore}` : ""),
        lootable: true,
      };
    });
  },

  async f2p() {
    const list = await fetchJson(API.f2p);
    return list.map((g) => ({
      id: "ftg-" + g.id,
      title: g.title,
      thumb: g.thumbnail,
      url: g.game_url,
      meta: `${g.genre.trim()} · ${g.platform}`,
      extra: g.short_description,
      filterValues: [g.genre.trim()],
      lootable: false, // already free forever, nothing to save
    }));
  },
};

// Loads a tab's data once. Concurrent callers share the same request, and a
// failed load leaves the data as null so the next call tries again.
const pendingLoads = {};

function loadTab(tab) {
  if (state.data[tab]) return Promise.resolve();
  if (!pendingLoads[tab]) {
    delete state.loadError[tab];
    pendingLoads[tab] = loaders[tab]()
      .then((items) => {
        state.data[tab] = items;
        chat(`Found ${items.length} items in ${tabLabel(tab)}.`);
      })
      .catch((err) => {
        state.loadError[tab] = true;
        chat(`Oh dear, ${tabLabel(tab)} failed to load (${err.message}).`);
      })
      .finally(() => delete pendingLoads[tab]);
  }
  return pendingLoads[tab];
}

function tabLabel(tab) {
  return { giveaways: "Giveaways", deals: "Deals", f2p: "Free-to-Play", fight: "Fight", bank: "Bank" }[tab];
}

// ---------- Filters ----------

const DEAL_SORTS = [
  ["savings", "Biggest discount"],
  ["price", "Lowest price"],
  ["rating", "Best Metacritic rating"],
];

function buildFilterOptions() {
  let options = [];
  if (state.tab === "deals") {
    options = DEAL_SORTS;
  } else if (state.tab === "giveaways" || state.tab === "f2p") {
    const label = state.tab === "giveaways" ? "All platforms" : "All genres";
    const values = new Set();
    (state.data[state.tab] || []).forEach((item) => item.filterValues.forEach((v) => values.add(v)));
    options = [["all", label], ...[...values].sort().map((v) => [v, v])];
  }
  el.filter.innerHTML = options
    .map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`)
    .join("");
  state.filter = options.length ? options[0][0] : "all";
}

function visibleItems() {
  const items = state.tab === "bank" ? state.bank : state.data[state.tab] || [];
  const q = state.search.trim().toLowerCase();
  let result = items.filter((item) => item.title.toLowerCase().includes(q));

  if (state.tab === "deals") {
    const sorters = {
      savings: (a, b) => b.savings - a.savings,
      price: (a, b) => a.sale - b.sale,
      rating: (a, b) => b.rating - a.rating,
    };
    result = [...result].sort(sorters[state.filter]);
  } else if (state.tab !== "bank" && state.filter !== "all") {
    result = result.filter((item) => item.filterValues.includes(state.filter));
  }
  return result;
}

// ---------- Rendering ----------

function cardHtml(item) {
  const priceLine = item.normal !== undefined
    ? `<div class="meta price"><span class="old">${money(item.normal)}</span>
         <span class="new">${money(item.sale)}</span><span class="pct">-${item.savings}%</span></div>`
    : item.value
      ? `<div class="meta price">Worth <span class="new">${money(item.value)}</span></div>`
      : "";

  let button = "";
  if (state.tab === "bank") {
    button = `<button class="btn remove" data-remove="${escapeHtml(item.id)}">Drop</button>`;
  } else if (item.lootable) {
    button = inBank(item.id)
      ? `<button class="btn" disabled>In bank</button>`
      : `<button class="btn" data-loot="${escapeHtml(item.id)}">Loot</button>`;
  }

  return `
    <article class="card">
      <img src="${escapeHtml(safeUrl(item.thumb))}" alt="" loading="lazy">
      <a class="name" href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>
      <div class="meta">${escapeHtml(item.meta)}</div>
      ${priceLine}
      ${item.extra ? `<div class="meta">${escapeHtml(item.extra)}</div>` : ""}
      <div class="spacer"></div>
      ${button}
    </article>`;
}

function render() {
  const isBank = state.tab === "bank";
  const isFight = state.tab === "fight";
  el.controls.classList.toggle("hidden", isFight);
  el.status.classList.toggle("hidden", isFight);
  el.grid.classList.toggle("hidden", isFight);
  el.arena.classList.toggle("hidden", !isFight);
  el.bankCount.textContent = `(${state.bank.length})`;
  if (isFight) {
    el.bankTotal.classList.add("hidden");
    renderFight();
    return;
  }

  el.filter.classList.toggle("hidden", isBank);
  el.bankTotal.classList.toggle("hidden", !isBank);
  el.bankCount.textContent = `(${state.bank.length})`;

  if (isBank) {
    el.bankTotal.innerHTML = `Bank value: <span class="value">${money(bankValue())}</span>
      saved across ${state.bank.length} item${state.bank.length === 1 ? "" : "s"}`;
  }

  if (!isBank && state.data[state.tab] === null && !state.loadError[state.tab]) {
    el.status.className = "status";
    el.status.textContent = "Loading...";
    el.grid.innerHTML = "";
    return;
  }

  const items = visibleItems();
  el.status.className = "status";
  if (!isBank && state.loadError[state.tab]) {
    el.status.className = "status error";
    el.status.textContent = "Could not load this list. Click the tab again to retry.";
  } else if (isBank && state.bank.length === 0) {
    el.status.textContent = "Your bank is empty. Loot some giveaways or deals!";
  } else if (items.length === 0) {
    el.status.textContent = "Nothing interesting happens. (No matches.)";
  } else {
    el.status.textContent = `Showing ${items.length} item${items.length === 1 ? "" : "s"}.`;
  }
  el.grid.innerHTML = items.map(cardHtml).join("");
}

// ---------- Events ----------

async function switchTab(tab) {
  state.tab = tab;
  state.search = "";
  el.search.value = "";
  el.tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  // Start loading before rendering, so a retry after an error shows "Loading..." not the old error.
  const loading = tab === "bank" || tab === "fight" ? null : loadTab(tab);
  render(); // shows "Loading..." straight away if needed
  if (tab === "fight") {
    if (!state.fight) startFight();
    return;
  }
  await loading;
  if (state.tab !== tab) return; // user switched again while loading
  buildFilterOptions();
  render();
}

el.tabs.forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));

el.search.addEventListener("input", () => {
  state.search = el.search.value;
  render();
});

el.filter.addEventListener("change", () => {
  state.filter = el.filter.value;
  render();
});

function findLootable(id) {
  const pools = [state.data.giveaways, state.data.deals].filter(Boolean);
  return pools.flat().find((i) => i.id === id);
}

function lootItem(id) {
  const item = findLootable(id);
  if (!item || inBank(item.id)) return;
  const { title, thumb, url, value, meta, normal, sale, savings } = item;
  state.bank.push({ id, title, thumb, url, value, meta, normal, sale, savings, lootable: true });
  saveBank();
  chat(`You loot ${title} (${money(value)} saved). Bank value: ${money(bankValue())}.`, "loot");
  render();
}

el.grid.addEventListener("click", (e) => {
  const lootId = e.target.dataset.loot;
  const removeId = e.target.dataset.remove;

  if (lootId) lootItem(lootId);

  if (removeId) {
    const item = state.bank.find((i) => i.id === removeId);
    state.bank = state.bank.filter((i) => i.id !== removeId);
    saveBank();
    if (item) chat(`You drop ${item.title}. Bank value: ${money(bankValue())}.`);
    render();
  }
});

// ---------- Fight ----------
// One click = one round: you attack with a style, then the monster hits back.
// Combat triangle: each style beats one other style.

const PLAYER_MAX_HP = 20;
const PLAYER_MAX_HIT = 5;
const STYLES = ["melee", "ranged", "magic"];
const BEATS = { melee: "ranged", ranged: "magic", magic: "melee" };
const STYLE_ICON = { melee: "⚔️", ranged: "🏹", magic: "✨" };
const STYLE_VERB = { melee: "slash", ranged: "shoot", magic: "blast" };

const randInt = (max) => Math.floor(Math.random() * (max + 1)); // 0..max
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

async function startFight() {
  state.fight = { status: "loading" };
  render();
  try {
    // Make sure there is something to drop, and a list of monsters to choose from.
    const [list] = await Promise.all([
      state.monsterList || fetchJson(API.monsters).then((d) => d.results),
      loadTab("giveaways"),
      loadTab("deals"),
    ]);
    state.monsterList = list;
    const m = await fetchJson(API.dndBase + pick(list).url);
    state.fight = {
      status: "fighting",
      playerHp: PLAYER_MAX_HP,
      monster: {
        name: m.name,
        img: m.image ? API.dndBase + m.image : "",
        hp: m.hit_points,
        maxHp: m.hit_points,
        maxHit: Math.min(4, Math.max(1, Math.round(m.hit_points / 8))),
        style: pick(STYLES),
      },
      hits: null, // last round's damage, shown as hitsplats
      drop: null,
    };
    chat(`A wild ${m.name} appears! It attacks with ${state.fight.monster.style}.`);
  } catch (err) {
    state.fight = { status: "error" };
    chat(`The monster got lost on the way (${err.message}).`);
  }
  if (state.tab === "fight") render();
}

function attack(style) {
  const f = state.fight;
  if (f?.status !== "fighting") return;
  const mon = f.monster;

  // Strong style hits harder, weak style hits softer.
  let maxHit = PLAYER_MAX_HIT;
  if (BEATS[style] === mon.style) maxHit = Math.round(PLAYER_MAX_HIT * 1.5);
  else if (BEATS[mon.style] === style) maxHit = Math.round(PLAYER_MAX_HIT * 0.6);

  const youDeal = Math.min(mon.hp, randInt(maxHit));
  mon.hp -= youDeal;
  chat(youDeal ? `You ${STYLE_VERB[style]} the ${mon.name} for ${youDeal}.` : `You miss the ${mon.name}.`);

  let theyDeal = null;
  if (mon.hp <= 0) {
    winFight();
  } else {
    theyDeal = Math.min(f.playerHp, randInt(mon.maxHit));
    f.playerHp -= theyDeal;
    chat(theyDeal ? `The ${mon.name} hits you for ${theyDeal}.` : `The ${mon.name} misses you.`);
    if (f.playerHp <= 0) {
      f.status = "dead";
      chat("Oh dear, you are dead!");
    }
  }
  f.hits = { monster: youDeal, player: theyDeal };
  render();
}

function winFight() {
  const f = state.fight;
  f.status = "won";
  // Drop a random giveaway or deal, preferring ones not already in the bank.
  const pool = [...(state.data.giveaways || []), ...(state.data.deals || [])];
  const fresh = pool.filter((i) => !inBank(i.id));
  f.drop = pool.length ? pick(fresh.length ? fresh : pool) : null;
  chat(`You have defeated the ${f.monster.name}!`);
  if (f.drop) chat(`The ${f.monster.name} dropped ${f.drop.title}.`, "loot");
}

function runAway() {
  if (state.fight?.status !== "fighting") return;
  chat(`You run away from the ${state.fight.monster.name}.`);
  startFight();
}

function hpBar(hp, max) {
  const pct = Math.max(0, (hp / max) * 100);
  return `<div class="hp-bar"><div class="hp-fill" style="width:${pct}%"></div></div>
          <div class="hp-text">${hp} / ${max}</div>`;
}

function hitsplat(dmg) {
  if (dmg === null || dmg === undefined) return "";
  return `<div class="hitsplat ${dmg ? "hit" : "miss"}">${dmg}</div>`;
}

function renderFight() {
  const f = state.fight;
  if (!f || f.status === "loading") {
    el.arena.innerHTML = `<p class="status">A monster approaches...</p>`;
    return;
  }
  if (f.status === "error") {
    el.arena.innerHTML = `<p class="status error">Could not find a monster.</p>
      <div class="actions"><button class="btn" data-action="new">Try again</button></div>`;
    return;
  }

  const mon = f.monster;
  let actions = "";
  let message = "";
  if (f.status === "fighting") {
    actions = STYLES.map((s) =>
      `<button class="btn style-btn" data-attack="${s}">${STYLE_ICON[s]} ${cap(s)}</button>`).join("") +
      `<button class="btn remove" data-action="run">Run</button>`;
  } else if (f.status === "won") {
    message = `<p class="fight-msg win">You have defeated the ${escapeHtml(mon.name)}!</p>`;
    actions = `<button class="btn" data-action="new">Next monster</button>`;
  } else if (f.status === "dead") {
    message = `<p class="fight-msg dead">Oh dear, you are dead!</p>`;
    actions = `<button class="btn" data-action="new">Fight again</button>`;
  }

  el.arena.innerHTML = `
    <div class="arena">
      <div class="fighter">
        <div class="portrait player-portrait">🧙${hitsplat(f.hits?.player)}</div>
        <div class="fighter-name">You</div>
        ${hpBar(f.playerHp, PLAYER_MAX_HP)}
      </div>
      <div class="vs">VS</div>
      <div class="fighter">
        <div class="portrait ${mon.hp <= 0 ? "defeated" : ""}">
          ${mon.img ? `<img src="${escapeHtml(safeUrl(mon.img))}" alt="${escapeHtml(mon.name)}">` : "👹"}
          ${hitsplat(f.hits?.monster)}
        </div>
        <div class="fighter-name">${escapeHtml(mon.name)}</div>
        <div class="fighter-style">Attacks with ${STYLE_ICON[mon.style]} ${mon.style}</div>
        ${hpBar(mon.hp, mon.maxHp)}
      </div>
    </div>
    ${message}
    <div class="actions">${actions}</div>
    <p class="tip">Tip: melee beats ranged, ranged beats magic, magic beats melee.</p>
    ${f.drop ? `<h2 class="drop-title">Loot drop</h2><div class="grid drop">${cardHtml(f.drop)}</div>` : ""}`;

  // Hitsplats are shown once; later re-renders (e.g. clicking Loot) shouldn't replay them.
  f.hits = null;
}

el.arena.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.attack) attack(btn.dataset.attack);
  if (btn.dataset.action === "run") runAway();
  if (btn.dataset.action === "new") startFight();
  if (btn.dataset.loot) lootItem(btn.dataset.loot);
});

// ---------- Start ----------

chat("Welcome to Loot Goblin.");
switchTab("giveaways");
