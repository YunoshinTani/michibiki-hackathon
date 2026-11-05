import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {FileBlob, PresentationFile} from '@oai/artifact-tool';

const workspaceDir=process.cwd();
const build=path.join(workspaceDir,'.petdeck-build');
const source=path.join(workspaceDir,'事業アイデア課題_提出用スライド.pptx');
const SKILL_DIR='C:/Users/tani/.codex/plugins/cache/openai-primary-runtime/presentations/26.1013.11914/skills/presentations';
const RUNTIME_PYTHON='C:/Users/tani/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
process.env.RUNTIME_NODE_MODULES='C:/Users/tani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const finalPath=path.join(workspaceDir,'output/presentation/みちねこ_事業提案_初稿.pptx');
const p=await PresentationFile.importPptx(await FileBlob.load(source));
const inspection=await p.inspect({select:'$.slides[*]',include:['id','index','elements.id','elements.text','elements.position']});
const records=inspection.records;

const sources={
  slas:'https://qzss.go.jp/technical/system/l1s.html',
  faq:'https://qzss.go.jp/overview/faq/index.html',
  catlog:'https://rabo.cat/catlog/',
  catlogSeek:'https://catlog.zendesk.com/hc/ja/articles/38861371024537--Catlog-迷い猫モード-迷い猫探し-について',
  tractive:'https://tractive.com/en/pd/gps-tracker-cat?shopCountry=GB',
  countries:'https://help.tractive.com/hc/en-us/articles/205664291-Where-does-Tractive-work',
  airtag:'https://www.apple.com/jp/newsroom/2026/01/apple-introduces-new-airtag-with-expanded-range-and-improved-findability/',
  market:'https://petfood.or.jp/pdf/data/2025/3.pdf',
  privacy:'https://www.ppc.go.jp/personalinfo/legal/guidelines_tsusoku/',
  telec:'https://www.telec.or.jp/services/tech/offer.html'
};

function set(id,text,opts={}){
  const s=p.resolve(id);
  s.text=text;
  s.text.style={typeface:'Noto Sans CJK JP',color:'#333333',italic:false,bold:false,
    fontSize:20,lineSpacing:1.3,verticalAlignment:'top',alignment:'left',
    wrap:'square',autoFit:'none',insets:0,...opts.style};
  if(opts.position)s.position={...s.position,...opts.position};
  return s;
}
function heading(id,text){return set(id,text,{style:{fontSize:34.67,bold:true,lineSpacing:1.05}});}
function note(originalNumber,text,keys=[]){
  const slide=p.resolve(records[originalNumber-1].id);
  slide.speakerNotes.text=[text,'',...keys.map(k=>`${k}: ${sources[k]}`),'参照日：2026年10月14日'].join('\n');
}
function foot(originalNumber,text){
  const slide=p.resolve(records[originalNumber-1].id);
  const s=slide.shapes.add({geometry:'textbox',name:`source-disclosure-${originalNumber}`,position:{left:74.88,top:originalNumber===9?650:630,width:1120,height:40},fill:'none',line:{fill:'none',width:0}});
  s.text=text;s.text.style={typeface:'Noto Sans CJK JP',fontSize:14.67,color:'#666666',lineSpacing:1.2,insets:0,autoFit:'none',wrap:'square'};
  return s;
}

// Retain the supplied typography, theme and furniture. Correct page labels that
// extended beyond the source slide edge.
for(const record of records){
  for(const e of record.elements){
    if(!e.text)continue;
    const s=p.resolve(e.id);
    s.text.style={typeface:'Noto Sans CJK JP'};
    if(e.position?.top>680){s.position={...s.position,left:1230,width:35,height:24};}
  }
}

// Cover
set('sh/7qp4be9c','QZSS PET CARE',{style:{fontSize:14.67,bold:true,color:'#0557FF'}});
heading('sh/65g3298r','みちねこ');
set('sh/65g3298r','みちねこ',{style:{fontSize:45.33,bold:true}});
set('sh/ts7md4r2','猫の居場所を探すスマート首輪',{style:{fontSize:30.67,bold:true}});
set('sh/sryl4zqx','テーマ2：準天頂衛星みちびきを活用した事業',{style:{fontSize:17.33}});
set('sh/utg3698n','探す',{style:{fontSize:38.67,bold:true,color:'#0557FF',alignment:'center'}});
set('sh/wn6dc7eh','＋',{style:{fontSize:37.33,bold:true,alignment:'center'}});
set('sh/hofulsf2','見守る',{style:{fontSize:34.67,bold:true,alignment:'center'}});
set('sh/ul4vaxgb','屋外の位置と日々の変化を記録',{style:{fontSize:14.67,alignment:'center',color:'#666666'}});
set('sh/5sfepcfe','［氏名を追記］',{style:{fontSize:14.67,color:'#9A6500'}});
set('sh/sfqdkrep','［学籍番号を追記］',{style:{fontSize:14.67,color:'#9A6500'}});
set('sh/dgzetcfa','初稿　2026年10月14日　事業名・価格・開発目標は仮案',{style:{fontSize:13.33,color:'#666666'}});
note(1,'猫の飼育経験とロボコン経験を起点とする事業案。氏名・学籍番号は本人による追記欄。開発済み製品ではなく提案段階。');

