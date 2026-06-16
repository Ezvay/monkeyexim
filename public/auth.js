/* ═══════════════════════════════
   GLOBALNY SYSTEM AUTORYZACJI
═══════════════════════════════ */
(function() {
  const KEY  = 'pt_auth_v2';
  const DAYS = 30;

  // Prosty hash — nie wymaga socketa ani fetch
  function simpleHash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8,'0');
  }
  const CORRECT = simpleHash('platforma');

  function isAuthed() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!d || !d.ok) return false;
      if (Date.now() - d.ts > DAYS * 864e5) { localStorage.removeItem(KEY); return false; }
      return true;
    } catch(e) { return false; }
  }

  function setAuthed() {
    localStorage.setItem(KEY, JSON.stringify({ ok: true, ts: Date.now() }));
  }

  window.requireAuth = function() {
    if (isAuthed()) return;

    document.documentElement.style.overflow = 'hidden';

    const style = document.createElement('style');
    style.textContent = `
      #ao{position:fixed;inset:0;z-index:99999;background:linear-gradient(160deg,#0d0a06,#090704);display:flex;align-items:center;justify-content:center;}
      #ab{background:linear-gradient(160deg,#1e1810,#100d08);border:1px solid rgba(201,168,76,0.4);border-radius:4px;padding:40px 44px;width:340px;box-shadow:0 0 80px rgba(0,0,0,0.95);display:flex;flex-direction:column;align-items:center;gap:18px;position:relative;}
      #ab::before,#ab::after{content:'';position:absolute;width:18px;height:18px;border-color:rgba(201,168,76,0.35);border-style:solid;}
      #ab::before{top:10px;left:10px;border-width:1px 0 0 1px;}
      #ab::after{bottom:10px;right:10px;border-width:0 1px 1px 0;}
      #al{font-family:'Cinzel',serif;font-size:12px;letter-spacing:5px;color:#c9a84c;text-transform:uppercase;text-align:center;line-height:1.7;}
      #al b{display:block;font-size:22px;letter-spacing:2px;color:#f0d080;margin-bottom:4px;}
      #adiv{width:60px;height:1px;background:linear-gradient(to right,transparent,rgba(201,168,76,0.5),transparent);}
      #ai{width:100%;background:#0a0806;border:1px solid rgba(201,168,76,0.25);color:#d4c4a0;font-family:'Crimson Text',serif;font-size:18px;padding:11px 14px;border-radius:2px;outline:none;text-align:center;letter-spacing:6px;transition:border-color .25s,box-shadow .25s;}
      #ai:focus{border-color:rgba(201,168,76,0.6);box-shadow:0 0 12px rgba(201,168,76,0.08);}
      #ai.err{border-color:rgba(200,60,60,0.7);animation:ashake .35s ease;}
      @keyframes ashake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}60%{transform:translateX(8px)}80%{transform:translateX(-4px)}}
      #abtn{width:100%;font-family:'Cinzel',serif;font-size:10px;letter-spacing:4px;text-transform:uppercase;padding:12px;border-radius:2px;cursor:pointer;background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.4);color:#c9a84c;transition:all .2s;}
      #abtn:hover{background:rgba(201,168,76,0.2);border-color:rgba(201,168,76,0.7);color:#f0d080;}
      #aerr{font-family:'Cinzel',serif;font-size:11px;color:#c05050;letter-spacing:1px;min-height:14px;text-align:center;}
      #ahint{font-family:'Cinzel',serif;font-size:10px;color:rgba(122,106,80,0.45);letter-spacing:1px;text-align:center;}
    `;
    document.head.appendChild(style);

    const ov = document.createElement('div');
    ov.id = 'ao';
    ov.innerHTML = `<div id="ab">
      <div id="al"><b>⚔</b>Patologiczne Timery</div>
      <div id="adiv"></div>
      <input id="ai" type="password" placeholder="hasło" autocomplete="off" spellcheck="false">
      <button id="abtn">Wejdź</button>
      <div id="aerr"></div>
      <div id="ahint">Gildia Patologów &nbsp;•&nbsp; Dostęp prywatny</div>
    </div>`;
    document.body.appendChild(ov);

    function tryLogin() {
      const inp = document.getElementById('ai');
      const err = document.getElementById('aerr');
      const val = inp.value.trim();
      if (!val) return;
      if (simpleHash(val) === CORRECT) {
        setAuthed();
        document.documentElement.style.overflow = '';
        ov.remove();
      } else {
        inp.classList.add('err');
        err.textContent = 'Nieprawidłowe hasło';
        inp.value = '';
        setTimeout(() => { inp.classList.remove('err'); err.textContent = ''; inp.focus(); }, 600);
      }
    }

    document.getElementById('abtn').addEventListener('click', tryLogin);
    document.getElementById('ai').addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });
    setTimeout(() => document.getElementById('ai')?.focus(), 80);
  };
})();
