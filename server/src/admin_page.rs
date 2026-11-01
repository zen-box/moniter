// 独立的管理员登录页面 (/admin/login)
pub const ADMIN_LOGIN_HTML: &str = r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="site-name" content="__SITE_NAME__">
  <title>__SITE_NAME__ · 登录</title>
  <script>
    (function () {
      try {
        var s = localStorage.getItem('aegis_theme') || 'system';
        var t = s;
        if (t === 'system') t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', t);
      } catch (e) {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    })();
  </script>
  <style>
    html { background-color: #0a0c10; color-scheme: dark; }
    html[data-theme="light"] { background-color: #f5f6f7; color-scheme: light; }
  </style>
  <link rel="stylesheet" href="/style.css">
  <style>
    body {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: var(--bg-primary);
      color: var(--text-main);
      padding: 1.5rem;
    }
    .login-box {
      width: 100%;
      max-width: 380px;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      padding: 2.25rem;
      box-shadow: var(--shadow-modal);
    }
    .input-field {
      width: 100%;
      padding: 0.65rem 0.85rem;
      font-size: 0.88rem;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-subtle);
      border-radius: 7px;
      color: var(--text-main);
      margin-top: 0.4rem;
      outline: none;
      box-sizing: border-box;
      transition: all 0.2s;
      font-family: inherit;
    }
    .input-field::placeholder { color: var(--text-faint); }
    .input-field:focus {
      border-color: var(--accent-primary);
      box-shadow: 0 0 0 2px var(--accent-primary-bg);
    }
  </style>
</head>
<body>
  <div style="position:fixed; top:1.25rem; right:1.5rem; display:flex; gap:0.5rem; z-index:100;">
    <button id="loginLangBtn" class="btn-control" style="font-size:0.75rem; padding:0.35rem 0.65rem;" onclick="toggleLoginLang()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
      <span id="loginLangText">中文</span>
    </button>
    <button id="loginThemeBtn" class="btn-control" style="font-size:0.75rem; padding:0.35rem 0.65rem;" onclick="cycleLoginTheme()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
      <span id="loginThemeText">深色</span>
    </button>
  </div>
  <div class="login-box">
    <div style="text-align: center; margin-bottom: 1.75rem;">
      <div class="brand-logo" style="width:44px; height:44px; margin:0 auto 0.85rem auto;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </div>
      <div id="loginBrandTitle" style="font-size: 1.25rem; font-weight: 700;">__SITE_NAME__ 控制台登录</div>
    </div>

    <div style="margin-bottom: 1.15rem;">
      <label id="loginUserLabel" style="font-size: 0.78rem; font-weight: 500; color: var(--text-secondary);">管理员账号</label>
      <input type="text" id="userInput" class="input-field" value="admin" placeholder="输入账号">
    </div>

    <div style="margin-bottom: 1.5rem;">
      <label id="loginPassLabel" style="font-size: 0.78rem; font-weight: 500; color: var(--text-secondary);">管理密码</label>
      <input type="password" id="passInput" class="input-field" placeholder="输入密码">
    </div>

    <div id="totpBox" style="display:none; margin-bottom:1.5rem;">
      <label id="loginTotpLabel" style="font-size: 0.78rem; font-weight: 500; color: var(--text-secondary);">两步验证码</label>
      <input type="text" id="totpInput" class="input-field" inputmode="numeric" maxlength="6"
             autocomplete="one-time-code" placeholder="验证器 App 上的 6 位数字">
    </div>

    <div id="errorMsg" style="display:none; color:var(--status-danger); font-size:0.8rem; margin-bottom:1rem; text-align:center;"></div>

    <button id="loginBtn" class="btn-control active" style="width: 100%; justify-content: center; padding: 0.7rem; font-size: 0.88rem;">
      安全登录
    </button>

  </div>

  <script>
    document.getElementById('loginBtn').addEventListener('click', async () => {
      const user = document.getElementById('userInput').value.trim();
      // Passwords are credentials; preserve intentional leading and trailing spaces.
      const pass = document.getElementById('passInput').value;
      const err = document.getElementById('errorMsg');
      const btn = document.getElementById('loginBtn');

      btn.disabled = true;
      btn.textContent = lLang === 'zh' ? '验证中...' : 'Signing in...';
      err.style.display = 'none';

      try {
        const totp = document.getElementById('totpInput').value.trim();
        const res = await fetch('/api/v1/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: user, password: pass, totp_code: totp || null })
        });
        const data = await res.json();
        if (data.success) {
          // 令牌保存在本机，服务重启后可恢复；服务端同时绑定登录来源 IP。
          localStorage.setItem('aegis_admin_token', data.token || '');
          window.location.href = '/admin';
        } else if (data.need_totp) {
          // 密码过了，还差验证码：展开输入框并聚焦
          const box = document.getElementById('totpBox');
          box.style.display = 'block';
          const input = document.getElementById('totpInput');
          if (!input.value) input.focus();
          err.textContent = lLang === 'zh'
            ? (data.message || '请输入两步验证码')
            : (String(data.message || '').includes('不正确') ? 'Invalid verification code' : 'Enter the verification code');
          err.style.display = 'block';
          btn.disabled = false;
          btn.textContent = lLang === 'zh' ? '安全登录' : 'Sign In';
        } else {
          const lockoutMinutes = String(data.message || '').match(/锁定，请\s*(\d+)\s*分钟/);
          err.textContent = lLang === 'zh'
            ? (data.message || '账号或密码错误')
            : (lockoutMinutes ? 'Too many failed attempts. Try again in ' + lockoutMinutes[1] + ' minutes.' : 'Invalid username or password');
          err.style.display = 'block';
          btn.disabled = false;
          btn.textContent = lLang === 'zh' ? '安全登录' : 'Sign In';
        }
      } catch (e) {
        err.textContent = lLang === 'zh' ? '无法连接管理后端' : 'Unable to reach the admin service';
        err.style.display = 'block';
        btn.disabled = false;
        btn.textContent = lLang === 'zh' ? '安全登录' : 'Sign In';
      }
    });

    
    // Login theme & lang controls
    let lTheme = localStorage.getItem('aegis_theme') || 'system';
    let lLang = localStorage.getItem('aegis_lang') || (navigator.language.startsWith('zh') ? 'zh' : 'en');

    function updateLoginThemeUI() {
      let real = lTheme;
      if (lTheme === 'system') real = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', real);
      const txt = lLang === 'zh'
        ? (lTheme === 'system' ? '跟随系统' : (lTheme === 'light' ? '浅色' : '深色'))
        : (lTheme === 'system' ? 'System' : (lTheme === 'light' ? 'Light' : 'Dark'));
      document.getElementById('loginThemeText').textContent = txt;
    }

    function cycleLoginTheme() {
      if (lTheme === 'dark') lTheme = 'light';
      else if (lTheme === 'light') lTheme = 'system';
      else lTheme = 'dark';
      localStorage.setItem('aegis_theme', lTheme);
      updateLoginThemeUI();
    }

    function applyLoginLanguage() {
      document.getElementById('loginLangText').textContent = lLang === 'zh' ? '中文' : 'English';
      document.getElementById('loginUserLabel').textContent = lLang === 'zh' ? '管理员账号' : 'Admin username';
      document.getElementById('loginPassLabel').textContent = lLang === 'zh' ? '管理密码' : 'Admin password';
      document.getElementById('loginTotpLabel').textContent = lLang === 'zh' ? '两步验证码' : 'Two-factor code';
      document.getElementById('userInput').placeholder = lLang === 'zh' ? '输入账号' : 'Username';
      document.getElementById('passInput').placeholder = lLang === 'zh' ? '输入密码' : 'Password';
      document.getElementById('totpInput').placeholder = lLang === 'zh' ? '验证器 App 上的 6 位数字' : '6-digit code from your authenticator';
      document.getElementById('loginBtn').textContent = lLang === 'zh' ? '安全登录' : 'Sign In';
      document.getElementById('loginBrandTitle').textContent = (window.siteDisplayName || 'Moniter') + (lLang === 'zh' ? ' 控制台登录' : ' Admin sign in');
      updateLoginThemeUI();
    }

    function toggleLoginLang() {
      lLang = lLang === 'zh' ? 'en' : 'zh';
      localStorage.setItem('aegis_lang', lLang);
      applyLoginLanguage();
    }

    updateLoginThemeUI();
    applyLoginLanguage();

    (async function resumeSession() {
      try {
        const settings = await fetch('/api/v1/site-settings').then((r) => r.json());
        const name = document.querySelector('meta[name="site-name"]').content || settings.site_name || 'Moniter';
        window.siteDisplayName = name;
        document.title = name + ' · 登录';
        document.getElementById('loginBrandTitle').textContent = name + (lLang === 'zh' ? ' 控制台登录' : ' Admin sign in');
      } catch (e) {}
      const token = localStorage.getItem('aegis_admin_token');
      if (!token) return;
      try {
        const res = await fetch('/api/v1/admin/status', { headers: { Authorization: 'Bearer ' + token } });
        if (res.ok) window.location.replace('/admin');
        else localStorage.removeItem('aegis_admin_token');
      } catch (e) {}
    })();

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('loginBtn').click();
    });
  </script>
</body>
</html>
"#;

// 独立的管理员后台主页面 (/admin)
pub const ADMIN_DASHBOARD_HTML: &str = r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="site-name" content="__SITE_NAME__">
  <title>__SITE_NAME__ · 管理控制中心</title>
  <script>
    (function () {
      try {
        var s = localStorage.getItem('aegis_theme') || 'system';
        var t = s;
        if (t === 'system') t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', t);
      } catch (e) {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    })();
  </script>
  <style>
    html { background-color: #0a0c10; color-scheme: dark; }
    html[data-theme="light"] { background-color: #f5f6f7; color-scheme: light; }
  </style>
  <link rel="stylesheet" href="/style.css">
  <style>
    body {
      background: var(--bg-primary);
      color: var(--text-main);
      min-height: 100vh;
      line-height: 1.5;
    }
    .admin-container {
      max-width: 1240px;
      margin: 0 auto;
      padding: 1.5rem;
    }
    .admin-container select,
    .admin-container input:not([type="checkbox"]):not([type="radio"]),
    .admin-container textarea {
      color: var(--text-main); background: var(--bg-input); border: 1px solid var(--border-subtle);
      border-radius: 7px; font: inherit; outline: none; transition: border-color .16s, box-shadow .16s, background .16s;
    }
    .admin-container select { appearance: none; padding: .55rem 2rem .55rem .7rem; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%238894a8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right .65rem center; }
    .admin-container input:not([type="checkbox"]):not([type="radio"]), .admin-container textarea { padding:.58rem .7rem; }
    .admin-container :is(input,select,textarea):focus { border-color:var(--accent-primary); box-shadow:0 0 0 3px var(--accent-primary-bg); }
    input[type="checkbox"] { appearance:none; width:17px; height:17px; flex:0 0 17px; margin:0; border:1px solid var(--border-strong); border-radius:4px; background:var(--bg-input); display:inline-grid; place-content:center; cursor:pointer; transition:background .15s,border-color .15s,box-shadow .15s; }
    input[type="checkbox"]::before { content:""; width:8px; height:5px; border:2px solid white; border-top:0; border-right:0; transform:rotate(-45deg) scale(0); transition:transform .12s ease; }
    input[type="checkbox"]:checked { background:var(--accent-primary); border-color:var(--accent-primary); }
    input[type="checkbox"]:checked::before { transform:rotate(-45deg) scale(1); }
    input[type="checkbox"]:focus-visible { outline:3px solid var(--accent-primary-bg); }
    .filter-select { min-width:155px; }
    .admin-table-wrap, .table-responsive { overflow:auto; border:1px solid var(--border-subtle); border-radius:8px; background:var(--bg-card); }
    .admin-container .probe-table { width:100%; border-collapse:separate; border-spacing:0; font-size:.82rem; }
    .admin-container .probe-table th { position:sticky; top:0; z-index:1; background:var(--bg-tertiary); color:var(--text-secondary); font-size:.7rem; font-weight:650; white-space:nowrap; padding:.72rem .8rem; border-bottom:1px solid var(--border-subtle); }
    .admin-container .probe-table td { padding:.78rem .8rem; border-bottom:1px solid var(--border-subtle); vertical-align:middle; }
    .admin-container .probe-table tbody tr:last-child td { border-bottom:0; }
    .admin-container .probe-table tbody tr:hover td { background:var(--bg-tertiary); }
    .admin-container .probe-table code { overflow-wrap:anywhere; }
    .flag-mark { width:20px; height:15px; object-fit:cover; border-radius:2px; border:1px solid var(--border-subtle); vertical-align:-3px; margin-right:.4rem; }
    .panel-card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 14px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      box-shadow: var(--shadow-sm);
    }
    .tabs-nav {
      display: flex;
      gap: 0.5rem;
      border-bottom: 1px solid var(--border-subtle);
      padding-bottom: 0.75rem;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
    }
    .tab-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      background: none;
      border: 1px solid transparent;
      color: var(--text-secondary);
      padding: 0.5rem 0.9rem;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 500;
      transition: all 0.2s;
    }
    .tab-btn.active {
      background: var(--accent-primary-bg);
      color: var(--accent-primary);
      border-color: var(--accent-primary);
      font-weight: 600;
    }
    .tab-btn:hover:not(.active) {
      background: var(--bg-tertiary);
      color: var(--text-main);
    }
    .input-sm {
      padding: 0.5rem 0.75rem;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      color: var(--text-main);
      font-size: 0.82rem;
      outline: none;
      box-sizing: border-box;
      transition: all 0.2s;
    }
    .input-sm:focus {
      border-color: var(--accent-primary);
      box-shadow: 0 0 0 2px var(--accent-primary-bg);
    }
    .stat-badge {
      font-size: 0.72rem;
      padding: 0.15rem 0.5rem;
      border-radius: 9999px;
      background: var(--status-online-bg);
      color: var(--status-online);
      border: 1px solid var(--status-online);
      font-weight: 600;
    }

    /* ==================== 自定义下拉框 ==================== */
    .cs-wrap { position: relative; user-select: none; }
    .cs-trigger {
      display: flex; align-items: center; gap: 0.5rem;
      width: 100%; padding: 0.5rem 0.65rem;
      border-radius: 8px; border: 1px solid var(--border-subtle);
      background: var(--bg-input); color: var(--text-main);
      font-size: 0.82rem; cursor: pointer; text-align: left; font-family: inherit;
      transition: border-color .15s, box-shadow .15s;
    }
    .cs-trigger:hover { border-color: var(--border-strong); }
    .cs-wrap.open .cs-trigger {
      border-color: var(--accent-primary);
      box-shadow: 0 0 0 3px var(--accent-primary-bg);
    }
    .cs-trigger .cs-flag { width: 18px; height: 13px; border-radius: 2px; object-fit: cover; flex: none; }
    .cs-trigger .cs-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cs-trigger .cs-caret { flex: none; opacity: .45; transition: transform .15s; }
    .cs-wrap.open .cs-caret { transform: rotate(180deg); }
    .cs-menu {
      position: absolute; z-index: 80; top: calc(100% + 4px); left: 0; right: 0;
      max-height: 250px; overflow-y: auto;
      background: var(--bg-card); border: 1px solid var(--border-subtle);
      border-radius: 10px; padding: 4px;
      box-shadow: var(--shadow-lg); display: none;
    }
    .cs-wrap.open .cs-menu { display: block; }
    .cs-option {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.45rem 0.6rem; border-radius: 6px;
      font-size: 0.82rem; color: var(--text-main); cursor: pointer;
    }
    .cs-option:hover { background: var(--bg-tertiary); }
    .cs-option.selected { background: var(--accent-primary-bg); color: var(--accent-primary); font-weight: 500; }
    .cs-option .cs-flag { width: 18px; height: 13px; border-radius: 2px; object-fit: cover; flex: none; }
    .cs-option .cs-sub { font-size: 0.7rem; color: var(--text-muted); }

    /* ==================== Toast ==================== */
    .toast-wrap { position: fixed; top: 1.25rem; right: 1.25rem; z-index: 999; display: flex; flex-direction: column; gap: 0.5rem; }
    .toast {
      min-width: 220px; max-width: 380px; padding: 0.7rem 0.9rem;
      border-radius: 10px; font-size: 0.82rem; line-height: 1.5;
      background: var(--bg-card); border: 1px solid var(--border-subtle);
      box-shadow: var(--shadow-lg); color: var(--text-main);
      display: flex; align-items: flex-start; gap: 0.55rem;
      animation: toastIn .18s ease-out;
    }
    @keyframes toastIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
    .toast.ok { border-color: var(--status-online); }
    .toast.err { border-color: var(--status-danger); }
    .toast .t-ico { flex: none; margin-top: 1px; }

    /* ==================== 确认框 ==================== */
    .confirm-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.45);
      display: none; align-items: center; justify-content: center;
      z-index: 998; padding: 1rem;
    }
    .confirm-backdrop.show { display: flex; }
    .confirm-box {
      width: 100%; max-width: 390px; background: var(--bg-card);
      border: 1px solid var(--border-subtle); border-radius: 14px; padding: 1.25rem;
      box-shadow: var(--shadow-modal);
    }
    .confirm-msg { font-size: 0.88rem; line-height: 1.65; color: var(--text-main); margin-bottom: 1.15rem; }
    .confirm-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }

    /* ==================== 表单 ==================== */
    .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.85rem; }
    .form-item label { display: block; font-size: 0.72rem; color: var(--text-muted); margin-bottom: 0.3rem; }
    .form-item input:not([type="checkbox"]):not([type="radio"]), .form-item select, .form-item textarea {
      width: 100%; padding: 0.5rem 0.65rem; border-radius: 8px;
      border: 1px solid var(--border-subtle); background: var(--bg-input); color: var(--text-main);
      font-size: 0.82rem; font-family: inherit; box-sizing: border-box;
    }
    .form-item input:focus {
      outline: none; border-color: var(--accent-primary);
      box-shadow: 0 0 0 3px var(--accent-primary-bg);
    }
    .form-item .hint { font-size: 0.68rem; color: var(--text-faint); margin-top: 0.3rem; }
    .switch-row { display: flex; align-items: center; gap: 0.5rem; font-size: 0.82rem; color: var(--text-secondary); }
    .switch-row input[type="checkbox"] { width: 17px; height: 17px; }
    .status-badge { display:inline-block; padding:.16rem .4rem; margin:.1rem .12rem .1rem 0; border-radius:4px; border:1px solid var(--border-subtle); color:var(--text-secondary); font-size:.68rem; }
    .login-summary-item { display:flex; justify-content:space-between; align-items:center; gap:.7rem; padding:.7rem .8rem; border:1px solid var(--border-subtle); border-radius:7px; background:var(--bg-tertiary); font-size:.74rem; color:var(--text-muted); }
    .login-summary-item strong { color:var(--text-main); font-weight:600; }
    .section-title {
      font-size: 0.72rem; font-weight: 600; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: 0.04em;
      margin: 1.1rem 0 0.7rem; padding-bottom: 0.35rem;
      border-bottom: 1px solid var(--border-subtle);
    }
  </style>