// Theme and staged scope
heading('sh/ozy1ofad','選択テーマと事業の範囲');
set('sh/b29kza94','まず猫の捜索支援を検証し、健康記録や他の対象への展開を段階的に進める',{style:{fontSize:14.67,color:'#666666'}});
set('sh/r65knqtk','最初の対象：猫の飼い主',{style:{fontSize:20,bold:true}});
set('sh/q5wjelsz','脱走や隠れ場所が気になる飼い主。\n首輪を無理なく装着できる成猫から検証する。\n\n自分の猫の経験を、他の飼い主への聞き取りで確かめる。',{style:{fontSize:19}});
set('sh/nu58f2hs','利用機能：SLAS',{style:{fontSize:20,bold:true}});
set('sh/wjy9sry9','屋外はGNSSとSLASで位置を取得。\n近距離はBluetoothで探索する。\n\n屋内で衛星測位ができるとは想定しない。',{style:{fontSize:19}});
set('sh/cnupgny5','将来：活動記録・対象拡大',{style:{fontSize:20,bold:true}});
set('sh/do3q9szq','IMUで活動量の変化を記録する。\n犬向けは体格や用途を再検証する。\n\n高齢者の家族向けは、本人の意向・携行・対応体制を別途検討する。',{style:{fontSize:19}});
set('sh/76twva5c','テーマ2 ／ 準天頂衛星みちびきを活用した事業',{style:{fontSize:24,bold:true,color:'#0557FF'}});
note(2,'中心顧客は猫の飼い主。高齢者の見守りは初期売上に含めない。人を追跡する用途は本人の意向と適切な権限管理、見失った際の対応体制まで別途設計する。',['faq']);

// One sentence
set('sh/298ryl4v','「見当たらない」という不安を、探すための具体的な情報に変える',{style:{fontSize:14.67,color:'#666666'}});
set('sh/pcjqtg36','みちねこ（仮称）',{style:{fontSize:30,bold:true,color:'#0557FF'}});
set('sh/n2l4fq98','猫の脱走や隠れ場所が気になる飼い主に、スマート首輪とアプリを提供する。\n屋外ではSLASを利用した位置情報、近距離ではBluetoothの受信状況を使い、\n捜索の手掛かりを増やす。\n\n将来は活動量の変化を記録し、普段と違う様子に気づくきっかけも提供する。',{style:{fontSize:24,lineSpacing:1.4}});
note(3,'発見や健康状態の判定を保証するサービスではない。現在位置と最終確認位置を区別する。心拍、体温、病名の推定は初期版に含めない。');

// Customers and need
set('sh/doj29oba','猫が外に出た経験がある、または\n家の中で見つからず不安になる飼い主。\n購入者・月額料金の支払者も飼い主。',{style:{fontSize:21}});
set('sh/ih8ju9sn','家の中や近所を探す、呼びかける。\nペットカメラ、迷子札、スマートタグを使う。\n体調の変化は日々の観察で気づく。',{style:{fontSize:21}});
set('sh/i94r6xgz','① 室内に隠れたのか、外に出たのか分からず、探す範囲が広くなる。\n② 発見までの手掛かりが少なく、飼い主の時間と不安が増える。\n③ 会話できないため、活動の変化に気づきにくいことがある。',{style:{fontSize:22,lineSpacing:1.5}});
foot(4,'国内の猫は推計884.7万頭（2025年）。飼育頭数は購入者数ではなく、需要は聞き取りで確認する。');
note(4,'ユーザー提供の経験：好奇心旺盛でいろいろな場所に行く猫を飼っており、たまに外出する。どこかに隠れていないか心配になることがある。現在の解決方法は一般的な代替手段として補完した仮説。国内の推計猫飼育頭数は2025年8,847千頭。主要指標資料の印刷ページ22、調査各年全数n=50,000。購入需要や世帯数とは区別する。',['market']);

