'use strict';

// 純資料邏輯（無 DOM／WebGL），瀏覽器掛在 window.UTE，Node 測試用 module.exports
(function (root) {

// ── 國家代碼表（世界地圖 numeric id → [alpha2, 中文名]）──
const ISO_NUM = {
  "004":["AF","阿富汗"],"008":["AL","阿爾巴尼亞"],"010":["AQ","南極洲"],"012":["DZ","阿爾及利亞"],
  "016":["AS","美屬薩摩亞"],"020":["AD","安道爾"],"024":["AO","安哥拉"],"028":["AG","安地卡及巴布達"],
  "031":["AZ","亞塞拜然"],"032":["AR","阿根廷"],"036":["AU","澳洲"],"040":["AT","奧地利"],
  "044":["BS","巴哈馬"],"048":["BH","巴林"],"050":["BD","孟加拉"],"051":["AM","亞美尼亞"],
  "052":["BB","巴貝多"],"056":["BE","比利時"],"060":["BM","百慕達"],"064":["BT","不丹"],
  "068":["BO","玻利維亞"],"070":["BA","波士尼亞與赫塞哥維納"],"072":["BW","波札那"],
  "076":["BR","巴西"],"084":["BZ","貝里斯"],"086":["IO","英屬印度洋領地"],"090":["SB","索羅門群島"],
  "092":["VG","英屬維京群島"],"096":["BN","汶萊"],"100":["BG","保加利亞"],"104":["MM","緬甸"],
  "108":["BI","蒲隆地"],"112":["BY","白俄羅斯"],"116":["KH","柬埔寨"],"120":["CM","喀麥隆"],
  "124":["CA","加拿大"],"132":["CV","維德角"],"136":["KY","開曼群島"],"140":["CF","中非共和國"],
  "144":["LK","斯里蘭卡"],"148":["TD","查德"],"152":["CL","智利"],"156":["CN","中國"],
  "158":["TW","台灣"],"162":["CX","聖誕島"],"166":["CC","科科斯群島"],"170":["CO","哥倫比亞"],
  "174":["KM","葛摩"],"175":["YT","馬約特"],"178":["CG","剛果共和國"],"180":["CD","剛果民主共和國"],
  "184":["CK","庫克群島"],"188":["CR","哥斯大黎加"],"191":["HR","克羅埃西亞"],
  "192":["CU","古巴"],"196":["CY","賽普勒斯"],"203":["CZ","捷克"],
  "204":["BJ","貝南"],"208":["DK","丹麥"],"212":["DM","多米尼克"],"214":["DO","多明尼加"],
  "218":["EC","厄瓜多"],"222":["SV","薩爾瓦多"],"226":["GQ","赤道幾內亞"],"231":["ET","衣索比亞"],
  "232":["ER","厄利垂亞"],"233":["EE","愛沙尼亞"],"234":["FO","法羅群島"],"238":["FK","福克蘭群島"],
  "239":["GS","南喬治亞與南桑威奇群島"],"242":["FJ","斐濟"],"246":["FI","芬蘭"],
  "248":["AX","奧蘭群島"],"250":["FR","法國"],"258":["PF","法屬玻里尼西亞"],"260":["TF","法屬南部領地"],
  "262":["DJ","吉布地"],"266":["GA","加彭"],"268":["GE","喬治亞"],"270":["GM","甘比亞"],
  "275":["PS","巴勒斯坦"],"276":["DE","德國"],"288":["GH","迦納"],"292":["GI","直布羅陀"],
  "296":["KI","吉里巴斯"],"300":["GR","希臘"],"304":["GL","格陵蘭"],"308":["GD","格瑞那達"],
  "312":["GP","瓜地洛普"],"316":["GU","關島"],"320":["GT","瓜地馬拉"],"324":["GN","幾內亞"],
  "328":["GY","蓋亞那"],"332":["HT","海地"],"334":["HM","赫德島和麥克唐納群島"],"340":["HN","宏都拉斯"],
  "344":["HK","中國香港"],"348":["HU","匈牙利"],"352":["IS","冰島"],"356":["IN","印度"],
  "360":["ID","印尼"],"364":["IR","伊朗"],"368":["IQ","伊拉克"],"372":["IE","愛爾蘭"],
  "376":["IL","以色列"],"380":["IT","義大利"],"384":["CI","象牙海岸"],"388":["JM","牙買加"],
  "392":["JP","日本"],"398":["KZ","哈薩克"],"400":["JO","約旦"],"404":["KE","肯亞"],
  "408":["KP","北韓"],"410":["KR","南韓"],"414":["KW","科威特"],"417":["KG","吉爾吉斯"],
  "418":["LA","寮國"],"422":["LB","黎巴嫩"],"426":["LS","賴索托"],"428":["LV","拉脫維亞"],
  "430":["LR","賴比瑞亞"],"434":["LY","利比亞"],"438":["LI","列支敦斯登"],"440":["LT","立陶宛"],
  "442":["LU","盧森堡"],"446":["MO","中國澳門"],"450":["MG","馬達加斯加"],"454":["MW","馬拉威"],
  "458":["MY","馬來西亞"],"462":["MV","馬爾地夫"],"466":["ML","馬利"],"470":["MT","馬爾他"],
  "474":["MQ","馬丁尼克"],"478":["MR","茅利塔尼亞"],"480":["MU","模里西斯"],"484":["MX","墨西哥"],
  "492":["MC","摩納哥"],"496":["MN","蒙古"],"498":["MD","摩爾多瓦"],"500":["MS","蒙特塞拉特"],
  "504":["MA","摩洛哥"],"508":["MZ","莫三比克"],"512":["OM","阿曼"],"516":["NA","奈米比亞"],
  "520":["NR","諾魯"],"524":["NP","尼泊爾"],"528":["NL","荷蘭"],"533":["AW","阿魯巴"],
  "540":["NC","新喀里多尼亞"],"548":["VU","萬那杜"],"554":["NZ","紐西蘭"],"558":["NI","尼加拉瓜"],
  "562":["NE","尼日"],"566":["NG","奈及利亞"],"570":["NU","紐埃"],"574":["NF","諾福克島"],
  "578":["NO","挪威"],"580":["MP","北馬里亞納群島"],"581":["UM","美國本土外小島嶼"],"583":["FM","密克羅尼西亞"],
  "584":["MH","馬紹爾群島"],"585":["PW","帛琉"],"586":["PK","巴基斯坦"],"591":["PA","巴拿馬"],
  "598":["PG","巴布亞新幾內亞"],"600":["PY","巴拉圭"],"604":["PE","秘魯"],"608":["PH","菲律賓"],
  "612":["PN","皮特肯群島"],"616":["PL","波蘭"],"620":["PT","葡萄牙"],"624":["GW","幾內亞比索"],
  "626":["TL","東帝汶"],"630":["PR","波多黎各"],"634":["QA","卡達"],"638":["RE","留尼旺"],
  "642":["RO","羅馬尼亞"],"643":["RU","俄羅斯"],"646":["RW","盧安達"],"652":["BL","聖巴瑟米"],
  "654":["SH","聖赫勒拿"],"659":["KN","聖克里斯多福及尼維斯"],"660":["AI","安圭拉"],
  "662":["LC","聖露西亞"],"666":["PM","聖皮耶與密克隆"],"670":["VC","聖文森及格瑞那丁"],"674":["SM","聖馬利諾"],
  "678":["ST","聖多美普林西比"],"682":["SA","沙烏地阿拉伯"],"686":["SN","塞內加爾"],
  "688":["RS","塞爾維亞"],"690":["SC","塞席爾"],"694":["SL","獅子山"],"702":["SG","新加坡"],
  "703":["SK","斯洛伐克"],"704":["VN","越南"],"706":["SO","索馬利亞"],
  "710":["ZA","南非"],"716":["ZW","辛巴威"],"724":["ES","西班牙"],"728":["SS","南蘇丹"],
  "736":["SD","蘇丹"],"740":["SR","蘇利南"],"744":["SJ","斯瓦巴和揚馬延島"],"748":["SZ","史瓦帝尼"],
  "752":["SE","瑞典"],"756":["CH","瑞士"],"760":["SY","敘利亞"],"762":["TJ","塔吉克"],
  "764":["TH","泰國"],"768":["TG","多哥"],"772":["TK","托克勞"],"776":["TO","東加"],
  "780":["TT","千里達及托巴哥"],"784":["AE","阿拉伯聯合大公國"],"788":["TN","突尼西亞"],
  "792":["TR","土耳其"],"795":["TM","土庫曼"],"796":["TC","特克斯和凱科斯群島"],"798":["TV","吐瓦魯"],
  "800":["UG","烏干達"],"804":["UA","烏克蘭"],"807":["MK","北馬其頓"],"818":["EG","埃及"],
  "826":["GB","英國"],"831":["GG","根西"],"832":["JE","澤西"],"833":["IM","曼島"],
  "834":["TZ","坦尚尼亞"],"840":["US","美國"],"850":["VI","美屬維京群島"],"854":["BF","布吉納法索"],
  "858":["UY","烏拉圭"],"860":["UZ","烏茲別克"],"862":["VE","委內瑞拉"],"876":["WF","瓦利斯和富圖納"],
  "882":["WS","薩摩亞"],"887":["YE","葉門"],"894":["ZM","尚比亞"],"983":["XK","科索沃"],
  "705":["SI","斯洛維尼亞"],"499":["ME","蒙特內哥羅"],"729":["SD","蘇丹"],"732":["EH","西撒哈拉"],
  "336":["VA","梵蒂岡"],"531":["CW","古拉索"],"663":["MF","法屬聖馬丁"],"534":["SX","荷屬聖馬丁"],
};

const TIERS = [
  {
    min:0, max:0,
    title:'待啟程', sub:'世界在等著你出發',
    color:'#7A9AAF',
    svg:`<svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M28 28V20Q28 15 33 15H47Q52 15 52 20V28" stroke="#7A9AAF" stroke-width="2.5" stroke-linecap="round"/>
      <rect x="14" y="28" width="52" height="34" rx="6" stroke="#7A9AAF" stroke-width="2.5"/>
      <line x1="14" y1="43" x2="66" y2="43" stroke="#7A9AAF" stroke-width="1.5" opacity="0.4"/>
      <rect x="33" y="39" width="14" height="8" rx="2.5" stroke="#7A9AAF" stroke-width="2"/>
      <circle cx="24" cy="64" r="3" stroke="#7A9AAF" stroke-width="2"/>
      <circle cx="56" cy="64" r="3" stroke="#7A9AAF" stroke-width="2"/>
    </svg>`
  },
  {
    min:1, max:9,
    title:'地圖新鮮人', sub:'第一步，最難也最珍貴',
    color:'#F5C842',
    svg:`<svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 18 L30 12 L50 20 L70 14 L70 62 L50 68 L30 60 L10 66 Z" stroke="#F5C842" stroke-width="2" stroke-linejoin="round"/>
      <line x1="30" y1="12" x2="30" y2="60" stroke="#F5C842" stroke-width="1" opacity="0.35"/>
      <line x1="50" y1="20" x2="50" y2="68" stroke="#F5C842" stroke-width="1" opacity="0.35"/>
      <circle cx="24" cy="33" r="4" fill="#F5C842"/>
      <circle cx="56" cy="47" r="4" fill="#F5C842"/>
      <path d="M24 33 Q37 26 56 47" stroke="#F5C842" stroke-width="1.5" stroke-dasharray="4 3" fill="none"/>
    </svg>`
  },
  {
    min:10, max:24,
    title:'洲際漫遊者', sub:'已跨越第一道海岸線',
    color:'#F5C842',
    svg:`<svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="40" cy="40" r="27" stroke="#F5C842" stroke-width="2.5"/>
      <circle cx="40" cy="40" r="3.5" fill="#F5C842"/>
      <polygon points="40,14 35,40 45,40" fill="#F5C842"/>
      <polygon points="40,66 35,40 45,40" fill="#F5C842" opacity="0.3"/>
      <polygon points="14,40 40,35 40,45" fill="#F5C842" opacity="0.3"/>
      <polygon points="66,40 40,35 40,45" fill="#F5C842" opacity="0.3"/>
    </svg>`
  },
  {
    min:25, max:44,
    title:'環球探索者', sub:'地球上已有你的足跡',
    color:'#F5C842',
    svg:`<svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="40" cy="40" r="25" stroke="#F5C842" stroke-width="2.5"/>
      <ellipse cx="40" cy="40" rx="12" ry="25" stroke="#F5C842" stroke-width="1.5" opacity="0.45"/>
      <line x1="15" y1="40" x2="65" y2="40" stroke="#F5C842" stroke-width="1.5" opacity="0.45"/>
      <path d="M18 32 Q40 28 62 32" fill="none" stroke="#F5C842" stroke-width="1" opacity="0.3"/>
      <path d="M18 48 Q40 52 62 48" fill="none" stroke="#F5C842" stroke-width="1" opacity="0.3"/>
      <path d="M23 55 Q32 20 57 26" fill="none" stroke="#F5C842" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="23" cy="55" r="3.5" fill="#F5C842"/>
      <circle cx="57" cy="26" r="3.5" fill="#F5C842"/>
    </svg>`
  },
  {
    min:45, max:64,
    title:'地平線獵手', sub:'世界的一半屬於你',
    color:'#F5A840',
    svg:`<svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="22" cy="42" r="16" stroke="#F5A840" stroke-width="2.5"/>
      <circle cx="58" cy="42" r="16" stroke="#F5A840" stroke-width="2.5"/>
      <line x1="38" y1="35" x2="42" y2="35" stroke="#F5A840" stroke-width="3" stroke-linecap="round"/>
      <line x1="38" y1="49" x2="42" y2="49" stroke="#F5A840" stroke-width="3" stroke-linecap="round"/>
      <circle cx="22" cy="42" r="8" fill="#F5A840" fill-opacity="0.1" stroke="#F5A840" stroke-width="1.5" opacity="0.5"/>
      <circle cx="58" cy="42" r="8" fill="#F5A840" fill-opacity="0.1" stroke="#F5A840" stroke-width="1.5" opacity="0.5"/>
    </svg>`
  },
  {
    min:65, max:84,
    title:'傳奇旅行者', sub:'地圖上幾乎找不到空白',
    color:'#F5A030',
    svg:`<svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 62 L18 34 L28 52 L40 22 L52 52 L62 34 L70 62 Z" stroke="#F5A030" stroke-width="2.5" stroke-linejoin="round" fill="#F5A030" fill-opacity="0.09"/>
      <line x1="10" y1="67" x2="70" y2="67" stroke="#F5A030" stroke-width="3" stroke-linecap="round"/>
      <circle cx="40" cy="22" r="4.5" fill="#F5A030"/>
      <circle cx="18" cy="34" r="3" fill="#F5A030"/>
      <circle cx="62" cy="34" r="3" fill="#F5A030"/>
      <line x1="40" y1="14" x2="40" y2="17" stroke="#F5A030" stroke-width="2" stroke-linecap="round" opacity="0.75"/>
      <line x1="35" y1="16" x2="37" y2="18" stroke="#F5A030" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/>
      <line x1="45" y1="16" x2="43" y2="18" stroke="#F5A030" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/>
    </svg>`
  },
  {
    min:85, max:99,
    title:'地球守護者', sub:'你見過幾乎所有角落',
    color:'#EE8822',
    svg:`<svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="40" cy="44" r="20" stroke="#EE8822" stroke-width="2.5"/>
      <ellipse cx="40" cy="44" rx="10" ry="20" stroke="#EE8822" stroke-width="1.5" opacity="0.45"/>
      <line x1="20" y1="44" x2="60" y2="44" stroke="#EE8822" stroke-width="1.5" opacity="0.45"/>
      <ellipse cx="40" cy="40" rx="34" ry="12" stroke="#EE8822" stroke-width="1.5" stroke-dasharray="5 3" opacity="0.5" transform="rotate(-20 40 40)"/>
      <circle cx="10" cy="28" r="3" fill="#EE8822"/>
      <circle cx="70" cy="34" r="2.5" fill="#EE8822" opacity="0.85"/>
      <circle cx="50" cy="11" r="2" fill="#EE8822" opacity="0.75"/>
    </svg>`
  },
  {
    min:100, max:100,
    title:'地球解鎖者', sub:'恭喜！你完全解鎖了地球',
    color:'#FFD700',
    svg:`<svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="18" y="38" width="44" height="30" rx="6" stroke="#FFD700" stroke-width="2.5" fill="#FFD700" fill-opacity="0.07"/>
      <path d="M29 38 V28 Q29 14 40 14 Q51 14 51 28 V22" stroke="#FFD700" stroke-width="2.5" stroke-linecap="round" fill="none"/>
      <circle cx="40" cy="55" r="5" stroke="#FFD700" stroke-width="2" fill="#FFD700" fill-opacity="0.2"/>
      <line x1="40" y1="60" x2="40" y2="65" stroke="#FFD700" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="62" cy="18" r="2.5" fill="#FFD700" opacity="0.9"/>
      <circle cx="70" cy="30" r="1.5" fill="#FFD700" opacity="0.7"/>
      <circle cx="67" cy="10" r="1.5" fill="#FFD700" opacity="0.65"/>
    </svg>`
  },
];

function getTier(pct) {
  return TIERS.find(t => pct >= t.min && pct <= t.max) || TIERS[1];
}

const REGION_COLORS = {
  '亞洲':   '#4fc3f7',
  '歐洲':   '#ce93d8',
  '美洲':   '#81c784',
  '非洲':   '#ffb74d',
  '大洋洲': '#4db6ac',
  '極地':   '#90a4ae',
  '台灣':   '#f48fb1',
};
const DEFAULT_COLOR = '#F4C737';
const HOME = { lat: 25.033, lng: 121.565 };   // 台北：所有旅程的起點
const TOTAL_COUNTRIES = 195;

// 地標資料裡同一國家有不同寫法，統一成 ISO_NUM 的中文名
const COUNTRY_ALIASES = {
  '臺灣': '台灣', '韓國': '南韓', '烏幹達': '烏干達', '印度尼西亞': '印尼',
  '納米比亞': '奈米比亞', '約旦/巴勒斯坦': '約旦', '香港': '中國香港', '澳門': '中國澳門',
  '圖瓦魯': '吐瓦魯', '巴布亞紐幾內亞': '巴布亞新幾內亞', '英屬南喬治亞': '南喬治亞與南桑威奇群島',
  '秘魯／玻利維亞': '秘魯', '葉門／索馬利蘭': '葉門', '烏茲別克／哈薩克': '烏茲別克',
  '英國海外領地（賽普勒斯）': '賽普勒斯',
};

const A2_BY_NUM = {};
const ZH_BY_A2 = {};
const A2_BY_ZH = {};
for (const [num, [a2, zh]] of Object.entries(ISO_NUM)) {
  A2_BY_NUM[num] = a2;
  if (zh) { ZH_BY_A2[a2] = zh; A2_BY_ZH[zh] = a2; }
}

function countryKey(zh) {
  if (!zh) return '';
  return COUNTRY_ALIASES[zh] || zh;
}
function a2FromNumeric(id) {
  return A2_BY_NUM[String(id).padStart(3, '0')] || null;
}

// 地圖檔裡沒有國碼的地區，用英文名對回（北賽普勒斯、索馬利蘭非聯合國會員，沒有 alpha2）
const NO_ID_FEATURES = {
  'Kosovo': { a2: 'XK', zh: '科索沃' },
  'N. Cyprus': { a2: null, zh: '北賽普勒斯' },
  'Somaliland': { a2: null, zh: '索馬利蘭' },
};
function featureCountry(f) {
  if (f.id) {
    const a2 = a2FromNumeric(f.id);
    return { a2, zh: (a2 && ZH_BY_A2[a2]) || f.properties.name };
  }
  return NO_ID_FEATURES[f.properties.name] || { a2: null, zh: f.properties.name };
}
function a2FromZh(zh) {
  return A2_BY_ZH[countryKey(zh)] || null;
}
function flagEmoji(a2) {
  if (!a2 || a2.length !== 2) return '🏳️';
  return String.fromCodePoint(...[...a2.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

// ── 索引 ──────────────────────────────────────────────
function buildIndex(episodes, landmarks) {
  const epMeta = new Map();
  for (const ep of episodes) if (ep.type === 'main' && ep.episode) epMeta.set(ep.episode, ep);
  const mainEps = [...epMeta.values()].sort((a, b) => b.episode - a.episode);

  const lmByEp = new Map();
  const countries = new Map();
  const lmFirstMs = new Map();

  for (const lm of landmarks) {
    lm.countryKey = countryKey(lm.country);
    lm.a2 = a2FromZh(lm.country);
    const epNums = [...new Set((lm.appearances || []).map(a => a.ep))].filter(n => epMeta.has(n));
    lm.epNums = epNums;

    for (const n of epNums) {
      if (!lmByEp.has(n)) lmByEp.set(n, []);
      lmByEp.get(n).push(lm);
    }

    const dates = epNums.map(n => Date.parse(epMeta.get(n).pubDate)).filter(Number.isFinite);
    if (dates.length) lmFirstMs.set(lm, Math.min(...dates));

    if (!lm.countryKey) continue;
    if (!countries.has(lm.countryKey)) {
      countries.set(lm.countryKey, {
        key: lm.countryKey, a2: lm.a2, region: lm.region,
        landmarks: [], eps: new Set(), firstMs: Infinity, lastMs: -Infinity,
      });
    }
    const c = countries.get(lm.countryKey);
    c.landmarks.push(lm);
    for (const n of epNums) c.eps.add(n);
    for (const d of dates) { c.firstMs = Math.min(c.firstMs, d); c.lastMs = Math.max(c.lastMs, d); }
  }

  for (const c of countries.values()) {
    c.landmarks.sort((a, b) => b.epNums.length - a.epNums.length);
  }

  // 搜尋字串：標題＋地標名＋國家
  const searchText = new Map();
  for (const ep of mainEps) {
    const lms = lmByEp.get(ep.episode) || [];
    searchText.set(ep.episode, [
      `ep${ep.episode}`, ep.title,
      ...lms.map(l => `${l.name} ${l.name_en || ''} ${l.countryKey}`),
    ].join(' ').toLowerCase());
  }

  const countryByA2 = new Map();
  for (const c of countries.values()) if (c.a2) countryByA2.set(c.a2, c);

  return { epMeta, mainEps, lmByEp, countries, countryByA2, lmFirstMs, searchText };
}

function filterEpisodes(index, { query = '', region = 'all', year = null, tag = null } = {}) {
  const q = query.trim().toLowerCase();
  return index.mainEps.filter(ep => {
    if (year && !(ep.pubDate || '').startsWith(year)) return false;
    if (tag && !(index.tagsByEp?.get(ep.episode) || []).includes(tag)) return false;
    if (region !== 'all') {
      const lms = index.lmByEp.get(ep.episode) || [];
      if (!lms.some(l => l.region === region)) return false;
    }
    if (q && !index.searchText.get(ep.episode).includes(q)) return false;
    return true;
  });
}

// 一組座標的鏡頭中心與高度（球面平均＋最大角距離）
function viewFor(points) {
  if (!points.length) return null;
  const rad = Math.PI / 180;
  let x = 0, y = 0, z = 0;
  for (const p of points) {
    const la = p.lat * rad, lo = p.lng * rad;
    x += Math.cos(la) * Math.cos(lo); y += Math.cos(la) * Math.sin(lo); z += Math.sin(la);
  }
  const lng = Math.atan2(y, x) / rad;
  const lat = Math.atan2(z, Math.hypot(x, y)) / rad;
  let maxD = 0;
  for (const p of points) maxD = Math.max(maxD, angularDistance({ lat, lng }, p));
  const altitude = Math.min(2.4, Math.max(0.18, maxD * 2.6 + 0.12));
  return { lat, lng, altitude };
}

function angularDistance(a, b) {
  const rad = Math.PI / 180;
  const s = Math.sin((b.lat - a.lat) * rad / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(s)));   // 弧度
}

function formatDuration(secs) {
  if (!secs) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h} 小時 ${m} 分` : `${m} 分鐘`;
}

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const UTE = {
  ISO_NUM, TIERS, REGION_COLORS, DEFAULT_COLOR, HOME, TOTAL_COUNTRIES, ZH_BY_A2,
  getTier, countryKey, a2FromNumeric, a2FromZh, featureCountry, flagEmoji,
  buildIndex, filterEpisodes, viewFor, angularDistance, formatDuration, escHtml,
};

if (typeof module !== 'undefined' && module.exports) module.exports = UTE;
else root.UTE = UTE;

})(typeof window !== 'undefined' ? window : globalThis);
