import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await cp('public','dist',{recursive:true});
let html=await readFile('dist/index.html','utf8');
html=html.replace('<html lang="en">','<html lang="en" data-hosted="true">');
html=html.replace('<script src="/app.js" defer>', '<script src="/cloud-client.js" defer></script><script src="/app.js" defer>');
html=html.replace('Two architectures. Real connections. Every message, explained.', 'Real TCP experiments on demand. Each action opens fresh sockets; your session stays in this tab.');
await writeFile('dist/index.html',html);
