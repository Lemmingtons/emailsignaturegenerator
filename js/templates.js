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
      const divider = this._divider(dividerStyle, primaryColor, data);

      return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 13px; color: ${textColor}; line-height: 1.4;">
  <tr>
    ${this._photoCell(data, photoRadius)}
    <td style="vertical-align: top;">
      <table cellpadding="0" cellspacing="0" border="0">
        ${this._logoRow(data, primaryColor)}
        <tr><td style="padding-bottom: 8px;">
          ${this._nameHtml(data, this.escapeAttr(data.fullName), `font-size: 15px; color: ${textColor}; font-family: ${fontFamily};`)}<br/>
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
          ${this._nameHtml(data, this.escapeAttr(String(data.fullName || '').toUpperCase()), `font-size: 17px; color: ${textColor}; font-family: ${fontFamily}; letter-spacing: 0.3px;`)}<br/>
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
          ${this._nameHtml(data, this.escapeAttr(data.fullName), `font-size: 16px; color: ${textColor}; font-family: ${fontFamily};`)}<br/>
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
      ${this._photoCellCustom(data, photoRadius, 60, 'vertical-align: middle; padding-right: 14px;')}
      <td style="vertical-align: middle;">
        ${this._nameHtml(data, this.escapeAttr(data.fullName), `font-size: 16px; color: ${textColor}; font-family: ${fontFamily};`)}<br/>
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
      const divider = this._divider(dividerStyle, primaryColor, data);

      return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 13px; color: ${textColor}; line-height: 1.5;">
  <tr>
    ${this._photoCell(data, photoRadius, 90)}
    <td style="vertical-align: top;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        ${this._logoRow(data, primaryColor)}
        <tr><td style="padding-bottom: 6px;">
          ${this._nameHtml(data, this.escapeAttr(data.fullName), `font-size: 16px; color: ${textColor}; font-family: ${fontFamily};`)}<br/>
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
          ${this._nameHtml(data, this.escapeAttr(data.fullName), `font-size: 18px; color: ${primaryColor}; font-family: ${fontFamily};`)}<br/>
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
    ${this._photoCellCustom(data, photoRadius, 90, 'vertical-align: top; padding-right: 18px;', `border: 3px solid ${primaryColor}; `)}
    <td style="vertical-align: top;">
      <table cellpadding="0" cellspacing="0" border="0">
        ${this._logoRow(data, primaryColor)}
        <tr><td style="padding-bottom: 6px;">
          ${this._nameHtml(data, this.escapeAttr(data.fullName), `font-size: 20px; color: ${primaryColor}; font-family: ${fontFamily}; letter-spacing: -0.5px;`)}
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
      ${this._photoCellCustom(data, photoRadius, 80, 'vertical-align: top; padding-right: 16px;')}
      <td style="vertical-align: top;">
        ${this._nameHtml(data, this.escapeAttr(data.fullName), `font-size: 16px; color: ${textColor}; font-family: ${fontFamily};`)}<br/>
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
    ${this._nameHtml(data, this.escapeAttr(data.fullName), `font-size: 14px; color: ${textColor}; font-family: ${fontFamily};`)}
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

      let lines = [`${this._nameHtml(data, this.escapeAttr(data.fullName), `color: ${textColor}; font-family: ${fontFamily};`)}`];
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
    ${this._nameHtml(data, this.escapeAttr(data.fullName), `font-size: 14px; color: ${textColor}; font-family: ${fontFamily};`)}<br/>
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
          ${this._nameHtml(data, this.escapeAttr(data.fullName), `font-size: 16px; color: ${textColor}; font-family: ${fontFamily};`)}<br/>
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
    ${this._photoTile(data, photoRadius, 70)}
  </td></tr>
  <tr><td style="padding-bottom: 4px;">
    ${this._nameHtml(data, this.escapeAttr(data.fullName), `font-size: 16px; color: ${textColor}; font-family: ${fontFamily};`)}
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
          ${this._nameHtml(data, nameSafe, `font-size: 15px; color: ${textColor}; font-family: ${fontFamily};`)}<br/>
          <span style="font-size: 12px; color: #4b5563; font-family: ${fontFamily};">${titleSafe}${data.title && data.company ? ' \u2014 ' : ''}${companySafe}</span>
        </td></tr>
        <tr><td style="font-size: 12px; color: #4b5563; font-family: ${fontFamily}; padding-bottom: 10px;">
          ${this._contactLine(data, fontFamily)}
        </td></tr>
        <tr><td>
          ${this._ctaButton(data, ctaLink, cta, `display: inline-block; background: ${primaryColor}; color: #fff; padding: 8px 20px; border-radius: 5px; font-size: 12px; font-weight: 700; text-decoration: none; font-family: ${fontFamily};`)}
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
          ${this._nameHtml(data, this.escapeAttr(data.fullName), `font-size: 15px; color: ${textColor}; font-family: ${fontFamily};`)}<br/>
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
      const divider = this._divider(dividerStyle, primaryColor, data);
      const cta = ctaText || 'Schedule a call';
      const ctaLink = this.escapeUrl(ctaUrl || '#', 'href') || '#';

      return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 13px; color: ${textColor}; line-height: 1.5;">
  <tr>
    ${this._photoCell(data, photoRadius)}
    <td style="vertical-align: top;">
      <table cellpadding="0" cellspacing="0" border="0">
        ${this._logoRow(data, primaryColor)}
        <tr><td style="padding-bottom: 8px;">
          ${this._nameHtml(data, this.escapeAttr(data.fullName), `font-size: 15px; color: ${textColor}; font-family: ${fontFamily};`)}<br/>
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
    ${this._photoCellCustom(data, photoRadius, 100, 'vertical-align: top; padding-right: 18px;')}
    <td style="vertical-align: top;">
      <table cellpadding="0" cellspacing="0" border="0">
        ${this._logoRow(data, primaryColor)}
        <tr><td style="padding-bottom: 4px;">
          ${this._nameHtml(data, this.escapeAttr(data.fullName), `font-size: 17px; color: ${textColor}; font-family: ${fontFamily};`)}
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
          ${this._ctaButton(data, ctaLink, cta, `display: inline-block; background: ${primaryColor}; color: #fff; padding: 7px 16px; border-radius: 4px; font-size: 11px; font-weight: 700; text-decoration: none; font-family: ${fontFamily}; text-transform: uppercase; letter-spacing: 0.5px;`)}
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
      ${this._photoCellCustom(data, photoRadius, 65, 'vertical-align: middle; padding-right: 14px;')}
      <td style="vertical-align: middle;">
        ${this._nameHtml(data, this.escapeAttr(data.fullName), `font-size: 16px; color: ${textColor}; font-family: ${fontFamily};`)}<br/>
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
          ${this._nameHtml(data, this.escapeAttr(data.fullName), `font-size: 15px; color: ${textColor}; font-family: ${fontFamily};`)}
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

  // ═══════════════════════════════════════════
  // PREMIUM
  // ═══════════════════════════════════════════
  //
  // These five share a deliberate house style that the older templates do not:
  // 1px neutral hairlines rather than 2-4px coloured bars, a wider type scale
  // (near-black name, small-caps role, muted contacts) and the accent colour spent
  // exactly once. Everything is still table-only and inline-styled, so they carry
  // no more client risk than the templates around them.

  atelier: {
    name: 'Atelier',
    category: 'professional',
    pro: false,
    icon: '&#9671;',
    render(data, style) {
      const { primaryColor, textColor, fontFamily, photoShape, iconStyle } = style;
      const photoRadius = photoShape === 'circle' ? '50%' : photoShape === 'rounded' ? '6px' : '0';
      const accent = this._safeColor(primaryColor);
      const ink = this._safeColor(textColor);
      const role = [data.title, data.company].filter(Boolean)
        .map(v => `<span style="font-size: 10px; color: #6b7280; font-family: ${fontFamily}; text-transform: uppercase; letter-spacing: 1.4px;">${this.escapeAttr(v)}</span>`)
        .join('<span style="color: #9aa3ad; padding: 0 6px;">&middot;</span>');

      return `<table cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background-color: #ffffff; font-family: ${fontFamily}; font-size: 13px; color: ${ink}; line-height: 1.5; border-collapse: collapse;">
  <tr>
    ${this._photoCellCustom(data, photoRadius, 76, 'vertical-align: top; padding-right: 20px;')}
    <td style="vertical-align: top;">
      <table cellpadding="0" cellspacing="0" border="0">
        ${this._logoRow(data, primaryColor)}
        <tr><td style="padding-bottom: 3px;">
          ${this._nameHtml(data, this.escapeAttr(data.fullName), `font-size: 17px; color: ${ink}; font-family: ${fontFamily}; letter-spacing: -0.2px;`)}
        </td></tr>
        ${role ? `<tr><td style="padding-bottom: 12px;">${role}</td></tr>` : ''}
        <tr><td style="padding-bottom: 12px;">
          <table cellpadding="0" cellspacing="0" border="0" width="40"><tr>
            <td height="2" bgcolor="${accent}" style="height: 2px; line-height: 2px; font-size: 1px; background-color: ${accent};">&nbsp;</td>
          </tr></table>
        </td></tr>
        <tr><td style="font-size: 12px; line-height: 1.9; color: #4b5563; font-family: ${fontFamily};">
          ${this._contactLineStacked(data, fontFamily)}
        </td></tr>
        ${this._socialRow(data, iconStyle, primaryColor, 14)}
      </table>
    </td>
  </tr>
</table>`;
    }
  },

  cardstock: {
    name: 'Card',
    category: 'professional',
    pro: true,
    icon: '&#9744;',
    render(data, style) {
      const { primaryColor, textColor, fontFamily, photoShape, iconStyle } = style;
      const photoRadius = photoShape === 'square' ? '0' : photoShape === 'rounded' ? '6px' : '50%';
      const accent = this._safeColor(primaryColor);
      const ink = this._safeColor(textColor);
      const cta = data.ctaText || style.ctaText;
      const ctaLink = this.escapeUrl(data.ctaUrl || style.ctaUrl, 'href');
      const role = [data.title, data.company].filter(Boolean).map(v => this.escapeAttr(v)).join(', ');
      const photo = this._photoTile(data, photoRadius, 64);

      // border-radius is ignored by classic Outlook, which renders this as a plain
      // square-cornered card. That degrades cleanly, so it is left in for the
      // clients that do honour it.
      return `<table cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background-color: #ffffff; border: 1px solid #e6e8eb; border-radius: 14px; border-collapse: separate; font-family: ${fontFamily}; max-width: 460px;">
  <tr><td style="padding: 20px 24px;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%">
      ${this._logoRow(data, primaryColor)}
      <tr>
        ${photo ? `<td width="64" style="width: 64px; vertical-align: middle;">${photo}</td><td width="20" style="width: 20px;">&nbsp;</td>` : ''}
        <td style="vertical-align: middle; ${photo ? `border-left: 1px solid #e6e8eb; padding-left: 20px;` : ''}">
          <table cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding-bottom: 3px;">
              ${this._nameHtml(data, this.escapeAttr(data.fullName), `font-size: 16px; color: ${ink}; font-family: ${fontFamily}; letter-spacing: -0.1px;`)}
            </td></tr>
            ${role ? `<tr><td style="padding-bottom: 10px; font-size: 12px; color: #6b7280; font-family: ${fontFamily};">${role}</td></tr>` : ''}
            <tr><td style="font-size: 12px; line-height: 1.8; color: #4b5563; font-family: ${fontFamily};">
              ${this._contactLine(data, fontFamily, '<span style="color: #e6e8eb; padding: 0 8px;">|</span>')}
            </td></tr>
          </table>
        </td>
      </tr>
      <tr><td colspan="${photo ? 3 : 1}" style="padding-top: 16px;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
          <td style="border-top: 1px solid #e6e8eb; font-size: 1px; line-height: 1px; height: 1px;">&nbsp;</td>
        </tr></table>
      </td></tr>
      <tr><td colspan="${photo ? 3 : 1}" style="padding-top: 14px;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
          <td style="vertical-align: middle;">${this._socialRowLarge(data, iconStyle, primaryColor).replace(/width="30" height="30"/g, 'width="18" height="18"').replace(/width: 30px; height: 30px/g, 'width: 18px; height: 18px')}</td>
          ${cta && ctaLink ? `<td align="right" style="vertical-align: middle;"><a href="${ctaLink}" target="_blank" style="font-size: 11px; font-weight: 700; color: ${accent}; text-decoration: none; letter-spacing: 0.3px; font-family: ${fontFamily};">${this.escapeAttr(cta)} &rarr;</a></td>` : ''}
        </tr></table>
      </td></tr>
    </table>
  </td></tr>
</table>`;
    }
  },

  portrait: {
    name: 'Portrait',
    category: 'creative',
    pro: true,
    icon: '&#9635;',
    render(data, style) {
      const { primaryColor, textColor, fontFamily, iconStyle } = style;
      const accent = this._safeColor(primaryColor);
      const ink = this._safeColor(textColor);
      // A serif nameplate is the whole point of this one, so it deliberately does
      // not follow the chosen body font. Georgia is web-safe everywhere.
      const serif = "Georgia, 'Times New Roman', Times, serif";
      const role = [data.title, data.company].filter(Boolean).map(v => this.escapeAttr(v))
        .join('<span style="color: #9aa3ad; padding: 0 8px;">&middot;</span>');
      const hasPhoto = !!(data.photoUrl && this.escapeUrl(data.photoUrl, 'src'));
      const initials = this.escapeAttr(this._initials(data.fullName));

      return `<table cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background-color: #ffffff; font-family: ${fontFamily}; font-size: 13px; color: ${ink}; line-height: 1.5; border-collapse: collapse;">
  <tr>
    ${hasPhoto ? `<td width="72" style="width: 72px; vertical-align: top;">
      <table cellpadding="0" cellspacing="0" border="0" width="72" height="90" style="width: 72px; height: 90px; border-collapse: collapse;"><tr>
        <td width="72" height="90" bgcolor="#eef1f4" align="center" style="width: 72px; height: 90px; background-color: #eef1f4;">
          <img src="${this.escapeUrl(data.photoUrl, 'src')}" alt="${initials}" width="72" height="90" style="display: block; width: 72px; height: 90px; object-fit: cover; border: 0; font-family: ${fontFamily}; font-size: 24px; font-weight: 700; color: #6b7280; text-align: center; line-height: 90px;" />
        </td>
      </tr></table>
    </td>
    <td width="1" bgcolor="${accent}" style="width: 1px; background-color: ${accent}; font-size: 1px; line-height: 1px;">&nbsp;</td>` : ''}
    <td style="vertical-align: top; ${hasPhoto ? 'padding-left: 20px;' : ''}">
      <table cellpadding="0" cellspacing="0" border="0">
        ${this._logoRow(data, primaryColor)}
        <tr><td style="padding-bottom: 4px;">
          ${this._nameHtml(data, this.escapeAttr(data.fullName), `font-size: 18px; color: ${ink}; font-family: ${serif}; letter-spacing: 0.4px;`)}
        </td></tr>
        ${role ? `<tr><td style="padding-bottom: 12px; font-size: 10px; color: #6b7280; font-family: ${fontFamily}; text-transform: uppercase; letter-spacing: 1.6px;">${role}</td></tr>` : ''}
        <tr><td style="font-size: 12px; line-height: 1.8; color: #4b5563; font-family: ${fontFamily};">
          ${this._contactLine(data, fontFamily, '<span style="color: #d7dbdf; padding: 0 8px;">/</span>')}
        </td></tr>
        ${this._socialRow(data, iconStyle, primaryColor, 12)}
      </table>
    </td>
  </tr>
</table>`;
    }
  },

  monogram: {
    name: 'Monogram',
    category: 'minimal',
    pro: true,
    icon: '&#9711;',
    render(data, style) {
      const { primaryColor, textColor, fontFamily, iconStyle } = style;
      const accent = this._safeColor(primaryColor);
      const ink = this._safeColor(textColor);
      const initials = this.escapeAttr(this._initials(data.fullName));

      // Prefers a generated monogram image when one has been built and hosted,
      // because classic Outlook squares off the CSS disc below. The fallback is a
      // filled cell rather than nothing, so this template never needs a photo.
      const hostedMonogram = data.monogramUrl ? this.escapeUrl(data.monogramUrl, 'src') : '';
      const disc = hostedMonogram
        ? `<img src="${hostedMonogram}" alt="${initials}" width="52" height="52" style="display: block; width: 52px; height: 52px; border: 0; border-radius: 50%; font-family: ${fontFamily}; font-size: 18px; font-weight: 700; color: #ffffff; text-align: center; line-height: 52px;" />`
        : `<table cellpadding="0" cellspacing="0" border="0" width="52" style="width: 52px; border-collapse: collapse;"><tr>
             <td width="52" height="52" align="center" bgcolor="${accent}" style="width: 52px; height: 52px; background-color: ${accent}; border-radius: 50%; text-align: center; vertical-align: middle;">
               <span style="font-family: Georgia, 'Times New Roman', Times, serif; font-size: 20px; color: #ffffff; letter-spacing: 1px; line-height: 52px;">${initials}</span>
             </td>
           </tr></table>`;

      return `<table cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background-color: #ffffff; font-family: ${fontFamily}; font-size: 13px; color: ${ink}; line-height: 1.5; border-collapse: collapse;">
  <tr>
    <td width="52" style="width: 52px; vertical-align: middle;">${disc}</td>
    <td style="padding-left: 18px; vertical-align: middle;">
      <table cellpadding="0" cellspacing="0" border="0">
        ${this._logoRow(data, primaryColor)}
        <tr><td style="padding-bottom: 2px;">
          ${this._nameHtml(data, this.escapeAttr(data.fullName), `font-size: 16px; color: ${ink}; font-family: ${fontFamily}; letter-spacing: -0.1px;`)}
          ${data.title ? `<span style="color: #d7dbdf; padding: 0 8px;">|</span><span style="font-size: 12px; color: #6b7280; font-family: ${fontFamily};">${this.escapeAttr(data.title)}</span>` : ''}
        </td></tr>
        <tr><td style="padding-top: 6px; font-size: 12px; line-height: 1.8; color: #4b5563; font-family: ${fontFamily};">
          ${data.company ? `${this.escapeAttr(data.company)}<span style="color: #d7dbdf; padding: 0 8px;">&middot;</span>` : ''}${this._contactLine(data, fontFamily, '<span style="color: #d7dbdf; padding: 0 8px;">&middot;</span>')}
        </td></tr>
        ${this._socialRow(data, iconStyle, primaryColor, 12)}
      </table>
    </td>
  </tr>
</table>`;
    }
  },

  stacked: {
    name: 'Stacked',
    category: 'minimal',
    pro: true,
    icon: '&#8801;',
    render(data, style) {
      const { primaryColor, textColor, fontFamily, photoShape, iconStyle } = style;
      const photoRadius = photoShape === 'square' ? '0' : photoShape === 'rounded' ? '6px' : '50%';
      const ink = this._safeColor(textColor);
      const role = [data.title, data.company].filter(Boolean).map(v => this.escapeAttr(v)).join(', ');
      const photo = this._photoTile(data, photoRadius, 44);

      // Micro-labels sit in their own table column rather than an inline-block, so
      // the alignment survives Outlook, which ignores inline-block widths.
      const label = (text) => `<td width="56" style="width: 56px; padding: 3px 0; font-size: 9px; text-transform: uppercase; letter-spacing: 1.2px; color: #9aa3ad; font-family: ${fontFamily}; vertical-align: middle;">${text}</td>`;
      const rows = [
        data.phone && [label('Phone'), `<a href="${this.escapeAttr('tel:' + String(data.phone).replace(/\s/g, ''))}" style="color: #4b5563; text-decoration: none; font-family: ${fontFamily};">${this.escapeAttr(data.phone)}</a>`],
        data.email && [label('Email'), `<a href="${this.escapeAttr('mailto:' + String(data.email))}" style="color: #4b5563; text-decoration: none; font-family: ${fontFamily};">${this.escapeAttr(data.email)}</a>`],
        data.website && this.escapeUrl(data.website, 'href') && [label('Web'), `<a href="${this.escapeUrl(data.website, 'href')}" style="color: #4b5563; text-decoration: none; font-family: ${fontFamily};">${this.escapeAttr(String(data.website).replace(/^https?:\/\//, ''))}</a>`],
      ].filter(Boolean)
        .map(([lab, value]) => `<tr>${lab}<td style="padding: 3px 0; font-size: 12px; font-family: ${fontFamily}; vertical-align: middle;">${value}</td></tr>`)
        .join('');

      return `<table cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background-color: #ffffff; font-family: ${fontFamily}; font-size: 13px; color: ${ink}; line-height: 1.5; border-collapse: collapse; max-width: 340px;">
  ${this._logoRow(data, primaryColor)}
  <tr><td style="padding-bottom: 14px;">
    <table cellpadding="0" cellspacing="0" border="0"><tr>
      ${photo ? `<td width="44" style="width: 44px; vertical-align: middle;">${photo}</td>` : ''}
      <td style="${photo ? 'padding-left: 12px; ' : ''}vertical-align: middle;">
        ${this._nameHtml(data, this.escapeAttr(data.fullName), `font-size: 15px; color: ${ink}; font-family: ${fontFamily};`)}
        ${role ? `<br/><span style="font-size: 11px; color: #6b7280; font-family: ${fontFamily};">${role}</span>` : ''}
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding-bottom: 12px;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td style="border-top: 1px solid #e6e8eb; font-size: 1px; line-height: 1px; height: 1px;">&nbsp;</td>
    </tr></table>
  </td></tr>
  ${rows ? `<tr><td><table cellpadding="0" cellspacing="0" border="0" style="color: #4b5563;">${rows}</table></td></tr>` : ''}
  ${this._socialRow(data, iconStyle, primaryColor, 14)}
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

  // Renders a filled call-to-action button. When an animated CTA image has been
  // generated and hosted, the button becomes that image inside the same link;
  // otherwise it stays a styled text anchor. The label is carried as alt text so
  // clients that block remote images still show a usable link.
  _ctaButton(data, ctaLink, label, anchorStyle) {
    const safeLabel = this.escapeAttr(label);
    const src = data.ctaImageUrl ? this.escapeUrl(data.ctaImageUrl, 'src') : '';
    const width = parseInt(data.ctaImageWidth, 10);
    const height = parseInt(data.ctaImageHeight, 10);

    if (src && width > 0 && height > 0) {
      return `<a href="${ctaLink}" target="_blank" style="text-decoration: none;"><img src="${src}" width="${width}" height="${height}" alt="${safeLabel}" style="display: block; border: 0; outline: none;" /></a>`;
    }

    return `<a href="${ctaLink}" target="_blank" style="${anchorStyle}">${safeLabel}</a>`;
  },

  // Renders the name, as a link when the customer has chosen a target for it.
  //
  // Colour, weight and text-decoration are all stated on the anchor because iOS
  // Mail and Outlook.com both restyle an under-specified link to their own blue
  // underline — on the one element in the signature people look at first.
  //
  // Falls back to the original <strong> whenever no target is set or the URL fails
  // the scheme check, so an unlinked signature is byte-identical to what shipped
  // before this existed.
  _nameHtml(data, text, styles) {
    const href = data.nameLinkUrl ? this.escapeUrl(data.nameLinkUrl, 'href') : '';
    if (!href) return `<strong style="${styles}">${text}</strong>`;
    return `<a href="${href}" target="_blank" style="${styles} font-weight: 700; text-decoration: none;">${text}</a>`;
  },

  // Up to two initials from the entered name, used as photo alt text.
  // Falls back to a single dot rather than an empty string, because an empty alt
  // renders as nothing at all and the tile would read as a layout bug.
  _initials(name) {
    const words = String(name == null ? '' : name)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return '·';
    const letters = words.length === 1
      ? words[0].slice(0, 1)
      : words[0].slice(0, 1) + words[words.length - 1].slice(0, 1);
    return letters.toUpperCase();
  },

  // Photo cell with a deliberate blocked-image state.
  //
  // Outlook and Gmail both apply an <img>'s own font styling to its alt text when
  // the image does not load, and remote images are blocked by default in a lot of
  // corporate Outlook installs. Sizing and centring the alt text and tinting the
  // cell behind it turns "broken icon next to the sender's full name" into a plain
  // initials tile at exactly the size the photo would have occupied, so the layout
  // does not move either.
  // The photo itself, tinted tile and all. Returned without an enclosing cell so
  // centred and bordered layouts can place it themselves.
  // `extraImgStyle` carries per-template decoration such as an accent border.
  // Returns '' when there is no photo or the URL fails the scheme check.
  _photoTile(data, radius, size, extraImgStyle = '') {
    if (!data.photoUrl) return '';
    const safeUrl = this.escapeUrl(data.photoUrl, 'src');
    if (!safeUrl) return '';
    const initials = this.escapeAttr(this._initials(data.fullName));
    const tint = '#eef1f4';

    return `<table cellpadding="0" cellspacing="0" border="0" width="${size}" align="center" style="width: ${size}px; border-collapse: collapse;">
        <tr><td width="${size}" height="${size}" align="center" bgcolor="${tint}" style="width: ${size}px; height: ${size}px; background-color: ${tint}; border-radius: ${radius};">
          <img src="${safeUrl}" alt="${initials}" width="${size}" height="${size}" style="border-radius: ${radius}; display: block; width: ${size}px; height: ${size}px; object-fit: cover; border: 0; ${extraImgStyle}font-family: Arial, Helvetica, sans-serif; font-size: ${Math.round(size / 3)}px; font-weight: 700; color: #6b7280; text-align: center; line-height: ${size}px;" />
        </td></tr>
      </table>`;
  },

  _photoCell(data, radius, size = 90) {
    const tile = this._photoTile(data, radius, size);
    if (!tile) return '';
    return `<td style="vertical-align: top; padding-right: 18px; background-color: #ffffff;" bgcolor="#ffffff">
      ${tile}
    </td>`;
  },

  // Same as _photoCell but with the cell styling chosen by the template, for the
  // layouts that need their own padding, alignment or photo border. Returns ''
  // when there is no photo, so the row simply loses the column.
  _photoCellCustom(data, radius, size, cellStyle, extraImgStyle) {
    const tile = this._photoTile(data, radius, size, extraImgStyle);
    return tile ? `<td style="${cellStyle}">${tile}</td>` : '';
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

  // `data` is optional so existing callers keep working; when an animated divider
  // has been generated and hosted, the border rule is replaced by that image.
  // width="100%" makes it fill the cell exactly as the border does, and a thin
  // horizontal bar scales without visible distortion. Frame 1 of the GIF is a
  // plain rule, so older Outlook renders what it renders today.
  _divider(style, color, data) {
    if (style === 'none') return '';

    const src = data && data.dividerImageUrl ? this.escapeUrl(data.dividerImageUrl, 'src') : '';
    const height = parseInt(data && data.dividerImageHeight, 10);
    if (src && height > 0) {
      return `<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="font-size: 1px; line-height: 1px; background-color: #ffffff;" bgcolor="#ffffff"><img src="${src}" width="100%" height="${height}" alt="" style="display: block; border: 0; width: 100%; height: ${height}px;" /></td></tr></table>`;
    }

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

  // Returns a hosted PNG URL for a social icon, tinted to match the signature.
  //
  // These used to be inline `data:` SVGs, which neither Gmail nor Outlook render —
  // every signature showed a row of broken-image placeholders. The Worker renders
  // them on demand at /i/{platform}-{hex}.png and caches them forever.
  //
  // Only `mono` and `color` are offered. Older saved signatures may still carry
  // `rounded` or `square`, which never differed from `mono` — anything that isn't
  // `color` falls through to the grey tint.
  _iconUrl(platform, iconStyle, primaryColor) {
    const known = ['website', 'linkedin', 'instagram', 'facebook', 'google'];
    const safePlatform = known.includes(platform) ? platform : 'website';

    const tint = (iconStyle === 'color') ? this._safeColor(primaryColor) : '#4b5563';
    const hex = /^#[0-9a-fA-F]{6}$/.test(tint) ? tint.slice(1).toLowerCase() : '4b5563';

    return `${this._siteOrigin()}/i/${safePlatform}-${hex}.png`;
  },

  // Icons must be absolute for email, and must point at the live site rather than
  // wherever the generator happens to be running.
  _siteOrigin() {
    const facts = (typeof SiteFacts !== 'undefined' && SiteFacts)
      || (typeof globalThis !== 'undefined' && globalThis.SiteFacts);
    return (facts && facts.origin) || 'https://emailsignaturegenerator.ai';
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
      const icon = this._iconUrl(s.platform, iconStyle, primaryColor);
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
      const icon = this._iconUrl(s.platform, iconStyle, primaryColor);
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

if (typeof module === 'object' && module.exports) {
  module.exports = { TEMPLATES, CATEGORIES };
}