// Product and workflow
set('sh/l4bupwny','初期版：首輪＋在宅中継機＋アプリ\n\n屋外：GNSS／SLASで測位し、\nLTE-Mで位置を送信する。\n室内・近距離：Bluetoothの受信を\n在宅の目安・探索に利用する。\n\n位置の取得時刻と電池残量も表示。\n音・光は飼い主が操作したときだけ。\n\n将来：IMUによる活動量の変化を記録。\n病気の診断は行わない。',{style:{fontSize:21,lineSpacing:1.4}});
set('sh/m5kbi1oj','1. 首輪を充電し、アプリに登録する。\n\n2. 自宅の中継機をWi-Fiに接続する。\n\n3. 見当たらない時に在宅の目安と\n　 最終確認位置を確認する。\n\n4. 屋外では捜索モードで位置を更新。\n　 近づいたらBluetooth・音・光を使う。\n\n5. 発見後は履歴を振り返り、\n　 脱走しやすい場面の対策に生かす。',{style:{fontSize:21,lineSpacing:1.3}});
foot(5,'携帯圏外では送信できない。在宅中継機の未受信だけで「脱走」と断定しない。');
note(5,'在宅中継機はBLEを受信してWi-Fi経由で状態をアプリに送る構成案。BLEの受信強度は壁・姿勢・家具で変動し、距離や部屋を正確に特定する機能ではない。外出の通知には中継機の受信状況だけでなく複数時点の測位を併用し、未受信と外出を区別する。携帯圏外では最後の位置を表示し、端末に保存したログは再接続後に送信する。猫が音に驚く可能性を考慮し、音量調整・消音・短時間操作を備える。',['faq','tractive']);

// Value
set('sh/ml07i9sv','屋外の位置情報と近距離探索を、ひとつのアプリで使い分ける。\n位置が古い、受信できない、充電が必要という状態も分かるようにする。\n\n差別化の仮説：SLASによる精度改善で、捜索範囲や発見までの時間を減らす。\n同じ受信機で補正の有無を比較し、価格に見合う効果があるか検証する。',{style:{fontSize:23,lineSpacing:1.4}});
set('sh/pc76hkr2','「どこを探すか」を決めやすくする、猫向けの捜索支援。\n優位性は測位誤差だけでなく、模擬捜索の所要時間で確かめる。',{style:{fontSize:25,bold:true,color:'#0557FF',lineSpacing:1.4}});
foot(6,'位置追跡・活動記録は既存製品にもある。SLASの搭載だけで独自性や効果を主張しない。');
note(6,'顧客価値と優位性は未実証の仮説。固定経路を人が端末を持って移動し、SLAS補正あり／なしを時間・環境・受信条件を揃えて繰り返し評価する。都市部、開けた場所、住宅周辺で別々に誤差と探索時間を集計する。価格受容性と重量・充電負担の許容範囲も比較する。',['slas','catlog','tractive']);

// Pricing
set('sh/kzmdova1','猫の飼い主\nまずは捜索の不安が\n具体的な人に届ける。',{style:{fontSize:22}});
set('sh/fi9c369c','首輪と在宅中継機\n通信・位置履歴・通知\nアプリの利用',{style:{fontSize:22}});
set('sh/xcz2l03q','基本セット 9,800円\n月額 780円／匹\n税抜・仮の設定',{style:{fontSize:23,bold:true,color:'#0557FF'}});
set('sh/25ojml43','セット購入時に本体代を支払う。\n通信・アプリは毎月課金する。\n年額割引は継続率を確認してから検討。',{style:{fontSize:22}});
set('sh/f2d0b6lc','初期は自社Webで直接販売。\n通信・クラウド・決済・交換費を負担。\n広告費は月額収益から回収する。',{style:{fontSize:22}});
foot(7,'価格は見積もり・顧客調査前の仮定。比較対象の機能と、飼い主の支払意思を確認して改定する。');
note(7,'価格は本資料の採算例のために置いた税抜仮定であり、販売価格の決定や部品の実見積ではない。基本セットには首輪本体、在宅中継機、充電用品を含む想定。9800円と780円に対して高い／安いの誘導質問だけでなく、実際に試用・予約を希望するかを確認する。');

