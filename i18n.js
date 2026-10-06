// Язык сайта: RU (исходный) / EN / AR. Страница строится на русском, этот модуль переводит видимый текст
// по словарям (I18N_UI — интерфейс, I18N_DATA — термины из данных лотов, addMap — тексты конкретного лота).
// Для арабского страница зеркалится (dir="rtl").
(() => {
  const LANGS = { ru: 'RU', en: 'EN', ar: 'عربي' };
  let lang = 'ru';
  try { lang = localStorage.getItem('kal-lang') || 'ru'; } catch (e) { /* без хранилища — русский */ }
  if (!LANGS[lang]) lang = 'ru';
  const html = document.documentElement;
  html.lang = lang;
  html.dir = lang === 'ar' ? 'rtl' : 'ltr';

  const CYR = /[А-Яа-яЁё]/;
  const dict = new Map();                       // русская фраза → перевод
  let rx = null;                                 // регулярка по всем фразам (длинные — первыми)
  const add = (ru, tr) => { if (ru && tr && !dict.has(ru)) { dict.set(ru, tr); rx = null; } };
  const load = obj => { for (const [ru, v] of Object.entries(obj || {})) add(ru, typeof v === 'string' ? v : v?.[lang]); };

  function regex() {
    if (rx) return rx;
    const keys = [...dict.keys()].filter(k => k.length >= 2 || /^[чдг]$/.test(k)).sort((a, b) => b.length - a.length)
      .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    rx = keys.length ? new RegExp(`(?<![А-Яа-яЁё])(?:${keys.join('|')})(?![А-Яа-яЁё])`, 'g') : /$^/;
    return rx;
  }
  function tr(s) {
    if (!s || !CYR.test(s)) return s;
    const t = s.trim();
    if (dict.has(t)) return s.replace(t, dict.get(t));
    return s.replace(regex(), m => dict.get(m) ?? m);
  }

  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']);
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  let busy = false;
  function translate(root) {
    if (lang === 'ru' || !root) return;
    busy = true;
    try {
      if (root.nodeType === 3) {
        if (CYR.test(root.nodeValue)) { const v = tr(root.nodeValue); if (v !== root.nodeValue) root.nodeValue = v; }
        return;
      }
      if (root.nodeType !== 1 || SKIP.has(root.tagName) || root.closest?.('[data-noi18n]')) return;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: n => SKIP.has(n.parentNode?.tagName) || n.parentNode?.closest?.('[data-noi18n]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
      const nodes = [];
      while (w.nextNode()) if (CYR.test(w.currentNode.nodeValue)) nodes.push(w.currentNode);
      nodes.forEach(n => { const v = tr(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; });
      const els = [root, ...root.querySelectorAll('[placeholder],[title],[aria-label],[alt],option,input[type=button],input[type=submit]')];
      els.forEach(e => ATTRS.forEach(a => { const v = e.getAttribute?.(a); if (v && CYR.test(v)) { const t = tr(v); if (t !== v) e.setAttribute(a, t); } }));
    } finally { busy = false; mo?.takeRecords(); }
  }

  // всё, что добавляется на страницу позже (карточки, окна, кабинет), переводится сразу
  var mo = new MutationObserver(list => {
    if (busy || lang === 'ru') return;
    for (const m of list) {
      if (m.type === 'characterData') translate(m.target);
      else if (m.type === 'attributes') { const v = m.target.getAttribute(m.attributeName); if (v && CYR.test(v)) { const t = tr(v); if (t !== v) m.target.setAttribute(m.attributeName, t); } }
      else m.addedNodes.forEach(translate);
    }
  });

  function setLang(l) {
    if (!LANGS[l] || l === lang) return;
    try { localStorage.setItem('kal-lang', l); } catch (e) { /* ничего */ }
    window.dispatchEvent(new CustomEvent('kal-lang', { detail: l }));
    location.reload();
  }
  function switcher() {
    return `<div class="lang-sw" data-noi18n>${Object.entries(LANGS).map(([k, v]) =>
      `<button type="button" data-lang="${k}" class="${k === lang ? 'on' : ''}">${v}</button>`).join('')}</div>`;
  }
  document.addEventListener('click', e => { const b = e.target.closest?.('.lang-sw [data-lang]'); if (b) setLang(b.dataset.lang); });

  window.I18N = {
    get lang() { return lang; }, LANGS, tr, translate, setLang, switcher,
    addMap(obj) { if (lang !== 'ru') { load(obj); } },            // термины/тексты из данных
    t: s => lang === 'ru' ? s : tr(s),                              // для текста вне DOM (alert, confirm, prompt)
  };
  if (lang !== 'ru') {
    load(window.I18N_UI);
    const start = () => { translate(document.body); mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS }); };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
    document.title = tr(document.title);
  }
})();
