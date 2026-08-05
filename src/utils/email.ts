// Sends notification email via Resend's REST API (no SDK needed). Configured
// entirely by env vars so nothing is hard-coded:
//   RESEND_API_KEY  - required to send (if absent, sends are skipped silently)
//   NOTIFY_TO       - recipient(s), comma-separated
//   RESEND_FROM     - sender address (defaults to Resend's test sender)

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] as string,
  );
}

export async function sendUploadNotification(opts: {
  companyName?: string;
  fileNames: string[];
  category?: string; // client-chosen urgency for survey uploads
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_TO;
  const from = process.env.RESEND_FROM || 'onboarding@resend.dev';
  if (!apiKey || !to) return; // not configured yet — skip

  const who = opts.companyName ? escapeHtml(opts.companyName) : 'A client';
  const count = opts.fileNames.length;
  const list = opts.fileNames
    .map((n) => `<li>${escapeHtml(n)}</li>`)
    .join('');
  // The chosen urgency, made prominent on its own line.
  const categoryBlock = opts.category
    ? `<p style="margin:16px 0 4px;">How soon they need it:</p>` +
      `<p style="font-size:20px;font-weight:700;margin:0 0 16px;">${escapeHtml(opts.category)}</p>`
    : '';
  const subject =
    `New file upload${opts.companyName ? ` from ${opts.companyName}` : ''}` +
    (opts.category ? ` — ${opts.category}` : '');
  const html =
    `<p>${who} uploaded ${count} file${count === 1 ? '' : 's'} in the client portal:</p>` +
    categoryBlock +
    `<ul>${list}</ul>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: to.split(',').map((s) => s.trim()),
        subject,
        html,
      }),
    });
    if (!res.ok) {
      console.error('Resend send failed', res.status, await res.text().catch(() => ''));
    }
  } catch (e) {
    // Never let a notification failure break the upload flow.
    console.error('Resend send error', e);
  }
}
