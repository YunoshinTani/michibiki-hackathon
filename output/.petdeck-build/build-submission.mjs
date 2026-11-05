import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {FileBlob,PresentationFile} from '@oai/artifact-tool';
process.on('uncaughtException',e=>{console.error(e.message);console.error(e.stack?.split('\n').filter(x=>x.trim().startsWith('at ')).slice(-3).join('\n'));process.exit(1);});

const workspaceDir=process.cwd();
const build=path.join(workspaceDir,'.petdeck-build/submission');
const source=path.join(workspaceDir,'output/presentation/みちねこ_事業提案_初稿.pptx');
const out=path.join(workspaceDir,'output/submission');
const finalPath=path.join(out,'みちねこ_提出版.pptx');
const SKILL_DIR='C:/Users/tani/.codex/plugins/cache/openai-primary-runtime/presentations/26.1013.11914/skills/presentations';
const RUNTIME_PYTHON='C:/Users/tani/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
process.env.RUNTIME_NODE_MODULES='C:/Users/tani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
await fs.mkdir(out,{recursive:true});
const p=await PresentationFile.importPptx(await FileBlob.load(source));
const snap=await p.inspect({select:'$.slides[*]',include:['id','index','layout','elements.id','elements.text','elements.position']});
const records=snap.records;

function set(id,text,options={}){
 const s=p.resolve(id);s.text=text;
 s.text.style={typeface:'Noto Sans CJK JP',fontSize:21,color:'#333333',bold:false,italic:false,alignment:'left',verticalAlignment:'top',wrap:'square',autoFit:'none',insets:0,lineSpacing:1.3,...options.style};
 if(options.position)s.position={...s.position,...options.position};
 return s;
}
function title(id,text){set(id,text,{style:{fontSize:34.67,bold:true,lineSpacing:1.05}});}
function notes(index,text,urls=[]){
 p.resolve(records[index-1].id).speakerNotes.text=[text,'',...urls,'参照日：2026年10月14日'].join('\n');
}
function text(slide,name,value,position,style={}){
 const s=slide.shapes.add({name,geometry:'textbox',position,fill:'none',line:{fill:'none',width:0}});
 s.text=value;s.text.style={typeface:'Noto Sans CJK JP',fontSize:21,color:'#333333',insets:0,wrap:'square',autoFit:'none',lineSpacing:1.2,...style};
 return s;
}
function newPage(name,titleText,subText){
 const slide=p.slides.add({layout:records[1].layout.name});
 text(slide,`${name}-number`,'00',{left:46.08,top:59.52,width:59.52,height:34.56},{fontSize:24,bold:true,color:'#0557FF'});
 text(slide,`${name}-title`,titleText,{left:110.4,top:46.08,width:1046.4,height:52.8},{fontSize:34.67,bold:true});
 text(slide,`${name}-subtitle`,subText,{left:112.32,top:106,width:1080,height:50},{fontSize:18,color:'#8A5200',bold:true});
 text(slide,`${name}-page`,'00',{left:1230,top:684.48,width:35,height:24},{fontSize:10.67,color:'#B5B5B5',alignment:'right'});
 return slide;
}
function nativeTable(slide,name,values,position,widths){
 const t=slide.tables.add({rows:values.length,columns:values[0].length,left:position.left,top:position.top,width:position.width,height:position.height,columnWidths:widths,values});
 t.styleOptions={headerRow:true,bandedRows:false};
 t.borders.assign({style:'solid',fill:'#D6DDE9',width:1});
 for(let r=0;r<values.length;r++)for(let c=0;c<values[0].length;c++){
  const cell=t.getCell(r,c);
  cell.fill=r===0?'#0557FF':(r%2?'#F5F7FA':'#FFFFFF');
  cell.text.style={typeface:'Noto Sans CJK JP',fontSize:18.67,bold:r===0,color:r===0?'#FFFFFF':'#333333',lineSpacing:1.1,alignment:c===0?'left':'center',verticalAlignment:'middle',autoFit:'none'};
 }
 return t;
}
const currentName=records[0].elements.find(e=>e.id==='sh/5sfepcfe').text;
const currentStudent=records[0].elements.find(e=>e.id==='sh/sfqdkrep').text;
if(!currentName||currentName.includes('追記')||!currentStudent||currentStudent.includes('追記'))throw new Error('The user-provided identity is missing.');
set('sh/5sfepcfe',currentName,{style:{fontSize:18.67}});
set('sh/sfqdkrep',currentStudent,{style:{fontSize:18.67}});
set('sh/dgzetcfa','第1回提出版　2026年10月14日　需要・費用・性能は仮説を含む',{style:{fontSize:13.33,color:'#666666'},position:{width:680}});
notes(1,'氏名・学籍番号は本人が追記した最新の初稿からそのまま継承。本資料の需要シミュレーションは実施済みアンケートではなく、事業検討用の仮想回答。技術目標・価格・費用・販売数は計画上の仮定。');