// Revenue: one explicitly bounded constant-customer scenario
heading('sh/g72x4zyd','売上の試算');
set('sh/ri9g7uhw','契約100匹が12か月継続する例。初年度の予測ではなく、価格と規模の関係を見る試算',{style:{fontSize:14.67,color:'#666666'}});
set('sh/tkby9kzm','月額 780円 × 100匹 × 1か月 ＝ 78,000円',{style:{fontSize:25.33,bold:true,color:'#FFFFFF',alignment:'center'}});
set('sh/id0fu50z','780円／匹・月',{style:{fontSize:26,bold:true,color:'#0557FF'}});
set('sh/m5gvmhwn','100匹の有料契約',{style:{fontSize:25,bold:true,color:'#0557FF'}});
set('sh/0jydkreh','課金回数',{style:{fontSize:14.67,bold:true}});
set('sh/1k7edwv2','月1回（年12回）',{style:{fontSize:25,bold:true,color:'#0557FF'}});
set('sh/kfixwbe1','78,000円\n月額サービスの売上',{style:{fontSize:26,bold:true,lineSpacing:1.3}});
set('sh/svydgb65','936,000円\n100匹を12か月維持した場合',{style:{fontSize:26,bold:true,lineSpacing:1.3}});
foot(8,'本体100セットの販売売上は別に980,000円。売上と利益を区別し、解約や新規獲得はこの例に含めない。');
note(8,'算式：780×100×1=78,000円／月。780×100×12=936,000円／年。本体9800×100=980,000円は一度の売上であり毎年繰り返すとは仮定しない。100セットを販売し、同じ100契約が12か月続く場合の合計売上は1,916,000円。試作3か月以内に100顧客が集まるという予測ではない。単位は飼育頭数ではなく課金対象の猫1匹につき1契約。');

// Prototype budget
heading('sh/0b65obm9','試作・実証に必要なもの');
const budget=[
 ['sh/oza1gfyh','sh/p0ji9kf2','sh/2xsjepgb','SLAS・LTE通信の評価機材','測位と通信の比較試験','100,000円'],
 ['sh/qlcjipgn','sh/bml0buxs','sh/0ru1ozyp','電池・筐体・在宅中継機','装着と省電力の試作','60,000円'],
 ['sh/76h0zup8','sh/ml8j6p8n','sh/hcji5o7a','アプリ・クラウド試用','地図・履歴・通知の実演','20,000円'],
 ['sh/xgzitk76','sh/cf6h0fql','sh/2l4faloj','安全確認・専門家への相談','首輪・電池・音の確認','40,000円'],
 ['sh/apofe5of','sh/bqxg7q50','sh/cr6xgv6l','予備費','部品交換・追加試験','30,000円']
];
for(const [a,b,c,x,y,z] of budget)for(const [id,t] of [[a,x],[b,y],[c,z]])set(id,t,{style:{fontSize:18.67},position:{top:p.resolve(id).position.top-4,height:40}});
set('sh/qtkf21ob','試作費用合計（税抜仮定）',{style:{fontSize:14.67,bold:true},position:{width:500}});
set('sh/rutwv65w','250,000円　既存PCを使用・自分の開発工数は別途',{style:{fontSize:22,bold:true,color:'#0557FF'},position:{height:32,top:600}});
foot(9,'量産設計・適合確認・金型・販売在庫の費用は別途見積もる。25万円は事業全体の開業費ではない。');
note(9,'5項目は全て未見積の試作予算。100000+60000+20000+40000+30000=250000円。自分がソフトウェア・基板・機構の試作を担当する想定で、開発人件費を現金支出として含めていない。ロボコン経験を利用するが、学校設備・相談相手の利用可否は今後確認する。販売前にはLTE／BLE等の無線設備の適合、電池・防水・首輪の安全性と、販売・交換体制を確認する。',['telec']);

// Initial customers
set('sh/ydcnatkn','最初の10人を見つける方法',{style:{fontSize:14.67,bold:true},position:{width:550}});
set('sh/l036l83y','猫を飼う知人・学校関係の紹介から5人、猫の飼育コミュニティから5人に聞く。\n脱走経験、見つからず困る頻度、今の対策、首輪と充電の許容範囲を確認する。\n\nまず10人は需要を検証する協力者。安全確認後、3家庭から試用を始める。\n販売開始時は、試用を続けたい人に購入を案内する。',{style:{fontSize:22,lineSpacing:1.4}});
set('sh/m1cnetkj','最初は知人の紹介で、30分の聞き取りを5件実施する。\n写真付きの説明資料で価格案を示し、連絡許可を得て試用希望者を記録する。\n実績ができたら地域の動物病院・ペット店に紹介の相談をする。',{style:{fontSize:22,lineSpacing:1.35}});
note(10,'最初の10人・紹介数・試用人数は行動目標であり既存顧客ではない。知人や学校関係者が猫を飼っているか、コミュニティで募集できるかは未確認。病院・店舗との提携も未成立。協力者への依頼文は実際の依頼前に本人が確認する。');