</head>
<body>
  <!-- Top Navigation Header -->
  <header class="header">
    <div class="header-inner">
      <div class="brand-section">
        <div class="brand-logo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect width="20" height="8" x="2" y="2" rx="2" ry="2"/>
            <rect width="20" height="8" x="2" y="14" rx="2" ry="2"/>
            <line x1="6" x2="6.01" y1="6" y2="6"/>
            <line x1="6" x2="6.01" y1="18" y2="18"/>
          </svg>
        </div>
        <div class="brand-title">
          <span data-brand-name>__SITE_NAME__</span>
          <span class="brand-tag">ADMIN</span>
        </div>
      </div>

      <div class="header-controls">
        <!-- Return to Dashboard Button -->
        <a href="/" target="_blank" class="btn-control" style="text-decoration:none;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          </svg>
          <span id="txtViewSite">查看前台</span>
        </a>

        <!-- Language Switcher -->
        <div class="dropdown-wrapper">
          <button id="langToggleBtn" class="btn-control">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>
            </svg>
            <span id="currentLangLabel">中文</span>
          </button>
          <div id="langMenu" class="dropdown-menu">
            <button class="dropdown-item" onclick="setLang('zh')">简体中文 (CN)</button>
            <button class="dropdown-item" onclick="setLang('en')">English (US)</button>
          </div>
        </div>

        <!-- Theme Mode Switcher (System / Light / Dark) -->
        <div class="dropdown-wrapper">
          <button id="themeToggleBtn" class="btn-control">
            <span id="currentThemeIcon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
            </span>
            <span id="currentThemeLabel">深色</span>
          </button>
          <div id="themeMenu" class="dropdown-menu">
            <button class="dropdown-item" onclick="setTheme('system')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
              <span>跟随系统</span>
            </button>
            <button class="dropdown-item" onclick="setTheme('light')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M2 12h2"/><path d="M20 12h2"/></svg>
              <span>浅色模式</span>
            </button>
            <button class="dropdown-item" onclick="setTheme('dark')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
              <span>深色模式</span>
            </button>
          </div>
        </div>

        <!-- Two Factor Auth -->
        <button onclick="open2faModal()" class="btn-control" title="两步验证 (2FA)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/>
          </svg>
          <span>两步验证</span>
        </button>

        <!-- Change Password -->
        <button onclick="changePassword()" class="btn-control" title="修改管理员登录密码">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span>改密码</span>
        </button>

        <!-- Logout Button -->
        <button onclick="logout()" class="btn-control" style="color:var(--status-danger); border-color:rgba(239,68,68,0.3);">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>
          </svg>
          <span id="txtLogout">退出</span>
        </button>
      </div>
    </div>
  </header>

  <!-- Admin Main Body -->
  <main class="admin-container">
    <!-- Top KPI Overview Cards -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
      <div class="panel-card" style="padding:1.15rem; margin-bottom:0;">
        <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:0.4rem;" id="txtKpiTotal">托管节点总数</div>
        <div style="font-size:1.6rem; font-weight:700;" id="statTotalNodes">0</div>
        <div id="kpiTokenHint" style="font-size:0.72rem; color:var(--status-online); margin-top:0.25rem;">节点均使用独立令牌</div>
      </div>
      <div class="panel-card" style="padding:1.15rem; margin-bottom:0;">
        <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:0.4rem;" id="txtKpiOnline">在线活跃节点</div>
        <div style="font-size:1.6rem; font-weight:700; color:var(--status-online);" id="statOnlineNodes">0</div>
        <div style="font-size:0.72rem; color:var(--text-muted); margin-top:0.25rem;">WebSocket 实时心跳中</div>
      </div>
      <div class="panel-card" style="padding:1.15rem; margin-bottom:0;">
        <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:0.4rem;" id="txtKpiCost">月度总支出折算</div>
        <div style="font-size:1.6rem; font-weight:700; color:var(--accent-primary);" id="statMonthlyCost">$0.00 <span style="font-size:0.75rem; font-weight:normal; color:var(--text-muted);">/mo</span></div>
        <div style="font-size:0.72rem; color:var(--text-muted); margin-top:0.25rem;">自动折算月度账单</div>
      </div>
      <div class="panel-card" style="padding:1.15rem; margin-bottom:0;">
        <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:0.4rem;" id="txtKpiSecurity">安全审计状态</div>
        <div id="statRecentLogin" style="font-size:1rem; font-weight:650; overflow-wrap:anywhere;">读取中…</div>
        <div id="recentLoginIp" style="font-size:0.72rem; color:var(--text-muted); margin-top:0.25rem;">最近成功登录</div>
      </div>
    </div>

    <!-- Navigation Tabs (Clean Linear SVG Icons, No Emoji) -->
    <div class="tabs-nav">
      <button class="tab-btn active" onclick="showTab('nodes', event)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>
        </svg>
        <span id="tabTitleNodes">节点管理与安装</span>
      </button>

      <button class="tab-btn" onclick="showTab('themes', event)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2Z"/>
        </svg>
        <span id="tabTitleThemes">主题引擎切换</span>
      </button>

      <button class="tab-btn" onclick="showTab('targets', event)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
        </svg>
        <span id="tabTitleTargets">延迟监控目标</span>
      </button>

      <button class="tab-btn" onclick="showTab('costs', event)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 16V9m4 7V5m4 11v-4"/></svg>
        <span id="tabTitleCosts">成本中心</span>
      </button>

      <button class="tab-btn" onclick="showTab('alerts', event)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
        </svg>
        <span id="tabTitleAlerts">告警通知配置</span>
      </button>

      <button class="tab-btn" onclick="showTab('audit', event)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>
        </svg>
        <span id="tabTitleAudit">安全审计日志</span>
      </button>

      <button class="tab-btn" onclick="showTab('settings', event)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="m19.4 15 .1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.8 1.8 0 0 0-3.1 1.3v.2a2 2 0 1 1-4 0v-.2A1.8 1.8 0 0 0 6.4 18l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.8 1.8 0 0 0 2.3 12a1.8 1.8 0 0 0 1.3-3.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.8 1.8 0 0 0 9.5 4.8v-.2a2 2 0 1 1 4 0v.2A1.8 1.8 0 0 0 16.6 6l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.8 1.8 0 0 0 20.7 12a1.8 1.8 0 0 0-1.3 3.1Z"/></svg>
        <span id="tabTitleSettings">网站设置</span>
      </button>
    </div>

    <section id="tab-costs" class="panel-card" style="display:none;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;margin-bottom:1rem;">
        <div><div id="costTitle" style="font-size:1rem;font-weight:650;">成本中心</div><div id="costSubtitle" style="font-size:.75rem;color:var(--text-muted);margin-top:.25rem;">基于节点当前价格和续费周期估算；不包含历史支付记录。</div></div>
        <div id="costUpdated" style="font-size:.72rem;color:var(--text-muted);"></div>
      </div>
      <div id="costKpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.7rem;margin-bottom:1rem;"></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:1rem;">
        <div style="border-top:1px solid var(--border-subtle);padding-top:1rem;">
          <div id="costRenewalTitle" style="font-size:.84rem;font-weight:600;margin-bottom:.75rem;">未来 12 个月续费预测</div>
          <div id="renewalChart" style="height:230px;display:flex;align-items:end;gap:5px;border-bottom:1px solid var(--border-subtle);padding:0 4px;"></div>
        </div>
        <div style="border-top:1px solid var(--border-subtle);padding-top:1rem;">
          <div id="costProviderTitle" style="font-size:.84rem;font-weight:600;margin-bottom:.75rem;">月均成本 · 按服务商</div>
          <div id="providerChart" style="display:grid;gap:.75rem;"></div>
        </div>
      </div>
      <div style="margin-top:1rem;border-top:1px solid var(--border-subtle);padding-top:1rem;">
        <div id="costUpcomingTitle" style="font-size:.84rem;font-weight:600;margin-bottom:.7rem;">近期续费</div>
        <div id="upcomingRenewals" style="display:grid;gap:.4rem;"></div>
      </div>
      <div id="costDisclaimer" style="font-size:.7rem;color:var(--text-muted);margin-top:1rem;">美元等值使用固定参考汇率（USD 1、CNY 0.138、EUR 1.08、GBP 1.27、JPY 0.0067），仅用于趋势比较；实际扣款以账单为准。</div>
    </section>

    <!-- Tab 1: Nodes -->
    <div id="tab-nodes" class="panel-card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap:wrap; gap:0.5rem;">
        <div>
          <div style="font-weight: 600; font-size: 1rem;" id="txtNodeListTitle">托管服务器列表</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);" id="txtNodeListSub">点击右侧按钮复制 Linux (AMD64/ARM64) 及 Windows 一键脚本</div>
        </div>
        <button class="btn-control active" onclick="openAddModal()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>
          <span id="txtBtnAddNode">添加新服务器</span>
        </button>
      </div>

      <div class="node-filters" style="display:flex; gap:0.55rem; flex-wrap:wrap; margin-bottom:1rem;">
        <input id="nodeSearch" class="input-field" style="max-width:260px; margin-top:0;" placeholder="搜索名称或 IP" oninput="applyNodeFilters()" />
        <div id="nodeRegionFilter" class="filter-select"></div>
        <div id="nodeStatusFilter" class="filter-select" style="min-width:130px;"></div>
      </div>

      <!-- Add Server Form Box -->
      <div class="table-responsive">
        <table class="probe-table" style="font-size:0.82rem;">
          <thead>
            <tr>
              <th id="thName">名称</th>
              <th id="thNetwork">网络（IPv4 / IPv6）</th>
              <th id="thAgentVersion">Agent 版本</th>
              <th id="thPrice">价格周期</th>
              <th id="thTags">标签</th>
              <th id="thStatus">状态</th>
              <th style="text-align:right;" id="thAction">操作</th>
            </tr>
          </thead>
          <tbody id="nodesTbody">
            <tr><td colspan="7" style="text-align:center; padding:1.5rem; color:var(--text-muted);">正在加载...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Tab: Monitor Targets -->
    <div id="tab-targets" class="panel-card" style="display: none;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap:wrap; gap:0.5rem;">
        <div>
          <div id="targetsTitle" style="font-weight: 600; font-size: 1rem;">延迟监控目标</div>
          <div id="targetsSubtitle" style="font-size: 0.75rem; color: var(--text-muted);">
            Agent 会对这些地址做 TCP 探测，结果展示在前台节点详情页。建议按「不同地区 + 不同运营商」各配一个落点。
          </div>
        </div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
        <button id="resetTargetsBtn" class="btn-control" onclick="resetDefaultTargets()" title="用默认的 93 个中国三网目标覆盖当前列表">恢复默认目标</button>
        <button class="btn-control active" onclick="openTargetModal()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>
          <span id="addTargetBtnText">添加目标</span>
        </button>
        </div>
      </div>

      <div class="admin-table-wrap" style="max-height:68vh;">
        <table class="probe-table" style="width:100%;">
          <thead>
            <tr>
              <th>名称</th>
              <th>主机</th>
              <th>端口</th>
              <th>运营商</th>
              <th>地区</th>
              <th>状态</th>
              <th style="text-align:right;">操作</th>
            </tr>
          </thead>
          <tbody id="targetsTbody">
            <tr><td colspan="7" style="text-align:center; padding:1.5rem; color:var(--text-muted);">正在加载...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Tab 2: Themes -->
    <div id="tab-themes" class="panel-card" style="display: none;">
      <div id="themesDescription" style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:1.25rem;">
        系统自动扫描 <code>web/themes/</code> 目录中的全部外部主题，支持零配置热切换：
      </div>
      <div id="themesGrid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:1rem;"></div>
    </div>

    <!-- Tab 3: Alerts -->
    <div id="tab-alerts" class="panel-card" style="display: none;">
      <div id="alertsTitle" style="font-weight:600; font-size:1rem; margin-bottom:0.4rem;">告警通知</div>
      <div id="alertsSubtitle" style="font-size:0.78rem; color:var(--text-muted); margin-bottom:1.25rem;">
        先配置通知渠道，再在节点编辑里选择哪些节点和事件接收告警。同一节点同一事件会自动冷却，避免刷屏。
      </div>

      <div style="max-width: 720px;">
        <div id="smtpSectionTitle" class="section-title">SMTP 服务器</div>
        <label class="switch-row" style="margin-bottom:0.75rem;"><input type="checkbox" id="alertSmtpEnabled" /> 启用 SMTP 邮件</label>
        <div class="form-grid">
          <div class="form-item">
            <label>服务器地址</label>
            <input id="alertHost" type="text" placeholder="smtp.qq.com" />
          </div>
          <div class="form-item">
            <label>端口</label>
            <input id="alertPort" type="number" value="465" min="1" max="65535" />
            <div class="hint">465 走 SSL，587 走 STARTTLS</div>
          </div>
          <div class="form-item">
            <label>用户名</label>
            <input id="alertUser" type="text" placeholder="you@example.com" />
          </div>
          <div class="form-item">
            <label>密码 / 授权码</label>
            <input id="alertPass" type="password" placeholder="留空表示不修改" />
          </div>
          <div class="form-item">
            <label>发件人</label>
            <input id="alertFrom" type="text" placeholder="you@example.com" />
          </div>
          <div class="form-item">
            <label>收件人</label>
            <input id="alertTo" type="text" placeholder="多个用英文逗号分隔" />
          </div>
        </div>

        <div class="section-title">Telegram</div>
        <div class="form-grid">
          <div class="form-item">
            <label>Bot Token</label>
            <input id="alertTelegramToken" type="password" placeholder="留空表示不修改" />
          </div>
          <div class="form-item">
            <label>Chat ID</label>
            <input id="alertTelegramChatId" type="text" placeholder="例如 -1001234567890" />
          </div>
        </div>
        <label class="switch-row" style="margin-top:0.65rem;"><input type="checkbox" id="alertTelegramEnabled" /> 启用 Telegram</label>

        <div class="section-title">Webhook</div>
        <div class="form-grid">
          <div class="form-item" style="grid-column:1 / -1;">
            <label>Webhook URL</label>
            <input id="alertWebhookUrl" type="url" placeholder="https://example.com/hooks/aegis" />
          </div>
        </div>
        <label class="switch-row" style="margin-top:0.65rem;"><input type="checkbox" id="alertWebhookEnabled" /> 启用 Webhook（POST JSON）</label>

        <div class="section-title">触发条件</div>
        <div style="display:flex; flex-direction:column; gap:0.65rem;">
          <label class="switch-row">
            <input type="checkbox" id="alertEnabled" /> 启用全局告警
          </label>
          <label class="switch-row">
            <input type="checkbox" id="alertOffline" checked /> 节点离线（心跳超时 10 秒）
          </label>
          <label class="switch-row">
            <input type="checkbox" id="alertOnline" checked /> 节点恢复在线
          </label>
          <label class="switch-row">
            <input type="checkbox" id="alertCpu" /> CPU 使用率超过
            <input id="alertCpuTh" type="number" value="90" min="1" max="100"
                   style="width:72px; padding:0.25rem 0.45rem; border-radius:6px; border:1px solid var(--border-subtle); background:var(--bg-input); color:var(--text-main); font-size:0.78rem;" /> %
          </label>
          <label class="switch-row">
            <input type="checkbox" id="alertTraffic" /> 流量使用超过
            <input id="alertTrafficTh" type="number" value="90" min="1" max="100"
                   style="width:72px; padding:0.25rem 0.45rem; border-radius:6px; border:1px solid var(--border-subtle); background:var(--bg-input); color:var(--text-main); font-size:0.78rem;" /> %
          </label>
        </div>

        <div style="margin-top:1.25rem; display:flex; gap:0.75rem; flex-wrap:wrap;">
          <button class="btn-control active" onclick="saveAlerts()">保存配置</button>
          <button class="btn-control" onclick="testAlert()">发送测试告警</button>
        </div>
      </div>

      <div class="section-title" style="margin-top:1.75rem;">最近告警事件</div>
      <div class="table-responsive">
        <table class="probe-table" style="font-size:0.8rem;">
          <thead><tr><th>时间</th><th>节点</th><th>事件</th><th>内容</th></tr></thead>
          <tbody id="alertEventsTbody"><tr><td colspan="4" style="color:var(--text-muted);">暂无告警事件</td></tr></tbody>
        </table>
      </div>
    </div>


    <div id="tab-audit" class="panel-card" style="display: none;">
        <div id="auditTitle" style="font-weight:600; margin-bottom:1rem; font-size:1rem;">安全审计日志与登录历史</div>
      <div id="latestLoginSummary" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.65rem;margin-bottom:1rem;"></div>
      <div class="table-responsive">
        <table class="probe-table" style="font-size:0.8rem;">
          <thead>
            <tr>
              <th>时间戳</th>
              <th>审计行为</th>
              <th>来源 IP</th>
            </tr>
          </thead>
          <tbody id="auditTbody"></tbody>
        </table>
      </div>
    </div>

    <div id="tab-settings" class="panel-card" style="display: none;">
      <div id="settingsTitle" style="font-weight:600;font-size:1rem;margin-bottom:.35rem;">网站设置</div>
      <div id="settingsSubtitle" style="font-size:.76rem;color:var(--text-muted);margin-bottom:1.1rem;">网站名称会同步应用到前台标题、后台标题、登录页标题和品牌文字。</div>
      <div style="max-width:520px;">
        <div class="form-item"><label for="siteNameInput">网站名称</label><input id="siteNameInput" type="text" maxlength="48" placeholder="Moniter" /></div>
        <button class="btn-control active" style="margin-top:1rem;" onclick="saveSiteSettings()">保存网站名称</button>
      </div>
    </div>
  </main>

  <!-- One-Click Install Script Modal -->
  <div id="cmdModal" class="modal-backdrop">
    <div class="modal-window" style="max-width: 650px;">
      <div class="modal-header">
        <div style="font-weight:700; font-size:1.05rem; display:flex; align-items:center; gap:0.5rem;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>
          <span>一键部署 Agent 安装命令</span>
        </div>
        <button class="btn-close" onclick="closeCmdModal()">&times;</button>
      </div>
      <div style="font-size:0.825rem; line-height:1.6; color:var(--text-secondary); margin-bottom:1rem;">
        在目标 VPS 终端执行命令，脚本自动检测架构 (Linux x86_64 / ARM64) 并配置 systemd 后台常驻：
      </div>
      
      <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:0.35rem;">Linux (Ubuntu / Debian / CentOS / Alpine / 甲骨文ARM):</div>
      <div style="background:var(--bg-tertiary); border:1px solid var(--border-subtle); border-radius:8px; padding:0.85rem; font-family:var(--font-mono); font-size:0.8rem; word-break:break-all; margin-bottom:1rem; color:var(--accent-primary);" id="cmdBox"></div>
      
      <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:0.35rem;">Windows (PowerShell 一键):</div>
      <div style="background:var(--bg-tertiary); border:1px solid var(--border-subtle); border-radius:8px; padding:0.85rem; font-family:var(--font-mono); font-size:0.78rem; word-break:break-all; margin-bottom:1.25rem; color:var(--status-online);" id="cmdBoxPs"></div>

      <button class="btn-control active" style="width:100%; justify-content:center; padding:0.65rem;" onclick="copyCmd()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
        <span>一键复制 Linux 安装命令</span>
      </button>
    </div>
  </div>

  <!-- Node Edit / Add Modal -->
  <div id="editModal" class="modal-backdrop">
    <div class="modal-window" style="max-width: 760px;">
      <div class="modal-header">
        <div style="font-weight:700; font-size:1.05rem; display:flex; align-items:center; gap:0.5rem;">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
          <span id="editModalTitle">编辑节点配置</span>
        </div>
        <button class="btn-close" onclick="closeEditModal()">&times;</button>
      </div>

      <div style="max-height: 68vh; overflow-y: auto; padding-right: 6px;">
        <div class="section-title">基本信息</div>
        <div class="form-grid">
          <div class="form-item">
            <label>节点名称</label>
            <input id="editName" type="text" placeholder="例如 HKG-CN2-GIA" />
          </div>
          <div class="form-item">
            <label>地区</label>
            <div id="editRegionSel"></div>
          </div>
          <div class="form-item">
            <label>地区显示名</label>
            <input id="editRegionName" type="text" placeholder="留空则用地区默认名" />
          </div>
          <div class="form-item">
            <label>服务商</label>
            <input id="editProvider" type="text" placeholder="例如 BandwagonHost" />
          </div>
          <div class="form-item">
            <label>标签</label>
            <input id="editTags" type="text" placeholder="生产, 香港, 线路A" />
            <div class="hint">多个标签用逗号分隔</div>
          </div>
        </div>

        <div class="section-title">账单</div>
        <div class="form-grid">
          <div class="form-item">
            <label>价格</label>
            <input id="editPrice" type="number" step="0.01" min="0" value="0" />
          </div>
          <div class="form-item">
            <label>币种</label>
            <div id="editCurrencySel"></div>
          </div>
          <div class="form-item">
            <label>付费周期</label>
            <div id="editCycleSel"></div>
          </div>
          <div class="form-item">
            <label>下次续费日</label>
            <input id="editRenewal" type="date" />
          </div>
        </div>

        <div class="section-title">流量</div>
        <div class="form-grid">
          <div class="form-item">
            <label>流量配额 (GB)</label>
            <input id="editTraffic" type="number" min="0" step="1" value="1000" />
          </div>
          <div class="form-item">
            <label>计费方式</label>
            <div id="editTrafficTypeSel"></div>
          </div>
          <div class="form-item">
            <label>每月重置日</label>
            <input id="editResetDay" type="number" min="1" max="31" value="1" />
          </div>
          <div class="form-item" id="editUsedBox">
            <label>当前已用 (GB)</label>
            <input id="editUsedGb" type="text" readonly value="—" />
            <div class="hint">用列表里的「校准」按钮修改</div>
          </div>
        </div>

        <div class="section-title">监控</div>
        <div class="form-grid">
          <div class="form-item">
            <label>延迟监控</label>
            <label class="switch-row" style="padding-top:0.45rem;">
              <input type="checkbox" id="editMonitorEnabled" /> 启用自定义目标探测
            </label>
          </div>
          <div class="form-item">
            <label>监控范围</label>
            <div id="editMonitorModeSel"></div>
          </div>
          <div class="form-item">
            <label>回程检测</label>
            <label class="switch-row" style="padding-top:0.45rem;">
              <input type="checkbox" id="editRouteEnabled" /> 启用 traceroute 诊断
            </label>
          </div>
        </div>

        <div id="editTargetPick" style="display:none; margin-top:0.75rem;">
          <label style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:0.45rem;">选择要探测的目标</label>
          <div id="editTargetList" style="display:flex; flex-wrap:wrap; gap:0.4rem;"></div>
        </div>

        <div class="section-title">节点告警</div>
        <div class="form-grid">
          <div class="form-item">
            <label>告警总开关</label>
            <label class="switch-row" style="padding-top:0.45rem;"><input type="checkbox" id="editAlertEnabled" /> 接收此节点告警</label>
          </div>
          <div class="form-item">
            <label>告警类型</label>
            <div style="display:flex; flex-wrap:wrap; gap:0.6rem; padding-top:0.45rem;">
              <label class="switch-row"><input type="checkbox" id="editAlertOffline" checked /> 离线</label>
              <label class="switch-row"><input type="checkbox" id="editAlertCpu" /> CPU</label>
              <label class="switch-row"><input type="checkbox" id="editAlertTraffic" /> 流量</label>
            </div>
          </div>
        </div>
      </div>

      <div style="display:flex; gap:0.5rem; justify-content:space-between; margin-top:1.25rem; flex-wrap:wrap;">
        <div style="display:flex; gap:0.5rem;">
          <button class="btn-control" id="editResetTokenBtn" onclick="resetToken()">重置 Token</button>
          <button class="btn-control" id="editCalibrateBtn" onclick="calibrateTraffic()">校准流量</button>
        </div>
        <div style="display:flex; gap:0.5rem;">
          <button class="btn-control" onclick="closeEditModal()">取消</button>
          <button class="btn-control active" id="editSubmitBtn" onclick="submitServerEdit()">保存修改</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Target Modal -->
  <div id="targetModal" class="modal-backdrop">
    <div class="modal-window" style="max-width: 560px;">
      <div class="modal-header">
        <div style="font-weight:700; font-size:1.05rem; display:flex; align-items:center; gap:0.5rem;">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
          <span id="targetModalTitle">添加监控目标</span>
        </div>
        <button class="btn-close" onclick="closeTargetModal()">&times;</button>
      </div>

      <div class="form-grid">
        <div class="form-item">
          <label>名称</label>
          <input id="tgtName" type="text" placeholder="北京电信" />
        </div>
        <div class="form-item">
          <label>IP / 域名</label>
          <input id="tgtHost" type="text" placeholder="219.141.136.10" />
        </div>
        <div class="form-item">
          <label>探测端口</label>
          <input id="tgtPort" type="number" min="1" max="65535" value="53" />
          <div class="hint">TCP 探测；53 常被拦截，可换 80 / 443</div>
        </div>
        <div class="form-item">
          <label>运营商</label>
          <div id="tgtCarrier"></div>
        </div>
        <div class="form-item">
          <label>地区</label>
          <input id="tgtRegion" type="text" placeholder="北京" />
        </div>
        <div class="form-item">
          <label>状态</label>
          <label class="switch-row" style="padding-top:0.45rem;">
            <input type="checkbox" id="tgtEnabled" checked /> 启用探测
          </label>
        </div>
      </div>

      <div style="display:flex; gap:0.5rem; justify-content:flex-end; margin-top:1.25rem;">
        <button class="btn-control" onclick="closeTargetModal()">取消</button>
        <button class="btn-control active" onclick="submitTarget()">保存</button>
      </div>
    </div>
  </div>

  <!-- Two Factor Modal -->
  <div id="tfaModal" class="modal-backdrop">
    <div class="modal-window" style="max-width: 480px;">
      <div class="modal-header">
        <div style="font-weight:700; font-size:1.05rem; display:flex; align-items:center; gap:0.5rem;">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></svg>
          <span>两步验证 (2FA)</span>
        </div>
        <button class="btn-close" onclick="close2faModal()">&times;</button>
      </div>
      <div id="tfaBody"></div>
    </div>
  </div>


  <script src="/assets/iso-regions.js"></script>
  <script>
    // ==========================================
    // Theme & i18n Engines (Same as Front-end)
    // ==========================================
    // ==========================================
    // 基础 UI 组件（自定义下拉 / Toast / 确认框）
    // 不用原生 alert/confirm/select —— 各浏览器样式不统一且无法美化
    // ==========================================
    const CURRENCIES = [
      { value: 'USD', label: '美元 USD', sub: '$' },
      { value: 'EUR', label: '欧元 EUR', sub: '€' },
      { value: 'CNY', label: '人民币 CNY', sub: '¥' },
      { value: 'GBP', label: '英镑 GBP', sub: '£' },
      { value: 'JPY', label: '日元 JPY', sub: '¥' },
      { value: 'HKD', label: '港币 HKD', sub: 'HK$' },
      { value: 'SGD', label: '新加坡元 SGD', sub: 'S$' },
      { value: 'AUD', label: '澳元 AUD', sub: 'A$' },
      { value: 'CAD', label: '加元 CAD', sub: 'C$' },
      { value: 'RUB', label: '卢布 RUB', sub: '₽' },
    ];

    const regionNamesZh = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
    const regionNamesEn = new Intl.DisplayNames(['en'], { type: 'region' });
    const regionOverrides = {
      cn: { label: '中国 · 大陆', sub: 'China · Mainland' },
      hk: { label: '中国 · 香港', sub: 'Hong Kong, China' },
      tw: { label: '中国 · 台湾', sub: 'Taiwan, China' },
      kr: { label: '韩国', sub: 'South Korea' },
      gb: { label: '英国', sub: 'United Kingdom' },
      ae: { label: '阿联酋', sub: 'United Arab Emirates' },
    };
    const REGIONS = (window.AEGIS_ISO_REGIONS || []).map((value) => {
      const names = regionOverrides[value] || {};
      const code = value.toUpperCase();
      return {
        value,
        label: names.label || regionNamesZh.of(code) || code,
        sub: names.sub || regionNamesEn.of(code) || code,
        flag: value,
      };
    }).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));

    const CYCLES = [
      { value: 'monthly', label: '月付' },
      { value: 'quarterly', label: '季付' },
      { value: 'semi_annually', label: '半年付' },
      { value: 'annually', label: '年付' },
      { value: 'biennially', label: '两年付' },
      { value: 'triennially', label: '三年付' },
      { value: 'lifetime', label: '永久 / 一次性' },
      { value: 'free', label: '免费' },
    ];

    let _openSelect = null;
    document.addEventListener('click', () => {
      if (_openSelect) {
        _openSelect.classList.remove('open');
        _openSelect = null;
      }
    });

    /// 把原生 select 换成可美化的自定义下拉
    function createSelect(mount, opts) {
      const wrap = document.createElement('div');
      wrap.className = 'cs-wrap';
      wrap.innerHTML = '<button type="button" class="cs-trigger"></button><div class="cs-menu"></div>';
      const trigger = wrap.querySelector('.cs-trigger');
      const menu = wrap.querySelector('.cs-menu');
      let current = opts.value;

      function renderTrigger() {
        const opt = opts.options.find((o) => o.value === current);
        trigger.innerHTML = '';
        if (opt && opt.flag) {
          const img = document.createElement('img');
          img.className = 'cs-flag';
          img.src = '/assets/flags/' + opt.flag + '.svg';
          img.onerror = () => { img.style.visibility = 'hidden'; };
          trigger.appendChild(img);
        }
        const lab = document.createElement('span');
        lab.className = 'cs-label';
        lab.textContent = opt ? opt.label : (opts.placeholder || '请选择');
        if (!opt) lab.style.color = 'var(--text-faint)';
        trigger.appendChild(lab);
        trigger.insertAdjacentHTML('beforeend',
          '<svg class="cs-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>');
      }

      function renderMenu() {
        menu.innerHTML = '';
        opts.options.forEach((o) => {
          const item = document.createElement('div');
          item.className = 'cs-option' + (o.value === current ? ' selected' : '');
          if (o.flag) {
            const img = document.createElement('img');
            img.className = 'cs-flag';
            img.src = '/assets/flags/' + o.flag + '.svg';
            img.onerror = () => { img.style.visibility = 'hidden'; };
            item.appendChild(img);
          }
          const span = document.createElement('span');
          span.textContent = o.label;
          item.appendChild(span);
          if (o.sub) {
            const sub = document.createElement('span');
            sub.className = 'cs-sub';
            sub.textContent = o.sub;
            item.appendChild(sub);
          }
          item.onclick = (e) => {
            e.stopPropagation();
            current = o.value;
            wrap.classList.remove('open');
            _openSelect = null;
            renderTrigger();
            if (opts.onChange) opts.onChange(o.value, o);
          };
          menu.appendChild(item);
        });
      }

      trigger.onclick = (e) => {
        e.stopPropagation();
        if (_openSelect && _openSelect !== wrap) _openSelect.classList.remove('open');
        const open = !wrap.classList.contains('open');
        wrap.classList.toggle('open', open);
        _openSelect = open ? wrap : null;
        if (open) renderMenu();
      };

      renderTrigger();
      mount.appendChild(wrap);

      return {
        get value() { return current; },
        set(v) { current = v; renderTrigger(); },
        setOptions(options) { opts.options = options; if (!options.some((o) => o.value === current)) current = options[0] ? options[0].value : ''; renderTrigger(); },
        el: wrap,
      };
    }

    function toast(msg, type) {
      let wrap = document.querySelector('.toast-wrap');
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.className = 'toast-wrap';
        document.body.appendChild(wrap);
      }
      const el = document.createElement('div');
      el.className = 'toast ' + (type === 'err' ? 'err' : 'ok');
      const ico = document.createElement('span');
      ico.className = 't-ico';
      ico.innerHTML = type === 'err'
        ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--status-danger)" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>'
        : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--status-online)" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>';
      const txt = document.createElement('span');
      txt.textContent = msg;
      el.appendChild(ico);
      el.appendChild(txt);
      wrap.appendChild(el);
      setTimeout(() => {
        el.style.transition = 'opacity .2s';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 220);
      }, 2600);
    }

    function confirmDialog(msg, okText) {
      return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'confirm-backdrop show';
        backdrop.innerHTML =
          '<div class="confirm-box">' +
            '<div class="confirm-msg"></div>' +
            '<div class="confirm-actions">' +
              '<button class="btn-control" data-act="cancel">取消</button>' +
              '<button class="btn-control active" data-act="ok"></button>' +
            '</div>' +
          '</div>';
        backdrop.querySelector('.confirm-msg').textContent = msg;
        backdrop.querySelector('[data-act="ok"]').textContent = okText || '确定';
        const done = (v) => { backdrop.remove(); resolve(v); };
        backdrop.querySelector('[data-act="cancel"]').onclick = () => done(false);
        backdrop.querySelector('[data-act="ok"]').onclick = () => done(true);
        backdrop.onclick = (e) => { if (e.target === backdrop) done(false); };
        document.body.appendChild(backdrop);
      });
    }

    function promptDialog(title, value, placeholder) {
      return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'confirm-backdrop show';
        backdrop.innerHTML =
          '<div class="confirm-box">' +
            '<div style="font-size:0.88rem; margin-bottom:0.75rem; color:var(--text-main);"></div>' +
            '<input type="text" style="width:100%; padding:0.55rem 0.7rem; border-radius:8px; border:1px solid var(--border-subtle); background:var(--bg-input); color:var(--text-main); font-size:0.85rem; box-sizing:border-box;" />' +
            '<div class="confirm-actions" style="margin-top:1rem;">' +
              '<button class="btn-control" data-act="cancel">取消</button>' +
              '<button class="btn-control active" data-act="ok">确定</button>' +
            '</div>' +
          '</div>';
        backdrop.querySelector('div > div').textContent = title;
        const input = backdrop.querySelector('input');
        input.value = value == null ? '' : value;
        if (placeholder) input.placeholder = placeholder;
        const done = (v) => { backdrop.remove(); resolve(v); };
        backdrop.querySelector('[data-act="cancel"]').onclick = () => done(null);
        backdrop.querySelector('[data-act="ok"]').onclick = () => done(input.value.trim());
        backdrop.onclick = (e) => { if (e.target === backdrop) done(null); };
        input.onkeydown = (e) => {
          if (e.key === 'Enter') done(input.value.trim());
          if (e.key === 'Escape') done(null);
        };
        document.body.appendChild(backdrop);
        setTimeout(() => { input.focus(); input.select(); }, 30);
      });
    }

    let curTheme = localStorage.getItem('aegis_theme') || 'system';
    let curLang = localStorage.getItem('aegis_lang') || (navigator.language.startsWith('zh') ? 'zh' : 'en');

    function setTheme(mode) {
      curTheme = mode;
      localStorage.setItem('aegis_theme', mode);
      let real = mode;
      if (mode === 'system') real = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', real);
      document.getElementById('currentThemeLabel').textContent = mode === 'system' ? '跟随系统' : (mode === 'light' ? '浅色' : '深色');
      document.getElementById('themeMenu').classList.remove('show');
    }

    function setLang(lang) {
      curLang = lang;
      localStorage.setItem('aegis_lang', lang);
      document.getElementById('currentLangLabel').textContent = lang === 'zh' ? '中文' : 'English';
      document.getElementById('langMenu').classList.remove('show');
      applyI18n();
    }

    const dict = {
      zh: {
        viewSite: "查看前台", logout: "退出", kpiTotal: "托管节点总数", kpiOnline: "在线活跃节点",
        kpiCost: "月度总支出折算", kpiSecurity: "最近成功登录", tabNodes: "节点管理与安装",
        tabThemes: "主题引擎切换", tabTargets: "延迟监控目标", tabCosts: "成本中心", tabAlerts: "告警通知配置", tabAudit: "安全审计日志", tabSettings: "网站设置",
        listTitle: "托管服务器列表", listSub: "点击右侧按钮复制 Linux (AMD64/ARM64) 及 Windows 一键脚本",
        btnAdd: "添加新服务器", thName: "节点名称", thRegion: "地区", thToken: "专属密钥 (Token)",
        thPrice: "价格周期", thStatus: "状态", thAction: "操作", tokenHint: "节点均使用独立令牌",
        securityValue: "正常防护", securityHint: "防爆破策略已启用", targetsSubtitle: "Agent 会对这些地址做 TCP 探测，结果展示在前台节点详情页。建议按「不同地区 + 不同运营商」各配一个落点。",
        resetTargets: "恢复默认目标", addTarget: "添加目标", themesDescription: "系统自动扫描 web/themes/ 目录中的全部外部主题，支持零配置热切换：",
        alertsTitle: "告警通知", alertsSubtitle: "先配置通知渠道，再在节点编辑里选择哪些节点和事件接收告警。同一节点同一事件会自动冷却，避免刷屏。",
        auditTitle: "安全审计日志与登录历史", settingsTitle: "网站设置", settingsSubtitle: "网站名称会同步应用到前台标题、后台标题、登录页标题和品牌文字。",
        costSubtitle: "基于节点当前价格和续费周期估算；不包含历史支付记录。", costRenewal: "未来 12 个月续费预测", costProvider: "月均成本 · 按服务商", costUpcoming: "近期续费",
        costDisclaimer: "折算使用固定参考汇率（USD 1、CNY 0.138、EUR 1.08、GBP 1.27、JPY 0.0067、HKD 0.128、SGD 0.74、AUD 0.65、CAD 0.73、RUB 0.011），仅供比较；实际扣款以账单为准。"
      },
      en: {
        viewSite: "View Public Dashboard", logout: "Logout", kpiTotal: "Total Nodes", kpiOnline: "Online Active",
        kpiCost: "Est. Monthly Cost", kpiSecurity: "Last successful sign-in", tabNodes: "Nodes & Install",
        tabThemes: "Themes Engine", tabTargets: "Latency Targets", tabCosts: "Cost Center", tabAlerts: "Alert Notifications", tabAudit: "Security Audit", tabSettings: "Site Settings",
        listTitle: "Managed Server Nodes", listSub: "Click install to copy Linux/Windows one-line deploy scripts",
        btnAdd: "Add Server", thName: "Node Name", thRegion: "Region", thToken: "Token Key",
        thPrice: "Billing", thStatus: "Status", thAction: "Actions", tokenHint: "Every node uses a dedicated token",
        securityValue: "Protected", securityHint: "Brute-force protection enabled", targetsSubtitle: "The Agent probes these addresses over TCP and shows results in node details. Configure one target per region and carrier.",
        resetTargets: "Restore defaults", addTarget: "Add target", themesDescription: "All external themes in web/themes/ are discovered automatically and can be switched without extra configuration:",
        alertsTitle: "Alert notifications", alertsSubtitle: "Configure channels here, then choose per-node events in the node editor. A cooldown prevents duplicate alerts.",
        auditTitle: "Security audit and login history", settingsTitle: "Site settings", settingsSubtitle: "The site name is applied to the public title, admin title, login title, and brand text.",
        costSubtitle: "Estimated from current node prices and renewal cycles; historical payments are not included.", costRenewal: "Renewal forecast · next 12 months", costProvider: "Average monthly cost · by provider", costUpcoming: "Upcoming renewals",
        costDisclaimer: "Conversions use fixed reference rates (USD 1, CNY 0.138, EUR 1.08, GBP 1.27, JPY 0.0067, HKD 0.128, SGD 0.74, AUD 0.65, CAD 0.73, RUB 0.011) for comparison only; actual charges follow your invoices."
      }
    };

    function applyI18n() {
      const t = dict[curLang] || dict.zh;
      document.getElementById('txtViewSite').textContent = t.viewSite;
      document.getElementById('txtLogout').textContent = t.logout;
      document.getElementById('txtKpiTotal').textContent = t.kpiTotal;
      document.getElementById('txtKpiOnline').textContent = t.kpiOnline;
      document.getElementById('txtKpiCost').textContent = t.kpiCost;
      document.getElementById('txtKpiSecurity').textContent = t.kpiSecurity;
      document.getElementById('tabTitleNodes').textContent = t.tabNodes;
      document.getElementById('tabTitleThemes').textContent = t.tabThemes;
      document.getElementById('tabTitleTargets').textContent = t.tabTargets;
      document.getElementById('tabTitleCosts').textContent = t.tabCosts;
      document.getElementById('tabTitleAlerts').textContent = t.tabAlerts;
      document.getElementById('tabTitleAudit').textContent = t.tabAudit;
      document.getElementById('tabTitleSettings').textContent = t.tabSettings;
      document.getElementById('kpiTokenHint').textContent = t.tokenHint;
      if (document.getElementById('statRecentLogin').textContent === '正常防护' || document.getElementById('statRecentLogin').textContent === 'Protected') {
        document.getElementById('statRecentLogin').textContent = curLang === 'zh' ? '暂无记录' : 'No record';
        document.getElementById('recentLoginIp').textContent = curLang === 'zh' ? '暂无登录记录' : 'No sign-in record';
      }
      document.getElementById('targetsTitle').textContent = t.tabTargets;
      document.getElementById('targetsSubtitle').textContent = t.targetsSubtitle;
      document.getElementById('resetTargetsBtn').textContent = t.resetTargets;
      document.getElementById('addTargetBtnText').textContent = t.addTarget;
      document.getElementById('themesDescription').textContent = t.themesDescription;
      document.getElementById('alertsTitle').textContent = t.alertsTitle;
      document.getElementById('alertsSubtitle').textContent = t.alertsSubtitle;
      document.getElementById('auditTitle').textContent = t.auditTitle;
      document.getElementById('settingsTitle').textContent = t.settingsTitle;
      document.getElementById('settingsSubtitle').textContent = t.settingsSubtitle;
      document.getElementById('costTitle').textContent = t.tabCosts;
      document.getElementById('costSubtitle').textContent = t.costSubtitle;
      document.getElementById('costRenewalTitle').textContent = t.costRenewal;
      document.getElementById('costProviderTitle').textContent = t.costProvider;
      document.getElementById('costUpcomingTitle').textContent = t.costUpcoming;
      document.getElementById('costDisclaimer').textContent = t.costDisclaimer;
      document.getElementById('txtNodeListTitle').textContent = t.listTitle;
      document.getElementById('txtNodeListSub').textContent = t.listSub;
      document.getElementById('txtBtnAddNode').textContent = t.btnAdd;
      document.getElementById('thName').textContent = t.thName;
      if (document.getElementById('thRegion')) document.getElementById('thRegion').textContent = t.thRegion;
      if (document.getElementById('thToken')) document.getElementById('thToken').textContent = t.thToken;
      document.getElementById('thPrice').textContent = t.thPrice;
      document.getElementById('thStatus').textContent = t.thStatus;
      document.getElementById('thAction').textContent = t.thAction;
      document.getElementById('thNetwork').textContent = curLang === 'zh' ? '网络（IPv4 / IPv6）' : 'Network (IPv4 / IPv6)';
      document.getElementById('thAgentVersion').textContent = curLang === 'zh' ? 'Agent 版本' : 'Agent version';
      document.getElementById('thTags').textContent = curLang === 'zh' ? '标签' : 'Tags';
      if (nodeRegionSelect) {
        const regions = [...new Map((window._nodes || []).map((n) => [n.region, n.region_name || n.region])).entries()]
          .sort((a, b) => a[1].localeCompare(b[1]));
        nodeRegionSelect.setOptions([{ value: '', label: curLang === 'zh' ? '全部国家/地区' : 'All countries / regions' }].concat(regions.map(([value, label]) => ({ value, label, flag: value }))));
        nodeStatusSelect.setOptions([
          { value: '', label: curLang === 'zh' ? '全部状态' : 'All statuses' },
          { value: 'online', label: curLang === 'zh' ? '在线' : 'Online' },
          { value: 'offline', label: curLang === 'zh' ? '离线' : 'Offline' },
        ]);
      }
      const search = document.getElementById('nodeSearch');
      if (search) search.placeholder = curLang === 'zh' ? '搜索名称或 IP' : 'Search name or IP';
      if (document.getElementById('tab-targets').style.display !== 'none') loadTargets();
      if (document.getElementById('tab-costs').style.display !== 'none') loadCosts();
    }

    // Dropdown binds
    document.getElementById('langToggleBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('langMenu').classList.toggle('show');
    });
    document.getElementById('themeToggleBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('themeMenu').classList.toggle('show');
    });
    window.addEventListener('click', () => {
      document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    });

    // ==========================================
    // Management Business Operations
    // ==========================================
    function adminToken() {
      return localStorage.getItem('aegis_admin_token') || '';
    }

    async function apiFetch(url, options) {
      const opts = Object.assign({}, options || {});
      const headers = Object.assign({}, opts.headers || {});
      const t = adminToken();
      if (t) headers['Authorization'] = 'Bearer ' + t;
      if (opts.body) headers['Content-Type'] = 'application/json';
      opts.headers = headers;

      const res = await fetch(url, opts);
      if (res.status === 401) {
        localStorage.removeItem('aegis_admin_token');
        window.location.href = '/admin/login';
        throw new Error('unauthorized');
      }
      return res;
    }

    async function checkAuth() {
      try {
        const res = await apiFetch('/api/v1/admin/status');
        const data = await res.json();
        if (!data.logged_in) {
          window.location.href = '/admin/login';
        } else {
          loadSiteBrand();
          loadNodes();
          loadRecentLogin();
        }
      } catch (e) {}
    }

    async function loadSiteBrand() {
      try {
        const data = await apiFetch('/api/v1/admin/site-settings').then((r) => r.json());
        const name = data.site_name || 'Moniter';
        document.title = name + ' · 管理控制中心';
        const brand = document.querySelector('.brand-title > span:first-child');
        if (brand) brand.textContent = name;
      } catch (e) {}
    }

    async function loadRecentLogin() {
      try {
        const logs = await apiFetch('/api/v1/admin/audit').then((r) => r.json());
        const lastLogin = logs.find((log) => log.action.includes('登录成功'));
        if (!lastLogin) {
          document.getElementById('statRecentLogin').textContent = curLang === 'zh' ? '暂无记录' : 'No record';
          document.getElementById('recentLoginIp').textContent = curLang === 'zh' ? '暂无登录记录' : 'No sign-in record';
          return;
        }
        const parsed = new Date(String(lastLogin.created_at).replace(' ', 'T') + 'Z');
        document.getElementById('statRecentLogin').textContent = isNaN(parsed)
          ? lastLogin.created_at
          : parsed.toLocaleString(curLang === 'zh' ? 'zh-CN' : 'en');
        document.getElementById('recentLoginIp').textContent = (curLang === 'zh' ? '来源 IP · ' : 'Source IP · ') + lastLogin.ip;
      } catch (e) {}
    }

    function showTab(tab, e) {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      if (e && e.currentTarget) e.currentTarget.classList.add('active');
      ['nodes', 'targets', 'costs', 'themes', 'alerts', 'audit', 'settings'].forEach((k) => {
        const el = document.getElementById('tab-' + k);
        if (el) el.style.display = tab === k ? 'block' : 'none';
      });

      if (tab === 'nodes') loadNodes();
      if (tab === 'costs') loadCosts();
      if (tab === 'targets') loadTargets();
      if (tab === 'alerts') { loadAlerts(); loadAlertEvents(); }
      if (tab === 'themes') loadThemes();
      if (tab === 'audit') loadAudit();
      if (tab === 'settings') loadSiteSettings();
    }

    async function loadSiteSettings() {
      const data = await apiFetch('/api/v1/admin/site-settings').then((r) => r.json());
      document.getElementById('siteNameInput').value = data.site_name || 'Moniter';
    }

    async function saveSiteSettings() {
      const siteName = document.getElementById('siteNameInput').value.trim();
      if (!siteName) return toast('网站名称不能为空', 'err');
      const res = await apiFetch('/api/v1/admin/site-settings', { method: 'POST', body: JSON.stringify({ site_name: siteName }) });
      const data = await res.json();
      if (!data.success) return toast(data.message || '保存失败', 'err');
      toast('网站名称已保存');
      document.title = siteName + ' · 管理控制中心';
      document.querySelectorAll('.brand-title > span:first-child').forEach((el) => { el.textContent = siteName; });
    }

    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
      ));
    }

    function replaceChildrenIfChanged(parent, nextChildren) {
      const current = Array.from(parent.children);
      if (current.length === nextChildren.length && current.every((child, index) => child.isEqualNode(nextChildren[index]))) {
        return;
      }
      parent.replaceChildren(...nextChildren);
    }

    // ==========================================
    // 节点：列表 / 新增 / 编辑 / 校准 / 重置令牌
    // ==========================================
    let selRegion, selCurrency, selCycle, selTrafficType, selMonitorMode;
    let nodeRegionSelect, nodeStatusSelect;
    let editMode = 'edit';
    let currentEditId = '';
    let currentTargets = [];

    function initEditSelects() {
      if (selRegion) return;
      selRegion = createSelect(document.getElementById('editRegionSel'), {
        options: REGIONS,
        value: 'cn',
        onChange: (v) => {
          const r = REGIONS.find((x) => x.value === v);
          const nameInput = document.getElementById('editRegionName');
          if (r && !nameInput.dataset.touched) nameInput.value = r.label;
        },
      });
      selCurrency = createSelect(document.getElementById('editCurrencySel'), {
        options: CURRENCIES,
        value: 'USD',
      });
      selCycle = createSelect(document.getElementById('editCycleSel'), {
        options: CYCLES,
        value: 'monthly',
      });
      selTrafficType = createSelect(document.getElementById('editTrafficTypeSel'), {
        options: [
          { value: 'outbound', label: '单向计费', sub: '只统计出站' },
          { value: 'both', label: '双向计费', sub: '出站 + 入站' },
        ],
        value: 'outbound',
      });
      selMonitorMode = createSelect(document.getElementById('editMonitorModeSel'), {
        options: [
          { value: 'all', label: '全部目标' },
          { value: 'selected', label: '指定目标' },
        ],
        value: 'all',
        onChange: (v) => {
          document.getElementById('editTargetPick').style.display = v === 'selected' ? 'block' : 'none';
        },
      });
      document.getElementById('editRegionName').addEventListener('input', (e) => {
        e.target.dataset.touched = '1';
      });
    }

    function renderTargetPicker(selectedIds) {
      const box = document.getElementById('editTargetList');
      box.innerHTML = '';
      if (!currentTargets.length) {
        box.innerHTML = '<span style="font-size:0.75rem;color:var(--text-muted);">还没有监控目标，请先到「延迟监控目标」添加</span>';
        return;
      }
      currentTargets.forEach((t) => {
        const lab = document.createElement('label');
        lab.className = 'switch-row';
        lab.style.cssText = 'padding:0.3rem 0.6rem;border:1px solid var(--border-subtle);border-radius:999px;cursor:pointer;font-size:0.75rem;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = t.id;
        cb.checked = selectedIds.includes(t.id);
        const span = document.createElement('span');
        span.textContent = t.name;
        lab.appendChild(cb);
        lab.appendChild(span);
        box.appendChild(lab);
      });
    }

    async function ensureTargetsLoaded() {
      if (currentTargets.length) return;
      try {
        const res = await apiFetch('/api/v1/admin/targets');
        currentTargets = await res.json();
      } catch (e) {}
    }

    async function openAddModal() {
      initEditSelects();
      await ensureTargetsLoaded();
      editMode = 'add';
      currentEditId = '';
      document.getElementById('editModalTitle').textContent = '添加新服务器';
      document.getElementById('editSubmitBtn').textContent = '创建节点';
      document.getElementById('editName').value = '';
      document.getElementById('editTags').value = '';
      document.getElementById('editProvider').value = '';
      document.getElementById('editRegionName').value = '中国 · 大陆';
      document.getElementById('editRegionName').dataset.touched = '';
      document.getElementById('editPrice').value = '0';
      document.getElementById('editRenewal').value = '';
      document.getElementById('editTraffic').value = '1000';
      document.getElementById('editResetDay').value = '1';
      document.getElementById('editUsedBox').style.display = 'none';
      document.getElementById('editMonitorEnabled').checked = false;
      document.getElementById('editRouteEnabled').checked = false;
      document.getElementById('editAlertEnabled').checked = false;
      document.getElementById('editAlertOffline').checked = true;
      document.getElementById('editAlertCpu').checked = false;
      document.getElementById('editAlertTraffic').checked = false;
      selRegion.set('cn');
      selCurrency.set('USD');
      selCycle.set('monthly');
      selTrafficType.set('outbound');
      selMonitorMode.set('all');
      renderTargetPicker([]);
      document.getElementById('editTargetPick').style.display = 'none';
      // 新增模式下还没有节点，令牌和校准无从谈起
      document.getElementById('editResetTokenBtn').style.display = 'none';
      document.getElementById('editCalibrateBtn').style.display = 'none';
      document.getElementById('editModal').classList.add('show');
    }

    async function editServer(id) {
      const s = (window._nodes || []).find((x) => x.id === id);
      if (!s) return;
      initEditSelects();
      await ensureTargetsLoaded();

      editMode = 'edit';
      currentEditId = s.id;
      document.getElementById('editModalTitle').textContent = '编辑节点配置';
      document.getElementById('editSubmitBtn').textContent = '保存修改';
      document.getElementById('editName').value = s.name || '';
      document.getElementById('editRegionName').value = s.region_name || '';
      document.getElementById('editRegionName').dataset.touched = '1';
      document.getElementById('editProvider').value = s.provider || '';
      document.getElementById('editTags').value = s.tags || '';
      document.getElementById('editPrice').value = s.billing_price;
      document.getElementById('editRenewal').value = (s.renewal_date || '').slice(0, 10);
      document.getElementById('editTraffic').value = s.traffic_limit_gb;
      document.getElementById('editResetDay').value = s.traffic_reset_day || 1;
      document.getElementById('editUsedGb').value = (s.traffic_used_gb || 0).toFixed(2) + ' GB';
      document.getElementById('editUsedBox').style.display = '';
      document.getElementById('editMonitorEnabled').checked = !!s.monitor_enabled;
      document.getElementById('editRouteEnabled').checked = !!s.route_enabled;
      document.getElementById('editAlertEnabled').checked = !!s.alert_enabled;
      document.getElementById('editAlertOffline').checked = s.alert_offline !== false;
      document.getElementById('editAlertCpu').checked = !!s.alert_cpu;
      document.getElementById('editAlertTraffic').checked = !!s.alert_traffic;

      selRegion.set(s.region || 'cn');
      const cur = CURRENCIES.find((c) => c.value === s.billing_currency_code) || CURRENCIES.find((c) => c.sub === s.billing_currency) || CURRENCIES[0];
      selCurrency.set(cur.value);
      selCycle.set(s.billing_cycle || 'monthly');
      selTrafficType.set(s.traffic_type || 'outbound');
      selMonitorMode.set(s.monitor_mode || 'all');

      const ids = String(s.monitor_targets || '').split(',').filter(Boolean).map(Number);
      renderTargetPicker(ids);
      document.getElementById('editTargetPick').style.display = s.monitor_mode === 'selected' ? 'block' : 'none';
      document.getElementById('editResetTokenBtn').style.display = '';
      document.getElementById('editCalibrateBtn').style.display = '';

      document.getElementById('editModal').classList.add('show');
    }

    function closeEditModal() {
      document.getElementById('editModal').classList.remove('show');
    }

    async function submitServerEdit() {
      const region = selRegion.value;
      const regionObj = REGIONS.find((r) => r.value === region);
      const name = document.getElementById('editName').value.trim();
      if (!name) {
        toast('节点名称不能为空', 'err');
        return;
      }

      const cur = CURRENCIES.find((c) => c.value === selCurrency.value) || CURRENCIES[0];
      const payload = {
        name,
        region,
        region_name: document.getElementById('editRegionName').value.trim() || (regionObj ? regionObj.label : region),
        region_name_en: regionObj ? regionObj.sub : '',
        provider: document.getElementById('editProvider').value.trim() || 'VPS',
        tags: document.getElementById('editTags').value.trim(),
        billing_price: parseFloat(document.getElementById('editPrice').value) || 0,
        billing_currency: cur.sub,
        billing_currency_code: cur.value,
        billing_cycle: selCycle.value,
        renewal_date: document.getElementById('editRenewal').value,
        traffic_limit_gb: parseFloat(document.getElementById('editTraffic').value) || 0,
        traffic_type: selTrafficType.value,
        traffic_reset_day: parseInt(document.getElementById('editResetDay').value, 10) || 1,
        monitor_enabled: document.getElementById('editMonitorEnabled').checked,
        monitor_mode: selMonitorMode.value,
        monitor_targets: Array.from(document.querySelectorAll('#editTargetList input:checked'))
          .map((c) => c.value)
          .join(','),
        route_enabled: document.getElementById('editRouteEnabled').checked,
        alert_enabled: document.getElementById('editAlertEnabled').checked,
        alert_offline: document.getElementById('editAlertOffline').checked,
        alert_cpu: document.getElementById('editAlertCpu').checked,
        alert_traffic: document.getElementById('editAlertTraffic').checked,
      };

      let url = '/api/v1/admin/servers/update';
      if (editMode === 'add') {
        url = '/api/v1/admin/servers/add';
      } else {
        payload.id = currentEditId;
      }

      const res = await apiFetch(url, { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json();
      if (!data.success) {
        toast('保存失败：' + (data.message || '未知错误'), 'err');
        return;
      }

      closeEditModal();
      toast(editMode === 'add' ? '节点已创建，去「安装命令」复制部署脚本' : '配置已保存');
      loadNodes();
    }

    async function resetToken() {
      if (editMode !== 'edit') return;
      const ok = await confirmDialog(
        '重置后旧令牌立即失效，正在运行的 Agent 会断开连接，需要重新执行安装命令。确定重置吗？',
        '重置令牌'
      );
      if (!ok) return;

      const res = await apiFetch('/api/v1/admin/servers/reset_token', {
        method: 'POST',
        body: JSON.stringify({ id: currentEditId }),
      });
      const data = await res.json();
      if (!data.success) {
        toast('重置失败：' + (data.message || ''), 'err');
        return;
      }
      toast('令牌已重置，请重新执行安装命令');
      closeEditModal();
      loadNodes();
    }

    async function calibrateTraffic() {
      if (editMode !== 'edit') return;
      const cur = (window._nodes || []).find((x) => x.id === currentEditId);
      const v = await promptDialog(
        '把「当前已用流量」设成多少 GB？（之后的用量从这个值继续累加）',
        cur ? (cur.traffic_used_gb || 0).toFixed(2) : '',
        '例如 428.5'
      );
      if (v === null) return;
      const gb = parseFloat(v);
      if (isNaN(gb) || gb < 0) {
        toast('请输入有效的数字', 'err');
        return;
      }

      const res = await apiFetch('/api/v1/admin/servers/calibrate', {
        method: 'POST',
        body: JSON.stringify({ id: currentEditId, used_gb: gb }),
      });
      const data = await res.json();
      if (!data.success) {
        toast('校准失败：' + (data.message || ''), 'err');
        return;
      }
      document.getElementById('editUsedGb').value = gb.toFixed(2) + ' GB';
      toast('已校准为 ' + gb.toFixed(2) + ' GB');
      loadNodes();
    }

    async function delServer(id) {
      const ok = await confirmDialog('确定删除该服务器节点？相关的历史指标也会一并清除。', '删除');
      if (!ok) return;
      await apiFetch('/api/v1/admin/servers/delete', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      toast('节点已删除');
      loadNodes();
    }

    async function loadNodes() {
      const tbody = document.getElementById('nodesTbody');
      try {
        const res = await apiFetch('/api/v1/admin/servers');
        const list = await res.json();
        window._nodes = list;
        if (!nodeRegionSelect) {
          nodeRegionSelect = createSelect(document.getElementById('nodeRegionFilter'), { options: [{ value: '', label: '全部国家/地区' }], value: '', onChange: applyNodeFilters });
          nodeStatusSelect = createSelect(document.getElementById('nodeStatusFilter'), { options: [{ value: '', label: '全部状态' }, { value: 'online', label: '在线' }, { value: 'offline', label: '离线' }], value: '', onChange: applyNodeFilters });
        }
        const currentRegion = nodeRegionSelect.value;
        const regions = [...new Map(list.map((n) => [n.region, n.region_name || n.region])).entries()]
          .sort((a, b) => a[1].localeCompare(b[1]));
        nodeRegionSelect.setOptions([{ value: '', label: curLang === 'zh' ? '全部国家/地区' : 'All regions' }].concat(
          regions.map(([value, label]) => ({ value, label, flag: value }))
        ));
        nodeRegionSelect.set(currentRegion);
        document.getElementById('statTotalNodes').textContent = list.length;
        document.getElementById('statOnlineNodes').textContent = list.filter((x) => x.status === 'online').length;

        let totalCost = 0;
        list.forEach((s) => {
          let p = s.billing_price;
          if (s.billing_cycle === 'annually') p /= 12;
          else if (s.billing_cycle === 'quarterly') p /= 3;
          else if (s.billing_cycle === 'semi_annually') p /= 6;
          else if (s.billing_cycle === 'biennially') p /= 24;
          else if (s.billing_cycle === 'triennially') p /= 36;
          else if (s.billing_cycle === 'lifetime' || s.billing_cycle === 'free') p = 0;
          totalCost += p;
        });
        document.getElementById('statMonthlyCost').innerHTML =
          '$' + totalCost.toFixed(2) +
          ' <span style="font-size:0.75rem; font-weight:normal; color:var(--text-muted);">' +
          (curLang === 'zh' ? '/月' : '/mo') + '</span>';

        if (list.length === 0) {
          const empty = document.createElement('tr');
          empty.innerHTML = '<td colspan="7" style="text-align:center; padding:2rem; color:var(--text-muted);">暂无节点，点击右上角「添加新服务器」</td>';
          if (!tbody.firstElementChild || tbody.firstElementChild.dataset.empty !== 'true') {
            empty.dataset.empty = 'true';
            tbody.replaceChildren(empty);
          }
          return;
        }

        const existingRows = new Map(Array.from(tbody.querySelectorAll('tr[data-server-id]'))
          .map((row) => [row.dataset.serverId, row]));
        const nextRows = [];
        list.forEach((s) => {
          const origin = location.origin;
          const cmd = 'curl -fsSL -H "Authorization: Bearer ' + s.token + '" ' + origin + '/install.sh | bash';
          const cmdPs = 'iwr -useb -Headers @{Authorization="Bearer ' + s.token + '"} ' + origin + '/install.ps1 | iex';

          const usedPct = s.traffic_limit_gb > 0 ? Math.min(100, (s.traffic_used_gb / s.traffic_limit_gb) * 100) : 0;

          const tr = document.createElement('tr');
          tr.dataset.serverId = s.id;
          tr.dataset.name = String(s.name || '').toLocaleLowerCase();
          tr.dataset.ip = String([s.ipv4, s.ipv6].join(' ')).toLocaleLowerCase();
          tr.dataset.region = s.region || '';
          tr.dataset.status = s.status || 'offline';
          tr.innerHTML =
            '<td><strong>' + esc(s.name) + '</strong><div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;"><img class="flag-mark" src="/assets/flags/' + esc((s.region || 'un').toLowerCase()) + '.svg" onerror="this.style.display=\'none\'" />' + esc(s.region_name || s.region) + ' · ' + esc(s.provider) + '</div></td>' +
            '<td><div>4: <code>' + esc(s.ipv4 || '—') + '</code></div><div style="font-size:0.72rem;color:var(--text-muted);">6: <code>' + esc(s.ipv6 || '—') + '</code></div></td>' +
            '<td>' + esc(s.agent_version || '—') + '</td>' +
            '<td>' + esc(s.billing_currency) + Number(s.billing_price).toFixed(2) + ' / ' + esc(s.billing_cycle) + '</td>' +
            '<td>' + (String(s.tags || '').split(',').filter(Boolean).map((tag) => '<span class="status-badge">' + esc(tag.trim()) + '</span>').join(' ') || '—') + '</td>' +
            '<td><span class="status-dot ' + (s.status === 'online' ? '' : 'offline') + '"></span> ' +
              (s.status === 'online' ? (curLang === 'zh' ? '在线' : 'Online') : (curLang === 'zh' ? '离线' : 'Offline')) +
              '<div style="font-size:0.68rem;color:var(--text-muted);margin-top:2px;">' +
                (s.traffic_used_gb || 0).toFixed(1) + ' / ' + s.traffic_limit_gb + ' GB (' + usedPct.toFixed(0) + '%)' +
              '</div></td>' +
            '<td style="text-align:right;white-space:nowrap;">' +
              '<button class="btn-action" onclick="showCmd(' + JSON.stringify(cmd).replace(/"/g, '&quot;') + ',' + JSON.stringify(cmdPs).replace(/"/g, '&quot;') + ')">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle; margin-right:3px;"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>' +
                '<span>安装</span></button>' +
              '<button class="btn-action" style="margin-left:4px;" onclick="editServer(' + JSON.stringify(s.id).replace(/"/g, '&quot;') + ')">编辑</button>' +
              '<button class="btn-action" style="color:var(--status-danger); margin-left:4px;" onclick="delServer(' + JSON.stringify(s.id).replace(/"/g, '&quot;') + ')">删除</button>' +
            '</td>';
          const current = existingRows.get(String(s.id));
          if (current) {
            existingRows.delete(String(s.id));
            if (current.isEqualNode(tr)) nextRows.push(current);
            else {
              current.replaceWith(tr);
              nextRows.push(tr);
            }
          } else {
            nextRows.push(tr);
          }
        });

        nextRows.forEach((row, index) => {
          const currentAtIndex = tbody.children[index];
          if (currentAtIndex !== row) tbody.insertBefore(row, currentAtIndex || null);
        });
        Array.from(tbody.children).forEach((row) => {
          if (!row.dataset.serverId) row.remove();
        });
        existingRows.forEach((row) => row.remove());
        applyNodeFilters();
      } catch (e) {}
    }

    function applyNodeFilters() {
      const query = document.getElementById('nodeSearch').value.trim().toLocaleLowerCase();
      const region = nodeRegionSelect ? nodeRegionSelect.value : '';
      const status = nodeStatusSelect ? nodeStatusSelect.value : '';
      document.querySelectorAll('#nodesTbody tr[data-server-id]').forEach((row) => {
        row.hidden = (!!query && !(row.dataset.name + ' ' + row.dataset.ip).includes(query)) ||
          (!!region && row.dataset.region !== region) || (!!status && row.dataset.status !== status);
      });
    }

    async function loadCosts() {
      const res = await apiFetch('/api/v1/admin/costs');
      const nodes = await res.json();
      const rates = { USD: 1, CNY: 0.138, EUR: 1.08, GBP: 1.27, JPY: 0.0067, HKD: 0.128, SGD: 0.74, AUD: 0.65, CAD: 0.73, RUB: 0.011 };
      const monthly = (n) => {
        let value = Number(n.price || 0) * (rates[n.currency_code] || 1);
        const cycles = { annually: value / 12, quarterly: value / 3, semi_annually: value / 6, biennially: value / 24, triennially: value / 36, lifetime: 0, free: 0 };
        return Object.prototype.hasOwnProperty.call(cycles, n.cycle) ? cycles[n.cycle] : value;
      };
      const total = nodes.reduce((sum, n) => sum + monthly(n), 0);
      const annual = total * 12;
      const now = new Date();
      const cycleMonths = { monthly: 1, quarterly: 3, semi_annually: 6, annually: 12, biennially: 24, triennially: 36 };
      const upcoming = [];
      nodes.forEach((node) => {
        const dateParts = String(node.renewal_date || '').slice(0, 10).split('-').map(Number);
        const anchor = dateParts.length === 3 && dateParts.every(Number.isFinite)
          ? new Date(dateParts[0], dateParts[1] - 1, dateParts[2])
          : null;
        const period = cycleMonths[node.cycle];
        if (!anchor || isNaN(anchor) || !period) return;
        const dateForCycle = (cycle) => {
          const month = new Date(anchor.getFullYear(), anchor.getMonth() + period * cycle, 1);
          const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
          month.setDate(Math.min(anchor.getDate(), lastDay));
          return month;
        };
        let cycle = 0;
        let date = dateForCycle(cycle);
        while (date < now) date = dateForCycle(++cycle);
        const horizon = new Date(now.getFullYear(), now.getMonth() + 12, now.getDate());
        while (date < horizon) {
          upcoming.push({ ...node, date });
          date = dateForCycle(++cycle);
        }
      });
      upcoming.sort((a, b) => a.date - b.date);
      const costLabels = curLang === 'zh'
        ? ['月均成本（预计）', '年度成本（预计）', '节点数', '90 天内续费']
        : ['Est. monthly cost', 'Est. annual cost', 'Nodes', 'Renewals within 90 days'];
      document.getElementById('costKpis').innerHTML = [
        [costLabels[0], '$' + total.toFixed(2)], [costLabels[1], '$' + annual.toFixed(2)],
        [costLabels[2], String(nodes.length)], [costLabels[3], String(upcoming.filter((n) => n.date - now < 90 * 86400000 && n.date >= now).length)]
      ].map(([label, value]) => '<div class="panel-card" style="margin:0;padding:.9rem 1rem;"><div style="font-size:.72rem;color:var(--text-muted);">' + label + '</div><div style="font-size:1.25rem;font-weight:700;margin-top:.35rem;">' + value + '</div></div>').join('');
      const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); return { label: curLang === 'zh' ? (d.getMonth() + 1) + '月' : d.toLocaleString('en', { month: 'short' }), value: 0 }; });
      upcoming.forEach((n) => { const index = (n.date.getFullYear() - now.getFullYear()) * 12 + n.date.getMonth() - now.getMonth(); if (index >= 0 && index < 12) months[index].value += Number(n.price || 0) * (rates[n.currency_code] || 1); });
      const max = Math.max(1, ...months.map((m) => m.value));
      document.getElementById('renewalChart').innerHTML = months.map((m) => '<div title="' + m.label + ': $' + m.value.toFixed(2) + '" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:end;height:100%;gap:4px;"><div style="width:100%;max-width:28px;height:' + Math.max(3, m.value / max * 180) + 'px;background:var(--accent-primary);border-radius:4px 4px 0 0;opacity:.8;"></div><span style="font-size:.62rem;color:var(--text-muted);">' + m.label + '</span></div>').join('');
      const providers = {};
      nodes.forEach((n) => { const provider = n.provider || (curLang === 'zh' ? '未分类' : 'Uncategorized'); providers[provider] = (providers[provider] || 0) + monthly(n); });
      const providerMax = Math.max(1, ...Object.values(providers));
      document.getElementById('providerChart').innerHTML = Object.entries(providers).sort((a, b) => b[1] - a[1]).map(([name, value]) => '<div><div style="display:flex;justify-content:space-between;font-size:.72rem;"><span>' + esc(name) + '</span><strong>$' + value.toFixed(2) + '</strong></div><div style="height:6px;background:var(--bg-tertiary);border-radius:5px;margin-top:4px;"><div style="height:100%;width:' + (value / providerMax * 100) + '%;background:var(--accent-primary);border-radius:5px;"></div></div></div>').join('') || '<div style="color:var(--text-muted);font-size:.75rem;">' + (curLang === 'zh' ? '暂无节点账单' : 'No node billing data') + '</div>';
      document.getElementById('upcomingRenewals').innerHTML = upcoming.slice(0, 8).map((n) => '<div style="display:flex;justify-content:space-between;padding:.45rem .6rem;border:1px solid var(--border-subtle);border-radius:6px;font-size:.75rem;"><span>' + esc(n.name) + ' · ' + esc(n.provider) + '</span><strong>' + n.date.toLocaleDateString(curLang === 'zh' ? 'zh-CN' : 'en') + ' · ' + esc(n.currency) + Number(n.price).toFixed(2) + '</strong></div>').join('') || '<div style="color:var(--text-muted);font-size:.75rem;">' + (curLang === 'zh' ? '暂无续费日期' : 'No upcoming renewals') + '</div>';
      document.getElementById('costUpdated').textContent = (curLang === 'zh' ? '更新于 ' : 'Updated ') + now.toLocaleString(curLang === 'zh' ? 'zh-CN' : 'en');
    }

    // ==========================================
    // 监控目标：列表 + 弹窗编辑
    // ==========================================
    const CARRIER_LABEL = { ct: '电信', cu: '联通', cm: '移动', intl: '国际' };
    let editingTargetId = null;
    let selTargetCarrier;

    function initTargetSelect() {
      if (selTargetCarrier) return;
      selTargetCarrier = createSelect(document.getElementById('tgtCarrier'), {
        options: [
          { value: 'ct', label: '中国电信' },
          { value: 'cu', label: '中国联通' },
          { value: 'cm', label: '中国移动' },
          { value: 'intl', label: '国际 / 海外' },
          { value: '', label: '其他 / 不分类' },
        ],
        value: 'ct',
      });
    }

    async function loadTargets() {
      const tbody = document.getElementById('targetsTbody');
      try {
        const res = await apiFetch('/api/v1/admin/targets');
        const list = await res.json();
        currentTargets = list;

        if (!Array.isArray(list) || list.length === 0) {
          const empty = document.createElement('tr');
          empty.innerHTML = '<td colspan="7" style="text-align:center; padding:1.5rem; color:var(--text-muted);">' + (curLang === 'zh' ? '还没有监控目标，点击右上角「添加目标」' : 'No monitor targets yet. Click “Add target” to create one.') + '</td>';
          replaceChildrenIfChanged(tbody, [empty]);
          return;
        }

        const rows = [];
        list.forEach((t) => {
          const tr = document.createElement('tr');
          tr.dataset.targetId = t.id;
          const cell = (html) => {
            const td = document.createElement('td');
            td.innerHTML = html;
            return td;
          };

          tr.appendChild(cell('<strong>' + esc(t.name) + '</strong>'));
          tr.appendChild(cell('<code style="font-family:var(--font-mono); font-size:0.78rem;">' + esc(t.host) + '</code>'));
          tr.appendChild(cell(String(t.port)));
          const carrierLabels = curLang === 'zh'
            ? { ct: '电信', cu: '联通', cm: '移动', intl: '国际' }
            : { ct: 'China Telecom', cu: 'China Unicom', cm: 'China Mobile', intl: 'International' };
          tr.appendChild(cell(carrierLabels[t.carrier] || '—'));
          tr.appendChild(cell('<img class="flag-mark" src="/assets/flags/cn.svg" onerror="this.style.display=\'none\'" />' + (esc(t.region) || '—')));
          tr.appendChild(cell(t.enabled
            ? '<span style="color:var(--status-online);">' + (curLang === 'zh' ? '启用' : 'Enabled') + '</span>'
            : '<span style="color:var(--text-muted);">' + (curLang === 'zh' ? '停用' : 'Disabled') + '</span>'));

          const ops = document.createElement('td');
          ops.style.textAlign = 'right';

          const bEdit = document.createElement('button');
          bEdit.className = 'btn-action';
          bEdit.textContent = curLang === 'zh' ? '编辑' : 'Edit';
          bEdit.onclick = () => openTargetModal(t);

          const bDel = document.createElement('button');
          bDel.className = 'btn-action';
          bDel.style.color = 'var(--status-danger)';
          bDel.style.marginLeft = '4px';
          bDel.textContent = curLang === 'zh' ? '删除' : 'Delete';
          bDel.onclick = () => deleteTarget(t.id);

          ops.appendChild(bEdit);
          ops.appendChild(bDel);
          tr.appendChild(ops);
          rows.push(tr);
        });
        replaceChildrenIfChanged(tbody, rows);
      } catch (e) {
        const error = document.createElement('tr');
        error.innerHTML = '<td colspan="7" style="text-align:center; padding:1.5rem; color:var(--status-danger);">加载失败</td>';
        replaceChildrenIfChanged(tbody, [error]);
      }
    }

    async function resetDefaultTargets() {
      const ok = await confirmDialog('这会删除当前全部监控目标，并恢复 31 个省级地区 × 电信、联通、移动的 93 个默认目标。此操作不可撤销，继续吗？', '恢复默认目标');
      if (!ok) return;
      const res = await apiFetch('/api/v1/admin/targets/reset_defaults', { method: 'POST' });
      const data = await res.json();
      if (!data.success) return toast('恢复失败：' + (data.message || ''), 'err');
      currentTargets = [];
      toast('已恢复 93 个默认监控目标');
      loadTargets();
    }

    function openTargetModal(t) {
      initTargetSelect();
      editingTargetId = t ? t.id : null;
      document.getElementById('targetModalTitle').textContent = t ? '编辑监控目标' : '添加监控目标';
      document.getElementById('tgtName').value = t ? t.name : '';
      document.getElementById('tgtHost').value = t ? t.host : '';
      document.getElementById('tgtPort').value = t ? t.port : 53;
      document.getElementById('tgtRegion').value = t ? t.region : '';
      document.getElementById('tgtEnabled').checked = t ? !!t.enabled : true;
      selTargetCarrier.set(t ? (t.carrier || '') : 'ct');
      document.getElementById('targetModal').classList.add('show');
    }

    function closeTargetModal() {
      document.getElementById('targetModal').classList.remove('show');
    }

    async function submitTarget() {
      const payload = {
        id: editingTargetId,
        name: document.getElementById('tgtName').value.trim(),
        host: document.getElementById('tgtHost').value.trim(),
        port: parseInt(document.getElementById('tgtPort').value, 10) || 53,
        carrier: selTargetCarrier.value,
        region: document.getElementById('tgtRegion').value.trim(),
        enabled: document.getElementById('tgtEnabled').checked,
      };

      if (!payload.name || !payload.host) {
        toast('名称和 IP / 域名都不能为空', 'err');
        return;
      }

      const res = await apiFetch('/api/v1/admin/targets/save', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) {
        toast('保存失败：' + (data.message || '未知错误'), 'err');
        return;
      }

      closeTargetModal();
      toast(editingTargetId ? '目标已更新' : '目标已添加');
      loadTargets();
    }

    async function deleteTarget(id) {
      const ok = await confirmDialog('确定删除该监控目标？历史数据会保留但不再更新。', '删除');
      if (!ok) return;
      await apiFetch('/api/v1/admin/targets/delete', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      toast('目标已删除');
      loadTargets();
    }

    // ==========================================
    // 其它
    // ==========================================
    function showCmd(cmd, cmdPs) {
      document.getElementById('cmdBox').textContent = cmd;
      document.getElementById('cmdBoxPs').textContent = cmdPs;
      document.getElementById('cmdModal').classList.add('show');
    }

    function closeCmdModal() {
      document.getElementById('cmdModal').classList.remove('show');
    }

    function copyCmd() {
      const text = document.getElementById('cmdBox').textContent;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(
          () => toast('已复制 Linux 安装命令'),
          () => toast('复制失败，请手动选择文本', 'err')
        );
      } else {
        toast('当前浏览器不支持自动复制', 'err');
      }
    }

    async function loadThemes() {
      const grid = document.getElementById('themesGrid');
      const res = await apiFetch('/api/v1/themes');
      const themes = await res.json();
      const cards = [];
      themes.forEach((t) => {
        const div = document.createElement('div');
        div.className = 'panel-card';
        div.innerHTML =
          '<div style="font-weight:700; font-size:1rem; margin-bottom:0.25rem;">' + esc(t.name) + '</div>' +
          '<div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:0.6rem;">v' + esc(t.version) + ' · By ' + esc(t.author) + '</div>' +
          '<div style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:1rem;">' + esc(t.description) + '</div>' +
          '<button class="btn-control active" data-theme="' + esc(t.id) + '">应用此主题</button>';
        div.querySelector('[data-theme]').onclick = () => switchTheme(t.id);
        cards.push(div);
      });
      replaceChildrenIfChanged(grid, cards);
    }

    async function switchTheme(id) {
      const res = await apiFetch('/api/v1/admin/theme/switch', {
        method: 'POST',
        body: JSON.stringify({ theme_id: id }),
      });
      const data = await res.json();
      if (!data.success) {
        toast('切换失败：' + (data.message || ''), 'err');
        return;
      }
      toast('已切换到主题「' + id + '」');
      setTimeout(() => location.reload(), 600);
    }

    async function loadAudit() {
      const tbody = document.getElementById('auditTbody');
      const res = await apiFetch('/api/v1/admin/audit');
      const logs = await res.json();
      const rows = [];
      logs.forEach((l) => {
        const tr = document.createElement('tr');
        const parsed = new Date(String(l.created_at).replace(' ', 'T') + 'Z');
        const time = isNaN(parsed) ? l.created_at : parsed.toLocaleString(curLang === 'zh' ? 'zh-CN' : 'en');
        tr.innerHTML =
          '<td style="font-family:var(--font-mono); font-size:0.75rem; white-space:nowrap;">' + esc(time) + '</td>' +
          '<td>' + esc(l.action) + '</td>' +
          '<td style="font-family:var(--font-mono); font-size:0.75rem;">' + esc(l.ip) + '</td>';
        rows.push(tr);
      });
      replaceChildrenIfChanged(tbody, rows);
      const lastLogin = logs.find((l) => l.action.includes('登录成功'));
      const summary = document.getElementById('latestLoginSummary');
      if (lastLogin) {
        const parsed = new Date(String(lastLogin.created_at).replace(' ', 'T') + 'Z');
        const time = isNaN(parsed) ? lastLogin.created_at : parsed.toLocaleString(curLang === 'zh' ? 'zh-CN' : 'en');
        const loginLabel = curLang === 'zh' ? '最近成功登录' : 'Last successful sign-in';
        const ipLabel = curLang === 'zh' ? '来源 IP' : 'Source IP';
        summary.innerHTML = '<div class="login-summary-item"><span>' + loginLabel + '</span><strong>' + esc(time) + '</strong></div><div class="login-summary-item"><span>' + ipLabel + '</span><strong><code>' + esc(lastLogin.ip) + '</code></strong></div>';
        document.getElementById('statRecentLogin').textContent = time;
        document.getElementById('recentLoginIp').textContent = (curLang === 'zh' ? '最近成功登录 · ' : 'Last successful sign-in · ') + lastLogin.ip;
      } else {
        const noLogin = curLang === 'zh' ? '暂无记录' : 'No record';
        summary.innerHTML = '<div class="login-summary-item"><span>' + (curLang === 'zh' ? '最近成功登录' : 'Last successful sign-in') + '</span><strong>' + noLogin + '</strong></div>';
        document.getElementById('statRecentLogin').textContent = curLang === 'zh' ? '暂无记录' : 'No record';
        document.getElementById('recentLoginIp').textContent = curLang === 'zh' ? '暂无登录记录' : 'No sign-in record';
      }
    }

    async function logout() {
      try {
        await apiFetch('/api/v1/admin/logout', { method: 'POST' });
      } catch (e) {}
      localStorage.removeItem('aegis_admin_token');
      window.location.href = '/admin/login';
    }

    // ==========================================
    // 两步验证 (TOTP)
    // ==========================================
    let tfaSecret = '';

    function close2faModal() {
      document.getElementById('tfaModal').classList.remove('show');
      tfaSecret = '';
    }

    async function open2faModal() {
      document.getElementById('tfaModal').classList.add('show');
      const body = document.getElementById('tfaBody');
      body.innerHTML = '<div style="padding:1.5rem; text-align:center; color:var(--text-muted); font-size:0.85rem;">加载中…</div>';

      let st = { enabled: false };
      try {
        const res = await apiFetch('/api/v1/admin/2fa/status');
        st = await res.json();
      } catch (e) {
        return;
      }

      if (st.enabled) {
        body.innerHTML =
          '<div style="display:flex; align-items:center; gap:0.5rem; color:var(--status-online); font-weight:600; font-size:0.88rem;">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>' +
            '<span>已启用</span>' +
          '</div>' +
          '<div style="font-size:0.8rem; color:var(--text-muted); line-height:1.6; margin-top:0.5rem;">' +
            '登录后台时需要额外输入验证器 App 上的 6 位动态码。' +
          '</div>' +
          '<div class="form-item" style="margin-top:1.1rem;">' +
            '<label>输入当前密码以关闭</label>' +
            '<input id="tfaDisablePass" type="password" placeholder="当前登录密码" />' +
          '</div>' +
          '<div style="display:flex; justify-content:flex-end; gap:0.5rem; margin-top:1.1rem;">' +
            '<button class="btn-control" onclick="close2faModal()">关闭</button>' +
            '<button class="btn-control" style="color:var(--status-danger);" onclick="disable2fa()">关闭两步验证</button>' +
          '</div>';
        return;
      }

      body.innerHTML =
        '<div style="font-size:0.82rem; color:var(--text-secondary); line-height:1.65;">' +
          '用 Google Authenticator / Microsoft Authenticator / 1Password 等扫描二维码，' +
          '再把 App 显示的 6 位数字填进来完成绑定。' +
        '</div>' +
        '<div style="display:flex; justify-content:flex-end; gap:0.5rem; margin-top:1.1rem;">' +
          '<button class="btn-control" onclick="close2faModal()">取消</button>' +
          '<button class="btn-control active" onclick="start2faSetup()">生成二维码</button>' +
        '</div>';
    }

    async function start2faSetup() {
      const res = await apiFetch('/api/v1/admin/2fa/setup', { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        toast(data.message || '生成失败', 'err');
        return;
      }

      tfaSecret = data.secret;
      const body = document.getElementById('tfaBody');
      body.innerHTML =
        '<div style="background:#fff; border-radius:10px; padding:0.6rem; display:flex; justify-content:center;">' +
          data.qr_svg +
        '</div>' +
        '<div style="font-size:0.7rem; color:var(--text-muted); text-align:center; margin-top:0.6rem; word-break:break-all;">' +
          '扫不了码就手动输入密钥：<code style="font-family:var(--font-mono);">' + esc(data.secret) + '</code>' +
        '</div>' +
        '<div class="form-item" style="margin-top:1rem;">' +
          '<label>输入 App 上显示的 6 位验证码</label>' +
          '<input id="tfaCode" type="text" inputmode="numeric" maxlength="6" placeholder="000000" ' +
                 'style="letter-spacing:0.3em; text-align:center; font-family:var(--font-mono);" />' +
        '</div>' +
        '<div style="display:flex; justify-content:flex-end; gap:0.5rem; margin-top:1.1rem;">' +
          '<button class="btn-control" onclick="close2faModal()">取消</button>' +
          '<button class="btn-control active" onclick="enable2fa()">确认启用</button>' +
        '</div>';

      const input = document.getElementById('tfaCode');
      if (input) input.focus();
    }

    async function enable2fa() {
      const code = document.getElementById('tfaCode').value.trim();
      if (code.length !== 6) {
        toast('请输入 6 位验证码', 'err');
        return;
      }

      const res = await apiFetch('/api/v1/admin/2fa/enable', {
        method: 'POST',
        body: JSON.stringify({ secret: tfaSecret, code }),
      });
      const data = await res.json();
      if (!data.success) {
        toast(data.message || '启用失败', 'err');
        return;
      }
      toast('两步验证已启用，下次登录需要输入验证码');
      close2faModal();
    }

    async function disable2fa() {
      const pw = document.getElementById('tfaDisablePass').value;
      if (!pw) {
        toast('请输入当前密码', 'err');
        return;
      }

      const res = await apiFetch('/api/v1/admin/2fa/disable', {
        method: 'POST',
        body: JSON.stringify({ password: pw }),
      });
      const data = await res.json();
      if (!data.success) {
        toast(data.message || '关闭失败', 'err');
        return;
      }
      toast('两步验证已关闭');
      close2faModal();
    }

    // ==========================================
    // 告警邮件配置
    // ==========================================
    async function loadAlerts() {
      try {
        const res = await apiFetch('/api/v1/admin/alerts');
        const c = await res.json();
        document.getElementById('alertEnabled').checked = !!c.enabled;
        document.getElementById('alertSmtpEnabled').checked = !!c.smtp_enabled;
        document.getElementById('alertHost').value = c.smtp_host || '';
        document.getElementById('alertPort').value = c.smtp_port || 465;
        document.getElementById('alertUser').value = c.smtp_user || '';
        document.getElementById('alertFrom').value = c.from || '';
        document.getElementById('alertTo').value = c.to || '';
        document.getElementById('alertOffline').checked = !!c.notify_offline;
        document.getElementById('alertOnline').checked = c.notify_online !== false;
        document.getElementById('alertCpu').checked = !!c.notify_cpu;
        document.getElementById('alertCpuTh').value = c.cpu_threshold || 90;
        document.getElementById('alertTraffic').checked = !!c.notify_traffic;
        document.getElementById('alertTrafficTh').value = c.traffic_threshold || 90;
        document.getElementById('alertTelegramEnabled').checked = !!c.telegram_enabled;
        document.getElementById('alertTelegramChatId').value = c.telegram_chat_id || '';
        document.getElementById('alertWebhookEnabled').checked = !!c.webhook_enabled;
        document.getElementById('alertWebhookUrl').value = c.webhook_url || '';

        const passInput = document.getElementById('alertPass');
        passInput.value = '';
        passInput.dataset.secretSet = c.smtp_pass_set ? 'true' : 'false';
        passInput.placeholder = c.smtp_pass_set ? '已设置，留空表示不修改' : '尚未设置';
        const telegramToken = document.getElementById('alertTelegramToken');
        telegramToken.value = '';
        telegramToken.dataset.secretSet = c.telegram_bot_token_set ? 'true' : 'false';
        telegramToken.placeholder = c.telegram_bot_token_set ? '已设置，留空表示不修改' : '尚未设置';
      } catch (e) {}
    }

    async function loadAlertEvents() {
      const tbody = document.getElementById('alertEventsTbody');
      try {
        const res = await apiFetch('/api/v1/admin/alerts/events?limit=100');
        const events = await res.json();
        if (!Array.isArray(events) || events.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-muted);">暂无告警事件</td></tr>';
          return;
        }
        tbody.innerHTML = events.map((event) => '<tr>' +
          '<td>' + esc(new Date(event.created_at * 1000).toLocaleString()) + '</td>' +
          '<td>' + esc(event.server_id) + '</td>' +
          '<td>' + esc(event.event_type) + '</td>' +
          '<td style="white-space:normal; min-width:260px;">' + esc(event.message) + '</td>' +
          '</tr>').join('');
      } catch (e) {
        tbody.innerHTML = '<tr><td colspan="4" style="color:var(--status-danger);">告警记录加载失败</td></tr>';
      }
    }

    async function saveAlerts() {
      const payload = {
        enabled: document.getElementById('alertEnabled').checked,
        smtp_enabled: document.getElementById('alertSmtpEnabled').checked,
        smtp_host: document.getElementById('alertHost').value.trim(),
        smtp_port: parseInt(document.getElementById('alertPort').value, 10) || 465,
        smtp_user: document.getElementById('alertUser').value.trim(),
        smtp_pass: document.getElementById('alertPass').value,
        from: document.getElementById('alertFrom').value.trim(),
        to: document.getElementById('alertTo').value.trim(),
        notify_offline: document.getElementById('alertOffline').checked,
        notify_online: document.getElementById('alertOnline').checked,
        notify_cpu: document.getElementById('alertCpu').checked,
        cpu_threshold: parseFloat(document.getElementById('alertCpuTh').value) || 90,
        notify_traffic: document.getElementById('alertTraffic').checked,
        traffic_threshold: parseInt(document.getElementById('alertTrafficTh').value, 10) || 90,
        telegram_enabled: document.getElementById('alertTelegramEnabled').checked,
        telegram_bot_token: document.getElementById('alertTelegramToken').value,
        telegram_chat_id: document.getElementById('alertTelegramChatId').value.trim(),
        webhook_enabled: document.getElementById('alertWebhookEnabled').checked,
        webhook_url: document.getElementById('alertWebhookUrl').value.trim(),
      };

      if (payload.enabled && !payload.smtp_enabled && !payload.telegram_enabled && !payload.webhook_enabled) {
        toast('请至少启用一个通知渠道', 'err');
        return;
      }
      if (payload.smtp_enabled && (!payload.smtp_host || !payload.from || !payload.to)) {
        toast('启用 SMTP 前请先填好服务器地址、发件人和收件人', 'err');
        return;
      }
      if (payload.telegram_enabled && (!payload.telegram_chat_id || (!payload.telegram_bot_token && document.getElementById('alertTelegramToken').dataset.secretSet !== 'true'))) {
        toast('启用 Telegram 前请填写 Bot Token 和 Chat ID', 'err');
        return;
      }
      if (payload.webhook_enabled && !payload.webhook_url) {
        toast('启用 Webhook 前请先填写 URL', 'err');
        return;
      }

      const res = await apiFetch('/api/v1/admin/alerts/save', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) {
        toast('保存失败：' + (data.message || ''), 'err');
        return;
      }
      toast('告警配置已保存');
      loadAlerts();
      loadAlertEvents();
    }

    async function testAlert() {
      toast(curLang === 'zh' ? '正在发送测试通知…' : 'Sending test notification…');
      const res = await apiFetch('/api/v1/admin/alerts/test', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast(data.message || (curLang === 'zh' ? '测试通知已发送' : 'Test notification sent'));
      } else {
        toast('发送失败：' + (data.message || '未知错误'), 'err');
      }
    }

    async function changePassword() {
      const oldPw = await promptDialog('请输入当前密码');
      if (!oldPw) return;
      const newPw = await promptDialog('请输入新密码（至少 8 位）');
      if (!newPw) return;
      if (newPw.length < 8) {
        toast('新密码至少 8 位', 'err');
        return;
      }
      try {
        const res = await apiFetch('/api/v1/admin/password', {
          method: 'POST',
          body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
        });
        const data = await res.json();
        if (data.success) {
          toast('密码已更新，请重新登录');
          localStorage.removeItem('aegis_admin_token');
          setTimeout(() => (window.location.href = '/admin/login'), 800);
        } else {
          toast(data.message || '修改失败', 'err');
        }
      } catch (e) {}
    }

    setTheme(curTheme);
    setLang(curLang);
    checkAuth();
  </script>
</body>
</html>
"#;