// Focus the customer description without changing the user's personal story.
set('sh/doj29oba','室内中心で飼い、脱走や隠れ場所が\n気になる猫の飼い主。\n首輪を無理なく装着できる成猫が対象。',{style:{fontSize:21}});
set('sh/fu9sn2p0','国内の猫は推計884.7万頭（2025年）。すべてが顧客になるとは考えず、困り事と支払意思で対象を絞る。',{style:{fontSize:14.67,color:'#666666'}});

// Clearly labelled, synthetic demand scenario. The data is not survey evidence.
const demand=newPage('demand','需要仮説とアンケートの想定','仮想回答20人分によるシミュレーション。アンケートは未実施で、次回に実回答へ置き換える');
const demandValues=[
 ['確認したいこと','仮想回答','割合','この想定なら、どう考えるか'],
 ['居場所が分からず不安になる','14／20人','70%','室内と屋外の両方を探せる構成を検証'],
 ['猫が外へ出た経験がある','8／20人','40%','外出経験のある飼い主から検証を始める'],
 ['税込10,780円・月858円で\n利用したい','6／20人','30%','利用意向と実際の有料申込を分けて確認'],
 ['最大の懸念：重量／充電／料金','9／7／4人','45／35／20%','軽量化と充電の手間を優先して検証']
];
nativeTable(demand,'demand-assumptions',demandValues,{left:72,top:179,width:1136,height:324},[370,150,170,446]);
text(demand,'demand-interpretation','需要があるという結論は、まだ出せない。\n次回は同じ質問を20人に行い、不安の頻度・既存対策・購入理由を一緒に確かめる。',{left:86,top:530,width:1105,height:76},{fontSize:23,bold:true,color:'#0557FF',lineSpacing:1.35});
text(demand,'demand-disclosure','仮想値は効果や需要の根拠ではない。最後の行は「最大の懸念」を1つ選ぶ単一回答の想定。',{left:75,top:638,width:1115,height:36},{fontSize:14.67,color:'#666666'});
demand.speakerNotes.text='このスライドの回答人数・割合はユーザーが希望した仮の情報を、明示的な仮想回答として作成したもの。調査対象者は実在せず、アンケートは未実施。20人の1匹飼育世帯を想定。設問ごとの比率14/20=70%、8/20=40%、6/20=30%。最大懸念は単一回答で9+7+4=20、45%+35%+20%=100%。仮想回答を市場全体や実際の成約率に外挿しない。税込価格は税率10%を想定した税抜価格9800円・780円の1.1倍で、税制上の判断を示すものではない。第2回では回答原票、回収期間、募集経路、設問と選択肢、有効回答数を付して更新する。';

