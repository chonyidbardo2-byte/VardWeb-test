/* ─────────────────────────────────────────────────────────────────────────
   VardWeb — Blog newsletter broadcast email builder.

   Exposes window.buildNewsletterBroadcastHtml(data), where:
     data = { subject, bodyHtml }
       subject  — plain text, escaped before display
       bodyHtml — admin-authored HTML from crm/newsletter.html's textarea.
                  Inserted UNESCAPED — this is trusted admin content, same
                  trust level as crm/cms-editor.html's content_type:'html'
                  blocks. Do not escape it.

   Used both by crm/newsletter.html (assembles the HTML sent to the
   send-newsletter-broadcast Edge Function) and
   blog-newsletter-broadcast.preview.html (design review) so the preview
   can never drift from what actually gets sent.

   Footer includes the literal, UNRESOLVED {{{RESEND_UNSUBSCRIBE_URL}}}
   placeholder — Resend resolves this itself when the broadcast is sent.
   Do not touch or interpolate that token.
───────────────────────────────────────────────────────────────────────── */
(function () {

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildNewsletterBroadcastHtml(data) {
    var subject = escapeHtml(data.subject);
    var bodyHtml = data.bodyHtml || '';
    var title = subject + ' | VardWeb Blog';

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
+     '.vw-h1 { font-size: 21px !important; }'
+   '}'
+ '</style>'
+ '</head>'
+ '<body lang="en" dir="ltr" style="margin:0;padding:0;background-color:#070910;">'

+ '<div lang="en" dir="ltr" style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:#070910;">'
+   subject
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
+     '<span style="font-family:\'JetBrains Mono\',Consolas,\'SFMono-Regular\',Menlo,monospace;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#00E5FF;">// vardweb blog</span>'
+   '</td></tr>'

+   '<tr><td class="vw-px vw-h1" style="padding:12px 40px 0;">'
+     '<h1 style="margin:0;font-family:\'JetBrains Mono\',Consolas,\'SFMono-Regular\',Menlo,monospace;font-size:24px;line-height:1.3;font-weight:800;letter-spacing:-0.02em;color:#EEF0F8;">' + subject + '</h1>'
+   '</td></tr>'

  /* Admin-authored body — unescaped, inherits base text styling */
+   '<tr><td class="vw-px" style="padding:20px 40px 0;">'
+     '<div style="font-family:\'Inter\',-apple-system,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#9AA3B8;">'
+       bodyHtml
+     '</div>'
+   '</td></tr>'

+   '<tr><td class="vw-px" style="padding:28px 40px 0;">'
+     '<div style="height:1px;line-height:1px;font-size:1px;background-color:rgba(0,229,255,0.12);">&nbsp;</div>'
+   '</td></tr>'

+   '<tr><td class="vw-px" style="padding:20px 40px 32px;">'
+     '<p style="margin:0 0 8px;font-family:\'Inter\',-apple-system,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:#9AA3B8;">'
+       'You&rsquo;re receiving this because you subscribed to the VardWeb blog. Questions? Reach us at '
+       '<a href="mailto:support@vardweb.com" style="color:#9AA3B8;text-decoration:underline;">support@vardweb.com</a>.'
+     '</p>'
+     '<p style="margin:0;font-family:\'Inter\',-apple-system,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#9AA3B8;">'
+       '<a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#9AA3B8;text-decoration:underline;">Unsubscribe</a>'
+       '&nbsp;&middot;&nbsp;&copy; 2026 VardWeb. All rights reserved.'
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

  window.buildNewsletterBroadcastHtml = buildNewsletterBroadcastHtml;
})();