// Actions
set('sh/98rytw72','愛猫が見つからず困った場面を記録し、首輪の装着経験・体重・生活環境を整理する。',{style:{fontSize:21},position:{height:56}});
set('sh/61kzalof','飼い主5人に聞き取り。競合を比較し、SLAS受信機・通信・電池の部品候補を決める。',{style:{fontSize:21},position:{height:56}});
set('sh/mdobedg3','机上の試作でSLAS補正の有無、送信遅延、消費電力を測る。協力者は計10人を目標。',{style:{fontSize:21},position:{height:56}});
set('sh/1cfa58zi','アプリで模擬捜索を実演。安全確認後に3家庭で試用し、費用・装着・購入意思を見直す。',{style:{fontSize:21},position:{height:56}});
foot(11,'販売開始は試験結果で判断する。6〜12か月を目安に量産・適合・保守体制を整える計画。');
note(11,'日程は今後の計画。３か月以内の成果は測位・捜索の実証と小規模試用であり、全国販売の達成ではない。猫を意図的に逃がさず、人が端末を持つ模擬捜索から始める。獣医師等への相談と電池・筐体・バックルの確認を経て、飼い主が監督できる環境で装着確認を行う。');

// Metrics
set('sh/q903ad4n','捜索に役立つか',{position:{width:270},style:{fontSize:18.67,bold:true}});
set('sh/dcbm583y','模擬捜索の所要時間\n\n補正なしと比べ\n中央値20%短縮を目標。\n\n場所別に10回以上試し、\n測位誤差と送信の遅れも\n分けて記録する。',{style:{fontSize:21,lineSpacing:1.35}});
set('sh/b6d4f2lc','使い続けられるか',{position:{width:270},style:{fontSize:18.67,bold:true}});
set('sh/a543mx4r','30日間の試用継続率\n\n目標80%以上。\n\n首輪を嫌がる、重い、\n充電が手間といった\n中止理由も記録する。\n少人数なので件数も示す。',{style:{fontSize:21,lineSpacing:1.35}});
set('sh/xw3q94ne','料金を払う価値があるか',{position:{width:350},style:{fontSize:18.67,bold:true}});
set('sh/atc7epon','試用後の有料申込率\n\n目標30%以上。\n\n月額780円と本体価格を\n提示して意思を確認する。\n契約数と解約率を追い、\n採算に届くか見直す。',{style:{fontSize:21,lineSpacing:1.35}});
set('sh/9sj65kn2','アンテナ・表示の改善で捜索時間を減らし、重量・充電の改善で継続率を高める。',{style:{fontSize:20},position:{height:45}});
note(12,'全て開発・検証の目標であり実績ではない。屋外の固定経路を使う模擬捜索を場所別に各10回以上行い、探索者が学習する順序効果も考慮して条件の順番を変える。時間短縮率は(補正なしの中央値−補正ありの中央値)/補正なしの中央値。試用継続率は30日後の継続希望家庭数／開始家庭数。有料申込率は試用後の申込家庭数／試用家庭数。少人数では比率だけで確定判断せず母数と理由を記録する。');

// Main technical and operating challenge
set('sh/21gnuts7','猫が毎日着けられる重さ・安全性と、必要なときに使える位置情報を両立する。\n初期の開発目標：首輪込み35g以下、通常利用72時間以上。達成可否は試作で判断する。',{style:{fontSize:23,lineSpacing:1.3}});
set('sh/1076lobm','小型化するとアンテナと電池が制約。\n建物・姿勢で測位が不安定になる。\n\n引っ掛かり、脱落、充電切れへの対応と、\n無線の適合・位置履歴の保護も必要。',{style:{fontSize:21,lineSpacing:1.3}});
set('sh/vaxg7ulo','在宅時は省電力、捜索時は更新を増やす。\n安全バックルと脱落時の表示を検討。\n\n誤差・取得時刻・圏外を表示し、\n位置の共有権限と履歴削除を設ける。',{style:{fontSize:21,lineSpacing:1.3}});
foot(13,'参考：Tractive CAT 6 Miniは首輪込み32g。重量と稼働時間の目標は、同じ利用条件で検証する。');
note(13,'Tractiveの公式仕様は32g（首輪込み）、猫の体重3〜8kg、稼働時間は節電ゾーン利用で最大7日、未利用で最大4日。条件付き最大値を常時GPS稼働と混同しない。本提案の35g・72時間は実績ではなく、通常利用の測位・送信間隔と在宅時間を定義して確認する。首輪の安全バックルは猫の安全を優先し、外れることによる捜索の限界も説明する。継続する個人の位置履歴が個人を識別する場合、個人情報に該当しうる。無線の適合や販売時の確認費用は別途見積。',['tractive','privacy','telec']);

