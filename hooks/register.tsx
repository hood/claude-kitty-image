import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Shown } from '../types'

const TOOL = 'mcp__kitty-image__show_image'
const KEEP = 12
const MAX = 2 * 1024 * 1024
const SVG_WIDTH_PX = 1600
const PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
const shown = atom({ plugin: 'kitty-image', key: 'shown' } as const, [], { shape: 'shown-1' })

type Input = { path?: string; svg?: string; background?: string; columns?: number; rows?: number; alt?: string }

// PNG width/height live big-endian at bytes 16..24 of the IHDR chunk.
function pngSize(b64: string): { w: number; h: number } | undefined {
  const head = atob(b64.slice(0, 44))
  if (head.slice(1, 4) !== 'PNG') return undefined
  const u32 = (o: number) =>
    ((head.charCodeAt(o) << 24) | (head.charCodeAt(o + 1) << 16) | (head.charCodeAt(o + 2) << 8) | head.charCodeAt(o + 3)) >>> 0
  return { w: u32(16), h: u32(20) }
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'show_image',
      description:
        "Display an image inline in the user's terminal (kitty graphics protocol). " +
        'Use it whenever a picture explains better than text: charts, diagrams, sketches, screenshots. ' +
        'Either pass `svg` (raw SVG markup you write yourself: the quickest way to draw anything, no files needed) ' +
        'or `path` (absolute path of a PNG or SVG file, e.g. from graphviz `dot -Tpng`, gnuplot, matplotlib). ' +
        'SVGs are rasterized with rsvg-convert; give them an explicit viewBox and a background, since terminals are often dark. ' +
        'Max 2 MiB PNG. The user sees the picture; you only get a confirmation.',
      inputSchema: {
        type: 'object',
        properties: {
          svg: { type: 'string', description: 'Raw SVG markup to draw' },
          path: { type: 'string', description: 'Absolute path of a PNG or SVG file' },
          background: { type: 'string', description: 'SVG only: background color, e.g. "white"; default transparent' },
          columns: { type: 'number', description: 'Width in terminal cells, default 80, max 255' },
          rows: { type: 'number', description: 'Height in cells; default keeps the aspect ratio' },
          alt: { type: 'string', description: 'Short description shown where images are unsupported' },
        },
      },
      isDeferred: false,
    })
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as Input
    const path = input.path
    if (!input.svg && !path) return { deny: 'pass `svg` markup or a `path`' }
    if (path && !path.startsWith('/')) return { deny: 'path must be absolute' }

    let base64: string
    const isSvg = Boolean(input.svg) || /\.svgz?$/i.test(path ?? '')
    if (isSvg) {
      // rsvg-convert writes PNG bytes; base64 makes them survive stdout as text.
      const bg = input.background ? `-b "$2"` : ''
      const src = input.svg ? '' : '"$3"'
      const ran = await $.process.run(
        ['sh', '-c', `rsvg-convert -w "$1" ${bg} ${src} | base64`, 'sh', String(SVG_WIDTH_PX), input.background ?? '', path ?? ''],
        { stdin: input.svg, env: { PATH }, timeoutMs: 20_000 },
      )
      base64 = ran.stdout.replace(/\s+/g, '')
      if (ran.exitCode !== 0 || !base64) return { deny: `rsvg-convert failed: ${ran.stderr.trim().slice(0, 400) || 'no output'}` }
      if ((base64.length * 3) / 4 > MAX) return { deny: 'rendered PNG over 2 MiB; simplify the SVG' }
    } else {
      const stat = await $.fs.stat(path!).catch(() => undefined)
      if (stat?.kind !== 'file') return { deny: `no such file: ${path}` }
      if ((stat.size ?? 0) > MAX) return { deny: 'PNG over 2 MiB; downscale it first' }
      base64 = (await $.fs.read(path!, { as: 'bytes' })).base64
    }

    const size = pngSize(base64)
    if (!size) return { deny: 'not a PNG or SVG; convert it first (e.g. magick in.jpg out.png)' }

    const columns = clamp(input.columns ?? 80, 4, 255)
    // Terminal cells are roughly twice as tall as wide.
    const rows = clamp(input.rows ?? (columns * size.h) / size.w / 2, 2, 255)
    const alt = input.alt ?? path?.split('/').pop() ?? 'drawing'

    await update($, shown, list => [...list, { id: e.tool_use_id, png: base64, columns, rows, alt }].slice(-KEEP))
    return { result: `Displayed ${alt} (${size.w}x${size.h}px) at ${columns}x${rows} cells.` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `kitty-image: ${next.error?.kind}: ${next.error?.message ?? 'no message'}` }))

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const row = await next(e)
    if (e.props.tool !== TOOL) return row
    const img = (await read($, shown)).find(s => s.id === e.props.tool_use_id)
    if (!img || e.surface !== 'terminal') return row

    const { Box, Image } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {row}
        <Image source={{ png: img.png }} columns={img.columns} rows={img.rows} alt={img.alt} />
      </Box>
    )
  })
}
