/**
 * The bake. Stills are pure sharp; videos shell out to ffmpeg (the one external
 * prerequisite, and only for video input).
 *
 * Both paths place the capture as a plain RECTANGLE at the frame's screen-hole rect
 * and composite the frame on top. Around the device's rounded corners the frame's
 * outermost pixels are ANTIALIASED (only partially opaque), the rectangle's square
 * corners reach them, and the bright screen would show straight through — invisible
 * on white, a crusty dotted rim on a dark page. Every affected pixel lies OUTSIDE
 * the device's silhouette, where nothing should be behind the frame at all, so its
 * correct value is knowable exactly:
 *
 *   stills (transparent background) → the frame's own RGBA
 *   clips  (opaque, themed)         → the frame composited over the theme background
 *
 * Stills repair those pixels in-buffer; videos overlay a pre-computed exterior
 * patch as the last filter step.
 */

import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import sharp from 'sharp'
import { rasterOf } from './frame.mjs'

// Corner colours for video masters — must match the page background each theme
// renders, or the baked corners read as tinted squares. The default dark value is
// PRE-COMPENSATED one step brighter than #0e1215: the RGB→YUV420(tv)→RGB round trip
// loses a unit per channel in the near-blacks, and this input is what actually
// decodes to #0e1215 (measured, ±1 on blue).
export const DEFAULT_THEME_BG = { light: '#ffffff', dark: '#0f1317' }

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf-8' })
}

export async function bakeStill(input, frame, outBase) {
  const { data: fd, w, h, exterior } = await rasterOf(frame.file)
  const { hole } = frame

  const screen = await sharp(input)
    .rotate() // respect EXIF orientation before measuring anything into the hole
    .resize(hole.w, hole.h, { fit: 'cover', position: 'centre' })
    .ensureAlpha()
    .toBuffer()

  const composed = await sharp({
    create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: screen, left: hole.x, top: hole.y },
      { input: frame.file, left: 0, top: 0 },
    ])
    .raw()
    .toBuffer()

  // Outside the device the frame IS the answer: its own colour, its own alpha.
  for (let i = 0; i < w * h; i++) {
    if (!exterior[i]) continue
    const o = i * 4
    composed[o] = fd[o]
    composed[o + 1] = fd[o + 1]
    composed[o + 2] = fd[o + 2]
    composed[o + 3] = fd[o + 3]
  }

  const out = `${outBase}-framed.png`
  await sharp(composed, { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(out)
  return [out]
}

/**
 * The exterior patch for a theme: opaque frame-over-background colour on every
 * exterior pixel, fully transparent everywhere else. Overlaid as the LAST filter
 * step it erases everything the screen rectangle painted outside the silhouette.
 */
async function exteriorPatch(frame, bgHex) {
  const { data, w, h, exterior } = await rasterOf(frame.file)
  const bg = [1, 3, 5].map((k) => parseInt(bgHex.slice(k, k + 2), 16))
  const patch = Buffer.alloc(w * h * 4, 0)
  for (let i = 0; i < w * h; i++) {
    if (!exterior[i]) continue
    const o = i * 4
    const a = data[o + 3] / 255
    patch[o] = Math.round(data[o] * a + bg[0] * (1 - a))
    patch[o + 1] = Math.round(data[o + 1] * a + bg[1] * (1 - a))
    patch[o + 2] = Math.round(data[o + 2] * a + bg[2] * (1 - a))
    patch[o + 3] = 255
  }
  const out = join(
    tmpdir(),
    `dkbezeler-exterior-${basename(frame.file).replace(/[^a-z0-9]+/gi, '-')}-${bgHex.slice(1)}.png`
  )
  await sharp(patch, { raw: { width: w, height: h, channels: 4 } }).png().toFile(out)
  return out
}

function videoFps(file) {
  const raw = run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', file,
  ]).trim()
  const [num, den] = raw.split('/').map(Number)
  return den ? num / den : num
}

export async function bakeVideo(input, frame, outBase, themeBg = DEFAULT_THEME_BG) {
  // THE FRAME RATE IS EXPLICIT. The ffmpeg color= source that paints the canvas
  // defaults to 25fps and drives the whole overlay chain's output rate — a 60/120fps
  // recording would be silently resampled to 25, discarding most of its frames before
  // encoding. The canvas runs at the clip's own rate, capped at 60 (120fps ProMotion
  // halves cleanly; nothing on the web needs more).
  const fps = Math.min(Math.round(videoFps(input)), 60)
  const { hole } = frame
  const outputs = []
  for (const [theme, bg] of Object.entries(themeBg)) {
    const out = `${outBase}-${theme}.mp4`
    const patch = await exteriorPatch(frame, bg)
    // Theme-coloured canvas → cover-fit clip in the hole (shortest=1 bounds the
    // infinite colour source to the clip) → frame overlaid (single image; overlay
    // repeats its last frame) → exterior patch last. out_range=tv: phone recordings
    // are FULL-range (yuvj420p/pc), the web's decode path assumes limited, and a
    // range mismatch shifts every corner colour.
    const filter = [
      `color=c=${bg}:s=${frame.w}x${frame.h}:r=${fps}[bg]`,
      `[0:v]scale=${hole.w}:${hole.h}:force_original_aspect_ratio=increase,crop=${hole.w}:${hole.h}[scr]`,
      `[bg][scr]overlay=${hole.x}:${hole.y}:shortest=1[withscr]`,
      `[withscr][1:v]overlay=0:0[withfr]`,
      `[withfr][2:v]overlay=0:0,scale=out_range=tv[out]`,
    ].join(';')
    run('ffmpeg', [
      '-y', '-v', 'error',
      '-i', input, '-i', frame.file, '-i', patch,
      '-filter_complex', filter, '-map', '[out]',
      '-an', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-movflags', '+faststart',
      '-crf', '20', '-preset', 'medium',
      out,
    ])
    outputs.push(out)
    const poster = `${outBase}-${theme}.jpg`
    run('ffmpeg', ['-y', '-v', 'error', '-i', out, '-frames:v', '1', '-update', '1', '-q:v', '2', poster])
    outputs.push(poster)
  }
  return outputs
}
