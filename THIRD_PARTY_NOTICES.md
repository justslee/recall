# Third-party notices

[Documentation](docs/README.md) · [Application license](LICENSE)

Recall depends on the following packages. Their distributions retain their own license files and
notices; the application license does not replace them. Electron also includes Chromium and its
accompanying licenses.

## Runtime dependencies

| Package          | Version | Declared license        |
| :--------------- | :------ | :---------------------- |
| @peculiar/x509   | 3.1.0   | MIT                     |
| adm-zip          | 0.6.1   | MIT                     |
| ajv              | 8.20.0  | MIT                     |
| dompurify        | 3.4.17  | (MPL-2.0 OR Apache-2.0) |
| katex            | 0.19.1  | MIT                     |
| lucide-react     | 1.69.0  | ISC                     |
| marked           | 18.1.3  | MIT                     |
| mermaid          | 12.3.0  | MIT                     |
| monaco-editor    | 0.57.0  | MIT                     |
| qrcode           | 1.5.4   | MIT                     |
| react            | 19.3.1  | MIT                     |
| react-dom        | 19.3.1  | MIT                     |
| reflect-metadata | 0.2.2   | Apache-2.0              |
| ts-fsrs          | 6.0.0   | MIT                     |
| ws               | 8.22.1  | MIT                     |
| yaml             | 2.9.1   | ISC                     |

Mermaid also bundles **elkjs 0.12.1**, declared `EPL-2.0 OR GPL-3.0-or-later`.
Recall distributes that unmodified dependency under **EPL-2.0**. Its license is
retained in the dependency distribution; its source is available from
[the upstream elkjs repository at the published package's source revision](https://github.com/kieler/elkjs/tree/624ae90aa37110033a8af59c5ccbb292708b4317).
The lockfile records transitive dependency versions; their licenses and notices
remain applicable alongside the direct dependencies above.

## Connection identification icons

The small Codex, Claude, Notion and Obsidian application icons identify optional third-party integrations. These marks belong to their respective owners (OpenAI, Anthropic, Notion Labs and Obsidian). Their inclusion does not imply endorsement and does not place those marks under Recall’s code license. Recall’s generic paper, microphone and Markdown symbols use the existing Lucide icon set.
