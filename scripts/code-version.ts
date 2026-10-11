import{execFileSync}from'node:child_process';import{readFileSync,existsSync}from'node:fs';import{createHash}from'node:crypto';
export function codeVersion(){
 const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard'],{encoding:'utf8'}).split('\n').filter(p=>p&&existsSync(p)&&(/^(src|scripts|tests|cloudflare|weixin\/src|acceptance-weixin|public)\//.test(p)||/^(package(-lock)?\.json|.*config\.(ts|cjs)|\.npmrc)$/.test(p))).sort();
 const hash=createHash('sha256');for(const path of paths)hash.update(path+'\0').update(readFileSync(path)).update('\0');const sourceHash=hash.digest('hex');
 const changes=execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).split('\n').filter(l=>l&&!l.endsWith(' test.txt'));
 return{commit,sourceHash,dirty:changes.length>0,version:`${commit.slice(0,12)}:${sourceHash.slice(0,16)}:${changes.length?'dirty':'clean'}`};
}
