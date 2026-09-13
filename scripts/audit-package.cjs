const path=require('node:path');
(async()=>{
 const asar=await import('@electron/asar');const archive=process.argv[2];if(!archive)throw Error('Supply app.asar');let count=0;const problems=[];
 for(const name of asar.listPackage(archive)){const file=name.replace(/^\//,'');if(file.startsWith('node_modules/')||asar.statFile(archive,file).files)continue;count++;
  if(/\.(sqlite|apkg|anki)$|^(tasks|private|evidence)\//.test(file))problems.push(file);
  if(!/\.(png|jpe?g|webp|woff2?)$/.test(file)&&/\/(?:Users|home)\/[A-Za-z0-9_.-]+\//.test(asar.extractFile(archive,file).toString('utf8')))problems.push(file+': personal path');
 }
 if(problems.length)throw Error(problems.join('\n'));console.log('PASS packaged privacy check: '+count+' app-owned files; no private profiles or personal paths');
})().catch(e=>{console.error(e);process.exitCode=1});
