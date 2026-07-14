/* ─────────────────────────────────────────────────────────────────────────
   VardWeb — Contact form "New Project Inquiry" notification email builder.

   Exposes window.buildInquiryEmailHtml(data), where:
     data = {
       name, email, project, businessType, hasWebsite, websiteUrl, message,
       tier,    // one of 'Bronze' | 'Silver' | 'Gold' | 'Custom' | null
       addons,  // array of readable add-on labels, [] if none
     }

   Used both by contact.html (production send) and
   contact-inquiry-notification.preview.html (design review) so the preview
   can never drift from what actually gets emailed.
───────────────────────────────────────────────────────────────────────── */
(function () {

  // Duplicated from contact.html's own TIER_COLORS (drives the on-page
  // #mini-tier-box preview) — keep both in sync if a tier is ever renamed/added.
  var TIER_COLORS = { Bronze: '#CD7F32', Silver: '#C2D0E8', Gold: '#FFD700', Custom: '#A855F7' };

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function nl2br(escapedStr) {
    return escapedStr.replace(/\r\n|\r|\n/g, '<br>');
  }

  function hexToRgb(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 229, 255];
  }

  /* ── Bulletproof "section card" wrapper shared by every section below ── */
  function sectionCard(opts) {
    return ''
      + '<tr>'
      + '<td class="vw-px" style="padding:0 40px ' + opts.bottomPad + 'px;">'
      + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
      + '<tr>'
      + '<td style="background-color:' + opts.bg + ';border-left:3px solid ' + opts.accent + ';border-radius:10px;padding:16px 18px;">'
      + '<p style="margin:0 0 10px;font-family:\'JetBrains Mono\',Consolas,\'SFMono-Regular\',Menlo,monospace;font-size:10.5px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:' + opts.accent + ';">' + opts.eyebrow + '</p>'
      + opts.body
      + '</td>'
      + '</tr>'
      + '</table>'
      + '</td>'
      + '</tr>';
  }

  function fieldBlock(label, valueHtml, marginBottom) {
    return '<p style="margin:0 0 ' + (marginBottom ? '10px' : '0') + ';font-family:\'Inter\',-apple-system,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:12.5px;line-height:1.5;color:#9AA3B8;">'
      + label + '<br>'
      + '<span style="font-size:14.5px;font-weight:600;color:#EEF0F8;">' + valueHtml + '</span>'
      + '</p>';
  }

  function renderClientInfoSection(data) {
    var name  = escapeHtml(data.name);
    var email = escapeHtml(data.email);
    var body = ''
      + '<p style="margin:0 0 4px;font-family:\'Inter\',-apple-system,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;color:#EEF0F8;">' + name + '</p>'
      + '<p style="margin:0;font-family:\'Inter\',-apple-system,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:13.5px;">'
      +   '<a href="mailto:' + email + '" style="color:#00E5FF;text-decoration:underline;">' + email + '</a>'
      + '</p>';
    return sectionCard({
      accent: '#00E5FF', bg: 'rgba(0,229,255,0.06)',
      eyebrow: '// client info', body: body, bottomPad: 14,
    });
  }

  function renderProjectDetailsSection(data) {
    var project      = escapeHtml(data.project);
    var businessType = escapeHtml(data.businessType);
    var hasWebsite   = data.hasWebsite === 'Yes';
    var websiteHtml  = hasWebsite
      ? '<a href="' + escapeHtml(data.websiteUrl) + '" style="color:#00E5FF;text-decoration:underline;">' + escapeHtml(data.websiteUrl) + '</a>'
      : 'No';

    var body = ''
      + fieldBlock('Project Type', project, true)
      + fieldBlock('Business Type', businessType, true)
      + fieldBlock('Existing Website', websiteHtml, false);

    return sectionCard({
      accent: 'rgba(255,255,255,0.22)', bg: '#161b27',
      eyebrow: '// project details', body: body, bottomPad: 14,
    });
  }

  function renderTierSection(data) {
    if (!data.tier) return '';
    var accent = TIER_COLORS[data.tier] || '#00E5FF';
    var rgb = hexToRgb(accent);
    var bg = 'rgba(' + rgb.join(',') + ',0.1)';
    var body = '<p style="margin:0;font-family:\'Inter\',-apple-system,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;color:#EEF0F8;">' + escapeHtml(data.tier) + '</p>';
    return sectionCard({
      accent: accent, bg: bg,
      eyebrow: '// investment tier', body: body, bottomPad: 14,
    });
  }

  function renderAddonsSection(data) {
    if (!data.addons || !data.addons.length) return '';
    var accent = (data.tier && TIER_COLORS[data.tier]) || '#00E5FF';
    var rgb = hexToRgb(accent);
    var bg = 'rgba(' + rgb.join(',') + ',0.1)';

    var rows = data.addons.map(function (addon, i) {
      var pad = i === data.addons.length - 1 ? '0' : '7px';
      return '<tr><td style="padding:0 0 ' + pad + ';font-family:\'Inter\',-apple-system,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#EEF0F8;">'
        + '<span style="color:#4ade80;font-weight:700;">&#10003;</span>&nbsp;&nbsp;' + escapeHtml(addon)
        + '</td></tr>';
    }).join('');

    var body = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + rows + '</table>';
    return sectionCard({
      accent: accent, bg: bg,
      eyebrow: '// selected add-ons', body: body, bottomPad: 14,
    });
  }

  function renderMessageSection(data) {
    var body = '<p style="margin:0;font-family:\'Inter\',-apple-system,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:14.5px;line-height:1.7;color:#EEF0F8;">'
      + nl2br(escapeHtml(data.message))
      + '</p>';
    return sectionCard({
      accent: '#FF2D78', bg: 'rgba(255,45,120,0.06)',
      eyebrow: '// project description', body: body, bottomPad: 0,
    });
  }

  function buildInquiryEmailHtml(data) {
    var name = escapeHtml(data.name);
    var title = 'New Project Inquiry — ' + name + ' | VardWeb';

    return '<!DOCTYPE html>'
+ '<html lang="en" dir="ltr">'
+ '<head>'
+ '<meta charset="UTF-8">'
+ '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
+ '<meta name="color-scheme" content="dark">'
+ '<meta name="supported-color-schemes" content="dark">'
+ '<title>' + title + '</title>'
+ '<link rel="preconnect" href="https://fonts.googleapis.com">'
+ '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
+ '<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">'
+ '<!--[if mso]><style>table,td{border-collapse:collapse;}h1,p{font-family:Arial,sans-serif !important;}</style><![endif]-->'
+ '<style>'
+   '@media (max-width: 620px) {'
+     '.vw-container { width: 100% !important; }'
+     '.vw-px { padding-left: 22px !important; padding-right: 22px !important; }'
+     '.vw-h1 { font-size: 20px !important; }'
+   '}'
+ '</style>'
+ '</head>'
+ '<body lang="en" dir="ltr" style="margin:0;padding:0;background-color:#070910;">'

+ '<div lang="en" dir="ltr" style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:#070910;">'
+   'New inquiry from ' + name + (data.tier ? ' — ' + escapeHtml(data.tier) + ' tier' : '')
+ '</div>'
+ '<div style="display:none;max-height:0;overflow:hidden;">&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;</div>'

+ '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" lang="en" dir="ltr" bgcolor="#070910" style="background-color:#070910;">'
+ '<tr><td align="center" style="padding:40px 16px;">'

+ '<table role="presentation" class="vw-container" width="600" cellpadding="0" cellspacing="0" border="0" align="center" style="width:600px;max-width:600px;">'

  /* Logo */
+ '<tr><td align="center" style="padding:0 0 32px;">'
+   '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
+     '<td bgcolor="#ffffff" style="background-color:#ffffff;border-radius:8px;padding:6px 14px;">'
+       '<img src="https://lvxlshberdazzmjbrjdu.supabase.co/storage/v1/object/public/Assets/VardWeb.png" width="132" alt="VardWeb — web design studio" style="display:block;border:0;outline:none;text-decoration:none;height:auto;border-radius:2px;">'
+     '</td>'
+   '</tr></table>'
+ '</td></tr>'

  /* Card */
+ '<tr><td style="background-color:#0f1219;border:1px solid rgba(0,229,255,0.14);border-radius:20px;">'
+ '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'

+   '<tr><td class="vw-px" style="padding:36px 40px 0;">'
+     '<span style="font-family:\'JetBrains Mono\',Consolas,\'SFMono-Regular\',Menlo,monospace;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#00E5FF;">// new project inquiry</span>'
+   '</td></tr>'

+   '<tr><td class="vw-px vw-h1" style="padding:12px 40px 0;">'
+     '<h1 style="margin:0;font-family:\'JetBrains Mono\',Consolas,\'SFMono-Regular\',Menlo,monospace;font-size:23px;line-height:1.3;font-weight:800;letter-spacing:-0.02em;color:#EEF0F8;">New inquiry from ' + name + '</h1>'
+   '</td></tr>'

+   '<tr><td class="vw-px" style="padding:24px 40px 0;">'
+     '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
+       renderClientInfoSection(data)
+       renderProjectDetailsSection(data)
+       renderTierSection(data)
+       renderAddonsSection(data)
+       renderMessageSection(data)
+     '</table>'
+   '</td></tr>'

+   '<tr><td class="vw-px" style="padding:8px 40px 0;">'
+     '<div style="height:1px;line-height:1px;font-size:1px;background-color:rgba(0,229,255,0.12);">&nbsp;</div>'
+   '</td></tr>'

+   '<tr><td class="vw-px" style="padding:20px 40px 32px;">'
+     '<p style="margin:0;font-family:\'Inter\',-apple-system,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:#9AA3B8;">'
+       'Automated notification from the VardWeb contact form. Reply directly to this email to respond to ' + name + ' — Reply-To is already set to their address. &middot; &copy; 2026 VardWeb. All rights reserved.'
+     '</p>'
+   '</td></tr>'

+ '</table>'
+ '</td></tr>'

+ '</table>'

+ '</td></tr>'
+ '</table>'

+ '</body>'
+ '</html>';
  }

  window.buildInquiryEmailHtml = buildInquiryEmailHtml;
})();
