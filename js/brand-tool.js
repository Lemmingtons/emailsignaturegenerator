// ── Brand extractor page ──
// Reads a public homepage through /api/brand (the same lookup the generator
// uses) and shows what it found: logo, brand colours, company name, phone and
// social links. Everything from the response is third-party content, so it is
// written with textContent and only http(s) links and data:image logos are used.

(function () {
  const ERRORS = {
    invalid_url: 'That doesn\'t look like a website address. Try something like acme.com.',
    rate_limited: 'Too many lookups in a row. Wait a minute and try again.',
    site_unreachable: 'We couldn\'t read that site. Some sites block automated visits.',
    site_not_html: 'That address isn\'t a web page we can read. Try the homepage, like acme.com.',
  };
  const SOCIAL_LABELS = { linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', google: 'Google reviews' };

  const form = document.getElementById('brandToolForm');
  const input = document.getElementById('brandToolSite');
  const button = document.getElementById('brandToolBtn');
  const status = document.getElementById('brandToolStatus');
  const results = document.getElementById('brandToolResults');
  if (!form || !input || !results) return;

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = 'brand-tool-status' + (kind ? ' is-' + kind : '');
  }

  function hostLabel(value) {
    try {
      return new URL(/^[a-z]+:\/\//i.test(value) ? value : 'https://' + value).hostname.replace(/^www\./, '');
    } catch {
      return value;
    }
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch {
      return '';
    }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function row(label, content) {
    const wrap = el('div', 'brand-result-row');
    wrap.appendChild(el('dt', null, label));
    const dd = el('dd');
    if (typeof content === 'string') dd.textContent = content;
    else dd.appendChild(content);
    wrap.appendChild(dd);
    return wrap;
  }

  function colourSwatch(hex, label) {
    const wrap = el('div', 'brand-swatch');
    const chip = el('span', 'brand-swatch-chip');
    chip.style.background = hex;
    chip.setAttribute('aria-hidden', 'true');
    wrap.appendChild(chip);
    const text = el('span', 'brand-swatch-text');
    text.appendChild(el('strong', null, label));
    text.appendChild(el('code', null, hex));
    wrap.appendChild(text);
    const copy = el('button', 'btn btn-secondary brand-copy', 'Copy');
    copy.type = 'button';
    copy.setAttribute('aria-label', 'Copy ' + label.toLowerCase() + ' ' + hex);
    copy.addEventListener('click', function () {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(hex).then(function () {
        copy.textContent = 'Copied';
        setTimeout(function () { copy.textContent = 'Copy'; }, 1500);
      });
    });
    wrap.appendChild(copy);
    return wrap;
  }

  function logoExtension(type) {
    if (/svg/.test(type)) return 'svg';
    if (/jpe?g/.test(type)) return 'jpg';
    if (/webp/.test(type)) return 'webp';
    if (/gif/.test(type)) return 'gif';
    if (/icon/.test(type)) return 'ico';
    return 'png';
  }

  function render(data) {
    results.innerHTML = '';
    const host = hostLabel(data.site || input.value);
    const card = el('section', 'brand-tool-card');
    card.setAttribute('aria-label', 'Brand found on ' + host);
    card.appendChild(el('h2', null, 'What we found on ' + host));

    const list = el('dl', 'brand-tool-list');
    const logo = data.logo && typeof data.logo.dataUri === 'string' && /^data:image\//.test(data.logo.dataUri) ? data.logo : null;
    if (logo) {
      const box = el('div', 'brand-logo-box');
      const img = el('img');
      img.src = logo.dataUri;
      img.alt = (data.company || host) + ' logo';
      box.appendChild(img);
      const download = el('a', 'brand-download', 'Download logo');
      download.href = logo.dataUri;
      download.download = host.replace(/[^a-z0-9.-]/gi, '') + '-logo.' + logoExtension(logo.type || logo.dataUri.slice(5, 30));
      box.appendChild(download);
      list.appendChild(row('Logo', box));
    } else {
      list.appendChild(row('Logo', 'Not found. The site may load its logo with JavaScript.'));
    }

    const colours = data.colors || {};
    const valid = function (hex) { return typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex); };
    if (valid(colours.primary) || valid(colours.secondary)) {
      const swatches = el('div', 'brand-swatches');
      if (valid(colours.primary)) swatches.appendChild(colourSwatch(colours.primary.toUpperCase(), 'Primary'));
      if (valid(colours.secondary)) swatches.appendChild(colourSwatch(colours.secondary.toUpperCase(), 'Secondary'));
      list.appendChild(row('Brand colours', swatches));
    } else {
      list.appendChild(row('Brand colours', 'Not found. The site may set its colours with JavaScript.'));
    }

    if (data.company) list.appendChild(row('Name', String(data.company)));
    if (data.phone) list.appendChild(row('Phone', String(data.phone)));

    const socials = Object.keys(SOCIAL_LABELS)
      .map(function (key) { return { key: key, url: safeHttpUrl((data.social || {})[key] || '') }; })
      .filter(function (item) { return item.url; });
    if (socials.length) {
      const links = el('ul', 'brand-social');
      socials.forEach(function (item) {
        const li = el('li');
        const a = el('a', null, SOCIAL_LABELS[item.key]);
        a.href = item.url;
        a.rel = 'nofollow noopener';
        a.target = '_blank';
        li.appendChild(a);
        links.appendChild(li);
      });
      list.appendChild(row('Social links', links));
    }
    card.appendChild(list);

    const next = el('div', 'brand-tool-next');
    next.appendChild(el('p', null, 'Turn this into an email signature. The generator fills in the same logo, colours and links.'));
    const cta = el('a', 'btn btn-primary', 'Make a signature with this brand');
    cta.href = '/generator?site=' + encodeURIComponent(host);
    next.appendChild(cta);
    card.appendChild(next);

    results.appendChild(card);
    results.hidden = false;
  }

  async function run(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) {
      setStatus('Type a website first, like acme.com.', 'error');
      input.focus();
      return;
    }
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Reading...';
    setStatus('Reading ' + hostLabel(value) + '...');
    try {
      const res = await fetch('/api/brand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: value }),
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) {
        results.hidden = true;
        setStatus(ERRORS[data.code] || 'Something went wrong reading that site. Try again in a moment.', 'error');
        return;
      }
      render(data);
      setStatus('Done. Results for ' + hostLabel(data.site || value) + ' are below.', 'success');
    } catch {
      setStatus('We couldn\'t reach the lookup service. Check your connection and try again.', 'error');
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = 'Extract brand';
    }
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    run(input.value);
  });

  const preset = new URLSearchParams(location.search).get('site');
  if (preset) {
    input.value = preset.slice(0, 300);
    run(input.value);
  }
})();