// Improve use, value and price narrative.
set('sh/ml07i9sv','屋外は首輪自身の測位と携帯通信、近距離はBluetoothで探す。\n最終確認時刻・受信状態・電池残量も示し、探す場所の判断を助ける。\n\nSLASによる位置精度の改善が、捜索時間の短縮につながるかを検証する。\n健康記録は既存サービスとの重複が大きいため、捜索支援を先に作る。',{style:{fontSize:23,lineSpacing:1.35}});
set('sh/xcz2l03q','本体 9,800円＋月780円\n税込 10,780円＋月858円\n1匹分・価格案',{style:{fontSize:21,bold:true,color:'#0557FF'}});
set('sh/s3ml0v61','Catlogの月980円（税込）を料金帯の参考にした。機能は異なり、本案の価格受容性は未確認。',{style:{fontSize:14.67,color:'#666666'}});
notes(7,'価格は税抜本体9800円／月780円の仮定。参考として税込を税率10%想定で併記し、消費者向け質問では本体10780円／月858円を提示する。Catlog公式の猫様メンバーシップは1匹あたり月980円税込（確認時点）。GPS非搭載の健康・行動記録サービスなので、単純な価格優位性ではなく価格帯の参考とする。旧年の580円という情報は採用していない。部材見積と顧客調査により改定する。',['https://rabo.cat/lp/202403_interested/']);

// Keep the simple revenue formula and expand to a sustainable scale.
title('sh/g72x4zyd','売上の作り方と目標規模');
set('sh/ri9g7uhw','500契約は販売開始から24か月以内の目標（仮定）。以下は維持できた場合の定常試算',{style:{fontSize:14.67,color:'#666666'}});
set('sh/tkby9kzm','月額 780円 × 500匹 × 1か月 ＝ 390,000円',{style:{fontSize:25.33,bold:true,color:'#FFFFFF',alignment:'center'},position:{height:44}});
set('sh/m5gvmhwn','500匹の有料契約',{style:{fontSize:25,bold:true,color:'#0557FF'}});
set('sh/kfixwbe1','390,000円\n月額サービス売上',{style:{fontSize:26,bold:true}});
set('sh/svydgb65','4,680,000円\n500契約を12か月維持',{style:{fontSize:26,bold:true}});
set('sh/jq5w365o','本体売上は9,800円×新規販売数。月額売上は780円×有料契約数。台数と継続契約を分けて管理する。',{style:{fontSize:14.67,color:'#666666'}});
notes(8,'定常規模の税抜試算：780×500=390000円／月、390000×12=4680000円／年。500契約は販売開始から24か月以内を目指す計画上の目標で、実績でも初年度確約でもない。本体は9800円×新規販売数の単発売上。1世帯1匹1契約を仮定し、飼育世帯・猫の頭数・端末販売数の単位を区別する。第1年の積み上げシナリオは別スライドに記載。');

// Prototype budget already sums to 250,000 yen. Explain scope and financing.
set('sh/mdsnatcn','25万円は試作費の仮定。量産設計・適合確認に50万円を別枠で置き、必要資金は収支計画で確認する。',{style:{fontSize:14.67,color:'#666666'}});
notes(9,'試作5項目は100000+60000+20000+40000+30000=250000円の未見積仮定。量産設計・適合確認・小ロットの製造準備費500000円も未見積の予算枠で、実際にこの金額で認証や生産が完了できるという主張ではない。金型を前提とせず、小ロット用筐体をまず検討する。自分の開発工数は現金支出に含めない。本人がセンサ・制御・機構を担当し、電池・首輪・無線の専門家確認は外部相談する計画。',['https://www.telec.or.jp/services/tech/offer.html']);