// Competitive comparison in the template's editable cell text boxes
const competitors=[
 ['sh/c3e1gjyd','sh/x4ni9ofy','sh/a1wze9g7','Tractive\nCAT 6 Mini（海外）','GPS位置追跡・逸走通知\n活動記録・音・光。\n首輪込み32g。','機能は重なる直接競合。\nSLASによる捜索効果を検証。\n日本の契約・対応条件は要確認。'],
 ['sh/y5wjitgj','sh/z650byxo','sh/0buh8zy5','Catlog\n（RABO）','猫の日常行動を記録。\nGPSは非搭載。\nBluetoothで迷い猫探しを支援。','日常の健康記録に強い。\n本案は屋外測位と近距離探索が軸。\n活動記録は将来機能として検討。'],
 ['sh/fqdg3q98','sh/up4fal83','sh/pwvy90rq','AirTag\n（Apple・代替手段）','Bluetoothと「探す」網で\n持ち物の発見を支援。\nペット専用ではない。','本案は首輪自身で屋外測位し、\n携帯回線で送信する構成。\n携帯圏外では更新できない。']
];
for(const [a,b,c,x,y,z] of competitors)for(const [id,t] of [[a,x],[b,y],[c,z]])set(id,t,{style:{fontSize:18.67,lineSpacing:1.15},position:{top:p.resolve(id).position.top-23,height:86}});
set('sh/4vmh0vq5','公式情報を2026年10月14日に確認。機能の組み合わせだけで優位性を主張せず、実測と顧客調査で比較する。',{style:{fontSize:14.67,color:'#666666'},position:{height:40}});
note(14,'競合比較の出典は全て各社公式。Tractive CAT 6 Miniは位置追跡と活動記録を備え、32g（首輪込み）。Tractiveの正式な発送・契約・顧客サポート対象国一覧に日本は掲載されていないが、追加利用可能国があるため、日本で利用不能とは断定せず販売・契約条件を要確認とする。CatlogはGPS非搭載だが、迷い猫モードでは協力者のスマホが首輪のBLE電波を受信した際にスマホ位置を共有できる。AirTagはApple公式で持ち物用途と説明され、人・ペット用ではない。Appleニュースリリースの当時価格と現行ストア表示が異なるため価格比較はこの表に記載しない。',['tractive','countries','catlog','catlogSeek','airtag']);

// Personal reason and 30-second pitch
heading('sh/k3y5ov21','この事業を考えた理由と30秒説明');
set('sh/t87ml0ji','私の猫は好奇心旺盛で、\nいろいろな場所に行き、たまに外出する。\n\n姿が見えないと、どこかに隠れているのか\n心配になることがある。\n会話ができないので、体調の変化も\n察知しにくいと感じた。\n\n飼い主としての経験と、ロボコンでの\nセンサ・機構・制御の経験を生かし、\n自分で試して改善できる事業を考えた。',{style:{fontSize:22,lineSpacing:1.35}});
set('sh/m9c3e1kn','私が考えたのは「みちねこ」という、\n猫の捜索を助ける首輪とアプリです。\n\n屋外はみちびきSLASの位置情報、\n近距離はBluetoothや音を使い、\n探す場所を絞る手掛かりを提供します。\n\n本体販売と月額料金で運営し、\nまず猫の飼い主10人への聞き取りと\n模擬捜索で、役立つかを確かめます。',{style:{fontSize:23,lineSpacing:1.4}});
note(15,'理由のうち猫の性格・外出・心配とロボコン経験はユーザーから提供された情報。実際の逸走回数、見つけるまでの時間、病気の経験は創作していない。30秒説明は読み方により約30秒を想定し、本人が発表時に調整する。');

