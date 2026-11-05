import fs from 'node:fs/promises';
import path from 'node:path';
import {FileBlob,PresentationFile} from '@oai/artifact-tool';
const root=process.cwd();
const out=path.join(root,'.petdeck-build/submission');
await fs.mkdir(path.join(out,'source'),{recursive:true});
const p=await PresentationFile.importPptx(await FileBlob.load(path.join(root,'output/presentation/みちねこ_事業提案_初稿.pptx')));
const x=await p.inspect({select:'$.slides[*]',include:['id','index','layout','elements.id','elements.kind','elements.text','elements.position','elements.style','notes.text']});
await fs.writeFile(path.join(out,'source.ndjson'),x.ndjson);
for(let i=0;i<p.slides.items.length;i++){
 const blob=await p.export({slide:p.slides.items[i],format:'png',scale:1});
 await fs.writeFile(path.join(out,'source',`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await blob.arrayBuffer()));
}
console.log(`Source rendered and inspected: ${p.slides.items.length} slides`);
process.exit(0);
