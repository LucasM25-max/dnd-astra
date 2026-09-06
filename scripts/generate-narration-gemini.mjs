/**
 * Optional OFFLINE regeneration. This script is never called by Vite or the browser.
 * Docs: https://ai.google.dev/gemini-api/docs/generate-content/speech-generation
 * Keep GEMINI_API_KEY in a local environment/secret store, never a VITE_* variable.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
const script = JSON.parse(await fs.readFile(new URL('../src/game/narration-script.json', import.meta.url), 'utf8'));
const model = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';
const voice = process.env.GEMINI_NARRATOR_VOICE || 'Charon';
if (!/^[a-z0-9.-]+$/i.test(model) || !/^[a-z0-9_-]+$/i.test(voice)) throw new Error('Invalid model or voice configuration.');
function directedText(line) {
  let text = `[${line.tag}] ${line.text}`;
  if (line.id === '02-gundren') text = text.replace('"something big,"', '[whispers] "something big," [storytelling]');
  return `${script.direction}\n\nSCRIPT:\n${text}`;
}
function requestFor(line) {
  return { contents: [{ parts: [{ text: directedText(line) }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } };
}
if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify({ model, voice, note: 'No API request made. No key included.', requests: script.lines.map(line => ({ id: line.id, request: requestFor(line) })) }, null, 2));
  process.exit(0);
}
const key = process.env.GEMINI_API_KEY;
if (!key) { console.error('Set GEMINI_API_KEY in a private environment or .env.local first. Never paste it into chat or use a VITE_ prefix. Use --dry-run to inspect directed scripts without a key.'); process.exit(1); }
const output = new URL('../public/audio/narration/', import.meta.url);
await fs.mkdir(output, { recursive: true });
const staged = [];
for (const line of script.lines) {
  console.log(`Generating ${line.id} with ${model} / ${voice}…`);
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(requestFor(line)), signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`Gemini returned HTTP ${response.status} for ${line.id}. Existing narration is unchanged. Check the model's availability, project access, and quota.`);
  const result = await response.json();
  const part = result.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.mimeType?.startsWith('audio/'));
  if (!part?.inlineData?.data) throw new Error(`No audio was returned for ${line.id}. Existing narration is unchanged.`);
  const mime = part.inlineData.mimeType, rate = Number(mime.match(/rate=(\d+)/)?.[1] || 24000);
  if (!/audio\/(L16|pcm)/i.test(mime) || !Number.isFinite(rate) || rate < 8000 || rate > 96000) throw new Error(`Unexpected audio format for ${line.id}; refusing to overwrite working narration.`);
  const pcm = Buffer.from(part.inlineData.data, 'base64');
  if (pcm.length < 1000 || pcm.length % 2) throw new Error(`Invalid PCM audio for ${line.id}.`);
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVE', 8); wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
  staged.push({ id: line.id, file: `${line.id}-gemini.wav`, wav, duration: pcm.length / (rate * 2) });
}
// Publish the manifest only after all six requests succeed; never leave a half-replaced voice.
const manifest = { version: 1, provider: model, voice, clips: {} };
for (const clip of staged) {
  await fs.writeFile(new URL(clip.file, output), clip.wav);
  manifest.clips[clip.id] = { file: `/audio/narration/${clip.file}`, duration: clip.duration };
}
const temporary = new URL('manifest.next.json', output);
await fs.writeFile(temporary, JSON.stringify(manifest, null, 2) + '\n');
await fs.rename(temporary, new URL('manifest.json', output));
console.log(`Saved ${staged.length} clips and ${path.basename(new URL('manifest.json', output).pathname)}. Listen to every passage before publishing.`);