// Practical acquisition and actual research plan.
set('sh/ydcnatkn','最初の調査20人・有料顧客10人',{style:{fontSize:16,bold:true},position:{width:650}});
set('sh/l036l83y','調査は知人・学校関係の紹介10人、猫の飼育コミュニティ10人を目標に募集。\n安全確認後、3家庭の試用から始め、問題を直して10家庭へ広げる。\n\n販売開始時の最初の10件は、試用家庭・紹介4件、SNS経由4件、店舗紹介2件を目標。\nいずれも未獲得。紹介先の了承と、購入・契約を別々に確認する。',{style:{fontSize:22,lineSpacing:1.35}});
set('sh/m1cnetkj','最初は知人の紹介で5人に予備調査し、質問の分かりにくさを直す。\n価格・使い方を説明するページを作り、連絡許可を得て試用希望者を記録する。\n初期の顧客獲得費は1件3,000円以下を目標とし、紹介・SNSで検証する。',{style:{fontSize:22,lineSpacing:1.3}});
notes(10,'全て募集・獲得の計画であり、取引や提携の実績ではない。調査20人、試用3から10家庭、有料契約10件を段階で分ける。直接販売を想定し、ペット店や動物病院との提携は未成立。1世帯1匹と仮定。顧客獲得費3000円以下は目標で、本体の粗利3300円との整合をまず見る。広告等の総獲得費／新規有料契約数で算出し、本体と月額の両方の収益から回収を確認する。');
set('sh/98rytw72','愛猫が見つからず困った場面を整理し、質問票・価格案・首輪の装着条件を作る。',{style:{fontSize:21}});
set('sh/61kzalof','5人に予備調査して質問票を修正。次回提出までに計20人の実回答を集める。',{style:{fontSize:21}});
set('sh/mdobedg3','SLAS補正の有無、通信遅延、電池持ちを机上試作で測り、量産費用を見積もる。',{style:{fontSize:21}});
set('sh/1cfa58zi','模擬捜索を比較し、安全確認後に3家庭で試用。需要・重量・価格を再判断する。',{style:{fontSize:21}});
set('sh/j2lgjq5w','4〜6か月目に試用を拡大し、7か月目の販売開始を仮置き。安全・適合・資金の条件を満たしてから開始。',{style:{fontSize:14.67,color:'#666666'}});
notes(11,'第2回に実回答20人を提示する計画。実際の次回提出日や利用可能な学校設備はまだ確認していないため、具体的な暦日は設定しない。第1日、1週間、1か月、3か月は着手後の行動期限。4〜6か月目に試用、安全性・部品見積の確認を行い、7か月目に販売するという仮シナリオ。条件が整わなければ延期し、先に性能を証明する。猫を意図的に逃がさず人が端末を持つ模擬捜索から試す。');

// Decision thresholds and user-visible failure handling.
set('sh/a543mx4r','30日間の試用継続率\n\n目標80%以上。\n\n10家庭中8家庭以上が\n無理なく継続できるか。\n装着と充電を理由に\n中止した件数も記録する。',{style:{fontSize:21}});
set('sh/atc7epon','有料申込率・解約率\n\n試用後の申込30%以上。\n販売後の月次解約は\n2%以下を目標にする。\n\n申込と継続を別に追い、\n料金と使い方を見直す。',{style:{fontSize:21}});
notes(12,'数値は全て検証目標。模擬捜索は場所別各10回以上、SLAS補正有無で中央値の所要時間を比較し20%短縮を目標。30日試用は10家庭中8以上継続を目標。有料申込は30%以上、月次解約率は月初有料契約数を分母に当月解約数を割り2%以下を目標。初期人数では比率だけで判断せず件数と理由を併記。第1年収支は解約0の簡略化シナリオであり、この解約目標を織り込んだ予測ではない。月次解約2%が実現しても期間やLTVを保証するものではない。');
set('sh/vaxg7ulo','在宅時は省電力、捜索時は更新を増やす。\n音は飼い主の操作時だけ、短時間にする。\n\n位置・取得時刻・圏外を区別して表示。\n安全バックルを採用し、脱落時は限界を示す。',{style:{fontSize:21}});
set('sh/2xof2lcv','目標未達なら軽量化や対象の体格を見直す。位置共有の権限、履歴削除、防水・電池・無線適合も確認する。',{style:{fontSize:14.67,color:'#666666'}});

