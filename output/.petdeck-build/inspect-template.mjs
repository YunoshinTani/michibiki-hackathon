import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, PresentationFile } from '@oai/artifact-tool';

const root = process.cwd();
const source = path.join(root, '事業アイデア課題_提出用スライド.pptx');
const build = path.join(root, '.petdeck-build');
const presentation = await PresentationFile.importPptx(await FileBlob.load(source));
const inspection = await presentation.inspect({select:'$.slides[*]', include:['id','index','layout','elements.id','elements.kind','elements.text','elements.position','elements.style','notes.text']});
await fs.writeFile(path.join(build,'template-inspection.ndjson'),inspection.ndjson);
await fs.writeFile(path.join(build,'template-masters.json'), JSON.stringify(presentation.masters.items.map(x=>({id:x.id,name:x.name})),null,2));
await fs.mkdir(path.join(build,'source'),{recursive:true});
for (let i=0;i<presentation.slides.items.length;i++) {
  const slide=presentation.slides.items[i];
  const png=await presentation.export({slide,format:'png',scale:1});
  await fs.writeFile(path.join(build,'source',`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await png.arrayBuffer()));
  console.log(`Rendered source ${i+1}`);
}
console.log(`Source slides: ${presentation.slides.items.length}`);
