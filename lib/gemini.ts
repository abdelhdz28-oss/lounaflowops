// Helpers Gemini Files API partagés (extraction IA de PDF : mirage, rendement).
// Chaîne : upload resumable → polling ACTIVE → generateContent avec file_data → JSON extrait de la réponse.

const GL = 'https://generativelanguage.googleapis.com';

export type GeminiUpload = {
  ok: boolean;
  fileUri?: string; fileName?: string;                    // présents si ok
  stage?: 'start' | 'upload' | 'processing';              // étape en échec sinon
  status?: number; detail?: any;
};

// Téléverse un PDF via la Files API (upload resumable : gère les gros dossiers scannés,
// sans la limite ~20 Mo de l'inline) puis attend que le fichier soit ACTIVE.
export async function geminiUploadPdf(key: string, buf: Buffer, displayName: string, pollAttempts = 20): Promise<GeminiUpload> {
  const startRes = await fetch(`${GL}/upload/v1beta/files?key=${key}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(buf.length),
      'X-Goog-Upload-Header-Content-Type': 'application/pdf', 'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });
  const uploadUrl = startRes.headers.get('x-goog-upload-url');
  if (!startRes.ok || !uploadUrl) return { ok: false, stage: 'start', status: startRes.status };
  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Length': String(buf.length), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: buf,
  });
  const upData: any = await upRes.json().catch(() => ({}));
  if (!upRes.ok || !upData.file?.uri) return { ok: false, stage: 'upload', status: upRes.status, detail: upData };
  const fileName = upData.file.name;
  let fileUri = upData.file.uri;
  let state = upData.file.state;
  for (let k = 0; k < pollAttempts && state === 'PROCESSING'; k++) {
    await new Promise(rz => setTimeout(rz, 1000));
    const st = await fetch(`${GL}/v1beta/${fileName}?key=${key}`);
    const sd: any = await st.json().catch(() => ({}));
    state = sd.state; fileUri = sd.uri || fileUri;
  }
  if (state && state !== 'ACTIVE') return { ok: false, stage: 'processing' };
  return { ok: true, fileUri, fileName };
}

// generateContent sur un ou plusieurs PDF + prompt ; extrait le premier bloc JSON de la réponse.
// Jusqu'à 3 tentatives : encaisse les erreurs d'API passagères ET les réponses tronquées/illisibles.
export async function geminiGenerateJson(key: string, model: string, fileUris: string[], text: string, opts: { maxOutputTokens: number; logLabel: string }): Promise<any | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(rz => setTimeout(rz, 800 * attempt));
    const r = await fetch(`${GL}/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [...fileUris.map(u => ({ file_data: { mime_type: 'application/pdf', file_uri: u } })), { text }] }],
        generationConfig: { temperature: 0, maxOutputTokens: opts.maxOutputTokens, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok) { console.error(opts.logLabel, r.status, data?.error?.message || ''); continue; } // erreur API → nouvelle tentative
    const txt = (data.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('');
    try { const m = txt.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); } catch { /* JSON tronqué/invalide → nouvelle tentative */ }
  }
  return null;
}

// Suppression best-effort du fichier téléversé après lecture.
export function geminiDeleteFile(key: string, fileName: string) {
  fetch(`${GL}/v1beta/${fileName}?key=${key}`, { method: 'DELETE' }).catch(() => {});
}