// Current official competitor prices, purpose and limitations.
set('sh/z650byxo','猫の日常行動を記録。\nGPS非搭載・迷い猫探しを支援。\n月額980円／匹（税込）。',{style:{fontSize:18.67,lineSpacing:1.15}});
set('sh/up4fal83','Bluetoothと「探す」網で\n持ち物の発見を支援。\n本体1個5,480円（税込）。',{style:{fontSize:18.67,lineSpacing:1.15}});
set('sh/pwvy90rq','AirTagは持ち物用途。\n本案は屋外測位と携帯通信を持つ。\n安さだけではなく捜索効果で比較。',{style:{fontSize:18.67,lineSpacing:1.15}});
set('sh/4vmh0vq5','公式情報を2026年10月14日に確認。Catlog・AirTagの価格は税込。用途・国内契約条件を含めて比較する。',{style:{fontSize:14.67,color:'#666666'}});
notes(14,'競合機能と国内条件は初稿の各社公式出典を継承。Catlogの現行公式解説では月額980円税込。過去の580円という料金は使わない。AirTag現行日本公式ストアでは1個5480円税込。2026年1月の発表時4980円とは異なるため現行ストアを価格出典とする。Appleは持ち物用途と説明し、人・ペット専用ではない。Tractiveは直接競合だが正式な発送・契約・サポート対象国一覧に日本がない一方追加利用可能国があるため、日本で利用不可と断定しない。Tractiveの海外価格は日本円価格や国内契約として比較しない。',['https://rabo.cat/lp/202403_interested/','https://www.apple.com/jp/shop/buy-airtag/airtag','https://rabo.cat/catlog/','https://catlog.zendesk.com/hc/ja/articles/38861371024537--Catlog-迷い猫モード-迷い猫探し-について','https://tractive.com/en/pd/gps-tracker-cat?shopCountry=GB','https://help.tractive.com/hc/en-us/articles/205664291-Where-does-Tractive-work','https://www.apple.com/jp/newsroom/2026/01/apple-introduces-new-airtag-with-expanded-range-and-improved-findability/']);

// Keep a short, complete pitch and the personal reason that the user supplied.
set('sh/m9c3e1kn','私が考えたのは「みちねこ」という、\n猫を探す首輪とアプリです。\n\n屋外はみちびきSLASの位置情報、\n近距離はBluetoothや音で、\n探す場所を絞る手掛かりを提供します。\n\n本体販売と月額料金で運営します。\n飼育経験とロボコン経験を生かし、\nまず20人の調査と模擬捜索で\n需要と効果を確かめます。',{style:{fontSize:23,lineSpacing:1.35}});

// Unit economics now includes a full-time operator at the target scale.
title('sh/gbedwfmx','費用・利益と損益分岐');
set('sh/rm5czq50','以下は税抜・未見積の仮定。売上、1契約あたりの収益、運営費を分けて計算する',{style:{fontSize:14.67,color:'#666666'}});
set('sh/ihcvml4j','本体：9,800円 − 製造・配送・交換引当6,500円 ＝ 3,300円／セット\n月額：780円 − 通信・クラウド・決済・対応250円 ＝ 530円／匹・月\n月固定費50,000円、専任担当の人件費200,000円を想定',{style:{fontSize:23,lineSpacing:1.3}});
set('sh/pc7qhwn6','500契約での定常収支と、原価上昇への対応',{style:{fontSize:18.67,bold:true},position:{width:800}});
set('sh/29grm1of','390,000円 − 125,000円 − 50,000円 − 人件費200,000円 ＝ 月15,000円\n人件費込みの損益分岐は約472契約。100契約では人件費前でも月3,000円。\n月変動費が350円なら、人件費込みの損益分岐は約582契約へ増える。\n実見積を取り、価格・設計・販売対象を見直す。',{style:{fontSize:22,lineSpacing:1.25}});
set('sh/zul836xg','本体粗利は新規販売時だけ発生。継続課金で人件費を賄う規模と、資金を確保して段階的に始める。',{style:{fontSize:14.67,color:'#666666'}});
notes(17,'全て税抜仮定。原価6500円は部材・中継機4700円＋組立検査800円＋梱包配送600円＋交換引当400円。月変動費250円は通信150円＋クラウド40円＋決済30円＋対応引当30円。月固定費5万円は広告3万円と運営ツール等2万円。500契約時は780×500=390000、250×500=125000、530×500−50000−200000=15000円／月。専任人件費20万円は概算枠で、採用条件や法定福利等を確定した見積ではない。損益分岐(50000+200000)/530=471.698なので整数472契約。変動費350円なら限界利益430円で250000/430=581.395、整数582契約。初期は本人が開発を担当し、初年度収支には専任採用の人件費を含めない。月固定費の広告等と顧客獲得費を二重に足さない。');

