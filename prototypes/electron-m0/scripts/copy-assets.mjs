import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist/renderer', { recursive: true });
cpSync('src/renderer/index.html', 'dist/renderer/index.html');
cpSync('src/renderer/styles.css', 'dist/renderer/styles.css');
cpSync('src/renderer/path-map.css', 'dist/renderer/path-map.css');

cpSync('../../tokens.css', 'dist/renderer/tokens.css');

cpSync('src/renderer/understanding.css', 'dist/renderer/understanding.css');

cpSync('src/renderer/comparison.css', 'dist/renderer/comparison.css');

cpSync('src/renderer/judgment.css', 'dist/renderer/judgment.css');

cpSync('src/renderer/storage.css', 'dist/renderer/storage.css');

for (const file of ['reading-shell.css','map.html','map.css']) cpSync(`src/renderer/${file}`, `dist/renderer/${file}`);
