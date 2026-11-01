(() => {
  const config = __MONITER_THEME_CONTEXT__;
  let pending = false;
  function storage(seed, persist) {
    const data = Object.assign(Object.create(null), seed);
    const notify = () => {
      if (!persist || pending) return;
      pending = true;
      queueMicrotask(() => { pending = false; parent.postMessage({type:'moniter:theme:storage', value:{...data}}, '*'); });
    };
    const methods = {
      getItem(key) { return Object.hasOwn(data, String(key)) ? data[String(key)] : null; },
      setItem(key, value) {
        key = String(key); value = String(value);
        if (key.length > 128 || value.length > 4096 || (!Object.hasOwn(data, key) && Object.keys(data).length >= 64)) {
          throw new DOMException('Theme storage limit exceeded', 'QuotaExceededError');
        }
        const previous = data[key];
        const existed = Object.hasOwn(data, key);
        data[key] = value;
        if (JSON.stringify(data).length > 32768) {
          if (existed) data[key] = previous; else delete data[key];
          throw new DOMException('Theme storage limit exceeded', 'QuotaExceededError');
        }
        notify();
      },
      removeItem(key) { delete data[String(key)]; notify(); },
      clear() { for (const key of Object.keys(data)) delete data[key]; notify(); },
      key(index) { return Object.keys(data)[Number(index)] ?? null; },
      get length() { return Object.keys(data).length; },
    };
    return new Proxy(methods, {
      get(target, property) { return property in target ? Reflect.get(target, property) : data[property]; },
      set(_target, property, value) { methods.setItem(property, value); return true; },
      deleteProperty(_target, property) { methods.removeItem(property); return true; },
    });
  }
  Object.defineProperty(window, 'localStorage', {value:storage(config.preferences, true), configurable:false});
  Object.defineProperty(window, 'sessionStorage', {value:storage({}, false), configurable:false});
  // Relative URLs resolve through the theme's <base>. Keep fragment routing on
  // srcdoc itself so deep links do not navigate away from the storage bridge.
  if (config.hash && location.hash !== config.hash) history.replaceState(null, '', 'about:srcdoc' + config.hash);
  addEventListener('hashchange', () => parent.postMessage({type:'moniter:theme:hash', value:location.hash}, '*'));
  addEventListener('message', event => {
    if (event.source === parent && event.data?.type === 'moniter:theme:navigate'
        && typeof event.data.hash === 'string' && event.data.hash.length <= 2048 && location.hash !== event.data.hash) {
      location.replace('about:srcdoc' + (event.data.hash || '#'));
    }
  });
})();