// Cash and first-year scenario. Cohorts, revenues, totals all share one source.
const acquisitions=[10,10,15,15,20,30];
const active=acquisitions.map((_,i)=>acquisitions.slice(0,i+1).reduce((a,b)=>a+b,0));
const subscriberMonths=active.reduce((a,b)=>a+b,0);
const hardwareCount=acquisitions.reduce((a,b)=>a+b,0);
const subscriptionSales=subscriberMonths*780;
const hardwareSales=hardwareCount*9800;
const totalSales=subscriptionSales+hardwareSales;
const hardwareCost=hardwareCount*6500;
const subscriptionCost=subscriberMonths*250;
const fixedCost=6*50000;
const upfrontCost=250000+500000;
const balance=totalSales-hardwareCost-subscriptionCost-fixedCost-upfrontCost;
if(subscriberMonths!==285||hardwareCount!==100||totalSales!==1202300||balance!==-568950)throw new Error('Scenario arithmetic mismatch');
const firstYear=newPage('first-year','初年度の収支と必要資金','仮シナリオ：1〜6か月目は開発・試用、7か月目から販売。1世帯1匹、解約なしで簡略化');
const format=n=>n.toLocaleString('ja-JP');
const firstYearValues=[
 ['項目','7か月目','8か月目','9か月目','10か月目','11か月目','12か月目','年間計'],
 ['新規販売数（台）',...acquisitions.map(String),String(hardwareCount)],
 ['有料契約数（匹）',...active.map(String),`${subscriberMonths}匹月`],
 ['月額売上（円）',...active.map(n=>format(n*780)),format(subscriptionSales)]
];
nativeTable(firstYear,'first-year-cohorts',firstYearValues,{left:72,top:179,width:1136,height:208},[240,128,128,128,128,128,128,128]);
text(firstYear,'first-year-sales',`年間売上 ${format(totalSales)}円 ＝ 本体${format(hardwareSales)}円 ＋ 月額${format(subscriptionSales)}円`,{left:86,top:407,width:1110,height:42},{fontSize:24,bold:true,color:'#0557FF'});
text(firstYear,'first-year-costs',`変動費${format(hardwareCost+subscriptionCost)}円 ＋ 商用6か月の固定費${format(fixedCost)}円 ＋ 開発等${format(upfrontCost)}円\n初年度の差引は ${format(balance)}円。本人の開発工数は別途、専任採用はまだ行わない。`,{left:86,top:458,width:1110,height:76},{fontSize:21,lineSpacing:1.3});
text(firstYear,'first-year-cash','販売前の資金目安：25万円＋量産準備50万円＋初回30台19.5万円＋運転資金15万円＝109.5万円\n自己資金・学内／創業支援等で約110万円を確保する計画。現時点では未確保。',{left:86,top:553,width:1105,height:76},{fontSize:20,lineSpacing:1.3});
text(firstYear,'first-year-disclosure','売上・費用・販売時期は未検証の仮定。初回在庫は年間100台分の原価に含まれ、損益に二重計上しない。',{left:75,top:648,width:1110,height:30},{fontSize:14.67,color:'#666666'});
firstYear.speakerNotes.text=`全て税抜で作った仮のシナリオ。アンケート仮想値から実際の販売数を推定したものではない。1〜6か月目は開発・安全確認・試用で有料契約0。7〜12か月目の新規販売${acquisitions.join(',')}で年間100台、月間契約${active.join(',')}で延べ285匹月。月額売上285×780=222300円、本体9800×100=980000円、合計1202300円。製品原価6500×100=650000円、月変動費250×285=71250円、商用運営の固定費50000×6=300000円、試作250000＋量産設計・適合等500000=750000円。差引1202300−650000−71250−300000−750000=−568950円。本人の開発工数と生活費は含めない。固定費は商用開始後6か月のみで、開発期間のクラウド試用は試作予算に含める。初年度は解約0という簡略化のため、実績を予測するものではなく、収支の構造を確認する。必要資金1095000円は販売開始までの予算750000円、初回在庫30×6500=195000円、運転資金150000円の合計。資金計画と年間損益は異なる概念。初回在庫は年間原価100台の一部であり年間費用に追加しない。自己資金や支援金は未確保、支援制度の採択・受給を主張していない。次の提出までに学校等の窓口へ相談し、実見積と資金源を確定する。`;

