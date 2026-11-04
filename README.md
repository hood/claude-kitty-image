# kitty-image

A Claude Code mod that lets Claude show PNG images inline in your terminal, using the kitty graphics protocol. Claude renders a plot or diagram to a PNG (matplotlib, graphviz, mermaid-cli, ...), calls the `show_image` tool, and the picture is drawn right under the tool call. Claude only gets a one-line confirmation back, so images cost no context.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install kitty-image --marketplace hood/claude-kitty-image
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install kitty-image --marketplace hood/claude-kitty-image
```

## Tool

`mcp__kitty-image__show_image`

| Arg | Required | Default |
|---|---|---|
| `path` | yes | absolute path of a PNG (max 2 MiB) |
| `columns` | no | 80 (max 255) |
| `rows` | no | keeps the aspect ratio |
| `alt` | no | file name; shown where images can't be drawn |

## Terminal support

Claude Code draws images in kitty and Ghostty (and iTerm2 3.5+ in fullscreen rendering). Inside tmux it needs:

```
set -g allow-passthrough on
set -g focus-events on
```

Claude Code recognizes terminals by name. If yours supports kitty graphics but isn't recognized (you see the dim `alt` text instead of the picture), force it before starting Claude Code:

```sh
export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1
```

## License

MIT
