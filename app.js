(function () {
  const DATA = window.AUCTION_DATA || { lots: [], sources: {}, rate: { usd: 1325, base: 1350, discount: 25 } };
  const RATE = DATA.rate.usd;
  const LOTS = DATA.lots.map(l => l.category === 'damaged' ? { ...l, priceKRW: null, feeKRW: null, usd: null }
    : { ...l, usd: l.priceKRW ? Math.round(l.priceKRW / RATE) : null });
  const BY_ID = Object.fromEntries(LOTS.map(l => [l.id, l]));
  const PAGE = 48;

  const FUEL = { gasoline: 'Бензин', diesel: 'Дизель', hybrid: 'Гибрид', electric: 'Электро', lpg: 'Газ', hydrogen: 'Водород', other: 'Другое' };
  const DMG = { total: 'Тотал', partial: 'Частичный', scrap: 'На утиль', condition: 'Есть дефекты' };
  const COLOR = { white: 'белый', black: 'чёрный', silver: 'серебристый', gray: 'серый', pearl: 'перламутр', blue: 'синий', red: 'красный', brown: 'коричневый', green: 'зелёный', beige: 'бежевый', gold: 'золотой' };

  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => n == null ? '—' : n.toLocaleString('ru-RU');
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  // ------------------------------------------------------------ избранное
  // Храним снимок лота, чтобы он оставался виден и после окончания торгов.
  let wish = store.get('wish', {});
  const isWish = id => !!wish[id];
  function toggleWish(id) {
    if (wish[id]) delete wish[id];
    else {
      const l = BY_ID[id];
      wish[id] = { added: Date.now(), note: '', snap: { id: l.id, source: l.source, category: l.category, make: l.make, model: l.model, year: l.year, mileage: l.mileage, priceKRW: l.priceKRW, photos: (l.photos || []).slice(0, 1), url: l.url, endsAt: l.endsAt, lotNo: l.lotNo } };
    }
    store.set('wish', wish);
    document.querySelectorAll(`[data-heart="${CSS.escape(id)}"]`).forEach(b => { b.classList.toggle('on', isWish(id)); b.textContent = isWish(id) ? '♥' : '♡'; });
    updateCounts();
    if (state.tab === 'wish') render();
  }

  // ------------------------------------------------------------ состояние
  const DEF = { tab: 'whole', q: '', src: [], make: '', model: '', yFrom: '', yTo: '', pFrom: '', pTo: '', km: 200000, fuel: [], tm: [], sheet: false, noRepl: false, hasPrice: false, active: true, sort: 'ends' };
  let state = { ...DEF, ...readHash() };
  let shown = PAGE;

  function readHash() {
    try { return JSON.parse(decodeURIComponent(location.hash.slice(1)) || '{}'); } catch { return {}; }
  }
  function writeHash() {
    const diff = {};
    for (const k in state) if (JSON.stringify(state[k]) !== JSON.stringify(DEF[k])) diff[k] = state[k];
    history.replaceState(null, '', Object.keys(diff).length ? '#' + encodeURIComponent(JSON.stringify(diff)) : location.pathname);
  }

  // ------------------------------------------------------------ фильтрация
  const now = Date.now();
  const ended = l => !l.negotiable && l.endsAt && new Date(l.endsAt).getTime() < now - 3600e3;
  const replaced = l => (l.inspection?.marks?.['Заменено'] || []).length > 0;
  const hasSheet = l => !!(l.inspection && (Object.keys(l.inspection.panels || {}).length || l.inspection.items?.length || l.inspection.grades?.length || l.inspection.sheetImages?.length || l.inspection.sheetUrl || Object.keys(l.inspection.marks || {}).length));
  const title = l => `${l.make !== 'Other' ? l.make + ' ' : ''}${l.model}`.trim();

  function baseSet() { return LOTS.filter(l => l.category === state.tab); }

  function filtered(except) {
    const q = state.q.trim().toLowerCase();
    return baseSet().filter(l => {
      if (q && !`${title(l)} ${l.grade} ${l.lotNo} ${l.vin} ${l.plate} ${l.location}`.toLowerCase().includes(q)) return false;
      if (except !== 'src' && state.src.length && !state.src.includes(l.source)) return false;
      if (except !== 'make' && state.make && l.make !== state.make) return false;
      if (except !== 'model' && except !== 'make' && state.model && l.model !== state.model) return false;
      if (state.yFrom && l.year && l.year < +state.yFrom) return false;
      if (state.yTo && l.year && l.year > +state.yTo) return false;
      if (state.pFrom && (l.usd ?? Infinity) < +state.pFrom) return false;
      if (state.pTo && (l.usd ?? 0) > +state.pTo) return false;
      if (state.km < 200000 && l.mileage != null && l.mileage > state.km) return false;
      if (except !== 'fuel' && state.fuel.length && !state.fuel.includes(l.fuel)) return false;
      if (except !== 'tm' && state.tm.length && !state.tm.includes(l.transmission)) return false;
      if (state.sheet && !hasSheet(l)) return false;
      if (state.noRepl && replaced(l)) return false;
      if (state.hasPrice && !l.usd) return false;
      if (state.active && ended(l)) return false;
      return true;
    });
  }

  const SORTS = {
    ends: (a, b) => (a.endsAt || '9') < (b.endsAt || '9') ? -1 : 1,
    priceAsc: (a, b) => (a.usd ?? 1e12) - (b.usd ?? 1e12),
    priceDesc: (a, b) => (b.usd ?? -1) - (a.usd ?? -1),
    yearDesc: (a, b) => (b.year || 0) - (a.year || 0),
    mileageAsc: (a, b) => (a.mileage ?? 1e9) - (b.mileage ?? 1e9),
  };

  // ------------------------------------------------------------ фильтры UI
  const countBy = (arr, f) => arr.reduce((m, l) => (m[f(l)] = (m[f(l)] || 0) + 1, m), {});

  function chips(el, key, entries) {
    el.innerHTML = entries.map(([v, label, n]) =>
      `<button class="chip ${state[key].includes(v) ? 'on' : ''}" data-v="${esc(v)}">${esc(label)}<small>${n ?? ''}</small></button>`).join('');
    el.onclick = e => {
      const b = e.target.closest('.chip'); if (!b) return;
      const v = b.dataset.v, a = state[key];
      state[key] = a.includes(v) ? a.filter(x => x !== v) : [...a, v];
      changed();
    };
  }

  function buildFilters() {
    const srcCount = countBy(filtered('src'), l => l.source);
    const srcs = Object.entries(DATA.sources).filter(([, s]) => s.category === state.tab || state.tab === 'wish');
    chips($('#fSource'), 'src', srcs.map(([id, s]) => [id, s.name, srcCount[id] || 0]));

    const dmgTab = state.tab === 'damaged';
    $('#gPrice').hidden = dmgTab; $('#fPrice').closest('label').hidden = dmgTab;
    document.querySelectorAll('#sort option[value^=price]').forEach(o => o.hidden = dmgTab);
    if (dmgTab && state.sort.startsWith('price')) state.sort = 'ends';

    const mc = countBy(filtered('make'), l => l.make);
    $('#fMake').innerHTML = '<option value="">Все марки</option>' + Object.keys(mc).sort((a, b) => a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b))
      .map(m => `<option value="${esc(m)}" ${m === state.make ? 'selected' : ''}>${m === 'Other' ? 'Другие' : esc(m)} (${mc[m]})</option>`).join('');
    const md = countBy(filtered('model'), l => l.model);
    $('#fModel').disabled = !state.make;
    $('#fModel').innerHTML = '<option value="">Все модели</option>' + (state.make ? Object.keys(md).sort()
      .map(m => `<option value="${esc(m)}" ${m === state.model ? 'selected' : ''}>${esc(m)} (${md[m]})</option>`).join('') : '');

    const minY = DATA.minYear || 2021, maxY = new Date().getFullYear() + 1;
    const yo = sel => '<option value="">' + (sel ? 'до' : 'от') + '</option>' + Array.from({ length: maxY - minY + 1 }, (_, i) => minY + i).map(y => `<option>${y}</option>`).join('');
    $('#fYearFrom').innerHTML = yo(0); $('#fYearFrom').value = state.yFrom;
    $('#fYearTo').innerHTML = yo(1); $('#fYearTo').value = state.yTo;
    $('#fPriceFrom').value = state.pFrom; $('#fPriceTo').value = state.pTo;
    $('#fMileage').value = state.km;
    $('#fMileageLbl').textContent = state.km >= 200000 ? 'любой' : 'до ' + fmt(+state.km) + ' км';

    const fc = countBy(filtered('fuel'), l => l.fuel);
    chips($('#fFuel'), 'fuel', Object.keys(FUEL).filter(k => fc[k]).map(k => [k, FUEL[k], fc[k]]));
    const tc = countBy(filtered('tm'), l => l.transmission || '?');
    chips($('#fTm'), 'tm', ['AT', 'MT', 'CVT'].filter(k => tc[k]).map(k => [k, { AT: 'Автомат', MT: 'Механика', CVT: 'Вариатор' }[k], tc[k]]));

    $('#fSheet').checked = state.sheet; $('#fNoReplace').checked = state.noRepl;
    $('#fPrice').checked = state.hasPrice; $('#fActive').checked = state.active;
    $('#q').value = state.q; $('#sort').value = state.sort;
  }

  function activeChips() {
    const out = [];
    const add = (label, reset) => out.push([label, reset]);
    if (state.q) add(`«${state.q}»`, () => state.q = '');
    state.src.forEach(s => add(DATA.sources[s]?.name || s, () => state.src = state.src.filter(x => x !== s)));
    if (state.make) add(state.make, () => { state.make = ''; state.model = ''; });
    if (state.model) add(state.model, () => state.model = '');
    if (state.yFrom || state.yTo) add(`${state.yFrom || '…'}–${state.yTo || '…'} г.`, () => { state.yFrom = state.yTo = ''; });
    if (state.pFrom || state.pTo) add(`$${state.pFrom || 0}–${state.pTo || '∞'}`, () => { state.pFrom = state.pTo = ''; });
    if (state.km < 200000) add(`≤${fmt(+state.km)} км`, () => state.km = 200000);
    state.fuel.forEach(s => add(FUEL[s], () => state.fuel = state.fuel.filter(x => x !== s)));
    if (state.sheet) add('лист осмотра', () => state.sheet = false);
    if (state.noRepl) add('без замен', () => state.noRepl = false);
    const el = $('#activeChips');
    el.innerHTML = out.map(([l], i) => `<button class="chip" data-i="${i}">${esc(l)} ✕</button>`).join('');
    el.onclick = e => { const b = e.target.closest('.chip'); if (b) { out[+b.dataset.i][1](); changed(); } };
  }

  // ------------------------------------------------------------ карточки
  function endsLabel(l) {
    if (!l.endsAt) return '';
    const d = new Date(l.endsAt), diff = d - Date.now();
    const t = d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    if (diff < 0) return `<div class="ends">${l.negotiable ? 'не продан, торг возможен' : 'торги прошли'}<br>${t}</div>`;
    const h = Math.floor(diff / 3600e3);
    const left = h < 48 ? `через ${h} ч ${Math.floor(diff / 60e3) % 60} мин` : `через ${Math.floor(h / 24)} дн`;
    return `<div class="ends ${h < 24 ? 'soon' : ''}">${left}<br>${t}</div>`;
  }

  function priceHtml(l) {
    if (l.category === 'damaged') return '<div></div>';
    return l.usd ? `<div class="price">$${fmt(l.usd)}<small>стартовая цена</small></div>`
      : `<div class="price" style="font-size:14px;color:var(--muted)">без стартовой цены<small>${l.source === "autohub_pub" ? "ставки вслепую (공매)" : "&nbsp;"}</small></div>`;
  }

  function card(l) {
    const ph = l.photos?.[0];
    const tags = [...(l.condition || [])].slice(0, 4).map(t => `<span class="tag">${esc(t)}</span>`);
    if (l.category === 'whole' && hasSheet(l) && !replaced(l)) tags.unshift('<span class="tag ok">без замен</span>');
    return `<div class="card" data-id="${esc(l.id)}">
      <div class="thumb">
        ${ph ? `<img src="${esc(ph)}" loading="lazy" referrerpolicy="no-referrer" alt="" onerror="this.remove()">` : ''}<div class="noimg" style="z-index:-1">нет фото</div>
        <div class="badges"><span class="badge">${esc(DATA.sources[l.source]?.name || l.source)}</span>
          ${l.aucGrade ? `<span class="badge grade">${esc(l.aucGrade)}</span>` : ''}${hasSheet(l) ? '<span class="badge sheet">лист осмотра</span>' : ''}
          ${l.alsoOn?.length ? `<span class="badge">+${l.alsoOn.length} аукц.</span>` : ''}</div>
        <button class="heart ${isWish(l.id) ? 'on' : ''}" data-heart="${esc(l.id)}" title="В избранное">${isWish(l.id) ? '♥' : '♡'}</button>
        ${l.photos?.length > 1 ? `<span class="photos-n">📷 ${l.photos.length}</span>` : ''}
      </div>
      <div class="body">
        <div class="title"><span class="t">${esc(title(l))}</span><small>${[l.grade, l.lotNo && 'лот ' + l.lotNo].filter(Boolean).map(esc).join(' · ')}</small></div>
        <div class="specs"><span>${l.year || '—'}</span><span>${l.mileage != null ? fmt(l.mileage) + ' км' : 'пробег —'}</span><span>${FUEL[l.fuel] || ''}</span>${l.transmission ? `<span>${l.transmission}</span>` : ''}</div>
        ${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}
        <div class="price-row">${priceHtml(l)}${endsLabel(l)}</div>
      </div></div>`;
  }

  // ------------------------------------------------------------ избранное
  function renderWish() {
    const ids = Object.keys(wish).sort((a, b) => wish[b].added - wish[a].added);
    $('#count').textContent = `В избранном: ${ids.length}`;
    $('#activeChips').innerHTML = '';
    $('#more').hidden = true;
    $('#empty').hidden = ids.length > 0;
    $('#empty').innerHTML = 'Нажмите ♡ на карточке, чтобы добавить лот в избранное.';
    if (!ids.length) { $('#grid').innerHTML = ''; return; }
    const rows = ids.map(id => {
      const live = BY_ID[id], l = live ? { ...live } : { ...wish[id].snap, usd: wish[id].snap.priceKRW ? Math.round(wish[id].snap.priceKRW / RATE) : null };
      return `<div class="wish-row" data-id="${esc(id)}">
        ${l.photos?.[0] ? `<img src="${esc(l.photos[0])}" referrerpolicy="no-referrer" alt="">` : '<img alt="">'}
        <div><div class="title">${esc(title(l))}<small>${esc(DATA.sources[l.source]?.name || l.source)} · ${l.category === 'damaged' ? 'битый' : 'целый'} · лот ${esc(l.lotNo || '—')}</small></div>
          <div class="specs"><span>${l.year || ''}</span><span>${l.mileage != null ? fmt(l.mileage) + ' км' : ''}</span><span><b>${l.usd ? '$' + fmt(l.usd) : ''}</b></span>
          ${!live ? '<span class="gone">лот снят / торги завершены</span>' : ended(l) ? '<span class="gone">торги прошли</span>' : ''}</div>
          <input class="note" data-note="${esc(id)}" value="${esc(wish[id].note)}" placeholder="заметка…" style="margin-top:6px;width:100%;border:1px solid var(--line);border-radius:6px;padding:4px 8px" onclick="event.stopPropagation()"></div>
        <div class="wish-actions">${endsLabel(l)}<button class="btn danger" data-unwish="${esc(id)}">Убрать</button></div></div>`;
    });
    $('#grid').className = 'wish-list';
    $('#grid').innerHTML = `<div class="wish-tools"><button class="btn" id="wishCopy">Скопировать список</button><button class="btn danger" id="wishClear">Очистить</button></div>` + rows.join('');
    $('#wishCopy').onclick = () => {
      const t = ids.map(id => { const l = BY_ID[id] || wish[id].snap; return `${title(l)} ${l.year || ''}, ${l.mileage ? fmt(l.mileage) + ' км' : ''}, ${l.priceKRW ? '$' + fmt(Math.round(l.priceKRW / RATE)) : ''} — ${l.url}${wish[id].note ? ' (' + wish[id].note + ')' : ''}`; }).join('\n');
      navigator.clipboard?.writeText(t).then(() => { $('#wishCopy').textContent = 'Скопировано ✓'; });
    };
    $('#wishClear').onclick = () => { if (confirm('Очистить избранное?')) { wish = {}; store.set('wish', wish); updateCounts(); render(); } };
  }

  // ------------------------------------------------------------ рендер
  function render() {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
    $('#filters').style.visibility = state.tab === 'wish' ? 'hidden' : '';
    $('#sort').style.display = state.tab === 'wish' ? 'none' : '';
    if (state.tab === 'wish') return renderWish();
    $('#grid').className = 'grid';
    buildFilters();
    activeChips();
    const list = filtered().sort(SORTS[state.sort]);
    $('#count').textContent = `${fmt(list.length)} лотов`;
    $('#grid').innerHTML = list.slice(0, shown).map(card).join('');
    $('#more').hidden = list.length <= shown;
    $('#more').textContent = `Показать ещё (${fmt(list.length - shown)})`;
    $('#empty').hidden = list.length > 0;
    $('#empty').innerHTML = baseSet().length ? 'Ничего не найдено — ослабьте фильтры.' : emptySourceMsg();
  }

  function emptySourceMsg() {
    const msgs = Object.values(DATA.sources).filter(s => s.category === state.tab && (s.error || s.note));
    return 'В этой категории пока нет лотов.' + (msgs.length ? '<br><br>' + msgs.map(s => `<b>${esc(s.name)}</b>: ${esc(s.note || s.error)}`).join('<br>') : '');
  }

  function changed() { shown = PAGE; writeHash(); render(); }

  function updateCounts() {
    const c = { whole: 0, damaged: 0 };
    LOTS.forEach(l => { if (!ended(l)) c[l.category]++; });
    const sp = document.querySelectorAll('#tabs button span');
    sp[0].textContent = c.whole; sp[1].textContent = c.damaged; sp[2].textContent = Object.keys(wish).length;
  }

  // ------------------------------------------------------------ схема кузова
  // Коды как на корейских листах: прошлое — XX замена, W рихтовка/сварка, P окрас;
  // текущее — R нужен ремонт, M регулировка, X нужна замена.
  const CODES = {
    XX: ['Замена (была)', 'bad'], W: ['Рихтовка/сварка (была)', 'mid'], P: ['Окрас (был)', 'low'],
    R: ['Требует ремонта', 'mid'], M: ['Требует регулировки', 'low'], X: ['Требует замены', 'bad'],
    A: ['Царапина', 'low'], U: ['Вмятина', 'low'], C: ['Коррозия', 'mid'], T: ['Трещина/скол', 'mid'],
  };
  const PANELS = {
    front_bumper: ['Передний бампер', 'M70 8h160a10 10 0 0 1 10 10v14H60V18a10 10 0 0 1 10-10z', 150, 26],
    hood: ['Капот', 'M68 40h164l-8 108H76z', 150, 98],
    fl_fender: ['Переднее крыло (Л)', 'M24 48h36l10 100H24z', 40, 100],
    fr_fender: ['Переднее крыло (П)', 'M240 48h36v100h-46z', 260, 100],
    roof: ['Крыша', 'M84 186h132v150H84z', 150, 262],
    fl_door: ['Передняя дверь (Л)', 'M24 156h46v112H24z', 46, 212],
    fr_door: ['Передняя дверь (П)', 'M230 156h46v112h-46z', 254, 212],
    rl_door: ['Задняя дверь (Л)', 'M24 274h46v104H24z', 46, 326],
    rr_door: ['Задняя дверь (П)', 'M230 274h46v104h-46z', 254, 326],
    rl_quarter: ['Заднее крыло (Л)', 'M24 384h46l-6 92H24z', 44, 432],
    rr_quarter: ['Заднее крыло (П)', 'M230 384h46v92h-40z', 256, 432],
    trunk: ['Крышка багажника', 'M80 372h140l-6 90H86z', 150, 418],
    rear_bumper: ['Задний бампер', 'M60 488h180v14a10 10 0 0 1-10 10H70a10 10 0 0 1-10-10z', 150, 500],
    l_sill: ['Порог (Л)', 'M8 156h12v222H8z', 14, 268],
    r_sill: ['Порог (П)', 'M280 156h12v222h-12z', 286, 268],
  };
  const sevRank = { bad: 3, mid: 2, low: 1 };

  function diagramHtml(panels) {
    const sev = codes => codes.reduce((m, c) => Math.max(m, sevRank[CODES[c]?.[1]] || 1), 0);
    const fill = { 3: 'var(--red-soft)', 2: 'var(--amber-soft)', 1: '#fff8d6', 0: '#fff' };
    const shapes = Object.entries(PANELS).map(([k, [name, d, x, y]]) => {
      const codes = panels[k] || [];
      return `<g><title>${name}${codes.length ? ': ' + codes.map(c => CODES[c]?.[0] || c).join(', ') : ''}</title>
        <path d="${d}" fill="${fill[sev(codes)]}" stroke="#b9c0cc" stroke-width="1.2"/>
        ${codes.length ? `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="13" font-weight="700" fill="${sev(codes) === 3 ? '#c4161c' : '#1f2937'}">${codes.join(' ')}</text>` : ''}</g>`;
    }).join('');
    const used = [...new Set(Object.values(panels).flat())];
    return `<div class="diagram">
      <svg viewBox="-24 -22 348 560" role="img" aria-label="Схема кузова">
        <text x="150" y="-8" text-anchor="middle" font-size="11" fill="#6b7280">ПЕРЕД</text>
        <text x="150" y="532" text-anchor="middle" font-size="11" fill="#6b7280">ЗАД</text>
        <text x="-14" y="270" text-anchor="middle" font-size="12" font-weight="700" fill="#6b7280">Л</text>
        <text x="314" y="270" text-anchor="middle" font-size="12" font-weight="700" fill="#6b7280">П</text>
        <path d="M150 150c30 0 52 6 60 14l-8 22H98l-8-22c8-8 30-14 60-14z" fill="#eef1f5"/>
        <path d="M98 342h104l6 22c-8 6-30 10-58 10s-50-4-58-10z" fill="#eef1f5"/>
        ${shapes}
      </svg>
      <div class="legend">
        ${legendTable()}
        ${used.length ? '<ul>' + Object.entries(panels).filter(([, c]) => c.length).map(([k, c]) =>
          `<li><b>${esc(PANELS[k]?.[0] || k)}</b> — ${c.map(x => esc(CODES[x]?.[0] || x)).join(', ')}</li>`).join('') + '</ul>' : '<p class="hint">Повреждений кузова не отмечено.</p>'}
      </div></div>`;
  }

  // ------------------------------------------------------------ карточка лота
  const gradeCls = g => /хорош/.test(g) ? 'g-good' : /средн/.test(g) ? 'g-mid' : /плох/.test(g) ? 'g-bad' : '';
  const ru = (obj, f) => obj?.[f + 'Ru'] || obj?.[f] || '';
  const orig = (obj, f) => obj?.[f + 'Ru'] && obj[f + 'Ru'] !== obj[f] ? `<details class="orig"><summary>оригинал</summary>${esc(obj[f])}</details>` : '';

  function layoutHtml(lay) {
    const sev = cs => Math.max(...cs.map(c => sevRank[CODES[c]?.[1]] || 1));
    const labels = lay.parts.map(p => `<span class="lay-code ${sev(p.codes) === 3 ? 'bad' : ''}" style="left:${(p.x + p.w / 2) / lay.w * 100}%;top:${(p.y + p.h / 2) / lay.h * 100}%" title="${esc(p.name)}">${p.codes.map(esc).join(' ')}</span>`).join('');
    return `<div class="diagram lay">
      <div class="lay-box" style="aspect-ratio:${lay.w}/${lay.h}">
        <img src="${esc(lay.draw)}" alt="Схема кузова" loading="lazy">
        ${lay.parts.map(p => `<img src="${esc(p.img)}" alt="" loading="lazy">`).join('')}
        ${labels}
      </div>
      <div class="legend">${legendTable()}
        ${lay.parts.length ? '<ul>' + lay.parts.map(p => `<li><b>${esc(p.name)}</b> — ${p.codes.map(c => esc(CODES[c]?.[0] || c)).join(', ')}</li>`).join('') + '</ul>' : '<p class="hint">Повреждений кузова не отмечено.</p>'}
      </div></div>`;
  }
  const legendTable = () => `<table><tr><th></th><th colspan="3">История</th><th colspan="3">Сейчас</th></tr>
    <tr><td>Код</td><td>XX</td><td>W</td><td>P</td><td>R</td><td>M</td><td>X</td></tr>
    <tr><td></td><td>замена</td><td>рихтовка/ сварка</td><td>окрас</td><td>нужен ремонт</td><td>регулировка</td><td>нужна замена</td></tr></table>`;
  const LETTER = { A: 'отлично', B: 'хорошо', C: 'средне', D: 'плохо', F: 'очень плохо' };
  const gradeNote = g => g && g.length === 2 ? `Кузов/ДТП: <b>${g[0]}</b> (${LETTER[g[0]] || ''}) · Внешний вид: <b>${g[1]}</b> (${LETTER[g[1]] || ''})<br><span class="hint">шкала A — лучшая … F — худшая</span>` : '';

  function sheetHtml(l) {
    const s = l.inspection;
    if (!s) return '<p class="hint">Аукцион не предоставил лист осмотра.</p>';
    let h = '';
    if (l.aucGrade || s.date) h += `<div class="sheet-head">${l.aucGrade ? `<div class="grade-big" title="Оценка аукциона">${esc(l.aucGrade)}<small>оценка аукциона</small></div>` : ''}
      <div>${gradeNote(l.aucGrade)}${s.date ? `<div class="hint">Данные истории от ${esc(s.date)}</div>` : ''}</div></div>`;
    if (s.layout?.draw) h += layoutHtml(s.layout);
    else if (s.panels && Object.keys(s.panels).length) h += diagramHtml(s.panels);
    const marks = Object.entries(s.marks || {});
    if (marks.length && !s.layout) h += '<div class="marks">' + marks.map(([k, v]) =>
      `<div class="mark ${/Замен/.test(k) ? 'bad' : /Ремонт|ремонт|Окрас|Рихтовка/.test(k) ? 'mid' : ''}"><b>${esc(k)} (${v.length})</b>${v.map(esc).join(', ')}</div>`).join('') + '</div>';
    if (s.accidents) h += `<p><b>Страховая история:</b> ${esc(ru(s, 'accidents'))}</p>${orig(s, 'accidents')}`;
    if (s.legal?.length) h += `<p><b>Юридически:</b> ${s.legal.map(x => `${esc(x.name)} — <span class="${x.value === '0' ? 'g-good' : 'g-bad'}">${x.value === '0' ? 'нет' : esc(x.value)}</span>`).join(' · ')}</p>`;
    if (s.exterior) h += `<div class="group-title">Комментарий осмотрщика</div><div class="notes">${esc(ru(s, 'exterior'))}</div>${orig(s, 'exterior')}`;
    if (s.repairNotes && s.repairNotes !== l.notes) h += `<div class="group-title">Повреждения</div><div class="notes">${esc(ru(s, 'repairNotes'))}</div>${orig(s, 'repairNotes')}`;
    if (s.items?.length) h += '<div class="group-title">Проверка узлов</div><div class="sheet-grid">' + s.items.map(g =>
      `<div><span>${g.group ? esc(g.group) + (g.name && g.name !== g.group ? ': ' + esc(g.name) : '') : esc(g.name)}</span><span class="${/^(нет|норма|хорошо|исправ)/i.test(g.value) ? 'g-good' : /средн/i.test(g.value) ? 'g-mid' : 'g-bad'}">${esc(g.value)}</span></div>`).join('') + '</div>';
    if (s.grades?.length) h += '<div class="group-title">Оценка узлов</div><div class="sheet-grid">' + s.grades.map(g =>
      `<div><span>${esc(g.group)}: ${esc(g.item)}</span><span class="${gradeCls(g.grade)}">${esc(g.grade)}</span></div>`).join('') + '</div>';
    if (l.options?.length) h += `<div class="group-title">Опции</div><p>${l.options.map(esc).join(', ')}</p>`;
    if (s.sheetImages?.length) h += '<div class="group-title">Скан листа</div><div class="sheet-imgs">' + s.sheetImages.map(u => `<a href="${esc(u)}" target="_blank" rel="noreferrer"><img src="${esc(u)}" referrerpolicy="no-referrer" alt="лист осмотра"></a>`).join('') + '</div>';
    if (s.sheetUrl) h += `<p><a href="${esc(s.sheetUrl)}" target="_blank" rel="noreferrer">${l.source === 'happycar' ? 'Подробная страховая история на сайте аукциона ↗' : 'Оригинал аукционного листа ↗'}</a> <span class="hint">(нужен вход на сайт аукциона)</span></p>`;
    return h || '<p class="hint">Лист осмотра пуст.</p>';
  }

  function openLot(id) {
    const l = BY_ID[id]; if (!l) return;
    const photos = l.photos?.length ? l.photos : [];
    let i = 0;
    const rows = [
      ['Аукцион', `<a href="${esc(DATA.sources[l.source]?.site)}" target="_blank" rel="noreferrer">${esc(DATA.sources[l.source]?.name)}</a>`],
      ['Лот №', esc(l.lotNo)], ['Год', l.year || '—'], ['Первая регистрация', esc(l.regDate || '—')],
      ['Пробег', l.mileage != null ? fmt(l.mileage) + ' км' : '—'], ['Топливо', FUEL[l.fuel] + (l.fuelRaw ? ` <span class="hint">(${esc(l.fuelRaw)})</span>` : '')],
      ['КПП', esc(l.transmission || '—')], ['Объём', l.engineCc ? fmt(l.engineCc) + ' см³' : '—'], ['Цвет', COLOR[l.color] || '—'],
      ['VIN', esc(l.vin || '—')], ['Госномер', esc(l.plate || '—')],
      ['Местонахождение', esc(l.location || '—')],
      ['Торги', l.endsAt ? new Date(l.endsAt).toLocaleString('ru-RU') : '—'], ['Статус', esc(l.statusRu || '—')], ['Стоянка / линия', esc(l.parking || '—')], ['Использование', esc(l.useRu || '—')],
    ];
    $('#modalBox').innerHTML = `<button class="m-close" data-close>✕</button>
      <div class="m-grid">
        <div class="gallery">
          <div class="main">${photos.length ? `<img id="gMain" src="${esc(photos[0])}" referrerpolicy="no-referrer" alt="">` : '<div class="noimg">нет фото</div>'}
            ${photos.length > 1 ? '<button class="nav prev">‹</button><button class="nav next">›</button>' : ''}</div>
          <div class="strip">${photos.map((p, k) => `<img src="${esc(p)}" data-k="${k}" class="${k ? '' : 'on'}" loading="lazy" referrerpolicy="no-referrer" alt="">`).join('')}</div>
        </div>
        <div>
          <h2 class="m-title">${esc(title(l))}</h2>
          <div class="m-sub">${esc(l.grade || '')}</div>
          <div class="tags">${(l.condition || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
          ${l.category === 'damaged' ? '' : `<div class="m-price">${l.usd ? `<b>$${fmt(l.usd)}</b><span>стартовая цена</span>` : `<span>без стартовой цены${l.source === 'autohub_pub' ? ' — закрытые торги, ставки вслепую' : ''}</span>`}</div>`}
          ${l.feeKRW ? `<p class="hint">+ комиссия аукциона $${fmt(Math.round(l.feeKRW / RATE))}</p>` : ''}
          <dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
          ${l.alsoOn?.length ? `<p class="hint" style="margin-top:12px">Этот же автомобиль на других аукционах: ${l.alsoOn.map(a => `<b>${esc(DATA.sources[a.source]?.name || a.source)}</b>${a.lotNo ? ' (лот ' + esc(a.lotNo) + ')' : ''}`).join(', ')}</p>` : ''}
          <div class="m-actions">
            <button class="btn ${isWish(l.id) ? '' : 'primary'}" id="mWish">${isWish(l.id) ? '♥ В избранном' : '♡ В избранное'}</button>
          </div>
        </div>
      </div>
      <div class="m-section">
        <h3>Описание</h3>
        ${l.notes ? `${l.notesOther ? `<div class="group-title">Описание на ${esc(DATA.sources[l.source]?.name || '')}</div>` : ''}<div class="notes">${esc(ru(l, 'notes'))}</div>${orig(l, 'notes')}` : '<p class="hint">Описания нет.</p>'}
        ${l.notesOther ? `<div class="group-title">Описание на ${esc(DATA.sources[l.notesOtherSrc]?.name || '')}</div><div class="notes">${esc(ru(l, 'notesOther'))}</div>${orig(l, 'notesOther')}` : ''}
        <h3>Аукционный лист / состояние</h3>
        ${sheetHtml(l)}
      </div>`;
    $('#modal').hidden = false;
    document.body.style.overflow = 'hidden';
    const show = k => {
      i = (k + photos.length) % photos.length;
      $('#gMain').src = photos[i];
      document.querySelectorAll('.strip img').forEach((im, n) => im.classList.toggle('on', n === i));
      document.querySelector('.strip img.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    $('#modalBox').onclick = e => {
      if (e.target.closest('.prev')) show(i - 1);
      else if (e.target.closest('.next')) show(i + 1);
      else if (e.target.dataset.k) show(+e.target.dataset.k);
      else if (e.target.id === 'mWish') { toggleWish(l.id); e.target.textContent = isWish(l.id) ? '♥ В избранном' : '♡ В избранное'; e.target.classList.toggle('primary', !isWish(l.id)); }
    };
    $('#modal').keyNav = e => { if (e.key === 'ArrowLeft' && photos.length) show(i - 1); if (e.key === 'ArrowRight' && photos.length) show(i + 1); };
  }

  function closeModal() { $('#modal').hidden = true; document.body.style.overflow = ''; }

  // ------------------------------------------------------------ события
  $('#tabs').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const keep = { q: state.q, sort: state.sort, active: state.active };
    state = { ...DEF, ...(b.dataset.tab === state.tab ? state : keep), tab: b.dataset.tab };
    changed();
  };
  let qt;
  $('#q').oninput = e => { clearTimeout(qt); qt = setTimeout(() => { state.q = e.target.value; changed(); }, 200); };
  $('#fMake').onchange = e => { state.make = e.target.value; state.model = ''; changed(); };
  $('#fModel').onchange = e => { state.model = e.target.value; changed(); };
  $('#fYearFrom').onchange = e => { state.yFrom = e.target.value; changed(); };
  $('#fYearTo').onchange = e => { state.yTo = e.target.value; changed(); };
  $('#fPriceFrom').onchange = e => { state.pFrom = e.target.value; changed(); };
  $('#fPriceTo').onchange = e => { state.pTo = e.target.value; changed(); };
  $('#fMileage').oninput = e => { state.km = +e.target.value; $('#fMileageLbl').textContent = state.km >= 200000 ? 'любой' : 'до ' + fmt(state.km) + ' км'; };
  $('#fMileage').onchange = () => changed();
  $('#fSheet').onchange = e => { state.sheet = e.target.checked; changed(); };
  $('#fNoReplace').onchange = e => { state.noRepl = e.target.checked; changed(); };
  $('#fPrice').onchange = e => { state.hasPrice = e.target.checked; changed(); };
  $('#fActive').onchange = e => { state.active = e.target.checked; changed(); };
  $('#sort').onchange = e => { state.sort = e.target.value; changed(); };
  $('#reset').onclick = () => { state = { ...DEF, tab: state.tab }; changed(); };
  $('#more').onclick = () => { shown += PAGE; render(); };
  $('#openFilters').onclick = () => $('#filters').classList.add('open');
  const done = document.createElement('button');
  done.className = 'btn primary btn-filters'; done.textContent = 'Показать результаты'; done.style.cssText = 'width:100%;margin-top:16px';
  done.onclick = () => $('#filters').classList.remove('open');
  $('#filters').appendChild(done);

  document.addEventListener('click', e => {
    const h = e.target.closest('[data-heart]');
    if (h) { e.stopPropagation(); toggleWish(h.dataset.heart); return; }
    const u = e.target.closest('[data-unwish]');
    if (u) { e.stopPropagation(); toggleWish(u.dataset.unwish); return; }
    if (e.target.closest('[data-close]')) return closeModal();
    const c = e.target.closest('.card, .wish-row');
    if (c && !e.target.closest('input') && BY_ID[c.dataset.id]) openLot(c.dataset.id);
  });
  document.addEventListener('change', e => {
    if (e.target.dataset.note) { wish[e.target.dataset.note].note = e.target.value; store.set('wish', wish); }
  });
  document.addEventListener('keydown', e => {
    if ($('#modal').hidden) return;
    if (e.key === 'Escape') closeModal(); else $('#modal').keyNav?.(e);
  });

  // ------------------------------------------------------------ шапка/подвал
  $('#foot').innerHTML = 'Данные обновлены: ' + Object.values(DATA.sources).map(s =>
    `${esc(s.name)} — ${s.updated ? new Date(s.updated).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'нет'}${s.count != null ? ` (${s.count})` : ''}${s.error ? ' ⚠' : ''}`).join(' · ')
    + ` · только авто от ${DATA.minYear || 2021} г.`;

  updateCounts();
  render();
})();
