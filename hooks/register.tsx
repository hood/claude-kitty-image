import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Shown } from '../types'

const TOOL = 'mcp__kitty-image__show_image'
const KEEP = 12
const shown = atom({ plugin: 'kitty-image', key: 'shown' } as const, [], { shape: 'shown-1' })

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
        'Display a PNG image inline in the user\'s terminal (kitty graphics protocol). ' +
        'Use it to show plots, diagrams or screenshots: render to a PNG file first (matplotlib, graphviz, mermaid-cli, ' +
        'sips/magick to convert other formats), then call this with its absolute path. Max 2 MiB. ' +
        'The user sees the picture; you only get a confirmation.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path of a PNG file' },
          columns: { type: 'number', description: 'Width in terminal cells, default 80, max 255' },
          rows: { type: 'number', description: 'Height in cells; default keeps the aspect ratio' },
          alt: { type: 'string', description: 'Short description shown where images are unsupported' },
        },
        required: ['path'],
      },
      isDeferred: false,
    })
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as { path?: string; columns?: number; rows?: number; alt?: string }
    const path = input.path ?? ''
    if (!path.startsWith('/')) return { deny: 'path must be absolute' }

    const stat = await $.fs.stat(path).catch(() => undefined)
    if (stat?.kind !== 'file') return { deny: `no such file: ${path}` }
    if ((stat.size ?? 0) > 2 * 1024 * 1024) return { deny: 'PNG over 2 MiB; downscale it first' }

    const { base64 } = await $.fs.read(path, { as: 'bytes' })
    const size = pngSize(base64)
    if (!size) return { deny: 'not a PNG; convert it first (e.g. sips -s format png in --out out.png)' }

    const columns = clamp(input.columns ?? 80, 4, 255)
    // Terminal cells are roughly twice as tall as wide.
    const rows = clamp(input.rows ?? (columns * size.h) / size.w / 2, 2, 255)
    const alt = input.alt ?? path.split('/').pop() ?? 'image'

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
