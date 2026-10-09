// Портал партнёров: вход, ставки, личный кабинет, админка. Данные — Supabase (см. tools/schema.sql).
(function () {
  const CFG = window.KAL_CONFIG;
  if (!CFG) return;
  const LOGIN_DOMAIN = 'partners.koreaautolots.app';
  const LOCK_MIN = CFG.bidLockMinutes || 30;
  const STEP = CFG.minStepUsd || 50;
  // вход хранится на устройстве и продлевается сам; на каждом устройстве — своя независимая сессия
  const sb = window.supabase.createClient(CFG.url, CFG.anonKey,
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'kal-auth' } });
  const IN_APP = /Telegram|FBAN|FBAV|Instagram|; wv\)/i.test(navigator.userAgent);

  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const usd = n => n == null ? '—' : '$' + Math.round(n).toLocaleString('ru-RU');
  const SRC = { autohub: 'Autohub', autohub_pub: 'Autohub 공매', jenomotors: 'Jenomotors', happycar: 'HappyCar', kcar: 'K Car', heydealer: 'HeyDealer' };
  const titleOf = l => l ? `${l.make && l.make !== 'Other' ? l.make + ' ' : ''}${l.model || ''}`.trim() : '';
  // время аукционов — корейское; строки без зоны считаем KST
  const ts = s => s ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : s + '+09:00').getTime() : null;
  const dateStr = s => s ? new Date(ts(s)).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

  // роли: владелец (admin) — всё; менеджер (manager) — то же, но только со своими партнёрами
  const STAFF = () => ['admin', 'manager'].includes(ME?.role);
  const OWNER = () => ME?.role === 'admin';
  const ROLE_RU = { admin: 'владелец', manager: 'менеджер', partner: 'партнёр' };
  let ME = null, CAT = null, RATE = 1325, RATE_INFO = null, FX = null;
  // справочный пересчёт долларовой суммы в EUR / AED / RUB (рыночный курс, как в Google)
  const FX_CUR = [['EUR', '€'], ['AED', 'AED'], ['RUB', '₽']];
  const fxNum = n => Math.round(n).toLocaleString('ru-RU');
  function fxLine(amountUsd) {
    if (!FX || !(amountUsd > 0)) return '';
    const parts = FX_CUR.filter(([k]) => FX[k]).map(([k, sym]) => k === 'AED' ? `${fxNum(amountUsd * FX[k])} AED` : `${sym}${fxNum(amountUsd * FX[k])}`);
    const at = FX.at ? new Date(FX.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    return parts.length ? `<div class="fx">≈ ${parts.join(' · ')}<sup>*</sup></div><div class="fx-note">* по курсу Google${at ? ` на ${at}` : ''}, справочно</div>` : '';
  }
  let MY = {};                       // lot_id -> моя ставка (строка my_bids)

  // ------------------------------------------------------------ вход
  function loginScreen(err) {
    document.body.classList.add('locked');
    let g = $('#login');
    if (!g) {
      g = document.createElement('div');
      g.id = 'login';
      g.innerHTML = `<form class="gate-box">
          <div class="brand">Korea<b>Auto</b>Lots</div>
          ${I18N.switcher()}
          <p>Вход для партнёров</p>
          <input id="lgLogin" autocomplete="username" placeholder="Логин" autocapitalize="none" autofocus>
          <input id="lgPass" type="password" autocomplete="current-password" placeholder="Пароль">
          <button class="btn primary" type="submit">Войти</button>
          <div class="gate-err" id="lgErr"></div>
          ${IN_APP ? `<div class="gate-tip">Вы открыли сайт во встроенном браузере Telegram — здесь вход не запоминается.
            Нажмите <b>⋮</b> или <b>⋯</b> вверху → <b>«Открыть в браузере»</b>, или включите в Telegram:
            Настройки → Данные и память → <b>Открывать ссылки во внешнем браузере</b>.</div>` : ''}
          <div class="gate-tip soft">Совет: добавьте сайт на главный экран телефона (Поделиться → «На экран Домой») — вход сохранится как в приложении.</div>
          <button type="button" class="link gate-video" onclick="KAL_showVideo()">▶ Как пользоваться сайтом — видео</button>
        </form>`;
      document.body.appendChild(g);
      g.querySelector('form').onsubmit = async e => {
        e.preventDefault();
        const btn = g.querySelector('button'); btn.disabled = true; btn.textContent = 'Вхожу…';
        const login = $('#lgLogin').value.trim().toLowerCase();
        const { error } = await sb.auth.signInWithPassword({ email: `${login}@${LOGIN_DOMAIN}`, password: $('#lgPass').value });
        btn.disabled = false; btn.textContent = 'Войти';
        if (error) { $('#lgErr').textContent = 'Неверный логин или пароль'; return; }
        boot();
      };
    }
    if (err) $('#lgErr').textContent = err;
  }

  // видеоинструкция на языке сайта (если нужного языка нет — русская)
  function showVideo() {
    const lang = I18N.lang, d = document.createElement('div');
    d.className = 'vid-dlg';
    d.innerHTML = `<div class="vid-box"><button class="vid-x" aria-label="Закрыть">✕</button>
      <video controls autoplay playsinline preload="metadata" poster="media/lesson_poster.jpg">
        <source src="media/lesson_${lang}.mp4" type="video/mp4"><source src="media/lesson_ru.mp4" type="video/mp4"></video></div>`;
    const close = () => { d.querySelector('video').pause(); d.remove(); document.removeEventListener('keydown', esc); };
    const esc = e => { if (e.key === 'Escape') close(); };
    d.onclick = e => { if (e.target === d || e.target.closest('.vid-x')) close(); };
    document.addEventListener('keydown', esc);
    document.body.appendChild(d);
  }
  window.KAL_showVideo = showVideo;

  async function logout() { await sb.auth.signOut(); location.reload(); }

  // ------------------------------------------------------------ загрузка
  async function selectAll(table, cols, apply) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      let q = sb.from(table).select(cols).range(from, from + 999);
      if (apply) q = apply(q);
      const { data, error } = await q;
      if (error) throw error;
      out.push(...data);
      if (data.length < 1000) return out;
    }
  }

  async function loadMyBids() {
    const { data } = await sb.from('my_bids').select('*').eq('partner_id', ME.id).order('updated_at', { ascending: false });
    MY = Object.fromEntries((data || []).map(b => [b.lot_id, b]));
    return data || [];
  }

  // ------------------------------------------------------------ избранное в аккаунте
  async function loadFavs() {
    const { data } = await sb.from('favorites').select('*').eq('partner_id', ME.id);
    const favs = Object.fromEntries((data || []).map(f => [f.lot_id, { added: ts(f.created_at), note: f.note || '', snap: f.lot_snapshot || {} }]));
    // перенос избранного, сохранённого раньше в браузере
    try {
      const local = JSON.parse(localStorage.getItem('wish') || '{}');
      const rows = Object.entries(local).filter(([id]) => !favs[id])
        .map(([id, w]) => ({ partner_id: ME.id, lot_id: id, note: w.note || null, lot_snapshot: w.snap || null }));
      if (rows.length) { await sb.from('favorites').upsert(rows); rows.forEach(r => favs[r.lot_id] = local[r.lot_id]); }
      localStorage.removeItem('wish');
    } catch {}
    return favs;
  }
  async function favToggle(id, entry) {
    if (entry) await sb.from('favorites').upsert({ partner_id: ME.id, lot_id: id, note: entry.note || null, lot_snapshot: entry.snap || null });
    else await sb.from('favorites').delete().eq('partner_id', ME.id).eq('lot_id', id);
  }
  async function favNote(id, note) { await sb.from('favorites').update({ note }).eq('partner_id', ME.id).eq('lot_id', id); }

  // ------------------------------------------------------------ сохранённые поиски
  const SEARCH_KEYS = ['tab', 'q', 'src', 'make', 'model', 'yFrom', 'yTo', 'pFrom', 'pTo', 'km', 'fuel', 'tm', 'sheet', 'noRepl', 'origin', 'makes', 'models'];
  async function saveSearch(state, ids, desc) {
    const name = prompt('Название поиска (о новых лотах сообщим в Telegram):', desc);
    if (!name) return;
    const filters = Object.fromEntries(SEARCH_KEYS.map(k => [k, state[k]]));
    const { error } = await sb.from('saved_searches').insert({ partner_id: ME.id, name, filters, seen_ids: ids });
    if (error) return alert('Не удалось сохранить: ' + error.message);
    toast(ME.telegram_chat_id ? `Поиск «${name}» сохранён — о новых лотах сообщим в Telegram`
      : `Поиск «${name}» сохранён. Подключите Telegram в «Мои ставки», чтобы получать уведомления`);
  }
  function toast(text) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = text;
    document.body.appendChild(t); setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 4500);
  }

  // ------------------------------------------------------------ статистика продаж
  async function salesPanel(el, lot) {
    if (!el || !lot) return;
    const key = lot.modelKey, y = lot.year;
    const [byModel, byVin] = await Promise.all([
      key ? sb.from('sales').select('*').eq('model_key', key).gte('year', (y || 0) - 1).lte('year', (y || 9999) + 1).order('sold_at', { ascending: false }).limit(40) : { data: [] },
      lot.vin && lot.vin.length >= 11 ? sb.from('sales').select('*').ilike('vin', lot.vin.slice(0, 11) + '%').limit(5) : { data: [] },
    ]);
    const list = (byModel.data || []).filter(x => x.price_usd);
    const vin = byVin.data || [];
    if (!list.length && !vin.length) {
      el.innerHTML = `<h3>Цены продаж</h3><p class="hint">По этой модели${y ? ` (${y - 1}–${y + 1})` : ''} продаж пока не накопилось — статистика собирается с каждых торгов.</p>`;
      return;
    }
    const prices = list.map(x => x.price_usd).sort((a, b) => a - b);
    const med = prices.length ? prices[Math.floor(prices.length / 2)] : null;
    el.innerHTML = `<h3>Цены продаж</h3>` +
      (vin.length ? `<div class="vin-hist">⚠️ Этот автомобиль уже продавался: ${vin.map(v => `${v.sold_at ? new Date(v.sold_at).toLocaleDateString('ru-RU') : ''} за <b>${usd(v.price_usd)}</b>`).join(', ')}</div>` : '') +
      (list.length ? `<div class="stats sales-stats">
          <div><b>${usd(med)}</b><span>медиана · ${list.length} продаж</span></div>
          <div><b>${usd(prices[0])} – ${usd(prices[prices.length - 1])}</b><span>разброс</span></div></div>
        <table class="adm-bids"><tr><th>Дата</th><th>Год</th><th>Пробег</th><th>Оценка</th><th>Цена</th></tr>
          ${list.slice(0, 8).map(x => `<tr><td>${x.sold_at ? new Date(x.sold_at).toLocaleDateString('ru-RU') : '—'}</td><td>${x.year || '—'}</td>
            <td>${x.mileage ? Math.round(x.mileage).toLocaleString('ru-RU') + ' км' : '—'}</td><td>${esc(x.grade || '—')}</td><td><b>${usd(x.price_usd)}</b></td></tr>`).join('')}
        </table><p class="hint">Похожие: ${esc(titleOf(lot))}${y ? `, ${y - 1}–${y + 1} г.` : ''} · цены торгов Autohub и итоги наших сделок</p>` : '');
  }

  // ------------------------------------------------------------ Telegram и поиски в кабинете
  async function telegramCard() {
    const { data: me } = await sb.from('profiles').select('telegram_chat_id, tg_username, notify').eq('id', ME.id).single();
    Object.assign(ME, me || {});
    const n = ME.notify || {};
    const on = !!ME.telegram_chat_id;
    return `<div class="panel tg-panel">
      <div class="panel-h"><b>Уведомления в Telegram</b>
        ${on ? `<span class="pill won">подключено${ME.tg_username ? ' · @' + esc(ME.tg_username) : ''}</span>` : '<span class="pill wait">не подключено</span>'}</div>
      ${on ? `<div class="toggles">
          ${[['bid', 'ставка принята'], ['reminder', 'за час до торгов'], ['result', 'итог торгов'], ['searches', 'новые лоты по поискам']]
            .map(([k, t]) => `<label class="check"><input type="checkbox" data-notify="${k}" ${n[k] !== false ? 'checked' : ''}> ${t}</label>`).join('')}
        </div><button class="link" id="tgUnlink">отключить Telegram</button>`
        : `<p class="hint">Личные уведомления: ставка принята, напоминание за час до торгов, результат, новые лоты по сохранённым поискам.</p>
           <button class="btn primary" id="tgLink">Подключить Telegram</button>`}
    </div>`;
  }
  async function searchesCard() {
    const { data } = await sb.from('saved_searches').select('*').eq('partner_id', ME.id).order('created_at', { ascending: false });
    const list = data || [];
    return `<div class="panel"><div class="panel-h"><b>Сохранённые поиски</b><span class="hint">${list.length}</span></div>
      ${list.length ? list.map(s => `<div class="ss-row">
          <button class="link ss-open" data-ssid="${s.id}">${esc(s.name)}</button>
          <label class="check"><input type="checkbox" data-ssn="${s.id}" ${s.notify ? 'checked' : ''}> уведомлять</label>
          <button class="link danger" data-ssdel="${s.id}">удалить</button></div>`).join('')
        : '<p class="hint">Настройте фильтры в каталоге и нажмите «☆ Сохранить поиск» — о новых подходящих лотах придёт сообщение.</p>'}
    </div>`;
  }
  let SS = {};
  async function wireCabinet(box, count) {
    const { data } = await sb.from('saved_searches').select('id, filters').eq('partner_id', ME.id);
    SS = Object.fromEntries((data || []).map(s => [s.id, s.filters]));
    box.querySelector('#tgLink')?.addEventListener('click', async e => {
      e.stopPropagation();
      const { data: code, error } = await sb.rpc('new_tg_link_code');
      if (error) return alert(error.message);
      window.open(`https://t.me/${CFG.botUsername || 'korealotsbot'}?start=${code}`, '_blank');
      toast('Нажмите «Старт» в Telegram и вернитесь сюда');
      setTimeout(() => renderBids(box, count), 15000);
    });
    box.querySelector('#tgUnlink')?.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('Отключить уведомления в Telegram?')) return;
      await sb.rpc('unlink_telegram'); renderBids(box, count);
    });
    box.querySelectorAll('[data-notify]').forEach(cb => cb.onchange = async () => {
      const n = { bid: true, reminder: true, result: true, searches: true, ...(ME.notify || {}) }; n[cb.dataset.notify] = cb.checked;
      await sb.rpc('set_my_notify', { n }); ME.notify = n;
    });
    box.querySelectorAll('[data-ssn]').forEach(cb => cb.onchange = () => sb.from('saved_searches').update({ notify: cb.checked }).eq('id', cb.dataset.ssn));
    box.querySelectorAll('[data-ssdel]').forEach(b => b.onclick = async e => {
      e.stopPropagation(); if (!confirm('Удалить поиск?')) return;
      await sb.from('saved_searches').delete().eq('id', b.dataset.ssdel); renderBids(box, count);
    });
    box.querySelectorAll('.ss-open').forEach(b => b.onclick = e => { e.stopPropagation(); const f = SS[b.dataset.ssid] || {}; CAT.applyState({ ...f, tab: f.tab || 'whole' }); });
  }

  async function boot() {
    const { data: s } = await sb.auth.getSession();
    if (!s.session) return loginScreen();
    const { data: prof } = await sb.from('profiles').select('*').eq('id', s.session.user.id).single();
    if (!prof || !prof.is_active) { await sb.auth.signOut(); return loginScreen('Аккаунт отключён — обратитесь к администратору'); }
    ME = prof;
    $('#login')?.remove();
    document.body.classList.remove('locked');
    $('#grid').innerHTML = '<div class="skeleton sk-card"></div>'.repeat(8);
    const [meta, cards] = await Promise.all([
      sb.from('meta').select('key,value'),
      selectAll('lots', 'card', q => q.eq('is_live', true)),
      loadMyBids(),
    ]);
    const M = Object.fromEntries((meta.data || []).map(r => [r.key, r.value]));
    P.favs = await loadFavs();
    RATE = M.rate?.usd || RATE; RATE_INFO = M.rate || null; FX = M.fx || null;
    I18N.addMap(M.i18n_terms);                 // термины из данных лотов (EN/AR)
    if ((ME.lang || 'ru') !== I18N.lang) sb.rpc('set_my_lang', { l: I18N.lang }).then(() => {}, () => {});   // язык сообщений бота
    setupHeader();
    CAT = window.startCatalog({ lots: cards.map(r => r.card), sources: M.sources || {}, rate: M.rate || { usd: RATE }, minYear: M.minYear }, P);
    setInterval(tick, 1000);
    const seen = () => { if (document.visibilityState === 'visible') sb.rpc('touch_seen').then(() => {}, () => {}); };
    seen(); setInterval(seen, 5 * 60 * 1000); document.addEventListener('visibilitychange', seen);
  }

  function setupHeader() {
    const tabs = $('#tabs');
    if (!tabs.querySelector('[data-tab=bids]'))
      tabs.insertAdjacentHTML('beforeend', `<button data-tab="bids" class="in-cab">Мои ставки <span></span></button>` +
        (STAFF() ? `<button data-tab="admin">Админ</button>` : ''));
    // личный кабинет — кнопка с инициалами справа вверху
    const initials = String(ME.display_name || ME.login || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    if (!$('#who')) $('#themeBtn').insertAdjacentHTML('afterend', `<div id="who">
      <button class="me-btn" id="meBtn" aria-haspopup="true" aria-expanded="false" title="Личный кабинет">
        <span class="me-av">${esc(initials)}</span><span class="me-name">${esc(ME.display_name)}</span><span class="me-caret">▾</span></button>
      <div class="me-menu" id="meMenu" hidden>
        <div class="me-head"><b>${esc(ME.display_name)}</b><span>${ROLE_RU[ME.role] || 'партнёр'} · ${esc(ME.login || '')}</span></div>
        <button data-go="bids">👤 Личный кабинет</button>
        <button data-go="wish">♥ Избранное</button>
        ${STAFF() ? '<button data-go="admin">⚙️ Админ-панель</button>' : ''}
        <button data-video>▶ Видеоинструкция</button>
        <hr><button id="btnLogout" class="me-out">Выйти</button>
      </div></div>`);
    const menu = $('#meMenu'), btn = $('#meBtn');
    const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); };
    document.addEventListener('click', e => { if (!menu.hidden && !e.target.closest('#who')) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    menu.querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
      close(); $(`#tabs [data-tab="${b.dataset.go}"]`)?.click(); window.scrollTo(0, 0);
    });
    menu.querySelector('[data-video]').onclick = () => { close(); showVideo(); };
    $('#btnLogout').onclick = logout;
  }

  // ------------------------------------------------------------ таймеры
  function left(ms) {
    if (ms <= 0) return 'торги прошли';
    const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4), s = Math.floor(ms % 6e4 / 1e3);
    return (d ? `${d} д ` : '') + `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  function tick() {
    document.querySelectorAll('[data-ends]').forEach(el => {
      const ms = +el.dataset.ends - Date.now();
      el.textContent = left(ms);
      el.classList.toggle('soon', ms > 0 && ms < 3 * 36e5);
      el.classList.toggle('over', ms <= 0);
    });
  }
  const timer = endsAt => endsAt ? `<span class="timer" data-ends="${ts(endsAt)}">${left(ts(endsAt) - Date.now())}</span>` : '<span class="timer">—</span>';

  // ------------------------------------------------------------ ставка в карточке лота
  function bidPanel(el, lot) {
    if (!el) return;
    const mine = MY[lot.id];
    const endMs = ts(lot.endsAt);
    const closed = endMs && !lot.negotiable && endMs - Date.now() < LOCK_MIN * 6e4;
    const startUsd = lot.priceKRW ? Math.round(lot.priceKRW / RATE) : null;
    const suggest = mine ? mine.amount_usd + STEP : (startUsd || '');
    let h = `<div class="bid-box">`;
    if (mine) {
      const res = mine.outcome === 'won' ? `<b class="g-good">🏆 Вы выиграли за ${usd(mine.result_price_usd)}</b>`
        : mine.outcome === 'lost' ? `<b class="g-bad">Лот ушёл за ${usd(mine.result_price_usd)}</b>` : '';
      h += `<div class="bid-mine">Ваша ставка: <b>${usd(mine.amount_usd)}</b> <span class="hint">от ${dateStr(mine.updated_at)}</span>${res ? '<br>' + res : ''}${fxLine(mine.amount_usd)}</div>`;
    }
    if (endMs) h += `<div class="bid-timer">${lot.source === 'heydealer' ? 'До окончания торгов' : 'До торгов'}: ${timer(lot.endsAt)} <span class="hint">· ${dateStr(lot.endsAt)} KST</span></div>`;
    if (mine?.outcome && mine.outcome !== 'pending') {
      h += '</div>';
    } else if (closed) {
      h += `<p class="hint">Приём ставок закрыт (меньше ${LOCK_MIN} мин до торгов).</p></div>`;
    } else {
      h += `<form class="bid-form">
          <label>${mine ? 'Повысить ставку' : 'Ваша ставка'}, $</label>
          <div class="bid-row"><input type="number" id="bidAmt" min="100" step="${STEP}" value="${suggest}" placeholder="сумма в $" required>
            <button class="btn primary" type="submit">${mine ? '⬆ Повысить' : 'Поставить'}</button></div>
          <div id="bidFx"></div>
          <input id="bidNote" placeholder="комментарий для менеджера (необязательно)" value="${esc(mine?.comment || '')}">
          <div class="bid-msg" id="bidMsg"></div>
          ${mine ? `<p class="hint">Шаг повышения — ${usd(STEP)}.</p>` : ''}
        </form></div>`;
    }
    el.innerHTML = h;
    tick();
    const f = el.querySelector('.bid-form');
    if (!f) return;
    const fx = () => { $('#bidFx').innerHTML = fxLine(+$('#bidAmt').value); };
    $('#bidAmt').addEventListener('input', fx); fx();
    f.onsubmit = async e => {
      e.preventDefault();
      const amount = Math.round(+$('#bidAmt').value);
      if (!amount) return;
      if (!confirm(`${mine ? 'Повысить ставку' : 'Поставить ставку'} на ${titleOf(lot)} (лот ${lot.lotNo || '—'})?\n\nСумма: ${usd(amount)}${mine ? `\nБыло: ${usd(mine.amount_usd)}` : ''}`)) return;
      const btn = f.querySelector('button'); btn.disabled = true;
      $('#bidMsg').textContent = 'Отправляю…'; $('#bidMsg').className = 'bid-msg';
      const { data, error } = await sb.functions.invoke('place-bid', { body: { lot_id: lot.id, amount_usd: amount, comment: $('#bidNote').value || null } });
      btn.disabled = false;
      const errText = data?.error || (error && (await error.context?.json?.().catch(() => null))?.error) || error?.message;
      if (errText) { $('#bidMsg').textContent = errText; $('#bidMsg').className = 'bid-msg err'; return; }
      await loadMyBids();
      bidPanel(el, lot);
      el.querySelector('.bid-box').insertAdjacentHTML('afterbegin', `<div class="bid-msg ok">✓ Ставка ${usd(amount)} принята${data?.telegram ? ' и отправлена менеджеру' : ''}</div>`);
      CAT?.updateCounts();
    };
  }

  // ------------------------------------------------------------ личный кабинет
  async function renderBids(box, count) {
    box.innerHTML = '<div class="empty">Загружаю ваши ставки…</div>';
    const bids = await loadMyBids();
    const ids = bids.map(b => b.id);
    const { data: ev } = ids.length ? await sb.from('bid_events').select('*').in('bid_id', ids).order('created_at') : { data: [] };
    const hist = {};
    (ev || []).forEach(e => (hist[e.bid_id] = hist[e.bid_id] || []).push(e));
    const now = Date.now();
    const group = b => b.outcome === 'won' ? 'won' : b.outcome === 'lost' ? 'lost' : (ts(b.ends_at) && ts(b.ends_at) < now ? 'wait' : 'active');
    const G = { active: [], wait: [], won: [], lost: [] };
    bids.forEach(b => G[group(b)].push(b));
    G.active.sort((a, b) => (ts(a.ends_at) || 9e15) - (ts(b.ends_at) || 9e15));
    const wonSum = G.won.reduce((s, b) => s + (b.result_price_usd || 0), 0);
    count.textContent = `Мои ставки: ${bids.length}`;
    const row = b => {
      const l = b.lot_snapshot || {};
      const steps = (hist[b.id] || []).map(e => usd(e.amount_usd)).join(' → ');
      const out = b.outcome === 'won' ? `<span class="pill won">🏆 выиграл за ${usd(b.result_price_usd)}</span>`
        : b.outcome === 'lost' ? `<span class="pill lost">проиграл · ушёл за ${usd(b.result_price_usd)}</span>`
        : group(b) === 'wait' ? '<span class="pill wait">торги прошли · ждём итог</span>' : timer(b.ends_at);
      return `<div class="bid-item" data-lot="${esc(b.lot_id)}">
        <img src="${esc((l.photos || [])[0] || '')}" referrerpolicy="no-referrer" alt="" onerror="this.style.visibility='hidden'">
        <div class="bi-main"><div class="title">${esc(titleOf(l))} ${esc(l.year || '')}</div>
          <div class="hint">${esc(SRC[l.source] || l.source || '')} · лот ${esc(l.lotNo || '—')} · VIN ${esc(l.vin || '—')}</div>
          <div class="hint">История: ${steps || usd(b.amount_usd)}${b.comment ? ' · ' + esc(b.comment) : ''}</div></div>
        <div class="bi-side"><div class="bi-amt">${usd(b.amount_usd)}</div>${out}<div class="hint">торги ${dateStr(b.ends_at)}</div></div>
      </div>`;
    };
    const sec = (t, arr, empty) => `<h3 class="sec">${t} <span>${arr.length}</span></h3>` + (arr.length ? arr.map(row).join('') : `<p class="hint">${empty}</p>`);
    const [tgHtml, ssHtml] = await Promise.all([telegramCard(), searchesCard()]);
    box.innerHTML = `<div class="panels">${tgHtml}${ssHtml}</div><div class="stats">
        <div><b>${G.active.length}</b><span>активных</span></div><div><b>${G.wait.length}</b><span>ждут итога</span></div>
        <div><b>${G.won.length}</b><span>выиграно</span></div><div><b>${usd(wonSum)}</b><span>сумма выигрышей</span></div></div>` +
      sec('Активные ставки', G.active, 'Нет активных ставок — откройте лот и нажмите «Поставить».') +
      (G.wait.length ? sec('Торги прошли — ждём итог', G.wait, '') : '') +
      sec('Выигранные', G.won, 'Пока нет.') + sec('Проигранные', G.lost, 'Пока нет.');
    box.onclick = e => { const it = e.target.closest('.bid-item'); if (it) openFromBid(it.dataset.lot, bids.find(b => b.lot_id === it.dataset.lot)?.lot_snapshot); };
    wireCabinet(box, count);
    tick();
  }

  function openFromBid(lotId, snap) {
    CAT.openLot(lotId, snap ? { ...snap, usd: snap.category === 'damaged' ? null : (snap.priceKRW ? Math.round(snap.priceKRW / RATE) : null) } : null);
  }

  // ------------------------------------------------------------ админка
  let ADM_TAB = 'bids', ADM_FILTER = 'open';
  async function adminCall(body) {
    const { data, error } = await sb.functions.invoke('admin', { body });
    const err = data?.error || (error && (await error.context?.json?.().catch(() => null))?.error) || error?.message;
    if (err) throw new Error(err);
    return data;
  }

  async function renderAdmin(box, count) {
    count.textContent = 'Администрирование';
    const ri = RATE_INFO || { usd: RATE };
    const n = v => Number(v).toLocaleString('ru-RU');
    box.innerHTML = `<div class="adm-rate"><span>Курс доллара</span><b>$1 = ₩${n(ri.usd)}</b></div>
      <div class="adm-tabs">
        <button data-adm="bids" class="${ADM_TAB === 'bids' ? 'on' : ''}">Ставки по лотам</button>
        <button data-adm="partners" class="${ADM_TAB === 'partners' ? 'on' : ''}">Партнёры</button>
        <button data-adm="results" class="${ADM_TAB === 'results' ? 'on' : ''}">Итоги</button></div><div id="admBody"><div class="empty">Загружаю…</div></div>`;
    box.querySelector('.adm-tabs').onclick = e => { const b = e.target.closest('[data-adm]'); if (b) { ADM_TAB = b.dataset.adm; renderAdmin(box, count); } };
    const body = $('#admBody');
    try {
      if (ADM_TAB === 'partners') await admPartners(body);
      else if (ADM_TAB === 'results') await admResults(body);
      else await admBids(body);
    } catch (e) { body.innerHTML = `<div class="empty">Ошибка: ${esc(e.message)}</div>`; }
    tick();
  }

  async function admBids(body) {
    const [{ data: bids }, { data: profs }, { data: res }] = await Promise.all([
      sb.from('bids').select('*').order('updated_at', { ascending: false }),
      sb.from('profiles').select('id,display_name,login,manager_id,role'),
      sb.from('results').select('*'),
    ]);
    const P_ = Object.fromEntries((profs || []).map(p => [p.id, p]));
    const R = Object.fromEntries((res || []).map(r => [r.lot_id, r]));
    const lots = {};
    (bids || []).forEach(b => (lots[b.lot_id] = lots[b.lot_id] || { id: b.lot_id, snap: b.lot_snapshot, ends: b.ends_at, bids: [] }).bids.push(b));
    let list = Object.values(lots);
    if (ADM_FILTER === 'open') list = list.filter(x => !R[x.id]);
    list.sort((a, b) => (ts(a.ends) || 9e15) - (ts(b.ends) || 9e15));
    const lotCard = x => {
      const s = x.snap || {}, r = R[x.id];
      const sorted = x.bids.sort((a, b) => b.amount_usd - a.amount_usd);
      const opts = sorted.map(b => `<option value="${b.partner_id}" data-amt="${b.amount_usd}">${esc(P_[b.partner_id]?.display_name || '?')} — ${usd(b.amount_usd)}</option>`).join('');
      return `<div class="adm-lot" data-lot="${esc(x.id)}">
        <div class="adm-head"><img src="${esc((s.photos || [])[0] || '')}" referrerpolicy="no-referrer" alt="">
          <div><div class="title">${esc(titleOf(s))} ${esc(s.year || '')}</div>
            <div class="hint">${esc(SRC[s.source] || s.source || '')} · лот <b>${esc(s.lotNo || '—')}</b> · VIN ${esc(s.vin || '—')}</div>
            <div class="hint">Торги ${dateStr(x.ends)} KST · ${timer(x.ends)}</div></div>
          <button class="btn" data-open="${esc(x.id)}">Лот</button></div>
        <table class="adm-bids"><tr><th>Партнёр</th><th>Ставка</th><th>Обновлена</th><th>Комментарий</th></tr>
          ${sorted.map((b, i) => `<tr class="${i === 0 ? 'lead' : ''}"><td>${esc(P_[b.partner_id]?.display_name || '?')}${OWNER() && P_[P_[b.partner_id]?.manager_id]?.role === 'manager' ? `<br><span class="hint">менеджер: ${esc(P_[P_[b.partner_id].manager_id].display_name)}</span>` : ''}</td><td><b>${usd(b.amount_usd)}</b></td>
            <td>${dateStr(b.updated_at)}</td><td>${esc(b.comment || '')}</td></tr>`).join('')}
        </table>
        ${r ? `<div class="adm-res">Итог: <b>${esc(r.winner_partner_id ? (P_[r.winner_partner_id]?.display_name || 'партнёр') : (r.winner_label || 'сторонний покупатель'))}</b> за <b>${usd(r.price_usd)}</b>
              ${r.note ? ' · ' + esc(r.note) : ''} <button class="link" data-clear="${esc(x.id)}">изменить</button></div>`
          : `<form class="adm-form" data-lot="${esc(x.id)}">
              <select name="winner">${opts}<option value="">Сторонний покупатель</option></select>
              <input name="label" placeholder="кто (если сторонний)">
              <input name="price" type="number" min="1" placeholder="цена продажи, $" value="${sorted[0]?.amount_usd || ''}" required>
              <input name="note" placeholder="заметка">
              <button class="btn primary">Сохранить итог</button></form>`}
      </div>`;
    };
    body.innerHTML = `<div class="adm-bar">
        <label class="check"><input type="checkbox" id="admOpen" ${ADM_FILTER === 'open' ? 'checked' : ''}> только без итога</label>
        <button class="btn" id="admCsv">Выгрузить ставки (Excel)</button></div>` +
      (list.length ? list.map(lotCard).join('') : '<div class="empty">Ставок пока нет.</div>');
    $('#admOpen').onchange = e => { ADM_FILTER = e.target.checked ? 'open' : 'all'; admBids(body).then(tick); };
    $('#admCsv').onclick = () => csv(list, P_);
    body.onclick = async e => {
      const o = e.target.closest('[data-open]');
      if (o) { const x = lots[o.dataset.open]; return openFromBid(x.id, x.snap); }
      const c = e.target.closest('[data-clear]');
      if (c && confirm('Удалить итог и внести заново?')) { await adminCall({ action: 'clear_result', lot_id: c.dataset.clear }); admBids(body).then(tick); }
    };
    body.querySelectorAll('.adm-form').forEach(f => {
      f.winner.onchange = () => { const amt = f.winner.selectedOptions[0]?.dataset.amt; if (amt) f.price.value = amt; };
      f.onsubmit = async e => {
        e.preventDefault();
        const btn = f.querySelector('button'); btn.disabled = true;
        try {
          await adminCall({ action: 'set_result', lot_id: f.dataset.lot, winner_partner_id: f.winner.value || null,
                            winner_label: f.label.value || null, price_usd: +f.price.value, note: f.note.value || null });
          admBids(body).then(tick);
        } catch (err) { alert(err.message); btn.disabled = false; }
      };
    });
  }

  function csv(list, P_) {
    const rows = [['Лот', 'Аукцион', 'Авто', 'Год', 'VIN', 'Торги (KST)', 'Партнёр', 'Ставка $', 'Комментарий']];
    list.forEach(x => x.bids.forEach(b => {
      const s = x.snap || {};
      rows.push([s.lotNo, SRC[s.source] || s.source, titleOf(s), s.year, s.vin, dateStr(x.ends), P_[b.partner_id]?.display_name, b.amount_usd, b.comment || '']);
    }));
    const text = '\ufeff' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = `ставки_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  let PF = '';                                 // фильтр владельца: партнёры какого менеджера показывать
  async function admPartners(body) {
    const { partners: all } = await adminCall({ action: 'list_partners' });
    const owner = OWNER();
    const managers = owner ? all.filter(p => p.role === 'manager' || p.role === 'admin') : [];
    const mName = id => { const m = all.find(x => x.id === id); return m ? (m.role === 'admin' ? 'я (владелец)' : m.display_name) : '—'; };
    const partners = all.filter(p => p.role === 'partner' && (!PF || p.manager_id === PF));
    const cnt = id => all.filter(p => p.role === 'partner' && p.manager_id === id).length;
    const mOpts = sel => managers.map(m => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc(m.role === 'admin' ? 'Я (владелец)' : m.display_name)}</option>`).join('');
    const row = p => `<tr data-id="${p.id}"><td>${esc(p.display_name)}${p.phone ? `<br><a class="hint" href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : ''}</td><td>${esc(p.login)}</td>
          ${owner ? `<td>${p.role === 'partner' ? esc(mName(p.manager_id)) : `<span class="hint">${ROLE_RU[p.role]}</span>`}</td>` : ''}
          <td>${pair(p.commission_pct, p.commission_pct_dmg, v => +v + '%')}</td><td>${pair(p.service_usd, p.service_usd_dmg, usd)}</td><td>${pair(p.freight_usd, p.freight_usd_dmg, usd)}</td>
          <td>${p.max_active_usd ? usd(p.max_active_usd) : '—'}</td><td>${seenAgo(p.last_seen_at)}${p.visits ? `<br><span class="hint">визитов: ${p.visits}</span>` : ''}</td><td>${p.is_active ? '<span class="g-good">активен</span>' : '<span class="g-bad">отключён</span>'}</td>
          <td><button class="link" data-act="terms">условия</button> · <button class="link" data-act="name">имя</button> · <button class="link" data-act="phone">телефон</button> · <button class="link" data-act="pass">пароль</button> · <button class="link" data-act="limit">лимит</button>
            ${p.role === 'partner' ? ` · <button class="link" data-act="market" title="Сравнение с рынком, Excel-статистика торгов и ссылки «Похожие на Dubizzle / Autowini»">${p.market_access ? '📊 рынок: вкл' : 'рынок: выкл'}</button>` : ''}
            ${p.id !== ME.id ? ` · <button class="link" data-act="toggle">${p.is_active ? 'отключить' : 'включить'}</button>` : ''}
            ${owner ? ` · <button class="link" data-act="move">передать</button> · <button class="link danger" data-act="del">удалить</button>` : ''}</td></tr>`;
    body.innerHTML = `<form class="adm-new" id="pNew">
        <h3>${owner ? 'Новый партнёр или менеджер' : 'Новый партнёр'}</h3>
        ${owner ? `<select name="role" id="pRole"><option value="partner">Партнёр</option><option value="manager">Менеджер</option></select>` : ''}
        <input name="display_name" placeholder="Имя для Telegram, напр. «Алексей (Бишкек)»" required>
        <input name="login" placeholder="логин (латиница)" required autocapitalize="none">
        <input name="password" placeholder="пароль (от 8 символов)" required minlength="8">
        <input name="phone" type="tel" placeholder="телефон партнёра, напр. +971 50 123 4567">
        ${owner ? `<label class="hint" id="pMgrWrap">Менеджер партнёра<select name="manager_id">${mOpts(ME.id)}</select></label>` : ''}
        <input name="max_active_usd" type="number" placeholder="лимит активных ставок, $ (необязательно)">
        <div class="terms-cols" id="pTerms">${termsFields({})}</div>
        <button class="btn primary">Создать</button><div class="bid-msg" id="pMsg"></div></form>
      ${owner ? `<div class="adm-mgrs"><h3>Менеджеры</h3>
        <table class="adm-bids mgrs"><tr><th>Менеджер</th><th>Логин</th><th>Партнёров</th><th>Telegram</th><th>Был на сайте</th><th>Статус</th><th></th></tr>
          ${managers.map(m => `<tr data-id="${m.id}"><td>${esc(m.role === 'admin' ? m.display_name + ' (вы)' : m.display_name)}</td><td>${esc(m.login)}</td>
            <td><button class="link" data-act="filter">${cnt(m.id)}</button></td><td>${m.telegram_chat_id ? '<span class="g-good">подключён</span>' : '<span class="hint">нет</span>'}</td>
            <td>${seenAgo(m.last_seen_at)}</td><td>${m.is_active ? '<span class="g-good">активен</span>' : '<span class="g-bad">отключён</span>'}</td>
            <td>${m.role === 'manager' ? `<button class="link" data-act="name">имя</button> · <button class="link" data-act="pass">пароль</button> · <button class="link" data-act="moveall">передать всех</button>
              · <button class="link" data-act="toggle">${m.is_active ? 'отключить' : 'включить'}</button> · <button class="link danger" data-act="del">удалить</button>` : ''}</td></tr>`).join('')}
        </table></div>
        <div class="adm-filter"><label class="hint">Показать партнёров:
          <select id="pFilter"><option value="">всех менеджеров</option>${managers.map(m => `<option value="${m.id}" ${m.id === PF ? 'selected' : ''}>${esc(m.role === 'admin' ? 'моих (владелец)' : m.display_name)}</option>`).join('')}</select></label></div>` : ''}
      <table class="adm-bids partners"><tr><th>Имя</th><th>Логин</th>${owner ? '<th>Менеджер</th>' : ''}<th>Комиссия<br><span class="hint">Autohub / битые</span></th><th>Сервис<br><span class="hint">Autohub / битые</span></th><th>Фрахт<br><span class="hint">Autohub / битые</span></th><th>Лимит</th><th>Был на сайте</th><th>Статус</th><th></th></tr>
        ${partners.map(row).join('') || `<tr><td colspan="10" class="hint">Партнёров пока нет</td></tr>`}
      </table>`;
    const f0 = $('#pNew');
    const syncRole = () => { const m = f0.role?.value === 'manager'; $('#pMgrWrap')?.toggleAttribute('hidden', m); $('#pTerms').hidden = m; };
    f0.role?.addEventListener('change', syncRole);
    $('#pFilter')?.addEventListener('change', e => { PF = e.target.value; admPartners(body); });
    f0.onsubmit = async e => {
      e.preventDefault();
      const f = e.target;
      try {
        await adminCall({ action: 'create_partner', display_name: f.display_name.value, login: f.login.value, password: f.password.value,
                          role: f.role?.value || 'partner', manager_id: f.manager_id?.value || null, max_active_usd: +f.max_active_usd.value || null,
                          phone: f.phone.value.trim(),
                          ...readTerms(f) });
        PARTNERS = null;
        admPartners(body);
      } catch (err) { $('#pMsg').textContent = err.message; $('#pMsg').className = 'bid-msg err'; }
    };
    const act = async e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const id = b.closest('tr').dataset.id, p = all.find(x => x.id === id);
      try {
        if (b.dataset.act === 'filter') { PF = id; return admPartners(body); }
        if (b.dataset.act === 'terms') {
          const t = await termsDialog(p); if (!t) return;
          await adminCall({ action: 'update_partner', id, ...t });
          PARTNERS = null;
        }
        if (b.dataset.act === 'name') { const v = prompt('Имя для Telegram', p.display_name); if (v) await adminCall({ action: 'update_partner', id, display_name: v }); }
        if (b.dataset.act === 'phone') { const v = prompt('Телефон партнёра (пусто — удалить)', p.phone || ''); if (v !== null) await adminCall({ action: 'update_partner', id, phone: v.trim() || null }); }
        if (b.dataset.act === 'pass') { const v = prompt('Новый пароль (от 8 символов)'); if (v) await adminCall({ action: 'update_partner', id, password: v }); }
        if (b.dataset.act === 'limit') { const v = prompt('Лимит активных ставок, $ (пусто — без лимита)', p.max_active_usd || ''); if (v !== null) await adminCall({ action: 'update_partner', id, max_active_usd: +v || null }); }
        if (b.dataset.act === 'market' && confirm(`${p.market_access ? 'Закрыть' : 'Открыть'} партнёру «${p.display_name}» сравнение с рынком, статистику торгов (Excel) и ссылки «Похожие на Dubizzle / Autowini»?`))
          await adminCall({ action: 'update_partner', id, market_access: !p.market_access });
        if (b.dataset.act === 'toggle' && confirm(`${p.is_active ? 'Отключить' : 'Включить'} ${p.display_name}?`)) await adminCall({ action: 'update_partner', id, is_active: !p.is_active });
        if (b.dataset.act === 'move') {
          const to = await pickManager(managers.filter(m => m.id !== p.manager_id), `Передать партнёра «${p.display_name}» менеджеру`); if (!to) return;
          await adminCall({ action: 'transfer_partners', ids: [id], manager_id: to });
        }
        if (b.dataset.act === 'moveall') {
          const to = await pickManager(managers.filter(m => m.id !== id), `Передать всех партнёров «${p.display_name}» (${cnt(id)}) менеджеру`); if (!to) return;
          await adminCall({ action: 'transfer_partners', from_manager: id, manager_id: to });
        }
        if (b.dataset.act === 'del') {
          const what = p.role === 'manager' ? `менеджера «${p.display_name}»? Его партнёры (${cnt(id)}) перейдут к вам.` : `партнёра «${p.display_name}»? Его ставки и избранное будут удалены.`;
          if (!confirm(`Удалить ${what} Это нельзя отменить.`)) return;
          await adminCall({ action: 'delete_partner', id });
        }
        PARTNERS = null;
        admPartners(body);
      } catch (err) { alert(err.message); }
    };
    body.querySelector('.partners').onclick = act;
    body.querySelector('.mgrs')?.addEventListener('click', act);
  }

  function pickManager(list, title) {
    return new Promise(resolve => {
      if (!list.length) { alert('Нет других менеджеров — создайте менеджера в форме выше.'); return resolve(null); }
      const d = document.createElement('div');
      d.className = 'terms-dlg';
      d.innerHTML = `<form class="terms-box"><h3>${esc(title)}</h3>
          <select name="m" style="width:100%;padding:10px;border-radius:8px">${list.map(m => `<option value="${m.id}">${esc(m.role === 'admin' ? 'Я (владелец)' : m.display_name)}</option>`).join('')}</select>
          <div class="terms-btns"><button type="button" class="btn" data-x>Отмена</button><button class="btn primary">Передать</button></div></form>`;
      document.body.appendChild(d);
      const done = v => { d.remove(); resolve(v); };
      d.querySelector('[data-x]').onclick = () => done(null);
      d.onclick = e => { if (e.target === d) done(null); };
      d.querySelector('form').onsubmit = e => { e.preventDefault(); done(e.target.m.value); };
    });
  }

  // условия партнёра: отдельно для Autohub (целые) и битых
  const pair = (a, b, f) => (+a || +b) ? `${+a ? f(a) : '—'} / ${+b ? f(b) : '—'}` : '—';
  const termsFields = p => [['', 'Autohub (целые)'], ['_dmg', 'Битые']].map(([sfx, title]) => `
      <fieldset class="terms-set"><legend>${title}</legend>
        <label>Комиссия, %<input name="commission_pct${sfx}" type="number" step="0.1" min="0" value="${p['commission_pct' + sfx] ?? ''}" placeholder="0"></label>
        <label>Сервисные расходы, $<input name="service_usd${sfx}" type="number" min="0" value="${p['service_usd' + sfx] ?? ''}" placeholder="0"></label>
        <label>Фрахт, $<input name="freight_usd${sfx}" type="number" min="0" value="${p['freight_usd' + sfx] ?? ''}" placeholder="0"></label>
      </fieldset>`).join('');
  const readTerms = f => Object.fromEntries(['commission_pct', 'service_usd', 'freight_usd', 'commission_pct_dmg', 'service_usd_dmg', 'freight_usd_dmg']
    .map(k => [k, +String(f[k].value).replace(',', '.') || 0]));
  function termsDialog(p) {
    return new Promise(resolve => {
      const d = document.createElement('div');
      d.className = 'terms-dlg';
      d.innerHTML = `<form class="terms-box"><h3>Условия · ${esc(p.display_name)}</h3>
          <div class="terms-cols">${termsFields(p)}</div>
          <div class="terms-btns"><button type="button" class="btn" data-x>Отмена</button><button class="btn primary">Сохранить</button></div></form>`;
      document.body.appendChild(d);
      const done = v => { d.remove(); resolve(v); };
      d.querySelector('[data-x]').onclick = () => done(null);
      d.onclick = e => { if (e.target === d) done(null); };
      d.querySelector('form').onsubmit = e => { e.preventDefault(); done(readTerms(e.target)); };
      d.querySelector('input').focus();
    });
  }

  function seenAgo(t) {
    if (!t) return '<span class="hint">ещё не заходил</span>';
    const m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
    if (m < 6) return '<span class="g-good">● сейчас на сайте</span>';
    const txt = m < 60 ? `${m} мин назад` : m < 1440 ? `${Math.round(m / 60)} ч назад` : new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return txt;
  }

  async function admResults(body) {
    const [{ data: res }, { data: profs }] = await Promise.all([
      sb.from('results').select('*').order('set_at', { ascending: false }),
      sb.from('profiles').select('id,display_name'),
    ]);
    const P_ = Object.fromEntries((profs || []).map(p => [p.id, p.display_name]));
    body.innerHTML = (res || []).length ? `<table class="adm-bids"><tr><th>Дата</th><th>Авто</th><th>Лот</th><th>Победитель</th><th>Цена</th><th>Заметка</th></tr>
      ${res.map(r => { const s = r.lot_snapshot || {}; return `<tr><td>${dateStr(r.set_at)}</td><td>${esc(titleOf(s))} ${esc(s.year || '')}</td><td>${esc(s.lotNo || '—')}</td>
        <td>${esc(r.winner_partner_id ? P_[r.winner_partner_id] : (r.winner_label || 'сторонний'))}</td><td><b>${usd(r.price_usd)}</b></td><td>${esc(r.note || '')}</td></tr>`; }).join('')}</table>`
      : '<div class="empty">Итогов пока нет.</div>';
  }

  // ------------------------------------------------------------ партнёрам — только доллары
  // Аукционы пишут суммы в вонах прямо в описаниях («хранение 300 000 ₩», «출고가격:13,150,000원», «보관료 25만»).
  // Для партнёров все такие суммы пересчитываются в $ по курсу сайта.
  const toUsd = krw => '$' + (krw > 0 ? Math.max(1, Math.round(krw / RATE)) : 0).toLocaleString('ru-RU');
  const numOf = s => +String(s).replace(/[\s, ]/g, '');
  const KRW_RULES = [
    [/(\d[\d\s, ]*(?:\.\d+)?)\s*만\s*원?/g, (m, n) => toUsd(numOf(n) * 10000)],              // 25만 / 25만원
    [/₩\s*(\d[\d\s, ]*\d|\d)/g, (m, n) => toUsd(numOf(n))],                                  // ₩5 000 000
    [/(\d[\d\s, ]*\d|\d)\s*(?:₩|원|KRW|вон)/gi, (m, n) => toUsd(numOf(n))],                  // 300 000 ₩ / 300,000원
  ];
  function hideKrw(root) {
    if (!root) return;                     // суммы в вонах не показываем никому — только $
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walk.nextNode()) if (/₩|원|만|KRW|вон/i.test(walk.currentNode.nodeValue)) nodes.push(walk.currentNode);
    nodes.forEach(n => { let t = n.nodeValue; KRW_RULES.forEach(([re, f]) => { t = t.replace(re, f); }); n.nodeValue = t; });
  }

  // ------------------------------------------------------------ калькуляция под условия партнёра
  let PARTNERS = null;                  // для админа: условия всех партнёров
  const terms = (p, lot) => {
    const s = lot?.category === 'damaged' ? '_dmg' : '';
    return { pct: +(p?.['commission_pct' + s] || 0), service: +(p?.['service_usd' + s] || 0), freight: +(p?.['freight_usd' + s] || 0) };
  };
  const HD_FEE_USD = 400;               // комиссия HeyDealer и комиссия дилера-оформителя (каждая), $
  async function calcPanel(el, lot) {
    if (!el) return;
    const isAdm = STAFF();
    if (isAdm && !PARTNERS) PARTNERS = (await adminCall({ action: 'list_partners' }).catch(() => ({ partners: [] }))).partners.filter(p => p.role === 'partner');
    const startUsd = lot.category !== 'damaged' && lot.priceKRW ? Math.round(lot.priceKRW / RATE) : null;
    const base = MY[lot.id]?.amount_usd || startUsd || '';
    el.innerHTML = `<div class="calc">
        <div class="calc-h"><b>Калькуляция</b>${isAdm ? `<select id="calcWho">${(PARTNERS || []).map(p => `<option value="${p.id}">${esc(p.display_name)}</option>`).join('')}</select>` : `<span class="hint">по вашим условиям · ${lot.category === 'damaged' ? 'битые' : 'целые'}</span>`}</div>
        <label class="calc-row"><span>Цена автомобиля</span><span class="calc-in">$<input type="number" id="calcPrice" min="0" step="50" value="${base}" placeholder="сумма"></span></label>
        <div class="calc-row"><span>Комиссия <b id="calcPct"></b></span><span id="calcFee"></span></div>
        <div class="calc-row"><span>Сервисные расходы</span><span id="calcSrv"></span></div>
        <div class="calc-row"><span>Фрахт</span><span id="calcFr"></span></div>
        ${lot.source === 'heydealer' ? `<div class="calc-row"><span>Переоформление на компанию дилера (3%)</span><span id="calcHdTax"></span></div>
        <div class="calc-row"><span>Комиссия HeyDealer</span><span id="calcHdFee"></span></div>
        <div class="calc-row"><span>Комиссия дилера, на которого оформляется авто</span><span id="calcHdDlr"></span></div>` : ''}
        <div class="calc-row total"><span>Итого</span><span id="calcTot"></span></div>
        <div id="calcFx"></div>
        <p class="hint" id="calcNote"></p></div>`;
    const upd = () => {
      const who = isAdm ? (PARTNERS || []).find(p => p.id === $('#calcWho')?.value) : ME;
      const t = terms(who, lot), price = +$('#calcPrice').value || 0;
      const fee = Math.round(price * t.pct / 100);
      $('#calcPct').textContent = t.pct ? `${t.pct}%` : '';
      $('#calcFee').textContent = usd(fee); $('#calcSrv').textContent = usd(t.service); $('#calcFr').textContent = usd(t.freight);
      // HeyDealer: 3% переоформление + $400 комиссия HeyDealer + $400 комиссия дилера-оформителя
      const hd = lot.source === 'heydealer' ? { tax: Math.round(price * 0.03), fee: HD_FEE_USD, dlr: HD_FEE_USD } : null;
      if (hd) { $('#calcHdTax').textContent = usd(hd.tax); $('#calcHdFee').textContent = usd(hd.fee); $('#calcHdDlr').textContent = usd(hd.dlr); }
      const total = price + fee + t.service + t.freight + (hd ? hd.tax + hd.fee + hd.dlr : 0);
      $('#calcTot').textContent = price ? usd(total) : '—';
      $('#calcFx').innerHTML = price ? fxLine(total) : '';
      $('#calcNote').textContent = isAdm && !(PARTNERS || []).length ? 'Партнёров пока нет — условия задаются в «Админ → Партнёры».'
        : !t.pct && !t.service && !t.freight ? (isAdm ? 'У этого партнёра условия не заданы (Админ → Партнёры → условия).' : 'Условия ещё не заданы — обратитесь к менеджеру.') : '';
    };
    $('#calcPrice').oninput = upd;
    if ($('#calcWho')) $('#calcWho').onchange = upd;
    // сумма ставки сразу попадает в калькуляцию
    $('#bidAmt')?.addEventListener('input', e => { $('#calcPrice').value = e.target.value; upd(); });
    upd();
  }

  // ------------------------------------------------------------ архив фото
  function zipButtons(el, lot) {
    if (!el || !(lot.photoCount ?? lot.photos?.length)) return;
    el.innerHTML = `<button class="btn" id="zipDl">⬇ Фото архивом</button><button class="btn" id="zipTg">📤 Архив в Telegram</button>`;
    const call = async (btn, sendTg, label) => {
      btn.disabled = true; btn.textContent = 'Собираю архив…';
      try {
        const { data: s } = await sb.auth.getSession();
        const r = await fetch(CFG.url + '/functions/v1/lot-photos', {
          method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.anonKey, Authorization: 'Bearer ' + s.session.access_token },
          body: JSON.stringify({ lot_id: lot.id, send_tg: sendTg }),
        });
        if (!r.ok || sendTg) {
          const j = await r.json().catch(() => ({}));
          if (r.status === 409 && sendTg) {   // Telegram ещё не подключён — предлагаем подключить прямо здесь
            if (confirm('Чтобы получать архивы, подключите Telegram.\n\nОткрыть бота сейчас? Нажмите в нём «Старт», вернитесь сюда и отправьте архив ещё раз.')) {
              const { data: code } = await sb.rpc('new_tg_link_code');
              if (code) window.open(`https://t.me/${CFG.botUsername || 'korealotsbot'}?start=${code}`, '_blank');
            }
            btn.disabled = false; btn.textContent = label; return;
          }
          if (!r.ok || j.error) throw new Error(j.error || 'ошибка ' + r.status);
          toast(`Архив «${j.name}» отправлен в Telegram (${j.photos} фото)`);
        } else {
          const blob = await r.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = decodeURIComponent(r.headers.get('x-filename') || 'photos.zip');
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        }
      } catch (e) { toast('Не получилось: ' + e.message); }
      btn.disabled = false; btn.textContent = label;
    };
    $('#zipDl').onclick = e => call(e.currentTarget, false, '⬇ Фото архивом');
    $('#zipTg').onclick = e => call(e.currentTarget, true, '📤 Архив в Telegram');
  }

  // ------------------------------------------------------------ «Похожие на Dubizzle» (пока только админу)
  // Корейские названия → как модель называется на рынке ОАЭ (адрес поиска dubizzle: /motors/used-cars/<марка>/<модель>/)
  const DZ_MAKE = { kgm: 'ssangyong', 'mercedes-benz': 'mercedes-benz', 'land rover': 'land-rover' };
  const DZ_MODEL = {
    'hyundai|avante': 'elantra', 'hyundai|grandeur': 'azera', 'hyundai|santa fe': 'santa-fe', 'hyundai|lf': 'sonata',
    'kia|morning': 'picanto', 'kia|k7': 'cadenza', 'kia|k3': 'cerato', 'kia|k9': 'k900',
    'renault|qm6': 'koleos', 'renault|sm6': 'talisman', 'renault|xm3': 'arkana', 'renault|qm3': 'captur', 'renault|sm5': 'safrane',
  };
  // пробег: ±25% (но не уже ±15 000 км), округление до 5 000 — чтобы в выдаче были сопоставимые машины
  // поколение (кузов) модели: код в скобках «(G60)», «(NQ5)», коды BMW/Mercedes «G30», «W213» и номер поколения «4th Gen», «4세대».
  // Разные поколения в сравнение не попадают; если у одной из машин поколение не указано — сравниваем.
  function genOf(s) {
    s = String(s || '');
    const code = new Set(), num = new Set();
    for (const m of s.matchAll(/\(([A-Z]{1,3}\d{1,3}[A-Z]?)\)/gi)) code.add(m[1].toUpperCase());
    for (const m of s.matchAll(/(?:^|[^A-Za-z0-9])([EFGU]\d{2}|[WVXHC]\d{3})(?![A-Za-z0-9])/g)) if (!/^C\d{3}$/.test(m[1]) || /\(C\d{3}\)/.test(s)) code.add(m[1].toUpperCase());
    for (const m of s.matchAll(/(?:^|[^A-Za-z0-9])(IG|HG|TG|LF|YF|NF|MD|AD|HD|DM|TM|UM|XM|QL|SL|TL|YP|JF|DL3|DN8)(?![A-Za-z0-9])/g)) code.add(m[1]);   // Hyundai/Kia без цифр
    for (const m of s.matchAll(/(\d{1,2})\s*(?:st|nd|rd|th)?[\s-]*gen(?:eration)?\b|(\d{1,2})\s*세대/gi)) num.add(m[1] || m[2]);
    return { code, num };
  }
  const meet = (a, b) => !a.size || !b.size || [...a].some(x => b.has(x));
  const sameGen = (a, b) => { const x = genOf(a), y = genOf(b); return meet(x.code, y.code) && meet(x.num, y.num); };
  const lotGen = l => `${l.model || ''} ${l.grade || ''} ${l.modelKo || ''}`;

  function kmRange(km) {
    if (!(km > 0)) return [0, 0];
    const d = Math.max(km * 0.25, 15000), r = v => Math.round(v / 5000) * 5000;
    return [Math.max(0, r(km - d)), r(km + d)];
  }
  function dubizzleUrl(lot) {
    const key = lot.modelKey || '';
    const [mk, base] = key.split('|');
    const make = DZ_MAKE[mk] || (mk || String(lot.make || '').toLowerCase()).replace(/\s+/g, '-');
    if (!make || make === 'other') return '';
    const model = DZ_MODEL[key] || (base || '').replace(/\s+/g, '-');
    const p = [];
    if (lot.year) p.push(`year__gte=${lot.year - 1}`, `year__lte=${lot.year + 1}`);
    const [kmFrom, kmTo] = kmRange(lot.mileage);
    if (kmTo) p.push(`kilometers__gte=${kmFrom}`, `kilometers__lte=${kmTo}`);
    return `https://uae.dubizzle.com/motors/used-cars/${make}/${model ? model + '/' : ''}${p.length ? '?' + p.join('&') : ''}`;
  }
  // похожие на Autowini (корейский аукцион для экспорта): поиск по марке и модели
  const AW_MAKE = { kgm: '', 'mercedes-benz': 'Mercedes Benz', 'land rover': 'Land Rover' };
  function autowiniUrl(lot) {
    const [mk, base] = (lot.modelKey || '').split('|');
    if (!mk || mk === 'other' || !base) return '';
    const cap = w => w.replace(/(^|[\s-])\w/g, c => c.toUpperCase());
    const make = mk in AW_MAKE ? AW_MAKE[mk] : cap(mk);
    return `https://buyer.auctionwini.com/search?keyword=${encodeURIComponent(`${make} ${cap(base)}`.trim())}`;
  }
  function similarBtns(lot) {
    const dz = dubizzleUrl(lot), aw = autowiniUrl(lot);
    const [a, b] = kmRange(lot.mileage);
    return (dz ? `<a class="btn" href="${esc(dz)}" target="_blank" rel="noopener" title="Объявления этой модели в ОАЭ: год ±1, пробег ${b ? `${fmtKm(a)}–${fmtKm(b)} км` : 'любой'}">Похожие на Dubizzle ↗</a>` : '') +
      (aw ? `<button type="button" class="btn" data-aw-btn disabled>Похожие на Autowini…</button>` : '');
  }
  // Excel со статистикой Autowini по аналогичной модели (владелец и менеджеры)
  async function awExcel(btn, lot, fn = 'aw-stats') {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Готовлю Excel…';
    try {
      const [a, b] = kmRange(lot.mileage);
      const { data: s } = await sb.auth.getSession();
      const r = await fetch(CFG.url + '/functions/v1/' + fn, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.anonKey, Authorization: 'Bearer ' + s.session.access_token },
        body: JSON.stringify({ mk: lot.modelKey, y: lot.year || 0, km_lo: a, km_hi: b, gen: lotGen(lot), title: `${titleOf(lot)} ${lot.year || ''}` }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'ошибка ' + r.status);
      const blob = await r.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = decodeURIComponent(r.headers.get('x-filename') || 'Autowini.xlsx');
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    } catch (e) { toast('Не получилось: ' + e.message); }
    btn.disabled = false; btn.textContent = label;
  }
  // список похожих лотов Autowini (модель, год ±1, похожий пробег) — из нашей базы, обновляется каждый час
  async function wireAw(root, lot) {
    const btn = root.querySelector('[data-aw-btn]'); if (!btn) return;
    const [a, b] = kmRange(lot.mileage);
    const { data } = await sb.rpc('similar_aw', { mk: lot.modelKey, y: lot.year || 0, km_lo: a, km_hi: b });
    const list = (data || []).filter(x => sameGen(lotGen(lot), x.name));
    btn.disabled = !list.length;
    btn.textContent = list.length ? `Похожие на Autowini (${list.length})` : 'На Autowini похожих нет';
    btn.title = 'Та же модель, год ±1, похожий пробег';
    const box = document.createElement('div');
    box.className = 'aw-list'; box.hidden = true;
    box.innerHTML = `<p class="hint">Autowini — корейский аукцион для экспорта. Та же модель, ${lot.year ? `${lot.year - 1}–${lot.year + 1} г.` : 'любой год'}, ${b ? `${fmtKm(a)}–${fmtKm(b)} км` : 'любой пробег'}.</p>` +
      list.map(x => `<a class="aw-item" href="${esc(x.url)}" target="_blank" rel="noopener">
        ${x.photo ? `<img src="${esc(x.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="aw-noimg"></span>'}
        <span><b>${esc(x.name || '')}</b><br><span class="hint">${x.mileage ? fmtKm(x.mileage) + ' км · ' : ''}${x.status === 'live' ? 'на торгах' : 'торги прошли'}${x.auction_at ? ' · ' + new Date(x.auction_at).toLocaleDateString('ru-RU') : ''}</span></span> ↗</a>`).join('');
    btn.after(box);
    btn.onclick = () => { box.hidden = !box.hidden; };
  }
  const fmtKm = n => Math.round(n).toLocaleString('ru-RU');
  // сравнение с рынком (только админ): статистика Autowini, под ней ссылка на похожие на Dubizzle
  const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  function awExamples(list, key) {
    const s = [...list].sort((a, b) => a[key] - b[key]);
    const pick = s.length >= 3 ? [['дешёвый', s[0]], ['средний', s[Math.floor(s.length / 2)]], ['дорогой', s[s.length - 1]]]
      : s.map((x, k) => [k ? 'ещё' : 'пример', x]);
    return pick.map(([t, x]) => `<li><span class="hint">${t}</span> <a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name || x.model || '')}</a>
      · ${x.mileage ? fmtKm(x.mileage) + ' км' : 'пробег —'} · <b>${usd(x[key])}</b></li>`).join('');
  }
  // итоги торгов K Car по той же модели (год ±1, похожий пробег) — за сколько ушли
  async function kcBlock(lot) {
    if (!lot.modelKey || !lot.year) return '';
    const { data } = await sb.from('kc_sales').select('id,name,make,model,grade,year,mileage,status,final_usd,start_usd,auction_at,url')
      .eq('model_key', lot.modelKey).gte('year', lot.year - 1).lte('year', lot.year + 1).order('auction_at', { ascending: false }).limit(1000);
    const all = (data || []).map(x => ({ ...x, name: `${x.make !== 'Other' ? x.make + ' ' : ''}${x.model || ''}` }))
      .filter(x => sameGen(lotGen(lot), `${x.model || ''} ${x.grade || ''}`));
    if (!all.length) return '';
    const [a, b] = kmRange(lot.mileage);
    const near = b ? all.filter(x => x.mileage == null || (x.mileage >= a && x.mileage <= b)) : all;
    const list = near.length ? near : all;
    const kmNote = b ? (near.length ? `пробег ${fmtKm(a)}–${fmtKm(b)} км` : 'с похожим пробегом нет — показаны все пробеги') : 'пробег любой';
    const sold = list.filter(x => x.status === 'sold' && x.final_usd > 0);
    const stats = arr => `мин <b>${usd(Math.min(...arr))}</b> · медиана <b>${usd(median(arr))}</b> · макс <b>${usd(Math.max(...arr))}</b>`;
    return `<div class="mk-src"><div class="mk-h"><b>K Car — итоги торгов</b><span class="hint">${esc(String(lot.year - 1))}–${esc(String(lot.year + 1))} г., ${kmNote}</span></div>
      ${sold.length ? `<div class="mk-row">Продано (${sold.length}), цена продажи: ${stats(sold.map(x => x.final_usd))}</div><ul class="mk-ex">${awExamples(sold, 'final_usd')}</ul>`
        : '<div class="mk-row hint">Продаж этой модели на K Car пока не было в нашей статистике.</div>'}
      ${list.length - sold.length ? `<div class="mk-row hint">Не проданы: ${list.length - sold.length}</div>` : ''}</div>`;
  }
  async function awBlock(lot) {
    if (!lot.modelKey || !lot.year) return '';
    const { data } = await sb.from('comp_items').select('*').eq('model_key', lot.modelKey)
      .gte('year', lot.year - 1).lte('year', lot.year + 1).limit(1000);
    const all = (data || []).filter(x => sameGen(lotGen(lot), `${x.name || ''} ${x.model || ''}`));
    const [a, b] = kmRange(lot.mileage);
    const near = b ? all.filter(x => x.mileage == null || (x.mileage >= a && x.mileage <= b)) : all;
    const list = near.length ? near : all;
    const kmNote = b ? (near.length ? `пробег ${fmtKm(a)}–${fmtKm(b)} км` : 'с похожим пробегом нет — показаны все пробеги') : 'пробег любой';
    const sold = list.filter(x => x.status !== 'live' && x.final_usd > 0);
    const noBid = list.filter(x => x.status === 'unsold').length;
    const live = list.filter(x => x.status === 'live' && x.start_usd > 0);
    const stats = arr => `мин <b>${usd(Math.min(...arr))}</b> · медиана <b>${usd(median(arr))}</b> · макс <b>${usd(Math.max(...arr))}</b>`;
    return `<div class="mk-src"><div class="mk-h"><b>Autowini</b><span class="hint">${esc(String(lot.year - 1))}–${esc(String(lot.year + 1))} г., ${kmNote}</span></div>
      ${sold.length ? `<div class="mk-row">Прошли торги со ставками (${sold.length}), последняя ставка: ${stats(sold.map(x => x.final_usd))}</div><ul class="mk-ex">${awExamples(sold, 'final_usd')}</ul>`
        : '<div class="mk-row hint">Торгов со ставками по этой модели пока не было — статистика копится после каждых торгов.</div>'}
      ${noBid ? `<div class="mk-row hint">Без ставок (не проданы): ${noBid}</div>` : ''}
      ${live.length ? `<div class="mk-row">Сейчас на торгах (${live.length}), стартовые цены: ${stats(live.map(x => x.start_usd))}</div><ul class="mk-ex">${awExamples(live, 'start_usd')}</ul>`
        : '<div class="mk-row hint">Сейчас похожих лотов на торгах нет.</div>'}</div>`;
  }
  async function extLinks(el, lot) {
    if (!el) return;
    const dzBtn = similarBtns(lot), url = dzBtn;
    const market = STAFF() || ME?.market_access;     // сравнение с рынком: персональный доступ партнёра (даёт админ/менеджер)
    if (!market) { el.innerHTML = ''; return; }   // без доступа — ни сравнения с рынком, ни ссылок на похожие (Dubizzle, Autowini)
    // ссылки на лот на сайтах аукционов (если лот продаётся на нескольких — все ссылки)
    const origins = [{ source: lot.source, url: lot.url, lotNo: lot.lotNo }, ...(lot.alsoOn || [])].filter(o => /^https?:/.test(o.url || ''));
    const origHtml = STAFF() && origins.length ? `<div class="orig-links"><span class="hint">Лот на сайте аукциона${origins.length > 1 ? ' (дубли)' : ''}:</span>
      ${origins.map(o => `<a class="btn" href="${esc(o.url)}" target="_blank" rel="noopener">${esc(SRC[o.source] || o.source)}${o.lotNo ? ' · лот ' + esc(o.lotNo) : ''} ↗</a>`).join('')}</div>` : '';
    el.innerHTML = origHtml + `<div class="market"><div class="mk-title">Сравнение с рынком${STAFF() ? ' <span class="hint">видно админу, менеджерам и партнёрам с доступом</span>' : ''}</div>
      <div id="mkAw"><p class="hint">Загружаю Autowini…</p></div>
      <div id="mkKc"></div>
      <div class="mk-xls"><button type="button" class="btn" id="awXls">📊 Статистика торгов (Excel)</button>
        <span class="hint">Autowini и K Car в одном файле · та же модель, год ±1, похожий пробег · листы «Целые» и «Битые», столбец «Аукцион» · тех. лист K Car · ZIP с фото Autowini</span></div>
      ${url ? `<div class="mk-dz"></div>` : ''}</div>`;
    if (url) { el.querySelector('.mk-dz').innerHTML = dzBtn; wireAw(el, lot); }
    el.querySelector('#awXls').onclick = e => awExcel(e.currentTarget, lot);
    try { el.querySelector('#mkAw').innerHTML = await awBlock(lot) || '<p class="hint">Нет данных о модели для сравнения.</p>'; }
    catch (e) { el.querySelector('#mkAw').innerHTML = `<p class="hint">Autowini: ${esc(e.message)}</p>`; }
    try { el.querySelector('#mkKc').innerHTML = await kcBlock(lot); } catch (e) { /* итогов K Car пока нет */ }
  }

  // ------------------------------------------------------------ связь с каталогом
  const P = {
    fetchFull: async id => {
      const d = (await sb.from('lots').select('data').eq('id', id).single()).data?.data;
      if (d?.tr) I18N.addMap(d.tr[I18N.lang]);    // длинные тексты лота (описания) на выбранном языке
      return d;
    },
    myBid: id => MY[id] && (!MY[id].outcome || MY[id].outcome === 'pending') ? MY[id].amount_usd : null,
    activeBidsCount: () => Object.values(MY).filter(b => b.outcome === 'pending' && !(ts(b.ends_at) < Date.now())).length,
    bidPanel, renderBids, renderAdmin, salesPanel, saveSearch, favToggle, favNote,
    afterModal: el => hideKrw(el),
    fx: fxLine,
    calcPanel, zipButtons, extLinks,
  };

  sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') loginScreen(); });
  boot().catch(e => { console.error(e); loginScreen('Ошибка загрузки: ' + e.message); });
})();