// Theme 2, moved before supplements
heading('sh/gbedwfmx','みちびきを使う理由と検証');
set('sh/rm5czq50','テーマ2：位置精度の改善を、実際の捜索のしやすさにつなげる',{style:{fontSize:14.67,color:'#666666'}});
set('sh/ihcvml4j','SLASのL1S補強信号。\nGPS等の測位誤差を補正する。\n\n対象領域の公式水平精度は\n1.0m以下（95%）。\n受信機と環境に条件があり、\n首輪での達成は別途検証。\n\n利用料は不要。\n対応受信機が必要。',{style:{fontSize:21,lineSpacing:1.35}});
set('sh/29grm1of','屋外で探す範囲を絞る\n効果を狙う。\n\n同じ受信機で補正の有無を\n比較し、誤差と模擬捜索の\n所要時間を測る。\n\n地図自体の誤差や\n通信の遅れも含めて評価。\n屋内はBluetoothを使う。',{style:{fontSize:21,lineSpacing:1.35}});
set('sh/honqdwnu','通常のGNSSや2周波方式で\n同様のサービスは作れる。\n\nSLASが必須とは限らず、\n価格・消費電力・実測精度を\n比較して採用を判断する。\n\nSLASは位置の送信機能では\nないため、離れた飼い主への\n通知には別の通信が必要。',{style:{fontSize:21,lineSpacing:1.35}});
foot(17,'出典：内閣府「SLAS仕様」「みちびきFAQ」。屋内・地下では一般的な衛星受信機を利用できない。');
note(17,'水平1m以下95%は日本列島等の領域1で、仰角マスク10度、受信機・環境由来のユーザ測距誤差0.87m以下95%を想定する公式仕様。製品の全天候・全環境での達成を保証する値ではない。通常GNSSや2周波と比較した製品優位性はまだ未実証。SLASの補正信号とLTE-Mによる位置送信を区別する。',['slas','faq']);

// Reuse the unused theme 1 page for transparent economics
heading('sh/9kby1g7m','補足：費用と収益の仮定');
set('sh/ytkf2h8j','すべて税抜の未見積仮定。価格・費用を変えたときに事業が成立するかを見る',{style:{fontSize:14.67,color:'#666666'}});
set('sh/kv2h4rqp','収支の試算',{style:{fontSize:12.67,bold:true,color:'#FFFFFF',alignment:'center'}});
set('sh/ip4zel83','1セット・1契約あたり',{style:{fontSize:18.67,bold:true},position:{width:550}});
set('sh/3qdg7qpo','本体：9,800円 − 製造・配送・交換引当 6,500円 ＝ 3,300円／セット\n月額：780円 − 通信・クラウド・決済・対応 250円 ＝ 530円／匹・月\n固定費：月50,000円を仮定（広告、運営ツール等）',{style:{fontSize:23,lineSpacing:1.35}});
set('sh/e1sf65o3','100契約での収支と、販売前の条件',{style:{fontSize:18.67,bold:true},position:{width:650}});
set('sh/1ojy10ne','月額売上78,000円 − 変動費25,000円 − 固定費50,000円 ＝ 月3,000円\n月額サービスだけの損益分岐は約95契約。100セットの本体粗利は330,000円。\n専任人件費・試作費・量産立上費は別途必要。100契約だけで十分な生計は賄えない。\n6,500円で製造できるかを見積もり、達成できなければ設計・価格を改定する。',{style:{fontSize:22,lineSpacing:1.3}});
foot(16,'試作予算25万円と製品1セットの原価を区別する。安全性・実測効果・価格受容性を確認して販売を判断する。');
note(16,'試算は売上と利益を区別するための税抜仮定。製品原価6500円の内訳目安：部材・在宅中継機4700円、組立検査800円、梱包配送600円、交換引当400円。月変動費250円の内訳目安：通信150円、クラウド40円、決済30円、対応引当30円。固定費5万円の想定は広告3万円・運営ツール等2万円。全て未見積であり、試作部品の購入価格や実際の通信プランに基づく値ではない。専任人件費は除外。50000/530=94.3396なので整数契約の損益分岐は95件。本体粗利3300×100=330000円は一度の販売に伴うもので月額利益に繰り返し加算しない。初期実証費250000円、量産設計・適合確認・販売在庫資金は別途。');

