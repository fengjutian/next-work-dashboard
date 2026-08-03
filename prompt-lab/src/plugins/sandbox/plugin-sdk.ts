type Listener = (payload: unknown) => void;

export interface PluginSDK {
  store: {
    getPrompts(): Promise<unknown[]>;
    getSites(): Promise<unknown[]>;
    getTabs(): Promise<unknown[]>;
    getActiveTab(): Promise<unknown | null>;
    getTheme(): Promise<string>;
    getConversations(): Promise<unknown[]>;
    subscribe(event: string, fn: Listener): () => void;
  };
  on(event: string, fn: Listener): () => void;
  ui: {
    setContent(html: string): Promise<void>;
    getThemeTokens(): Promise<Record<string, string>>;
    showToast(message: string, type?: string): Promise<void>;
    getContainerSize(): Promise<{ w: number; h: number }>;
  };
  actions: {
    copyToClipboard(text: string): Promise<void>;
    injectPrompt(siteId: string, text: string, autoSubmit?: boolean): Promise<void>;
    openUrl(url: string): Promise<void>;
  };
  data: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    list(): Promise<string[]>;
  };
  preview: {
    markdown(content: string): Promise<void>;
    image(src: string, alt?: string): Promise<void>;
    pdf(src: string): Promise<void>;
    code(source: string, language?: string): Promise<void>;
  };
  file: {
    pickOpen(options?: { accept?: string; multiple?: boolean }): Promise<unknown>;
    pickSave(content: string, defaultName?: string): Promise<void>;
  };
  config: {
    get(key: string): Promise<unknown>;
    getAll(): Promise<Record<string, unknown>>;
    set(key: string, value: unknown): Promise<void>;
    getDefaults(): Promise<Record<string, unknown>>;
  };
}

/** The single runtime source injected into every sandbox iframe. */
export const PLUGIN_SDK_SOURCE = `
(function() {
  'use strict';
  var listeners = new Map();
  function genId() { return 'req-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9); }
  function request(channel, method, args) {
    return new Promise(function(resolve, reject) {
      var id = genId();
      var timeout = window.setTimeout(function() {
        window.removeEventListener('message', handler);
        reject(new Error('PluginSDK request timed out: ' + channel + '.' + method));
      }, 30000);
      function handler(e) {
        if (e.source !== window.parent) return;
        var msg = e.data;
        if (!msg || msg.requestId !== id) return;
        window.clearTimeout(timeout);
        window.removeEventListener('message', handler);
        if (msg.ok) resolve(msg.result);
        else reject(new Error(msg.error || 'Unknown error'));
      }
      window.addEventListener('message', handler);
      window.parent.postMessage({ requestId: id, channel: channel, method: method, args: args || [] }, '*');
    });
  }
  function subscribe(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return function() { var set = listeners.get(event); if (set) set.delete(fn); };
  }
  window.addEventListener('message', function(e) {
    if (e.source !== window.parent) return;
    var msg = e.data;
    if (!msg || !msg.event) return;
    var set = listeners.get(msg.event);
    if (set) set.forEach(function(fn) { fn(msg.payload); });
  });
  subscribe('setContent', function(html) {
    var root = document.getElementById('root');
    if (root) root.innerHTML = String(html);
  });
  window.PluginSDK = {
    store: {
      getPrompts: function() { return request('store', 'getPrompts'); },
      getSites: function() { return request('store', 'getSites'); },
      getTabs: function() { return request('store', 'getTabs'); },
      getActiveTab: function() { return request('store', 'getActiveTab'); },
      getTheme: function() { return request('store', 'getTheme'); },
      getConversations: function() { return request('store', 'getConversations'); },
      subscribe: subscribe
    },
    on: subscribe,
    ui: {
      setContent: function(html) { return request('ui', 'setContent', [html]); },
      getThemeTokens: function() { return request('ui', 'getThemeTokens'); },
      showToast: function(message, type) { return request('ui', 'showToast', [message, type || 'info']); },
      getContainerSize: function() { return request('ui', 'getContainerSize'); }
    },
    actions: {
      copyToClipboard: function(text) { return request('actions', 'copyToClipboard', [text]); },
      injectPrompt: function(siteId, text, autoSubmit) { return request('actions', 'injectPrompt', [siteId, text, autoSubmit || false]); },
      openUrl: function(url) { return request('actions', 'openUrl', [url]); }
    },
    data: {
      get: function(key) { return request('data', 'get', [key]); },
      set: function(key, value) { return request('data', 'set', [key, value]); },
      delete: function(key) { return request('data', 'delete', [key]); },
      list: function() { return request('data', 'list'); }
    },
    preview: {
      markdown: function(content) { return request('preview', 'markdown', [content]); },
      image: function(src, alt) { return request('preview', 'image', [src, alt]); },
      pdf: function(src) { return request('preview', 'pdf', [src]); },
      code: function(source, language) { return request('preview', 'code', [source, language]); }
    },
    file: {
      pickOpen: function(options) { return request('file', 'pickOpen', [options]); },
      pickSave: function(content, name) { return request('file', 'pickSave', [content, name]); }
    },
    config: {
      get: function(key) { return request('config', 'get', [key]); },
      getAll: function() { return request('config', 'getAll'); },
      set: function(key, value) { return request('config', 'set', [key, value]); },
      getDefaults: function() { return request('config', 'getDefaults'); }
    }
  };
})();
`;
