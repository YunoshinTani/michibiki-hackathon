import fs from 'node:fs/promises';
import path from 'node:path';
import {FileBlob,PresentationFile} from '@oai/artifact-tool';
const root=process.cwd();
const finalPptx=path.join(root,'output/presentation/みちねこ_事業提案_初稿.pptx');
const finalPdf=path.join(root,'output/presentation/みちねこ_事業提案_初稿.pdf');
const p=await PresentationFile.importPptx(await FileBlob.load(finalPptx));
const dest=path.join(root,'.petdeck-build/final-render');
await fs.mkdir(dest,{recursive:true});
for(let i=0;i<p.slides.items.length;i++){
 const blob=await p.export({slide:p.slides.items[i],format:'png',scale:1});
 await fs.writeFile(path.join(dest,`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await blob.arrayBuffer()));
}
const pdf=await p.export({format:'pdf'});
await fs.writeFile(finalPdf,new Uint8Array(await pdf.arrayBuffer()));
console.log(`Exported ${p.slides.items.length} final slide previews and PDF.`);
process.exit(0);