// Remove drafting instructions while retaining next-submission criteria and links.
title('sh/hsn2l4bu','公式出典と第2回の検証計画');
set('sh/itw3upcf','公式情報と本人の経験を根拠に、需要・価格・費用・開発目標を仮説として具体化した',{style:{fontSize:14.67,color:'#666666'}});
const referenceText='内閣府：SLAS仕様・みちびきFAQ\n\nRABO：Catlogの機能・料金\n\nTractive：猫用製品・対応国\n\nApple：AirTagの用途・現行価格\n\nペットフード協会：2025年飼育調査';
const referenceShape=set('sh/rip4retw',referenceText,{style:{fontSize:20,lineSpacing:1.3}});
for(const [label,uri] of [
 ['内閣府：SLAS仕様・みちびきFAQ','https://qzss.go.jp/technical/system/l1s.html'],
 ['RABO：Catlogの機能・料金','https://rabo.cat/lp/202403_interested/'],
 ['Tractive：猫用製品・対応国','https://tractive.com/en/pd/gps-tracker-cat?shopCountry=GB'],
 ['Apple：AirTagの用途・現行価格','https://www.apple.com/jp/shop/buy-airtag/airtag'],
 ['ペットフード協会：2025年飼育調査','https://petfood.or.jp/pdf/data/2025/3.pdf']
])referenceShape.text.get(label).link={uri,isExternal:true};
set('sh/upg3i18r','次回の調査と見直し条件',{style:{fontSize:18.67,bold:true}});
set('sh/1cr2tg72','猫の飼い主20人に同じ質問を実施。\n募集経路・期間・有効回答数を示す。\n\n利用意向30%未満なら価格・対象を再検討。\n装着負担が大きければ小型化を優先。\n\nSLAS比較、重量・電池・遅延を実測。\n部品見積と約110万円の資金源を確認。\n\n仮想回答はすべて実回答に差し替える。',{style:{fontSize:21,lineSpacing:1.25}});
set('sh/w36poza9','第1回は事業仮説の提出。実アンケート・性能試験・部品見積は未実施で、次回の検証課題として示した。',{style:{fontSize:14.67,color:'#666666'}});
notes(18,'公式出典への既存リンクを保持。第2回で仮想回答を実回答に置換する。設問案：過去3か月で居場所が分からず不安になった頻度、猫が外へ出た経験、現在の対策、税込本体10780円／月858円を見て利用したいか、最大の懸念（重さ・充電・料金・精度・その他）。自由回答では理由を聞く。予備調査5人から最終20人へ募集し、同じ質問条件と原票を保存する。肯定・否定の両方と母数を示し、知人中心の便宜標本を市場全体へ外挿しない。利用意向が30%未満なら価格・顧客像を見直すという計画上の判断条件で、需要の科学的証明の基準ではない。実際の申込・継続は別に検証する。',['https://qzss.go.jp/technical/system/l1s.html','https://qzss.go.jp/overview/faq/index.html','https://rabo.cat/catlog/','https://rabo.cat/lp/202403_interested/','https://tractive.com/en/pd/gps-tracker-cat?shopCountry=GB','https://help.tractive.com/hc/en-us/articles/205664291-Where-does-Tractive-work','https://www.apple.com/jp/shop/buy-airtag/airtag','https://petfood.or.jp/pdf/data/2025/3.pdf']);

