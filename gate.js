// Вход по паролю для опубликованной версии сайта.
// Данные лотов (data/lots.enc.js) зашифрованы AES-256-GCM ключом из пароля (PBKDF2-SHA256),
// без пароля их не прочитать. После входа ключ запоминается на этом устройстве.
(function () {
  const E = window.AUCTION_ENC;
  const KEY_STORE = 'kal-key-' + E.kid;
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));

  async function deriveKey(password) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(E.salt), iterations: E.iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }

  async function open(key) {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(E.iv) }, key, b64(E.ct));
    const text = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    window.AUCTION_DATA = JSON.parse(text);
    document.getElementById('gate')?.remove();
    const s = document.createElement('script');
    s.src = 'app.js?v=' + (window.SITE_VER || E.kid);
    document.body.appendChild(s);
    addLogout();
  }

  function addLogout() {
    const b = document.createElement('button');
    b.textContent = 'Выйти';
    b.className = 'logout';
    b.onclick = () => { try { localStorage.removeItem(KEY_STORE); } catch {} location.reload(); };
    document.querySelector('.top')?.appendChild(b);
  }

  function showForm(error) {
    let g = document.getElementById('gate');
    if (!g) {
      g = document.createElement('div');
      g.id = 'gate';
      g.innerHTML = `<form class="gate-box">
          <div class="brand">Korea<b>Auto</b>Lots</div>
          <p>Введите пароль для доступа к лотам</p>
          <input type="password" id="gatePass" autocomplete="current-password" placeholder="Пароль" autofocus>
          <label class="check"><input type="checkbox" id="gateRemember" checked> Запомнить на этом устройстве</label>
          <button class="btn primary" type="submit">Войти</button>
          <div class="gate-err" id="gateErr"></div>
        </form>`;
      document.body.appendChild(g);
      g.querySelector('form').onsubmit = async e => {
        e.preventDefault();
        const btn = g.querySelector('button');
        btn.disabled = true; btn.textContent = 'Проверяю…';
        try {
          const key = await deriveKey(document.getElementById('gatePass').value);
          await open(key);
          if (document.getElementById('gateRemember')?.checked !== false) {
            try { localStorage.setItem(KEY_STORE, toB64(await crypto.subtle.exportKey('raw', key))); } catch {}
          }
        } catch {
          btn.disabled = false; btn.textContent = 'Войти';
          document.getElementById('gateErr').textContent = 'Неверный пароль';
        }
      };
    }
    if (error) document.getElementById('gateErr').textContent = error;
  }

  (async () => {
    let saved = null;
    try { saved = localStorage.getItem(KEY_STORE); } catch {}
    if (saved) {
      try {
        const key = await crypto.subtle.importKey('raw', b64(saved), { name: 'AES-GCM' }, true, ['decrypt']);
        return await open(key);
      } catch { try { localStorage.removeItem(KEY_STORE); } catch {} }
    }
    showForm();
  })();
})();
