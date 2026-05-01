// ── Email Signature Templates ──
// All templates use HTML table layout for maximum email client compatibility.
// Each template is a function that takes form data + style config and returns HTML.

const TEMPLATES = {

  // ═══════════════════════════════════════════
  // PROFESSIONAL / CORPORATE
  // ═══════════════════════════════════════════

  classic: {
    name: 'Classic',
    category: 'professional',
    pro: false,
    icon: '&#9635;',
    render(data, style) {
      const { primaryColor, textColor, fontFamily, dividerStyle, photoShape, iconStyle } = style;
      const photoRadius = photoShape === 'circle' ? '50%' : photoShape === 'rounded' ? '10px' : '0';
      const divider = this._divider(dividerStyle, primaryColor);

      return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 13px; color: ${textColor}; line-height: 1.4;">
  <tr>
    ${this._photoCell(data, photoRadius)}
    <td style="vertical-align: top;">
      <table cellpadding="0" cellspacing="0" border="0">
        ${this._logoRow(data, primaryColor)}
        <tr><td style="padding-bottom: 8px;">
          <strong style="font-size: 15px; color: ${textColor}; font-family: ${fontFamily};">${this.escapeAttr(data.fullName)}</strong><br/>
          <span style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">${this.escapeAttr(data.title || '')}</span>
          ${data.company ? `<br/><span style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">${this.escapeAttr(data.company)}</span>` : ''}
        </td></tr>
        ${data.logoUrl ? '' : `<tr><td style="padding-bottom: 8px;">${divider}</td></tr>`}
        <tr><td style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">
          ${this._contactLine(data, fontFamily)}
        </td></tr>
        ${this._socialRow(data, iconStyle, primaryColor)}
      </table>
    </td>
  </tr>
</table>`;
    }
  },

  executive: {
    name: 'Executive',
    category: 'professional',
    pro: false,
    icon: '&#9733;',
    render(data, style) {
      const { primaryColor, textColor, fontFamily, dividerStyle, photoShape, iconStyle } = style;
      const photoRadius = photoShape === 'circle' ? '50%' : photoShape === 'rounded' ? '10px' : '0';

      return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 13px; color: ${textColor}; line-height: 1.5;">
  <tr>
    ${this._photoCell(data, photoRadius, 100)}
    <td style="vertical-align: top; ${data.photoUrl ? 'border-left: 3px solid ' + primaryColor + '; padding-left: 18px;' : ''}">
      <table cellpadding="0" cellspacing="0" border="0">
        ${this._logoRow(data, primaryColor)}
        <tr><td style="padding-bottom: 6px;">
          <strong style="font-size: 17px; color: ${textColor}; font-family: ${fontFamily}; letter-spacing: 0.3px;">${this.escapeAttr(String(data.fullName || '').toUpperCase())}</strong><br/>
          <span style="font-size: 12px; color: ${primaryColor}; font-family: ${fontFamily}; font-weight: 600;">${this.escapeAttr(data.title || '')}</span>
          ${data.company ? `<br/><span style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">${this.escapeAttr(data.company)}</span>` : ''}
        </td></tr>
        <tr><td style="padding-bottom: 6px; padding-top: 4px; font-size: 12px; color: #4b5563; font-family: ${fontFamily};">
          ${this._contactLineStacked(data, fontFamily)}
        </td></tr>
        ${this._socialRow(data, iconStyle, primaryColor)}
      </table>
    </td>
  </tr>
</table>`;
    }
  },

  corporate: {
    name: 'Corporate',
    category: 'professional',
    pro: true,
    icon: '&#127970;',
    render(data, style) {
      const { primaryColor, textColor, fontFamily, photoShape, iconStyle } = style;
      const photoRadius = photoShape === 'circle' ? '50%' : photoShape === 'rounded' ? '10px' : '0';

      return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 13px; color: ${textColor}; line-height: 1.5; border-top: 4px solid ${primaryColor}; padding-top: 14px;">
  <tr>
    ${this._photoCell(data, photoRadius)}
    <td style="vertical-align: top;">
      <table cellpadding="0" cellspacing="0" border="0">
        ${this._logoRow(data, primaryColor)}
        <tr><td style="padding-bottom: 10px;">
          <strong style="font-size: 16px; color: ${textColor}; font-family: ${fontFamily};">${this.escapeAttr(data.fullName)}</strong><br/>
          <span style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">${this.escapeAttr(data.title || '')}${data.title && data.company ? ' | ' : ''}${this.escapeAttr(data.company || '')}</span>
        </td></tr>
        <tr><td>
          <table cellpadding="0" cellspacing="0" border="0" style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">
            ${data.phone ? `<tr><td style="padding-bottom: 3px; padding-right: 8px; color: ${primaryColor}; font-weight: 700;">P</td><td style="padding-bottom: 3px;"><a href="${this.escapeAttr('tel:' + String(data.phone).replace(/\s/g,''))}" style="color: #4b5563; text-decoration: none; font-family: ${fontFamily};">${this.escapeAttr(data.phone)}</a></td></tr>` : ''}
            ${data.email ? `<tr><td style="padding-bottom: 3px; padding-right: 8px; color: ${primaryColor}; font-weight: 700;">E</td><td style="padding-bottom: 3px;"><a href="${this.escapeAttr('mailto:' + String(data.email))}" style="color: #4b5563; text-decoration: none; font-family: ${fontFamily};">${this.escapeAttr(data.email)}</a></td></tr>` : ''}
            ${data.website && this.escapeUrl(data.website, 'href') ? `<tr><td style="padding-bottom: 3px; padding-right: 8px; color: ${primaryColor}; font-weight: 700;">W</td><td style="padding-bottom: 3px;"><a href="${this.escapeUrl(data.website, 'href')}" style="color: #4b5563; text-decoration: none; font-family: ${fontFamily};">${this.escapeAttr(String(data.website).replace(/^https?:\/\//, ''))}</a></td></tr>` : ''}
          </table>
        </td></tr>
        ${this._socialRow(data, iconStyle, primaryColor)}
      </table>
    </td>
  </tr>
</table>`;
    }
  },

  boardroom: {
    name: 'Boardroom',
    category: 'professional',
    pro: true,
    icon: '&#128188;',
    render(data, style) {
      const { primaryColor, textColor, fontFamily, photoShape, iconStyle } = style;
      const photoRadius = photoShape === 'circle' ? '50%' : photoShape === 'rounded' ? '10px' : '0';

      return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 13px; color: ${textColor}; line-height: 1.5;">
  ${this._logoRow(data, primaryColor)}
  <tr><td style="padding-bottom: 12px;">
    <table cellpadding="0" cellspacing="0" border="0"><tr>
      ${data.photoUrl && this.escapeUrl(data.photoUrl, 'src') ? `<td style="vertical-align: middle; padding-right: 14px;"><img src="${this.escapeUrl(data.photoUrl, 'src')}" width="60" height="60" style="border-radius: ${photoRadius}; display: block; width: 60px; height: 60px; object-fit: cover; border: 0;" alt="${this.escapeAttr(data.fullName || '')}" /></td>` : ''}
      <td style="vertical-align: middle;">
        <strong style="font-size: 16px; color: ${textColor}; font-family: ${fontFamily};">${this.escapeAttr(data.fullName)}</strong><br/>
        <span style="font-size: 12px; color: ${primaryColor}; font-family: ${fontFamily};">${this.escapeAttr(data.title || '')}</span>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="border-top: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; padding: 8px 0; font-size: 12px; color: #4b5563; font-family: ${fontFamily};">
    ${data.company ? `<strong style="color: ${textColor};">${this.escapeAttr(data.company)}</strong><br/>` : ''}
    ${this._contactLine(data, fontFamily)}
  </td></tr>
  ${this._socialRow(data, iconStyle, primaryColor, 8)}
</table>`;
    }
  },

  branded: {
    name: 'Branded',
    category: 'professional',
    pro: true,
    icon: '&#128142;',
    render(data, style) {
      const { primaryColor, textColor, fontFamily, dividerStyle, photoShape, iconStyle } = style;
      const photoRadius = photoShape === 'circle' ? '50%' : photoShape === 'rounded' ? '10px' : '0';
      const divider = this._divider(dividerStyle, primaryColor);

      return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 13px; color: ${textColor}; line-height: 1.5;">
  <tr>
    ${this._photoCell(data, photoRadius, 90)}
    <td style="vertical-align: top;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        ${this._logoRow(data, primaryColor)}
        <tr><td style="padding-bottom: 6px;">
          <strong style="font-size: 16px; color: ${textColor}; font-family: ${fontFamily};">${this.escapeAttr(data.fullName)}</strong><br/>
          <span style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">${this.escapeAttr(data.title || '')}</span>
        </td></tr>
        ${data.logoUrl ? '' : `<tr><td style="padding-bottom: 10px;">${divider}</td></tr>`}
        <tr><td style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">
          ${this._contactLine(data, fontFamily)}
        </td></tr>
        ${this._socialRow(data, iconStyle, primaryColor)}
      </table>
    </td>
  </tr>
</table>`;
    }
  },

  // ═══════════════════════════════════════════
  // CREATIVE / DESIGNER
  // ═══════════════════════════════════════════

  gradient: {
    name: 'Gradient',
    category: 'creative',
    pro: true,
    icon: '&#127752;',
    render(data, style) {
      const { primaryColor, secondaryColor, textColor, fontFamily, photoShape, iconStyle } = style;
      const photoRadius = photoShape === 'circle' ? '50%' : photoShape === 'rounded' ? '10px' : '0';
      const secondary = secondaryColor || '#7c3aed';

      return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 13px; color: ${textColor}; line-height: 1.5;">
  <tr>
    ${this._photoCell(data, photoRadius, 90)}
    <td style="vertical-align: top;">
      <table cellpadding="0" cellspacing="0" border="0">
        ${this._logoRow(data, primaryColor)}
        <tr><td style="padding-bottom: 8px;">
          <strong style="font-size: 18px; color: ${primaryColor}; font-family: ${fontFamily};">${this.escapeAttr(data.fullName)}</strong><br/>
          <span style="font-size: 12px; color: ${secondary}; font-family: ${fontFamily}; font-weight: 600;">${this.escapeAttr(data.title || '')}</span>
          ${data.company ? `<br/><span style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">${this.escapeAttr(data.company)}</span>` : ''}
        </td></tr>
        <tr><td style="padding-bottom: 8px;">
          <table cellpadding="0" cellspacing="0" border="0" width="200"><tr><td style="background: linear-gradient(to right, ${primaryColor}, ${secondary}); height: 3px; font-size: 1px; line-height: 1px;">&nbsp;</td></tr></table>
        </td></tr>
        <tr><td style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">
          ${this._contactLine(data, fontFamily)}
        </td></tr>
        ${this._socialRow(data, iconStyle, primaryColor)}
      </table>
    </td>
  </tr>
</table>`;
    }
  },

  bold: {
    name: 'Bold',
    category: 'creative',
    pro: false,
    icon: '&#9889;',
    render(data, style) {
      const { primaryColor, textColor, fontFamily, photoShape, iconStyle } = style;
      const photoRadius = photoShape === 'circle' ? '50%' : photoShape === 'rounded' ? '10px' : '0';

      return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 13px; color: ${textColor}; line-height: 1.5;">
  <tr>
    ${data.photoUrl && this.escapeUrl(data.photoUrl, 'src') ? `<td style="vertical-align: top; padding-right: 18px;"><img src="${this.escapeUrl(data.photoUrl, 'src')}" width="90" height="90" style="border-radius: ${photoRadius}; display: block; width: 90px; height: 90px; object-fit: cover; border: 3px solid ${primaryColor};" alt="${this.escapeAttr(data.fullName || '')}" /></td>` : ''}
    <td style="vertical-align: top;">
      <table cellpadding="0" cellspacing="0" border="0">
        ${this._logoRow(data, primaryColor)}
        <tr><td style="padding-bottom: 6px;">
          <strong style="font-size: 20px; color: ${primaryColor}; font-family: ${fontFamily}; letter-spacing: -0.5px;">${this.escapeAttr(data.fullName)}</strong>
        </td></tr>
        <tr><td style="padding-bottom: 8px;">
          <span style="font-size: 13px; color: #fff; background: ${primaryColor}; padding: 3px 10px; border-radius: 3px; font-family: ${fontFamily}; font-weight: 600;">${this.escapeAttr(data.title || 'Professional')}</span>
          ${data.company ? `<span style="font-size: 12px; color: #4b5563; font-family: ${fontFamily}; padding-left: 8px;">${this.escapeAttr(data.company)}</span>` : ''}
        </td></tr>
        <tr><td style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">
          ${this._contactLine(data, fontFamily)}
        </td></tr>
        ${this._socialRow(data, iconStyle, primaryColor)}
      </table>
    </td>
  </tr>
</table>`;
    }
  },

  modern: {
    name: 'Modern',
    category: 'creative',
    pro: true,
    icon: '&#10024;',
    render(data, style) {
      const { primaryColor, textColor, fontFamily, photoShape, iconStyle } = style;
      const photoRadius = photoShape === 'circle' ? '50%' : photoShape === 'rounded' ? '10px' : '0';

      return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 13px; color: ${textColor}; line-height: 1.5; background: #fafafa; border-radius: 8px; padding: 16px;">
  ${this._logoRow(data, primaryColor)}
  <tr><td>
    <table cellpadding="0" cellspacing="0" border="0"><tr>
      ${data.photoUrl && this.escapeUrl(data.photoUrl, 'src') ? `<td style="vertical-align: top; padding-right: 16px;"><img src="${this.escapeUrl(data.photoUrl, 'src')}" width="80" height="80" style="border-radius: ${photoRadius}; display: block; width: 80px; height: 80px; object-fit: cover; border: 0;" alt="${this.escapeAttr(data.fullName || '')}" /></td>` : ''}
      <td style="vertical-align: top;">
        <strong style="font-size: 16px; color: ${textColor}; font-family: ${fontFamily};">${this.escapeAttr(data.fullName)}</strong><br/>
        <span style="font-size: 12px; color: ${primaryColor}; font-family: ${fontFamily}; font-weight: 600;">${this.escapeAttr(data.title || '')}</span>
        ${data.company ? `<br/><span style="font-size: 11px; color: #9ca3af; font-family: ${fontFamily}; text-transform: uppercase; letter-spacing: 1px;">${this.escapeAttr(data.company)}</span>` : ''}
      </td>
    </tr></table>
  </td></tr>
  ${data.logoUrl ? '' : `<tr><td style="padding-top: 10px; padding-bottom: 6px;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="border-top: 2px solid ${primaryColor}; font-size: 1px; line-height: 1px; height: 1px;">&nbsp;</td></tr></table>
  </td></tr>`}
  <tr><td style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">
    ${this._contactLine(data, fontFamily)}
  </td></tr>
  ${this._socialRow(data, iconStyle, primaryColor)}
</table>`;
    }
  },

  // ═══════════════════════════════════════════
  // MINIMAL
  // ═══════════════════════════════════════════

  clean: {
    name: 'Clean',
    category: 'minimal',
    pro: false,
    icon: '&#9723;',
    render(data, style) {
      const { primaryColor, textColor, fontFamily, dividerStyle, iconStyle } = style;
      const sep = dividerStyle === 'pipe' ? ' | ' : dividerStyle === 'dot' ? ' \u00b7 ' : ' \u2014 ';

      return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 13px; color: ${textColor}; line-height: 1.6;">
  ${this._logoRow(data, primaryColor, 'left')}
  <tr><td>
    <strong style="font-size: 14px; color: ${textColor}; font-family: ${fontFamily};">${this.escapeAttr(data.fullName)}</strong>
    ${data.title ? `<span style="color: #9ca3af;">${sep}</span><span style="font-size: 13px; color: #4b5563; font-family: ${fontFamily};">${this.escapeAttr(data.title)}</span>` : ''}
  </td></tr>
  ${data.company ? `<tr><td style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">${this.escapeAttr(data.company)}</td></tr>` : ''}
  <tr><td style="font-size: 12px; color: #4b5563; padding-top: 4px; font-family: ${fontFamily};">
    ${this._contactLine(data, fontFamily, sep)}
  </td></tr>
  ${this._socialRow(data, iconStyle, primaryColor)}
</table>`;
    }
  },

  textonly: {
    name: 'Text Only',
    category: 'minimal',
    pro: false,
    icon: '&#9776;',
    render(data, style) {
      const { primaryColor, textColor, fontFamily } = style;

      let lines = [`<strong style="color: ${textColor}; font-family: ${fontFamily};">${this.escapeAttr(data.fullName)}</strong>`];
      if (data.title) lines.push(`<span style="color: #4b5563;">${this.escapeAttr(data.title)}</span>`);
      if (data.company) lines.push(`<span style="color: #4b5563;">${this.escapeAttr(data.company)}</span>`);
      if (data.phone) lines.push(`<a href="${this.escapeAttr('tel:' + String(data.phone).replace(/\s/g,''))}" style="color: #4b5563; text-decoration: none;">${this.escapeAttr(data.phone)}</a>`);
      if (data.email) lines.push(`<a href="${this.escapeAttr('mailto:' + String(data.email))}" style="color: #4b5563; text-decoration: none;">${this.escapeAttr(data.email)}</a>`);
      if (data.website) { const h = this.escapeUrl(data.website, 'href'); if (h) lines.push(`<a href="${h}" style="color: #4b5563; text-decoration: none;">${this.escapeAttr(String(data.website).replace(/^https?:\/\//, ''))}</a>`); }

      const socialLabels = [
        { url: data.linkedin, label: 'LinkedIn' },
        { url: data.instagram, label: 'Instagram' },
        { url: data.facebook, label: 'Facebook' },
        { url: data.google, label: 'Google' },
      ];
      socialLabels.forEach(s => {
        if (!s.url) return;
        const h = this.escapeUrl(s.url, 'href');
        if (h) lines.push(`<a href="${h}" style="color: #4b5563; text-decoration: none;">${s.label}</a>`);
      });

      return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 13px; line-height: 1.7;">
  ${this._logoRow(data, primaryColor, 'left')}
  <tr><td>${lines.join('<br/>')}</td></tr>
</table>`;
    }
  },

  dash: {
    name: 'Dash',
    category: 'minimal',
    pro: true,
    icon: '&#8212;',
    render(data, style) {
      const { primaryColor, textColor, fontFamily, iconStyle } = style;

      return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 13px; color: ${textColor}; line-height: 1.5;">
  <tr><td style="border-left: 3px solid ${primaryColor}; padding-left: 12px;">
    ${data.logoUrl && this.escapeUrl(data.logoUrl, 'src') ? `<img src="${this.escapeUrl(data.logoUrl, 'src')}" alt="${this.escapeAttr(data.company || 'Company logo')}" style="max-height: 40px; max-width: 180px; display: block; margin-bottom: 8px; border: 0;" />
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 10px;"><tr><td style="border-top: 2px solid ${this._safeColor(primaryColor)}; font-size: 1px; line-height: 1px; height: 1px; background-color: #ffffff;" bgcolor="#ffffff">&nbsp;</td></tr></table>` : ''}
    <strong style="font-size: 14px; color: ${textColor}; font-family: ${fontFamily};">${this.escapeAttr(data.fullName)}</strong><br/>
    ${data.title ? `<span style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">${this.escapeAttr(data.title)}</span><br/>` : ''}
    ${data.company ? `<span style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">${this.escapeAttr(data.company)}</span><br/>` : ''}
    <span style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">
      ${this._contactLine(data, fontFamily, ' | ')}
    </span>
    <table cellpadding="0" cellspacing="0" border="0" style="margin-top: 8px;"><tbody>${this._socialRow(data, iconStyle, primaryColor, 0)}</tbody></table>
  </td></tr>
</table>`;
    }
  },

  // ═══════════════════════════════════════════
  // SOCIAL-FIRST
  // ═══════════════════════════════════════════

  socialstar: {
    name: 'Social Star',
    category: 'social',
    pro: true,
    icon: '&#128640;',
    render(data, style) {
      const { primaryColor, textColor, fontFamily, photoShape, iconStyle } = style;
      const photoRadius = photoShape === 'circle' ? '50%' : photoShape === 'rounded' ? '10px' : '0';

      return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 13px; color: ${textColor}; line-height: 1.5;">
  <tr>
    ${this._photoCell(data, photoRadius, 80)}
    <td style="vertical-align: top;">
      <table cellpadding="0" cellspacing="0" border="0">
        ${this._logoRow(data, primaryColor)}
        <tr><td style="padding-bottom: 6px;">
          <strong style="font-size: 16px; color: ${textColor}; font-family: ${fontFamily};">${this.escapeAttr(data.fullName)}</strong><br/>
          <span style="font-size: 12px; color: ${primaryColor}; font-family: ${fontFamily}; font-weight: 600;">${this.escapeAttr(data.title || '')}</span>
        </td></tr>
        <tr><td style="padding-bottom: 8px;">
          ${this._socialRowLarge(data, iconStyle, primaryColor)}
        </td></tr>
        <tr><td style="font-size: 11px; color: #9ca3af; font-family: ${fontFamily};">
          ${this._contactLine(data, fontFamily, ' \u00b7 ')}
        </td></tr>
      </table>
    </td>
  </tr>
</table>`;
    }
  },

  creator: {
    name: 'Creator',
    category: 'social',
    pro: false,
    icon: '&#127916;',
    render(data, style) {
      const { primaryColor, textColor, fontFamily, photoShape, iconStyle } = style;
      const photoRadius = photoShape === 'circle' ? '50%' : photoShape === 'rounded' ? '10px' : '0';

      return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 13px; color: ${textColor}; line-height: 1.5; text-align: center;">
  ${this._logoRow(data, primaryColor, 'center')}
  <tr><td style="padding-bottom: 10px;">
    ${data.photoUrl && this.escapeUrl(data.photoUrl, 'src') ? `<img src="${this.escapeUrl(data.photoUrl, 'src')}" width="70" height="70" style="border-radius: ${photoRadius}; display: inline-block; width: 70px; height: 70px; object-fit: cover; border: 0;" alt="${this.escapeAttr(data.fullName || '')}" />` : ''}
  </td></tr>
  <tr><td style="padding-bottom: 4px;">
    <strong style="font-size: 16px; color: ${textColor}; font-family: ${fontFamily};">${this.escapeAttr(data.fullName)}</strong>
  </td></tr>
  <tr><td style="padding-bottom: 8px;">
    <span style="font-size: 12px; color: ${primaryColor}; font-family: ${fontFamily}; font-weight: 600;">${this.escapeAttr(data.title || '')}</span>
    ${data.company ? `<br/><span style="font-size: 11px; color: #9ca3af; font-family: ${fontFamily};">${this.escapeAttr(data.company)}</span>` : ''}
  </td></tr>
  <tr><td style="padding-bottom: 6px;">
    ${this._socialRowLarge(data, iconStyle, primaryColor)}
  </td></tr>
  <tr><td style="font-size: 11px; color: #9ca3af; font-family: ${fontFamily};">
    ${this._contactLine(data, fontFamily, ' \u00b7 ')}
  </td></tr>
</table>`;
    }
  },

  // ═══════════════════════════════════════════
  // SALES / CTA
  // ═══════════════════════════════════════════

  ctabox: {
    name: 'CTA Box',
    category: 'sales',
    pro: true,
    icon: '&#128279;',
    render(data, style) {
      const { primaryColor, textColor, fontFamily, photoShape, iconStyle, ctaText, ctaUrl } = style;
      const photoRadius = photoShape === 'circle' ? '50%' : photoShape === 'rounded' ? '10px' : '0';
      const cta = ctaText || 'Book a Meeting';
      const ctaLink = this.escapeUrl(ctaUrl || '#', 'href') || '#';
      const ctaSafe = this.escapeAttr(cta);
      const nameSafe = this.escapeAttr(data.fullName);
      const titleSafe = this.escapeAttr(data.title || '');
      const companySafe = this.escapeAttr(data.company || '');

      return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 13px; color: ${textColor}; line-height: 1.5;">
  <tr>
    ${this._photoCell(data, photoRadius)}
    <td style="vertical-align: top;">
      <table cellpadding="0" cellspacing="0" border="0">
        ${this._logoRow(data, primaryColor)}
        <tr><td style="padding-bottom: 6px;">
          <strong style="font-size: 15px; color: ${textColor}; font-family: ${fontFamily};">${nameSafe}</strong><br/>
          <span style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">${titleSafe}${data.title && data.company ? ' \u2014 ' : ''}${companySafe}</span>
        </td></tr>
        <tr><td style="font-size: 12px; color: #4b5563; font-family: ${fontFamily}; padding-bottom: 10px;">
          ${this._contactLine(data, fontFamily)}
        </td></tr>
        <tr><td>
          <a href="${ctaLink}" target="_blank" style="display: inline-block; background: ${primaryColor}; color: #fff; padding: 8px 20px; border-radius: 5px; font-size: 12px; font-weight: 700; text-decoration: none; font-family: ${fontFamily};">${ctaSafe}</a>
        </td></tr>
        ${this._socialRow(data, iconStyle, primaryColor, 10)}
      </table>
    </td>
  </tr>
</table>`;
    }
  },

  banner: {
    name: 'Banner',
    category: 'sales',
    pro: true,
    icon: '&#128230;',
    render(data, style) {
      const { primaryColor, textColor, fontFamily, photoShape, iconStyle, ctaText, ctaUrl } = style;
      const photoRadius = photoShape === 'circle' ? '50%' : photoShape === 'rounded' ? '10px' : '0';
      const cta = ctaText || 'Learn More';
      const ctaLink = this.escapeUrl(ctaUrl || '#', 'href') || '#';

      return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 13px; color: ${textColor}; line-height: 1.5;">
  <tr>
    ${this._photoCell(data, photoRadius)}
    <td style="vertical-align: top;">
      <table cellpadding="0" cellspacing="0" border="0">
        ${this._logoRow(data, primaryColor)}
        <tr><td style="padding-bottom: 6px;">
          <strong style="font-size: 15px; color: ${textColor}; font-family: ${fontFamily};">${this.escapeAttr(data.fullName)}</strong><br/>
          <span style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">${this.escapeAttr(data.title || '')}</span>
          ${data.company ? `<br/><span style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">${this.escapeAttr(data.company)}</span>` : ''}
        </td></tr>
        <tr><td style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">
          ${this._contactLine(data, fontFamily)}
        </td></tr>
        ${this._socialRow(data, iconStyle, primaryColor)}
      </table>
    </td>
  </tr>
  <tr><td colspan="2" style="padding-top: 12px;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${primaryColor}; border-radius: 6px;">
      <tr><td style="padding: 12px 18px; color: #fff; font-size: 13px; font-family: ${fontFamily};">
        <strong>${this.escapeAttr(cta)}</strong>
        <a href="${ctaLink}" target="_blank" style="color: #fff; text-decoration: underline; padding-left: 8px; font-size: 12px; font-family: ${fontFamily};">Click here &rarr;</a>
      </td></tr>
    </table>
  </td></tr>
</table>`;
    }
  },

  meetinglink: {
    name: 'Meeting',
    category: 'sales',
    pro: false,
    icon: '&#128197;',
    render(data, style) {
      const { primaryColor, textColor, fontFamily, dividerStyle, photoShape, iconStyle, ctaText, ctaUrl } = style;
      const photoRadius = photoShape === 'circle' ? '50%' : photoShape === 'rounded' ? '10px' : '0';
      const divider = this._divider(dividerStyle, primaryColor);
      const cta = ctaText || 'Schedule a call';
      const ctaLink = this.escapeUrl(ctaUrl || '#', 'href') || '#';

      return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 13px; color: ${textColor}; line-height: 1.5;">
  <tr>
    ${this._photoCell(data, photoRadius)}
    <td style="vertical-align: top;">
      <table cellpadding="0" cellspacing="0" border="0">
        ${this._logoRow(data, primaryColor)}
        <tr><td style="padding-bottom: 8px;">
          <strong style="font-size: 15px; color: ${textColor}; font-family: ${fontFamily};">${this.escapeAttr(data.fullName)}</strong><br/>
          <span style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">${this.escapeAttr(data.title || '')}</span>
          ${data.company ? `<br/><span style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">${this.escapeAttr(data.company)}</span>` : ''}
        </td></tr>
        ${data.logoUrl ? '' : `<tr><td style="padding-bottom: 8px;">${divider}</td></tr>`}
        <tr><td style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">
          ${this._contactLine(data, fontFamily)}
        </td></tr>
        <tr><td style="padding-top: 8px;">
          <a href="${ctaLink}" target="_blank" style="color: ${primaryColor}; font-size: 12px; font-weight: 700; text-decoration: none; font-family: ${fontFamily};">&#128197; ${this.escapeAttr(cta)}</a>
        </td></tr>
        ${this._socialRow(data, iconStyle, primaryColor)}
      </table>
    </td>
  </tr>
</table>`;
    }
  },

  // ═══════════════════════════════════════════
  // INDUSTRY-SPECIFIC
  // ═══════════════════════════════════════════

  realestate: {
    name: 'Real Estate',
    category: 'industry',
    pro: true,
    icon: '&#127968;',
    render(data, style) {
      const { primaryColor, textColor, fontFamily, photoShape, iconStyle, ctaText, ctaUrl } = style;
      const photoRadius = photoShape === 'circle' ? '50%' : photoShape === 'rounded' ? '10px' : '0';
      const cta = ctaText || 'View My Listings';
      const ctaLink = this.escapeUrl(ctaUrl || '#', 'href') || '#';

      return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 13px; color: ${textColor}; line-height: 1.5;">
  <tr>
    ${data.photoUrl && this.escapeUrl(data.photoUrl, 'src') ? `<td style="vertical-align: top; padding-right: 18px;"><img src="${this.escapeUrl(data.photoUrl, 'src')}" width="100" height="100" style="border-radius: ${photoRadius}; display: block; width: 100px; height: 100px; object-fit: cover; border: 0;" alt="${this.escapeAttr(data.fullName || '')}" /></td>` : ''}
    <td style="vertical-align: top;">
      <table cellpadding="0" cellspacing="0" border="0">
        ${this._logoRow(data, primaryColor)}
        <tr><td style="padding-bottom: 4px;">
          <strong style="font-size: 17px; color: ${textColor}; font-family: ${fontFamily};">${this.escapeAttr(data.fullName)}</strong>
        </td></tr>
        <tr><td style="padding-bottom: 8px;">
          <span style="font-size: 13px; color: ${primaryColor}; font-family: ${fontFamily}; font-weight: 600;">${this.escapeAttr(data.title || 'Licensed Agent')}</span>
          ${data.company ? `<br/><span style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">${this.escapeAttr(data.company)}</span>` : ''}
        </td></tr>
        ${data.logoUrl ? '' : `<tr><td style="padding-bottom: 8px;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="border-top: 2px solid ${primaryColor}; font-size: 1px; line-height: 1px; height: 1px;">&nbsp;</td></tr></table>
        </td></tr>`}
        <tr><td style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">
          ${this._contactLineStacked(data, fontFamily)}
        </td></tr>
        <tr><td style="padding-top: 10px;">
          <a href="${ctaLink}" target="_blank" style="display: inline-block; background: ${primaryColor}; color: #fff; padding: 7px 16px; border-radius: 4px; font-size: 11px; font-weight: 700; text-decoration: none; font-family: ${fontFamily}; text-transform: uppercase; letter-spacing: 0.5px;">${this.escapeAttr(cta)}</a>
        </td></tr>
        ${this._socialRow(data, iconStyle, primaryColor)}
      </table>
    </td>
  </tr>
</table>`;
    }
  },

  trades: {
    name: 'Trades',
    category: 'industry',
    pro: true,
    icon: '&#128295;',
    render(data, style) {
      const { primaryColor, textColor, fontFamily, photoShape, iconStyle } = style;
      const photoRadius = photoShape === 'circle' ? '50%' : photoShape === 'rounded' ? '10px' : '0';

      return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 13px; color: ${textColor}; line-height: 1.5; border-left: 5px solid ${primaryColor}; padding-left: 14px;">
  ${this._logoRow(data, primaryColor, 'left')}
  <tr><td>
    <table cellpadding="0" cellspacing="0" border="0"><tr>
      ${data.photoUrl && this.escapeUrl(data.photoUrl, 'src') ? `<td style="vertical-align: middle; padding-right: 14px;"><img src="${this.escapeUrl(data.photoUrl, 'src')}" width="65" height="65" style="border-radius: ${photoRadius}; display: block; width: 65px; height: 65px; object-fit: cover; border: 0;" alt="${this.escapeAttr(data.fullName || '')}" /></td>` : ''}
      <td style="vertical-align: middle;">
        <strong style="font-size: 16px; color: ${textColor}; font-family: ${fontFamily};">${this.escapeAttr(data.fullName)}</strong><br/>
        <span style="font-size: 13px; color: ${primaryColor}; font-family: ${fontFamily}; font-weight: 700;">${this.escapeAttr(data.title || '')}</span>
        ${data.company ? `<br/><span style="font-size: 13px; color: #4b5563; font-family: ${fontFamily}; font-weight: 600;">${this.escapeAttr(data.company)}</span>` : ''}
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding-top: 8px; font-size: 13px; color: #4b5563; font-family: ${fontFamily};">
    ${data.phone ? `<strong style="color: ${textColor};">Call:</strong> <a href="${this.escapeAttr('tel:' + String(data.phone).replace(/\s/g,''))}" style="color: #4b5563; text-decoration: none; font-family: ${fontFamily};">${this.escapeAttr(data.phone)}</a><br/>` : ''}
    ${data.email ? `<strong style="color: ${textColor};">Email:</strong> <a href="${this.escapeAttr('mailto:' + String(data.email))}" style="color: #4b5563; text-decoration: none; font-family: ${fontFamily};">${this.escapeAttr(data.email)}</a>` : ''}
  </td></tr>
  ${this._socialRow(data, iconStyle, primaryColor, 8)}
</table>`;
    }
  },

  consultant: {
    name: 'Consultant',
    category: 'industry',
    pro: false,
    icon: '&#128736;',
    render(data, style) {
      const { primaryColor, textColor, fontFamily, dividerStyle, photoShape, iconStyle } = style;
      const photoRadius = photoShape === 'circle' ? '50%' : photoShape === 'rounded' ? '10px' : '0';

      return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 13px; color: ${textColor}; line-height: 1.5;">
  <tr>
    ${this._photoCell(data, photoRadius, 80)}
    <td style="vertical-align: top;">
      <table cellpadding="0" cellspacing="0" border="0">
        ${this._logoRow(data, primaryColor)}
        <tr><td style="padding-bottom: 2px;">
          <strong style="font-size: 15px; color: ${textColor}; font-family: ${fontFamily};">${this.escapeAttr(data.fullName)}</strong>
        </td></tr>
        <tr><td style="padding-bottom: 6px;">
          <span style="font-size: 12px; color: ${primaryColor}; font-family: ${fontFamily}; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">${this.escapeAttr(data.title || '')}</span>
          ${data.company ? `<br/><span style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">${this.escapeAttr(data.company)}</span>` : ''}
        </td></tr>
        ${data.logoUrl ? '' : `<tr><td style="padding-bottom: 8px;">
          <table cellpadding="0" cellspacing="0" border="0" width="60"><tr><td style="border-top: 2px solid ${primaryColor}; font-size: 1px; line-height: 1px; height: 1px;">&nbsp;</td></tr></table>
        </td></tr>`}
        <tr><td style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">
          ${this._contactLine(data, fontFamily)}
        </td></tr>
        ${this._socialRow(data, iconStyle, primaryColor)}
      </table>
    </td>
  </tr>
</table>`;
    }
  },
};

// ═══════════════════════════════════════════
// SHARED HELPER METHODS
// ═══════════════════════════════════════════
// Attached to every template via prototype-like injection

const _helpers = {
  // Gmail auto-inverts pure #000000 / #FFFFFF in dark mode (sometimes producing
  // unreadable results inside our light-island wrapper). Nudging by one byte
  // keeps the appearance identical to the user while opting the color out of
  // Gmail's color-swap heuristic.
  _safeColor(hex) {
    if (!hex) return hex;
    const h = String(hex).trim().toLowerCase();
    if (h === '#000' || h === '#000000' || h === 'black') return '#111111';
    if (h === '#fff' || h === '#ffffff' || h === 'white') return '#fefefe';
    return hex;
  },

  escapeAttr(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  },

  // Blocks javascript:, vbscript:, file: schemes in href/src attributes.
  // For src context, also permits data:image/* (used by logo/photo file upload
  // previews) while rejecting data:text/html and other dangerous data: types.
  // Returns an HTML-escaped URL or '' when the input is unsafe.
  escapeUrl(url, context) {
    const raw = String(url == null ? '' : url).trim();
    if (!raw) return '';
    const lower = raw.toLowerCase();
    if (/^(javascript|vbscript|file):/.test(lower)) return '';
    if (lower.startsWith('data:')) {
      if (context !== 'src' || !lower.startsWith('data:image/')) return '';
    }
    return this.escapeAttr(raw);
  },

  preview(style) {
    const sampleData = {
      fullName: 'Jane Smith',
      title: 'Marketing Manager',
      company: 'Acme Corp',
      phone: '0400 000 000',
      email: 'jane@acme.com',
      website: 'https://acme.com',
      instagram: 'https://instagram.com/acme',
      facebook: 'https://facebook.com/acme',
      linkedin: 'https://linkedin.com/in/janesmith',
      google: 'https://g.co/acme',
      photoUrl: '',
      logoUrl: '',
    };
    const sampleStyle = {
      primaryColor: '#0891B2',
      secondaryColor: '#7c3aed',
      textColor: '#1e293b',
      fontFamily: 'Arial, Helvetica, sans-serif',
      dividerStyle: 'line',
      photoShape: 'circle',
      iconStyle: 'mono',
      ctaText: 'Book a Meeting',
      ctaUrl: 'https://calendly.com',
      ...style,
    };
    const html = this.render(sampleData, sampleStyle);
    return `<div class="preview-inner" style="transform:scale(0.28);transform-origin:top left;width:360px;">${html}</div>`;
  },

  // Wraps a rendered signature in an opaque "light island" table. Gmail
  // preserves elements with explicit bgcolor + background-color, so recipients
  // in dark mode see the signature as we designed it instead of getting
  // unreadable dark-on-dark text after Gmail's auto color-swap.
  _darkSafeWrap(innerHtml) {
    return `<table cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background-color:#ffffff;border-collapse:collapse;"><tr><td bgcolor="#ffffff" style="background-color:#ffffff;padding:0;">${innerHtml}</td></tr></table>`;
  },

  _photoCell(data, radius, size = 90) {
    if (!data.photoUrl) return '';
    const safeUrl = this.escapeUrl(data.photoUrl, 'src');
    if (!safeUrl) return '';
    const safeName = this.escapeAttr(data.fullName || '');
    return `<td style="vertical-align: top; padding-right: 18px; background-color: #ffffff;" bgcolor="#ffffff">
      <img src="${safeUrl}" alt="${safeName}" width="${size}" height="${size}" style="border-radius: ${radius}; display: block; width: ${size}px; height: ${size}px; object-fit: cover; border: 0;" />
    </td>`;
  },

  // Company logo row — drop-in for the first row of any template's inner or
  // outer table. Renders the logo + a primary-color accent line underneath,
  // left-aligned by default. Pass 'center' for centered layouts.
  // When a logo is present, templates with an existing info/contact divider
  // should suppress it (the under-logo line takes its place).
  // Returns '' when no logo is set or the URL fails the scheme check.
  _logoRow(data, primaryColor, align) {
    if (!data.logoUrl) return '';
    const safeSrc = this.escapeUrl(data.logoUrl, 'src');
    if (!safeSrc) return '';
    const safeAlt = this.escapeAttr(data.company || 'Company logo');
    const a = align || 'left';
    const color = this._safeColor(primaryColor || '#0891B2');
    return `<tr><td style="text-align: ${a}; padding-bottom: 8px;">
          <img src="${safeSrc}" alt="${safeAlt}" style="max-height: 40px; max-width: 180px; display: inline-block; border: 0;" />
        </td></tr>
        <tr><td style="padding-bottom: 10px;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="border-top: 2px solid ${color}; font-size: 1px; line-height: 1px; height: 1px; background-color: #ffffff;" bgcolor="#ffffff">&nbsp;</td></tr></table>
        </td></tr>`;
  },

  _contactLine(data, fontFamily, sep = '<span style="color: #9ca3af; padding: 0 8px;">|</span>') {
    return this._contactItems(data, fontFamily).join(sep);
  },

  _contactLineStacked(data, fontFamily) {
    return this._contactItems(data, fontFamily).join('<br/>');
  },

  _contactItems(data, fontFamily) {
    const items = [];
    if (data.phone) {
      const telHref = this.escapeAttr('tel:' + String(data.phone).replace(/\s/g, ''));
      const phoneText = this.escapeAttr(data.phone);
      items.push(`<a href="${telHref}" style="color: #4b5563; text-decoration: none; font-family: ${fontFamily};">${phoneText}</a>`);
    }
    if (data.email) {
      const mailHref = this.escapeAttr('mailto:' + String(data.email));
      const emailText = this.escapeAttr(data.email);
      items.push(`<a href="${mailHref}" style="color: #4b5563; text-decoration: none; font-family: ${fontFamily};">${emailText}</a>`);
    }
    if (data.website) {
      const webHref = this.escapeUrl(data.website, 'href');
      if (webHref) {
        const webText = this.escapeAttr(String(data.website).replace(/^https?:\/\//, ''));
        items.push(`<a href="${webHref}" style="color: #4b5563; text-decoration: none; font-family: ${fontFamily};">${webText}</a>`);
      }
    }
    return items;
  },

  _divider(style, color) {
    if (style === 'none') return '';
    const safe = this._safeColor(color);
    const styles = {
      line: `border-top: 2px solid ${safe}`,
      thin: `border-top: 1px solid #d1d5db`,
      dot: `border-top: 2px dotted ${safe}`,
      double: `border-top: 3px double ${safe}`,
    };
    const borderStyle = styles[style] || styles.line;
    return `<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="${borderStyle}; font-size: 1px; line-height: 1px; height: 1px; background-color: #ffffff;" bgcolor="#ffffff">&nbsp;</td></tr></table>`;
  },

  _getIconSvg(platform, iconStyle, primaryColor, size = 22) {
    const safePrimary = this._safeColor(primaryColor);
    const color = (iconStyle === 'color') ? safePrimary : '#4b5563';
    const bg = (iconStyle === 'rounded' || iconStyle === 'square') ? color : 'none';
    const radius = iconStyle === 'rounded' ? '4' : '0';
    const iconPaths = {
      website: `<circle cx="12" cy="12" r="10" stroke="${color}" stroke-width="1.8" fill="none"/><line x1="2" y1="12" x2="22" y2="12" stroke="${color}" stroke-width="1.8"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke="${color}" stroke-width="1.8" fill="none"/>`,
      linkedin: `<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" fill="${color}"/><rect x="2" y="9" width="4" height="12" fill="${color}"/><circle cx="4" cy="4" r="2" fill="${color}"/>`,
      instagram: `<rect x="2" y="2" width="20" height="20" rx="5" ry="5" stroke="${color}" stroke-width="1.8" fill="none"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" stroke="${color}" stroke-width="1.8" fill="none"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`,
      facebook: `<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" fill="${color}"/>`,
      google: `<circle cx="11" cy="11" r="8" stroke="${color}" stroke-width="1.8" fill="none"/><line x1="21" y1="21" x2="16.65" y2="16.65" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>`,
    };
    const path = iconPaths[platform] || iconPaths.website;
    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">${path}</svg>`;
    const encoded = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgContent)));
    return encoded;
  },

  _socialRow(data, iconStyle, primaryColor, topPad = 10) {
    const socials = [
      { url: data.website, platform: 'website', alt: 'Website' },
      { url: data.instagram, platform: 'instagram', alt: 'Instagram' },
      { url: data.facebook, platform: 'facebook', alt: 'Facebook' },
      { url: data.linkedin, platform: 'linkedin', alt: 'LinkedIn' },
      { url: data.google, platform: 'google', alt: 'Google' },
    ].filter(s => s.url);

    if (!socials.length) return '';

    const cells = socials.map(s => {
      const safeUrl = this.escapeUrl(s.url, 'href');
      if (!safeUrl) return '';
      const icon = this._getIconSvg(s.platform, iconStyle, primaryColor, 22);
      return `<td style="padding-right: 8px;"><a href="${safeUrl}" target="_blank" style="text-decoration: none;"><img src="${icon}" alt="${s.alt}" width="22" height="22" style="display: block; width: 22px; height: 22px; border: 0;" /></a></td>`;
    }).join('');

    return `<tr><td style="padding-top: ${topPad}px;"><table cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table></td></tr>`;
  },

  // Renders an optional regulatory / compliance block beneath the main signature.
  // `conf.fields` is an array of {label, value} licence identifiers; `conf.disclaimer`
  // is plain text. Kept small (10px grey) and on an explicit white background so
  // Gmail dark mode doesn't invert contrast against the light-island wrapper.
  _complianceBlock(conf, fontFamily) {
    if (!conf || (!conf.fields?.length && !conf.disclaimer)) return '';
    const ff = fontFamily || 'Arial, Helvetica, sans-serif';
    const esc = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    let parts = '';
    if (conf.fields?.length) {
      const fieldLine = conf.fields
        .map(f => `<strong style="color: #4b5563;">${esc(f.label)}:</strong> <span style="color: #4b5563;">${esc(f.value)}</span>`)
        .join('<span style="color: #9ca3af; padding: 0 6px;">·</span>');
      parts += `<tr><td bgcolor="#ffffff" style="background-color: #ffffff; padding: 8px 0 4px 0; font-size: 10px; font-family: ${ff}; color: #4b5563; line-height: 1.45;">${fieldLine}</td></tr>`;
    }
    if (conf.disclaimer) {
      parts += `<tr><td bgcolor="#ffffff" style="background-color: #ffffff; padding: 4px 0 0 0; font-size: 10px; font-family: ${ff}; color: #6b7280; line-height: 1.5;">${esc(conf.disclaimer)}</td></tr>`;
    }

    return `<table cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="margin-top: 10px; background-color: #ffffff; border-top: 1px solid #e5e7eb; max-width: 600px;">${parts}</table>`;
  },

  _socialRowLarge(data, iconStyle, primaryColor) {
    const socials = [
      { url: data.website, platform: 'website', alt: 'Website' },
      { url: data.instagram, platform: 'instagram', alt: 'Instagram' },
      { url: data.facebook, platform: 'facebook', alt: 'Facebook' },
      { url: data.linkedin, platform: 'linkedin', alt: 'LinkedIn' },
      { url: data.google, platform: 'google', alt: 'Google' },
    ].filter(s => s.url);

    if (!socials.length) return '';

    const cells = socials.map(s => {
      const safeUrl = this.escapeUrl(s.url, 'href');
      if (!safeUrl) return '';
      const icon = this._getIconSvg(s.platform, iconStyle, primaryColor, 30);
      return `<td style="padding-right: 10px;"><a href="${safeUrl}" target="_blank" style="text-decoration: none;"><img src="${icon}" alt="${s.alt}" width="30" height="30" style="display: block; width: 30px; height: 30px; border: 0;" /></a></td>`;
    }).join('');

    return `<table cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`;
  },
};

// Attach helpers to all templates
Object.values(TEMPLATES).forEach(t => {
  Object.keys(_helpers).forEach(k => {
    t[k] = _helpers[k];
  });
});

// ── Category metadata ──
const CATEGORIES = [
  { id: 'all', name: 'All' },
  { id: 'professional', name: 'Professional' },
  { id: 'creative', name: 'Creative' },
  { id: 'minimal', name: 'Minimal' },
  { id: 'social', name: 'Social' },
  { id: 'sales', name: 'Sales / CTA' },
  { id: 'industry', name: 'Industry' },
];