// Sources and editable follow-up areas
heading('sh/hsn2l4bu','出典と、今後追記する情報');
set('sh/itw3upcf','公式情報の確認日：2026年10月14日。仮説・目標・未見積の費用は実証後に更新する',{style:{fontSize:14.67,color:'#666666'}});
set('sh/4felwzu5','参照・追記',{style:{fontSize:12.67,bold:true,color:'#FFFFFF',alignment:'center'}});
set('sh/6hw3y9sb','主な公式出典（クリックで開く）',{style:{fontSize:18.67,bold:true},position:{width:480}});
const refText='内閣府：SLAS仕様・みちびきFAQ\n\nRABO：Catlogの機能・迷い猫探し\n\nTractive：猫用製品・対応国\n\nApple：AirTagの用途・探す仕組み\n\nペットフード協会：2025年飼育調査';
const ref=set('sh/rip4retw',refText,{style:{fontSize:20,lineSpacing:1.3}});
for(const [label,key] of [['内閣府：SLAS仕様・みちびきFAQ','slas'],['RABO：Catlogの機能・迷い猫探し','catlog'],['Tractive：猫用製品・対応国','tractive'],['Apple：AirTagの用途・探す仕組み','airtag'],['ペットフード協会：2025年飼育調査','market']])ref.text.get(label).link={uri:sources[key],isExternal:true};
set('sh/upg3i18r','本人の経験・実測で追記すること',{style:{fontSize:18.67,bold:true},position:{width:500}});
set('sh/1cr2tg72','氏名・学籍番号・事業名の確定\n\n愛猫の体重、首輪の装着経験、\n見つからず困る頻度・具体的な場面\n\n聞き取り結果と支払意思\n\n測位精度・電池持ち・重量・捜索時間\n\n部品と量産の見積もり、販売開始時期',{style:{fontSize:21,lineSpacing:1.3}});
foot(18,'提出時は氏名と学籍番号を記入し、PDFを「学籍番号_氏名_課題1.pdf」に改名する。');
note(18,'出典全文URLは各スライドの発表者ノートにも掲載。飼育頭数の資料は印刷ページ22／PDF内3ページ目。資料は初稿で、氏名・学籍番号だけは本人が必ず追記する。提出PDF名は課題説明の指定に合わせる。',['slas','faq','catlog','catlogSeek','tractive','countries','airtag','market','privacy','telec']);

// Use all source pages, repurposing only the two unused theme pages.
const order=[...records.slice(0,15).map(x=>x.id),records[16].id,records[15].id,records[17].id];
p.slides.reorder(order);
for(let i=1;i<order.length;i++){
  const original=records.find(x=>x.id===order[i]);
  for(const e of original.elements){
    if(!e.text)continue;
    if(e.position?.top>680)set(e.id,String(i+1),{style:{fontSize:10.67,color:'#B5B5B5',alignment:'right'},position:{left:1230,width:35,height:24}});
    if(e.position?.left===46.08&&e.position?.top===59.52)set(e.id,String(i).padStart(2,'0'),{style:{fontSize:24,bold:true,color:'#0557FF'}});
  }
}

// Content snapshot, full previews, then package checks.
await fs.mkdir(path.join(build,'draft-render'),{recursive:true});
await fs.writeFile(path.join(build,'content.ndjson'),(await p.inspect({select:'$.slides[*]',include:['id','index','elements.id','elements.kind','elements.text','elements.position','notes.text']})).ndjson);
for(let i=0;i<p.slides.items.length;i++){
  const slide=p.slides.items[i];
  const blob=await p.export({slide,format:'png',scale:1});
  await fs.writeFile(path.join(build,'draft-render',`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await blob.arrayBuffer()));
  await fs.writeFile(path.join(build,'draft-render',`slide-${String(i+1).padStart(2,'0')}.layout.json`),await (await slide.export({format:'layout'})).text());
  console.log(`Rendered draft ${i+1}`);
}
const candidatePath=path.join(build,'candidate.pptx');
await (await PresentationFile.exportPptx(p)).save(candidatePath);
const sourceHash=crypto.createHash('sha256').update(await fs.readFile(source)).digest('hex');
const {finalizePresentation}=await import(pathToFileURL(path.join(SKILL_DIR,'container_tools/artifact_tool_utils.mjs')).href);
const result=await finalizePresentation({
 workspaceDir,candidatePath,finalPath,explicitTotalSlideCount:18,
 pythonExecutable:RUNTIME_PYTHON,
 integrityValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_package_integrity.py'),
 layoutValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_layout_geometry.py'),
 layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit'],
 fontPolicy:{basis:'reference',families:['Noto Sans CJK JP'],referencePath:source,referenceSha256:sourceHash},
 verifyArtifactToolImport:true,receiptPath:path.join(build,'validation.json')
});
console.log(JSON.stringify(result));
await fs.writeFile(path.join(build,'authoring-proto.json'),JSON.stringify(p.toProto()));
console.log(`Final PPTX: ${finalPath}`);
