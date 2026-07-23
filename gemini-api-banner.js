export function maybeShowApiKeyBanner(key, action = `set it as the VITE_GEMINI_API_KEY environment variable in
<code>.env</code>`) {
  if (!key) {
    let banner = document.createElement('div');
    banner.className = 'api-key-banner';
    banner.innerHTML = `
      To get started with the Gemini API,
      <a href="https://g.co/ai/idxGetGeminiKey" target="_blank">
      get an API key</a> (Ctrl+Click) and ${action}`;
    document.body.prepend(banner);
  }
}