// Place the new evidence and finance pages at the relevant point in the story.
const addedPages=(await p.inspect({select:'$.slides[18,19]',include:['id','index']})).records;
const demandId=addedPages.find(r=>r.index===18).id;
const firstYearId=addedPages.find(r=>r.index===19).id;
const order=[...records.slice(0,4).map(r=>r.id),demandId,...records.slice(4,17).map(r=>r.id),firstYearId,records[17].id];
p.slides.reorder(order);
const after=await p.inspect({select:'$.slides[*]',include:['id','index','elements.id','elements.text','elements.position','notes.text']});
for(const rec of after.records){
 if(rec.index===0)continue;
 for(const e of rec.elements){
  if(!e.text)continue;
  if(e.position?.top>680)set(e.id,String(rec.index+1),{style:{fontSize:10.67,color:'#B5B5B5',alignment:'right'}});
  if(e.position?.left===46.08&&e.position?.top===59.52)set(e.id,String(rec.index).padStart(2,'0'),{style:{fontSize:24,bold:true,color:'#0557FF'}});
 }
}
await fs.writeFile(path.join(build,'submission-content.ndjson'),(await p.inspect({select:'$.slides[*]',include:['id','index','elements.id','elements.kind','elements.text','elements.position','notes.text']})).ndjson);
await fs.mkdir(path.join(build,'draft-render'),{recursive:true});
for(let i=0;i<p.slides.items.length;i++){
 const blob=await p.export({slide:p.slides.items[i],format:'png',scale:1});
 await fs.writeFile(path.join(build,'draft-render',`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await blob.arrayBuffer()));
}
const candidatePath=path.join(build,'candidate.pptx');
await(await PresentationFile.exportPptx(p)).save(candidatePath);
const sourceHash=crypto.createHash('sha256').update(await fs.readFile(source)).digest('hex');
const {finalizePresentation}=await import(pathToFileURL(path.join(SKILL_DIR,'container_tools/artifact_tool_utils.mjs')).href);
const validated=await finalizePresentation({workspaceDir,candidatePath,finalPath,explicitTotalSlideCount:20,
 pythonExecutable:RUNTIME_PYTHON,
 integrityValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_package_integrity.py'),
 layoutValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_layout_geometry.py'),
 layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit','--require-native-table-slide','5','--require-native-table-slide','19'],
 requiredNativeTableOwnerSlides:[5,19],
 fontPolicy:{basis:'reference',families:['Noto Sans CJK JP'],referencePath:source,referenceSha256:sourceHash},
 verifyArtifactToolImport:true,receiptPath:path.join(build,'validation-final.json')});
console.log(JSON.stringify({finalPath:validated.finalPath,slides:20,integrity:validated.packageIntegrity?.status,layoutFindings:validated.presentationLayout?.findingCount}));
const fileStudent=currentStudent.replace(/\D/g,'');
const fileName=currentName.replace(/\s/g,'');
await fs.writeFile(path.join(build,'manifest.json'),JSON.stringify({pptx:finalPath,pdf:path.join(out,`${fileStudent}_${fileName}_課題1.pdf`),source,sourceSha256:sourceHash,ownerName:currentName,studentNumber:currentStudent,slideCount:20,scenario:{subscriberMonths,hardwareCount,subscriptionSales,hardwareSales,totalSales,hardwareCost,subscriptionCost,fixedCost,upfrontCost,balance}},null,2));
console.log('Submission deck completed; identity and arithmetic saved to private manifest.');
process.exit(0);
