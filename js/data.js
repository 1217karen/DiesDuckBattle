// data.js

// Battlers（バトラー）
const BATTLERS = [

{
  id: "B01",
  name: "アカシア・デビルアイ",
  description: "",

  icons: {
    full: "/img/Battler/B01.png",
    neutral: "/img/Battler/icon/B01_1.png",
    start:  "/img/Battler/icon/B01_2.png",
    even:   "/img/Battler/icon/B01_2.png",
    lead:   "/img/Battler/icon/B01_4.png",
    behind: "/img/Battler/icon/B01_5.png",
    win:    "/img/Battler/icon/B01_3.png",
    lose:   "/img/Battler/icon/B01_4.png",
    draw:   "/img/Battler/icon/B01_7.png",
  },

  quotes: {
    battleStart: { text: "「お互い頑張ろうね」", icon: "start" },
    turn: {
      even: { text: "「まあ、のんびり楽しもうよ」", icon: "even" },
      lead: { text: "「よーし、ノってきたぜ」", icon: "lead" },
      behind: { text: "「うわっ、ちょっと不味いかも」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「やった！ナイスバトルだったぜ」", icon: "win" },
      lose: { text: "「負けたか～。勝者には賞品のお菓子をあげよう」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },

  dSkill: {
    id: "DS01",
    name: "",
    description: "自分アヒルに【５】を追加",
    effect: { type: "addDice", target: "self", values: [5] },
  },
bSkill: {
  id: "BS01",
  name: "",
  description: "自分アヒルが自身を回復した時、相手アヒルにランダムな状態異常を2付与",
  trigger: "afterHeal",
  when: { left:"self.hp", op:">", right:0 },
  effect: { type:"changeStatus", target:"enemy", status:"@debuff", op:"add", value:2 },
},
},

{
  id: "B02",
  name: "絡繰院 オーコ",
  description: "",
  icons: {
    full: "/img/Battler/B02.png",
    neutral: "/img/Battler/icon/B02_1.png",
    start:  "/img/Battler/icon/B02_3.png",
    even:   "/img/Battler/icon/B02_2.png",
    lead:   "/img/Battler/icon/B02_1.png",
    behind: "/img/Battler/icon/B02_4.png",
    win:    "/img/Battler/icon/B02_3.png",
    lose:   "/img/Battler/icon/B02_5.png",
    draw:   "/img/Battler/icon/B02_7.png",
  },
  quotes: {
    battleStart: { text: "「ワガハイに挑もうなんて１００万年早いのにゃ！」", icon: "start" },
    turn: {
      even: { text: "「機会を伺うのにゃ～」", icon: "even" },
      lead: { text: "「降参するなら今のうちにゃ！」", icon: "lead" },
      behind: { text: "「こ、これも計算の内にゃ！」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「にゃっはっは！ワガハイの大勝利にゃ～！」", icon: "win" },
      lose: { text: "「そ、そんな馬鹿にゃ……覚えてろにゃ～！」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS02",
    name: "",
    description: "自分アヒルに【２】を追加",
    effect: { type: "addDice", target: "self", values: [2] },
  },
bSkill: {
  id: "BS02",
  name: "",
  description: "自分アヒルのHPが70%以上の時、通常攻撃回数が+1",
  trigger: "afterRoll",
  when: { all:[ { left:"dice", op:">=", right:1 }, { left:"self.hpPct", op:">=", right:0.7 } ] },
  effect: { type:"changeValue", target:"self", key:"attackTimesAdd", op:"add", value:1 },
},
},

{
  id: "B03",
  name: "アラン・グッドダック",
  description: "",
  icons: {
    full: "/img/Battler/B03.png",
    neutral: "/img/Battler/icon/B03_1.png",
    start:  "/img/Battler/icon/B03_2.png",
    even:   "/img/Battler/icon/B03_1.png",
    lead:   "/img/Battler/icon/B03_2.png",
    behind: "/img/Battler/icon/B03_4.png",
    win:    "/img/Battler/icon/B03_3.png",
    lose:   "/img/Battler/icon/B03_5.png",
    draw:   "/img/Battler/icon/B03_7.png",
  },
  quotes: {
    battleStart: { text: "「USA仕込みのアヒルバトルテク、見せてあげマース！」", icon: "start" },
    turn: {
      even: { text: "「まだまだイーブンデスネー」", icon: "even" },
      lead: { text: "「フィニッシュまでもう少しデース！」", icon: "lead" },
      behind: { text: "「これ以上のミスは許されマセン！」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「コレがジーニアスアヒルバトラーの実力デース！」", icon: "win" },
      lose: { text: "「USAスタイルが、通用しないなんて……」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS03",
    name: "",
    description: "自分アヒルに【４】を追加",
    effect: { type: "addDice", target: "self", values: [4] },
  },
bSkill: {
  id: "BS03",
  name: "",
  description: "フェイズ開始時、自分アヒルに付与されている反撃を集中に変換する",
  trigger: "phaseStart",
  when: { left:"self.status:counter", op:">", right:0 },
  effect: [ { type:"changeStatus", target:"self", status:"focus", op:"add", value:{ read:"self.status:counter" } }, { type:"changeStatus", target:"self", status:"counter", op:"set", value:0 } ],
},
},

{
  id: "B04",
  name: "芦比呂 シキ",
  description: "",
  icons: {
    full: "/img/Battler/B04.png",
    neutral: "/img/Battler/icon/B04_1.png",
    start:  "/img/Battler/icon/B04_1.png",
    even:   "/img/Battler/icon/B04_4.png",
    lead:   "/img/Battler/icon/B04_1.png",
    behind: "/img/Battler/icon/B04_5.png",
    win:    "/img/Battler/icon/B04_3.png",
    lose:   "/img/Battler/icon/B04_2.png",
    draw:   "/img/Battler/icon/B04_7.png",
  },
  quotes: {
    battleStart: { text: "「早く始めようぜ！」", icon: "start" },
    turn: {
      even: { text: "「いつも通りやればいけるはずだ……！」", icon: "even" },
      lead: { text: "「そろそろ効いてきたんじゃねえか？」", icon: "lead" },
      behind: { text: "「っ、修行が足りてないのか！？」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「よっしゃあ！オレの勝ちだ！」", icon: "win" },
      lose: { text: "「もっと、もっと強くならねえと……！」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS04",
    name: "",
    description: "相手アヒルに【０】を追加",
    effect: { type: "addDice", target: "enemy", values: [0] },
  },
bSkill: {
  id: "BS04",
  name: "",
  description: "自分アヒルが反撃を発動した時、相手アヒルに荒波を2付与",
  trigger: "afterTakeDamage",
  when: { left:"attack.isCounter", op:"==", right:true },
  effect: { type:"changeStatus", target:"enemy", status:"roughWave", op:"add", value:2 },
},
},

{
  id: "B05",
  name: "天真 すずら",
  description: "",
  icons: {
    full: "/img/Battler/B05.png",
    neutral: "/img/Battler/icon/B05_1.png",
    start:  "/img/Battler/icon/B05_4.png",
    even:   "/img/Battler/icon/B05_2.png",
    lead:   "/img/Battler/icon/B05_1.png",
    behind: "/img/Battler/icon/B05_4.png",
    win:    "/img/Battler/icon/B05_3.png",
    lose:   "/img/Battler/icon/B05_5.png",
    draw:   "/img/Battler/icon/B05_7.png",
  },
  quotes: {
    battleStart: { text: "「うぅ……た、戦えるかな……」", icon: "start" },
    turn: {
      even: { text: "「落ち着いて、落ち着いて……」", icon: "even" },
      lead: { text: "「あれっ、ど、どうして……！？」", icon: "lead" },
      behind: { text: "「も、もっと回復しなきゃ……！」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「勝てちゃった……あっ、て、手当てしますね！」", icon: "win" },
      lose: { text: "「よく頑張ったよ……えらいえらい……痛かったね、ごめんね……」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS05",
    name: "",
    description: "自分アヒルに【３】を追加",
    effect: { type: "addDice", target: "self", values: [3] },
  },
bSkill: {
  id: "BS05",
  name: "",
  description: "自分アヒルが回復した時、さらにHPを5回復",
  trigger: "afterHeal",
  when: { left:"self.hp", op:">", right:0 },
  effect: { type:"heal", target:"self", amount:5, source:"afterHealBonus" },
},
},

{
  id: "B06",
  name: "オキオニ タツト",
  description: "",
  icons: {
    full: "/img/Battler/B06.png",
    neutral: "/img/Battler/icon/B06_1.png",
    start:  "/img/Battler/icon/B06_2.png",
    even:   "/img/Battler/icon/B06_1.png",
    lead:   "/img/Battler/icon/B06_2.png",
    behind: "/img/Battler/icon/B06_4.png",
    win:    "/img/Battler/icon/B06_3.png",
    lose:   "/img/Battler/icon/B06_5.png",
    draw:   "/img/Battler/icon/B06_7.png",
  },
  quotes: {
    battleStart: { text: "「待ちくたびれちゃったよ……さあ、始めようか！」", icon: "start" },
    turn: {
      even: { text: "「様子見なんてつまんないよね？」", icon: "even" },
      lead: { text: "「いいのかな～？　このままだと沈んじゃうよ？」", icon: "lead" },
      behind: { text: "「まだ、終わってない！まだ戦える！」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「ふふん！まあ、当然の勝利だよね」", icon: "win" },
      lose: { text: "「ボク様が読み違えるなんてッ……！」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS06",
    name: "",
    description: "自分アヒルに【６】を追加",
    effect: { type: "addDice", target: "self", values: [6] },
  },
bSkill: {
  id: "BS06",
  name: "",
  description: "自分アヒルが与える通常ダメージが1.5倍になるが、受ける通常ダメージも1.5倍になる",
  trigger: "", hpCond: { op: "", value: 0 }, bonus: {},
},
bSkills: [
  { id: "BS06A", name: "", description: "", trigger: "beforeAttack", when: { all: [ { left: "attack.kind", op: "==", right: "normalAttack" }, { left: "attack.isCounter", op: "==", right: false } ] }, effect: { type: "changeAttack", op: "mulDamage", value: 1.5 } },
  { id: "BS06B", name: "", description: "", trigger: "beforeTakeDamage", when: { all: [ { left: "attack.kind", op: "==", right: "normalAttack" }, { left: "attack.isCounter", op: "==", right: false } ] }, effect: { type: "changeAttack", op: "mulDamage", value: 1.5 } },
],
 },

{
  id: "B06-2",
  name: "サレン タツト",
  description: "",
  icons: {
    full: "/img/Battler/B06-2.png",
    neutral: "/img/Battler/icon/B06-2_1.png",
    start:  "/img/Battler/icon/B06-2_3.png",
    even:   "/img/Battler/icon/B06-2_4.png",
    lead:   "/img/Battler/icon/B06-2_2.png",
    behind: "/img/Battler/icon/B06-2_5.png",
    win:    "/img/Battler/icon/B06-2_3.png",
    lose:   "/img/Battler/icon/B06-2_4.png",
    draw:   "/img/Battler/icon/B06-2_7.png",
  },
  quotes: {
    battleStart: { text: "「今度は誰がアヒルバトルをするんだ？　……俺！？」", icon: "start" },
    turn: {
      even: { text: "「セオリーも何もわからん！」", icon: "even" },
      lead: { text: "「いつの間にか優勢になっている……」", icon: "lead" },
      behind: { text: "「このままだと負けそうなことは分かるぞ！」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「お、終わったのか？　そうか……」", icon: "win" },
      lose: { text: "「クッ、普通に悔しさがある……」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS06-2",
    name: "",
    description: "自分アヒルに【４】を追加",
    effect: { type: "addDice", target: "self", values: [4] },
  },
bSkill: {
  id: "BS06-2",
  name: "",
  description: "自分アヒルが受ける通常ダメージが0.5倍になるが、与える通常ダメージも0.5倍になる",
  trigger: "", hpCond: { op: "", value: 0 }, bonus: {},
},
bSkills: [
  { id: "BS06-2A", name: "", description: "", trigger: "beforeAttack", when: { all: [ { left: "attack.kind", op: "==", right: "normalAttack" }, { left: "attack.isCounter", op: "==", right: false } ] }, effect: { type: "changeAttack", op: "mulDamage", value: 0.5 } },
  { id: "BS06-2B", name: "", description: "", trigger: "beforeTakeDamage", when: { all: [ { left: "attack.kind", op: "==", right: "normalAttack" }, { left: "attack.isCounter", op: "==", right: false } ] }, effect: { type: "changeAttack", op: "mulDamage", value: 0.5 } },
],
},

{
  id: "B07",
  name: "クルー",
  description: "",
  icons: {
    full: "/img/Battler/B07.png",
    neutral: "/img/Battler/icon/B07_1.png",
    start:  "/img/Battler/icon/B07_4.png",
    even:   "/img/Battler/icon/B07_1.png",
    lead:   "/img/Battler/icon/B07_4.png",
    behind: "/img/Battler/icon/B07_5.png",
    win:    "/img/Battler/icon/B07_3.png",
    lose:   "/img/Battler/icon/B07_2.png",
    draw:   "/img/Battler/icon/B07_7.png",
  },
  quotes: {
    battleStart: { text: "「野郎ども、出航だ！」", icon: "start" },
    turn: {
      even: { text: "「戦況を冷静に見極めるッス」", icon: "even" },
      lead: { text: "「このまま押し通すぞ！」", icon: "lead" },
      behind: { text: "「転覆させるわけにゃいかねえ！」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「これが海の漢の実力だ！……ッス」", icon: "win" },
      lose: { text: "「これも糧にさせてもらうッスよ」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS07",
    name: "",
    description: "自分アヒルに【６】を追加",
    effect: { type: "addDice", target: "self", values: [6] },
  },
bSkill: {
  id: "BS07",
  name: "",
  description: "自分アヒルに状態異常が付与されている時、フェイズ開始時に次に与える通常ダメージがAT+5",
  trigger: "phaseStart",
  when: { any:[ { left:"self.status:crack", op:">", right:0 }, { left:"self.status:roughWave", op:">", right:0 }, { left:"self.status:steam", op:">", right:0 }, { left:"self.status:Headwind", op:">", right:0 } ] },
  effect: { type:"changeValue", target:"self", key:"nextAttackATPlus", op:"add", value:5 },
},
},

{
  id: "B08",
  name: "生目駒 やかな",
  description: "",
  icons: {
    full: "/img/Battler/B08.png",
    neutral: "/img/Battler/icon/B08_1.png",
    start:  "/img/Battler/icon/B08_3.png",
    even:   "/img/Battler/icon/B08_4.png",
    lead:   "/img/Battler/icon/B08_2.png",
    behind: "/img/Battler/icon/B08_5.png",
    win:    "/img/Battler/icon/B08_3.png",
    lose:   "/img/Battler/icon/B08_1.png",
    draw:   "/img/Battler/icon/B08_7.png",
  },
  quotes: {
    battleStart: { text: "「バトっちゃう～？　バトっちゃお～！」", icon: "start" },
    turn: {
      even: { text: "「どうやって攻めよーかなっ」", icon: "even" },
      lead: { text: "「ちょ～いい感じかも～」", icon: "lead" },
      behind: { text: "「やばっ、大ピンチ！」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「ふ～……楽しかったよぉ、ありがとね！」", icon: "win" },
      lose: { text: "「負けちった～。ね、もっかいやらない？」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS08",
    name: "",
    description: "自分アヒルに【４】を追加",
    effect: { type: "addDice", target: "self", values: [4] },
  },
bSkill: {
  id: "BS08",
  name: "",
  description: "フェイズ終了時、自分アヒルに付与されている状態強化の総数×3のHP回復",
  trigger: "phaseEnd",
  when: {
    all: [{ left: "self.hp", op: ">", right: 0 },
      {any: [{ left: "self.status:clean", op: ">", right: 0 },{ left: "self.status:counter", op: ">", right: 0 },{ left: "self.status:tailwind", op: ">", right: 0 },{ left: "self.status:focus", op: ">", right: 0 }]}]},
effect:{type:"heal",target:"self",byStatusCount:{n:3,statuses:["counter","focus","tailwind","clean"]},source:"BS08"}
},
},

{
  id: "B09",
  name: "ペリペティア・ブルースター",
  description: "",
  icons: {
    full: "/img/Battler/B09.png",
    neutral: "/img/Battler/icon/B09_1.png",
    start:  "/img/Battler/icon/B09_1.png",
    even:   "/img/Battler/icon/B09_2.png",
    lead:   "/img/Battler/icon/B09_3.png",
    behind: "/img/Battler/icon/B09_4.png",
    win:    "/img/Battler/icon/B09_2.png",
    lose:   "/img/Battler/icon/B09_5.png",
    draw:   "/img/Battler/icon/B09_7.png",
  },
  quotes: {
    battleStart: { text: "「今回はどんな景色が待ってるのかなっ」", icon: "start" },
    turn: {
      even: { text: "「次はどうしようかな……」", icon: "even" },
      lead: { text: "「大丈夫、流れに乗れてるよっ！」", icon: "lead" },
      behind: { text: "「っ……！負けないっ！」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「少し、パパに近づけたかな」", icon: "win" },
      lose: { text: "「……勝って、あげられなかった」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS09",
    name: "",
    description: "自分アヒルに【３】を追加",
    effect: { type: "addDice", target: "self", values: [3] },
  },
bSkill: {
  id: "BS09",
  name: "",
  description: "自分アヒルが回復した時、次に与える通常ダメージがAT+3",
  trigger: "afterHeal",
  effect: { type:"changeValue", target:"self", key:"nextAttackATPlus", op:"add", value:3 },
},
},

{
  id: "B10",
  name: "リユニオン・ダックワース",
  description: "",
  icons: {
    full: "/img/Battler/B10.png",
    neutral: "/img/Battler/icon/B10_1.png",
    start:  "/img/Battler/icon/B10_2.png",
    even:   "/img/Battler/icon/B10_3.png",
    lead:   "/img/Battler/icon/B10_1.png",
    behind: "/img/Battler/icon/B10_4.png",
    win:    "/img/Battler/icon/B10_2.png",
    lose:   "/img/Battler/icon/B10_5.png",
    draw:   "/img/Battler/icon/B10_7.png",
  },
  quotes: {
    battleStart: { text: "「……いいよ、あそぼうか」", icon: "start" },
    turn: {
      even: { text: "「もっと見せてよ、きみの手札を」", icon: "even" },
      lead: { text: "「もうおしまい？」", icon: "lead" },
      behind: { text: "「……！」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「きみたちの戦い方、まあまあおもしろかったよ」", icon: "win" },
      lose: { text: "「……あーあ、負けちゃった」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS10",
    name: "",
    description: "自分アヒルに【４】を追加",
    effect: { type: "addDice", target: "self", values: [4] },
  },
bSkill: {
  id: "BS10",
  name: "",
  description: "自分アヒルが8以上の通常ダメージを受けた時、集中を1付与",
  trigger: "afterTakeDamage",
  when: { all:[ { left:"attack.kind", op:"==", right:"normalAttack" }, { left:"attack.damage", op:">=", right:8 } ] },
  effect: { type:"changeStatus", target:"self", status:"focus", op:"add", value:1 },
},
},

{
  id: "B11",
  name: "平木 夕真",
  description: "",
  icons: {
    full: "/img/Battler/B11.png",
    neutral: "/img/Battler/icon/B11_1.png",
    start:  "/img/Battler/icon/B11_1.png",
    even:   "/img/Battler/icon/B11_2.png",
    lead:   "/img/Battler/icon/B11_3.png",
    behind: "/img/Battler/icon/B11_5.png",
    win:    "/img/Battler/icon/B11_2.png",
    lose:   "/img/Battler/icon/B11_4.png",
    draw:   "/img/Battler/icon/B11_7.png",
  },
  quotes: {
    battleStart: { text: "「やるからには正々堂々とね」", icon: "start" },
    turn: {
      even: { text: "「ちょっと攻め時じゃないかな……」", icon: "even" },
      lead: { text: "「結構温まってきたかな！」", icon: "lead" },
      behind: { text: "「げっ、気付いたら追い詰められてる！？」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「ユマとして、負けられないからね」", icon: "win" },
      lose: { text: "「負けたぁ……結構本気だったんだけど……」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS11",
    name: "",
    description: "自分アヒルに【２】を追加",
    effect: { type: "addDice", target: "self", values: [2] },
  },
  bSkill: {
  id: "BS11",
  name: "",
  description: "自分アヒルが6以上の通常ダメージを受けた時、次に与える通常ダメージがAT+3",
  trigger: "afterTakeDamage",
  when: { all: [ { left:"attack.kind", op:"==", right:"normalAttack" }, { left:"attack.damage", op:">=", right:6 } ] },
  effect: { type:"changeValue", target:"self", key:"nextAttackATPlus", op:"add", value:3},
},
},

{
  id: "B12",
  name: "黒司 ロクロ",
  description: "",
  icons: {
    full: "/img/Battler/B12.png",
    neutral: "/img/Battler/icon/B12_1.png",
    start:  "/img/Battler/icon/B12_3.png",
    even:   "/img/Battler/icon/B12_1.png",
    lead:   "/img/Battler/icon/B12_4.png",
    behind: "/img/Battler/icon/B12_5.png",
    win:    "/img/Battler/icon/B12_2.png",
    lose:   "/img/Battler/icon/B12_3.png",
    draw:   "/img/Battler/icon/B12_7.png",
  },
  quotes: {
    battleStart: { text: "「……早く位置につけ」", icon: "start" },
    turn: {
      even: { text: "「さて……」", icon: "even" },
      lead: { text: "「その程度か？」", icon: "lead" },
      behind: { text: "「──ッ！隙を見せたか……！」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「これこそが、ダークダックエネルギーの力だ」", icon: "win" },
      lose: { text: "「まだ……キサマの絶望には足りないか」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS12",
    name: "",
    description: "自分アヒルに【４】を追加",
    effect: { type: "addDice", target: "self", values: [4] },
  },
bSkill: {
  id: "BS12",
  name: "",
  description: "自分アヒルが反撃を発動した時、集中を2付与",
  trigger: "afterDamage",
  when: { left: "attack.isCounter", op: "==", right: true },
  effect: {type: "changeStatus",target: "self",status: "focus",op: "add",value: 2}
},
},

{
  id: "B13",
  name: "冥月 サトリ",
  description: "",
  icons: {
    full: "/img/Battler/B13.png",
    neutral: "/img/Battler/icon/B13_1.png",
    start:  "/img/Battler/icon/B13_3.png",
    even:   "/img/Battler/icon/B13_4.png",
    lead:   "/img/Battler/icon/B13_1.png",
    behind: "/img/Battler/icon/B13_5.png",
    win:    "/img/Battler/icon/B13_3.png",
    lose:   "/img/Battler/icon/B13_2.png",
    draw:   "/img/Battler/icon/B13_7.png",
  },
  quotes: {
    battleStart: { text: "「僕にはもう視えている……このバトルの勝敗がね……」", icon: "start" },
    turn: {
      even: { text: "「戦うまでもないというのに……」", icon: "even" },
      lead: { text: "「フフ……全て占いの通りだ……！」", icon: "lead" },
      behind: { text: "「占いが、追い付かない……ッ！？」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「嘆く必要はないよ……全て決まっていた運命なのだから……」", icon: "win" },
      lose: { text: "「運命を……変えられた……？」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS13",
    name: "",
    description: "相手アヒルに【０】を追加",
    effect: { type: "addDice", target: "enemy", values: [0] },
  },
bSkill: {
  id: "BS13",
  name: "",
  description: "自分アヒルのHPが60%以上の時、AT+2・DF+2",
  trigger: "passiveHp", hpCond: { op: ">=", value: 0.6 }, bonus: { AT: 2, DF: 2 },
},
},

{
  id: "B14",
  name: "バイトのマツド",
  description: "",
  icons: {
    full: "/img/Battler/B14.png",
    neutral: "/img/Battler/icon/B14_1.png",
    start:  "/img/Battler/icon/B14_1.png",
    even:   "/img/Battler/icon/B14_2.png",
    lead:   "/img/Battler/icon/B14_3.png",
    behind: "/img/Battler/icon/B14_5.png",
    win:    "/img/Battler/icon/B14_1.png",
    lose:   "/img/Battler/icon/B14_2.png",
    draw:   "/img/Battler/icon/B14_7.png",
  },
  quotes: {
    battleStart: { text: "「では、始めましょう！レギュレーションはアヒルバトル：ダイスです！」", icon: "start" },
    turn: {
      even: { text: "「まずは流れを読みましょうか」", icon: "even" },
      lead: { text: "「アヒルさんと共に私も高まってきましたとも！」", icon: "lead" },
      behind: { text: "「これは少しマズいですねぇ……！」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「良いアヒルさばきでしたよ。次はきっと勝てますとも！」", icon: "win" },
      lose: { text: "「いやぁ、負けてしまいましたか……おめでとうございます」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS14",
    name: "",
    description: "自分アヒルに【３】を追加",
    effect: { type: "addDice", target: "self", values: [3] },
  },
bSkill: {
  id: "BS14",
  name: "",
  description: "ターン最初の攻撃フェイズ開始時、自分アヒルにランダムな状態強化を1付与",
  trigger: "beforeRoll",
  when: { left:"self.cdTurn:BS14_once", op:"==", right:0 },
  effect: [ { type:"changeStatus", target:"self", status:"@buff", op:"add", value:1 }, { type:"changeCooldown", target:"self", scope:"turn", key:"BS14_once", op:"set", value:1, source:"BS14" } ],
},
},

{
  id: "B14-2",
  name: "ガジェットマッド",
  description: "",
  icons: {
    full: "/img/Battler/B14-2.png",
    neutral: "/img/Battler/icon/B14-2_1.png",
    start:  "/img/Battler/icon/B14-2_2.png",
    even:   "/img/Battler/icon/B14-2_4.png",
    lead:   "/img/Battler/icon/B14-2_1.png",
    behind: "/img/Battler/icon/B14-2_5.png",
    win:    "/img/Battler/icon/B14-2_2.png",
    lose:   "/img/Battler/icon/B14-2_3.png",
    draw:   "/img/Battler/icon/B14-2_7.png",
  },
  quotes: {
    battleStart: { text: "「ワタクシがお相手致しましょう！」", icon: "start" },
    turn: {
      even: { text: "「まずは場を動かしましょうかねぇ」", icon: "even" },
      lead: { text: "「おや？　調子が悪そうですねぇ……。」", icon: "lead" },
      behind: { text: "「なっ──押されている！？」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「ワタクシはいつでも、再戦をお待ちしておりますよ！」", icon: "win" },
      lose: { text: "「素晴らしいバトルでしたとも、ええ」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS14-2",
    name: "",
    description: "自分アヒルに【２】を追加",
    effect: { type: "addDice", target: "self", values: [2] },
  },
bSkill: {
  id: "BS14-2",
  name: "",
  description: "ターン最初の攻撃フェイズ開始時、相手アヒルにランダムな状態異常を1付与",
  trigger: "beforeRoll",
  when: { left:"self.cdTurn:BS14-2_once", op:"==", right:0 },
  effect: [ { type:"changeStatus", target:"enemy", status:"@debuff", op:"add", value:1 }, { type:"changeCooldown", target:"self", scope:"turn", key:"BS14-2_once", op:"set", value:1, source:"BS14-2" } ],
},
},

{
  id: "B15",
  name: "カーシェ・ペピネル",
  description: "",
  icons: {
    full: "/img/Battler/B15.png",
    neutral: "/img/Battler/icon/B15_1.png",
    start:  "/img/Battler/icon/B15_1.png",
    even:   "/img/Battler/icon/B15_5.png",
    lead:   "/img/Battler/icon/B15_3.png",
    behind: "/img/Battler/icon/B15_4.png",
    win:    "/img/Battler/icon/B15_2.png",
    lose:   "/img/Battler/icon/B15_5.png",
    draw:   "/img/Battler/icon/B15_7.png",
  },
  quotes: {
    battleStart: { text: "「手合わせ、よろしくお願いいたしますね」", icon: "start" },
    turn: {
      even: { text: "「読み合いは得意なつもりですが……」", icon: "even" },
      lead: { text: "「策が決まっても油断はしませんよ」", icon: "lead" },
      behind: { text: "「いけない、すぐに最善の手を……！」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「今の時代にも、私の技は通用するのですね」", icon: "win" },
      lose: { text: "「……もっと、勘を取り戻さねばなりませんね」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS15",
    name: "",
    description: "自分アヒルに【５】を追加",
    effect: { type: "addDice", target: "self", values: [5] },
  },
bSkill: {
  id: "BS15",
  name: "",
  description: "自分アヒルが6以上の通常ダメージを与えた時、相手の清潔を1解除",
  trigger: "afterDamage",
  when: { all:[ { left:"attack.kind", op:"==", right:"normalAttack" }, { left:"attack.damage", op:">=", right:6 }, { left:"enemy.status:clean", op:">", right:0 } ] },
  effect: { type:"changeStatus", target:"enemy", status:"clean", op:"add", value:-1 },
},
},

{
  id: "B16",
  name: "真ヶ門 アキト",
  description: "",
  icons: {
    full: "/img/Battler/B16.png",
    neutral: "/img/Battler/icon/B16_1.png",
    start:  "/img/Battler/icon/B16_3.png",
    even:   "/img/Battler/icon/B16_2.png",
    lead:   "/img/Battler/icon/B16_1.png",
    behind: "/img/Battler/icon/B16_4.png",
    win:    "/img/Battler/icon/B16_3.png",
    lose:   "/img/Battler/icon/B16_5.png",
    draw:   "/img/Battler/icon/B16_7.png",
  },
  quotes: {
    battleStart: { text: "「たまにはバトルで息抜きもしないとな」", icon: "start" },
    turn: {
      even: { text: "「ここをどう凌ぐかな、っと……」", icon: "even" },
      lead: { text: "「俺はまだ本気出してないぜ？」", icon: "lead" },
      behind: { text: "「まだまだ、ここからが本番だ！」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「へへっ、悪いな。伊達に店長やってないからさ」", icon: "win" },
      lose: { text: "「強いなあ！今度うちの店の大会に出ないか？」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS16",
    name: "",
    description: "自分アヒルに【４】を追加",
    effect: { type: "addDice", target: "self", values: [4] },
  },
bSkill: {
  id: "BS16",
  name: "",
  description: "自分アヒルのHPが40%以下の時、AT+3・DF+1",
  trigger: "passiveHp",
  hpCond: { op: "<=", value: 0.4 },
  bonus: { AT: 3, DF: 1 },
},

},

{
  id: "B17",
  name: "ピエルマルコ・Ｐ・マードック",
  description: "",
  icons: {
    full: "/img/Battler/B17.png",
    neutral: "/img/Battler/icon/B17_1.png",
    start:  "/img/Battler/icon/B17_1.png",
    even:   "/img/Battler/icon/B17_2.png",
    lead:   "/img/Battler/icon/B17_3.png",
    behind: "/img/Battler/icon/B17_4.png",
    win:    "/img/Battler/icon/B17_3.png",
    lose:   "/img/Battler/icon/B17_5.png",
    draw:   "/img/Battler/icon/B17_7.png",
  },
  quotes: {
    battleStart: { text: "「古代アヒル文明継承者の実力、見せてやろう！」", icon: "start" },
    turn: {
      even: { text: "「手加減なんてしないからな！」", icon: "even" },
      lead: { text: "「どうだ！追いつめてやったぞ！」", icon: "lead" },
      behind: { text: "「いやっ……真の強者はここからでも勝てるのだ！」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「ワハハ！当然の結果だな！ひれ伏せーい！」", icon: "win" },
      lose: { text: "「くっそー！父上に言いつけてやる！」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS17",
    name: "",
    description: "自分アヒルに【６】を追加",
    effect: { type: "addDice", target: "self", values: [6] },
  },
bSkill: {
  id: "BS17",
  name: "",
  description: "自分アヒルのAPが1増える毎にAT+1(最大+5)",
  trigger: "passiveAp",
  apBonus: { stat: "AT", bias: 0, min: 0, max: 5 },
},
},

{
  id: "B18",
  name: "オオトリ アサヒ",
  description: "",
  icons: {
    full: "/img/Battler/B18.png",
    neutral: "/img/Battler/icon/B18_1.png",
    start:  "/img/Battler/icon/B18_5.png",
    even:   "/img/Battler/icon/B18_2.png",
    lead:   "/img/Battler/icon/B18_1.png",
    behind: "/img/Battler/icon/B18_5.png",
    win:    "/img/Battler/icon/B18_3.png",
    lose:   "/img/Battler/icon/B18_1.png",
    draw:   "/img/Battler/icon/B18_7.png",
  },
  quotes: {
    battleStart: { text: "「ルール、まだちょっとあやしいんだけど……」", icon: "start" },
    turn: {
      even: { text: "「まだ、ついていけてる……」", icon: "even" },
      lead: { text: "「なるほど……少しわかってきた」", icon: "lead" },
      behind: { text: "「あれ、もしかして負けそう？」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「もしかして手加減してくれた？ ありがとな」", icon: "win" },
      lose: { text: "「そりゃそう……でも楽しかったよ」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS18",
    name: "",
    description: "自分アヒルに【３】を追加",
    effect: { type: "addDice", target: "self", values: [3] },
  },
bSkill: {
  id: "BS18",
  name: "",
  description: "フェイズ開始時、相手アヒルと自分アヒルにランダムな状態変化を1付与",
  trigger: "phaseStart",
  effect: [ { type:"changeStatus", target:"self", status:"@all", op:"add", value:1 }, { type:"changeStatus", target:"enemy", status:"@all", op:"add", value:1 } ],
},

},

{
  id: "B19",
  name: "安倉 ソウハチ",
  description: "",
  icons: {
    full: "/img/Battler/B19.png",
    neutral: "/img/Battler/icon/B19_1.png",
    start:  "/img/Battler/icon/B19_1.png",
    even:   "/img/Battler/icon/B19_4.png",
    lead:   "/img/Battler/icon/B19_1.png",
    behind: "/img/Battler/icon/B19_3.png",
    win:    "/img/Battler/icon/B19_1.png",
    lose:   "/img/Battler/icon/B19_2.png",
    draw:   "/img/Battler/icon/B19_7.png",
  },
  quotes: {
    battleStart: { text: "「お兄さんが相手でいいのかい？」", icon: "start" },
    turn: {
      even: { text: "「今は動くときじゃないねぇ」", icon: "even" },
      lead: { text: "「良いところにかかったかな」", icon: "lead" },
      behind: { text: "「焦りは禁物……」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「勝利の女神が微笑んでくれただけさ」", icon: "win" },
      lose: { text: "「カンには自信があったんだが……しょうがないね」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS19",
    name: "",
    description: "自分アヒルに【１】を追加",
    effect: { type: "addDice", target: "self", values: [1] },
  },
bSkill: {
  id: "BS19",
  name: "",
  description: "自分アヒルが8以上のダメージを受けた時、APを1消費してHP15回復",
  trigger: "afterTakeDamage",
  when: { all:[ { left:"attack.damage", op:">=", right:8 }, { left:"self.ap", op:">=", right:1 } ] },
  effect: [
    { type:"changeValue", target:"self", key:"ap", op:"add", value:-1 },
    { type:"heal", target:"self", amount:15 }
  ],
},
},

{
  id: "B20",
  name: "どたどたハーピー",
  description: "",
  icons: {
    full: "/img/Battler/B20.png",
    neutral: "/img/Battler/icon/B20_1.png",
    start:  "/img/Battler/icon/B20_3.png",
    even:   "/img/Battler/icon/B20_3.png",
    lead:   "/img/Battler/icon/B20_2.png",
    behind: "/img/Battler/icon/B20_3.png",
    win:    "/img/Battler/icon/B20_3.png",
    lose:   "/img/Battler/icon/B00.png",
    draw:   "/img/Battler/icon/B20_7.png",
  },
  quotes: {
    battleStart: { text: "「とり」", icon: "start" },
    turn: {
      even: { text: "「Yeah～」", icon: "even" },
      lead: { text: "「キエーーーー！」", icon: "lead" },
      behind: { text: "「oh～」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「Victory」", icon: "win" },
      lose: { text: "「（走り去っていった）」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS20",
    name: "",
    description: "相手アヒルに【０】を追加",
    effect: { type: "addDice", target: "enemy", values: [0] },
  },
  bSkill: {
  id: "BS20",
  name: "",
  description: "自分アヒルが与える通常ダメージが、ランダムに0〜2倍になる",
  trigger: "afterHit",
  when: { all: [ { left:"attack.kind", op:"==", right:"normalAttack" }, { left:"attack.hit", op:"==", right:true }, { left:"attack.avoided", op:"==", right:false } ] },
  effect: { type:"changeAttack", op:"mulDamage", value:{ randUniform:[0,2] } },
},
},

{
  id: "B21",
  name: "黄鵞 ハトリ",
  description: "",
  icons: {
    full: "/img/Battler/B21.png",
    neutral: "/img/Battler/icon/B21_1.png",
    start:  "/img/Battler/icon/B21_1.png",
    even:   "/img/Battler/icon/B21_2.png",
    lead:   "/img/Battler/icon/B21_1.png",
    behind: "/img/Battler/icon/B21_3.png",
    win:    "/img/Battler/icon/B21_1.png",
    lose:   "/img/Battler/icon/B21_2.png",
    draw:   "/img/Battler/icon/B21_7.png",
  },
  quotes: {
    battleStart: { text: "「いざ、尋常に！全力で参られよ！」", icon: "start" },
    turn: {
      even: { text: "「ふむ、悪くない間合いでござるが──」", icon: "even" },
      lead: { text: "「好機、このまま掴ませてもらう！」", icon: "lead" },
      behind: { text: "「くっ、そう動くか！」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「勝負あり、でござるな。良いバトルであった」", icon: "win" },
      lose: { text: "「お見事……力及ばなんだ、拙者も精進せねばな」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS21",
    name: "",
    description: "自分アヒルに【５】を追加",
    effect: { type: "addDice", target: "self", values: [5] },
  },
bSkill: {
  id: "BS21",
  name: "",
  description: "自分アヒルの通常攻撃時、相手アヒルに状態異常が付与されていればAT+3",
  trigger: "beforeAttack",
  when: { all:[ { left:"attack.kind", op:"==", right:"normalAttack" }, { any:[ { left:"enemy.status:crack", op:">", right:0 }, { left:"enemy.status:steam", op:">", right:0 }, { left:"enemy.status:roughWave", op:">", right:0 }, { left:"enemy.status:Headwind", op:">", right:0 } ] } ] },
  effect: { type:"changeValue", target:"self", key:"nextAttackATPlus", op:"add", value:3 },
},
},

{
  id: "B22",
  name: "化野 露花",
  description: "",
  icons: {
    full: "/img/Battler/B22.png",
    neutral: "/img/Battler/icon/B22_1.png",
    start:  "/img/Battler/icon/B22_3.png",
    even:   "/img/Battler/icon/B22_2.png",
    lead:   "/img/Battler/icon/B22_1.png",
    behind: "/img/Battler/icon/B22_4.png",
    win:    "/img/Battler/icon/B22_3.png",
    lose:   "/img/Battler/icon/B22_1.png",
    draw:   "/img/Battler/icon/B22_7.png",
  },
  quotes: {
    battleStart: { text: "「わあ……楽しみ！」", icon: "start" },
    turn: {
      even: { text: "「えっと、えっと……」", icon: "even" },
      lead: { text: "「私、今すっごく楽しい！」", icon: "lead" },
      behind: { text: "「おわらないで、お願い！」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「やったあ！対戦ありがとう！」", icon: "win" },
      lose: { text: "「負けちゃったけど、楽しかった！」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS22",
    name: "",
    description: "自分アヒルに【６】を追加",
    effect: { type: "addDice", target: "self", values: [6] },
  },
bSkill: {
  id: "BS22",
  name: "",
  description: "自分アヒルが8以上の通常ダメージを受けた時、相手アヒルのAPの数だけ固定ダメージを与える",
  trigger: "afterTakeDamage",
  when: { all:[ { left:"attack.kind", op:"==", right:"normalAttack" }, { left:"attack.damage", op:">=", right:8 } ] },
  effect: { type:"fixedDamage", target:"enemy", amount:{ read:"enemy.ap" }, source:"BS22" },
},
},

{
  id: "B23",
  name: "Ｐ・グウィン",
  description: "",
  icons: {
    full: "/img/Battler/B23.png",
    neutral: "/img/Battler/icon/B23_1.png",
    start:  "/img/Battler/icon/B23_2.png",
    even:   "/img/Battler/icon/B23_1.png",
    lead:   "/img/Battler/icon/B23_3.png",
    behind: "/img/Battler/icon/B23_5.png",
    win:    "/img/Battler/icon/B23_4.png",
    lose:   "/img/Battler/icon/B23_2.png",
    draw:   "/img/Battler/icon/B23_7.png",
  },
  quotes: {
    battleStart: { text: "「クアッ！」", icon: "start" },
    turn: {
      even: { text: "「ク～？」", icon: "even" },
      lead: { text: "「クアーッ！」", icon: "lead" },
      behind: { text: "「グ～……」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「クアッ、クアーッ！」", icon: "win" },
      lose: { text: "「クア～」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS23",
    name: "",
    description: "自分アヒルに【５】を追加",
    effect: { type: "addDice", target: "self", values: [5] },
  },
bSkill: {
  id: "BS23",
  name: "",
  description: "自分アヒルのHPが30%以下の時、通常攻撃回数が+1",
  trigger: "beforeRoll",
  when: { left: "self.hpPct", op: "<=", right: 0.3 },
  effect: { type: "changeValue", target: "self", key: "attackTimesAdd", op: "add", value: 1 },
},
},

{
  id: "B24",
  name: "小日向 まひる",
  description: "",
  icons: {
    full: "/img/Battler/B24.png",
    neutral: "/img/Battler/icon/B24_1.png",
    start:  "/img/Battler/icon/B24_1.png",
    even:   "/img/Battler/icon/B24_3.png",
    lead:   "/img/Battler/icon/B24_2.png",
    behind: "/img/Battler/icon/B24_4.png",
    win:    "/img/Battler/icon/B24_3.png",
    lose:   "/img/Battler/icon/B24_5.png",
    draw:   "/img/Battler/icon/B24_7.png",
  },
  quotes: {
    battleStart: { text: "「アヒルバトルね！がんばるわ！」", icon: "start" },
    turn: {
      even: { text: "「ちからをためるのよ」", icon: "even" },
      lead: { text: "「こんなのよゆーだわ！」", icon: "lead" },
      behind: { text: "「あ、あー！まにあわないわ！」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「やったー！まひるのかちね！」", icon: "win" },
      lose: { text: "「チャージがもうちょっとはやかったら、まひるのかちだったのに！」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS24",
    name: "",
    description: "自分アヒルに【１】を追加",
    effect: { type: "addDice", target: "self", values: [1] },
  },
bSkill: {
  id: "BS24",
  name: "",
  description: "自分アヒルのAPが1増える毎にDF+1(最大+5)",
  trigger: "passiveAp",
  apBonus: { stat: "DF", bias: 0, min: 0, max: 5 },
},
},

{
  id: "B25",
  name: "ボルトボーン",
  description: "",
  icons: {
    full: "/img/Battler/B25.png",
    neutral: "/img/Battler/icon/B25_1.png",
    start:  "/img/Battler/icon/B25_3.png",
    even:   "/img/Battler/icon/B25_1.png",
    lead:   "/img/Battler/icon/B25_1.png",
    behind: "/img/Battler/icon/B25_4.png",
    win:    "/img/Battler/icon/B25_3.png",
    lose:   "/img/Battler/icon/B25_1.png",
    draw:   "/img/Battler/icon/B25_7.png",
  },
  quotes: {
    battleStart: { text: "「よし、私でよければ付き合おう」", icon: "start" },
    turn: {
      even: { text: "「仕掛けるには早いか……？」", icon: "even" },
      lead: { text: "「よく響くな、ここは」", icon: "lead" },
      behind: { text: "「ああっ……まずいな、これは」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「おお……勝てたか、嬉しいものだな」", icon: "win" },
      lose: { text: "「勝てなかったか……うむ、良い経験をありがとう」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS25",
    name: "",
    description: "自分アヒルに【２】を追加",
    effect: { type: "addDice", target: "self", values: [2] },
  },
  bSkill: {
  id: "BS25",
  name: "",
  description: "自分アヒルが受ける通常ダメージが、ランダムに0.5〜1倍になる",
  trigger: "beforeTakeDamage",
  when: { left:"attack.kind", op:"==", right:"normalAttack" },
  effect: { type:"changeAttack", op:"mulDamage", value:{ randUniform:[0.5,1] } },
},

},

{
  id: "B25-2",
  name: "ボルトボーン",
  description: "",
  icons: {
    full: "/img/Battler/B25-2.png",
    neutral: "/img/Battler/icon/B25-2_1.png",
    start:  "/img/Battler/icon/B25-2_3.png",
    even:   "/img/Battler/icon/B25-2_2.png",
    lead:   "/img/Battler/icon/B25-2_3.png",
    behind: "/img/Battler/icon/B25-2_4.png",
    win:    "/img/Battler/icon/B25-2_3.png",
    lose:   "/img/Battler/icon/B25-2_2.png",
    draw:   "/img/Battler/icon/B25-2_7.png",
  },
  quotes: {
    battleStart: { text: "「よし、私でよければ付き合おう」", icon: "start" },
    turn: {
      even: { text: "「仕掛けるには早いか……？」", icon: "even" },
      lead: { text: "「よく響くな、ここは」", icon: "lead" },
      behind: { text: "「ああっ……まずいな、これは」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「おお……勝てたか、嬉しいものだな」", icon: "win" },
      lose: { text: "「勝てなかったか……うむ、良い経験をありがとう」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS25-2",
    name: "",
    description: "自分アヒルに【５】を追加",
    effect: { type: "addDice", target: "self", values: [5] },
  },
  bSkill: {
  id: "BS25-2",
  name: "",
  description: "自分アヒルが受ける通常ダメージが、ランダムに0.5〜1倍になる",
  trigger: "beforeTakeDamage",
  when: { left:"attack.kind", op:"==", right:"normalAttack" },
  effect: { type:"changeAttack", op:"mulDamage", value:{ randUniform:[0.5,1] } },
},

},

{
  id: "B26",
  name: "箱入りケヴィン",
  description: "",
  icons: {
    full: "/img/Battler/B26.png",
    neutral: "/img/Battler/icon/B26_1.png",
    start:  "/img/Battler/icon/B26_2.png",
    even:   "/img/Battler/icon/B26_3.png",
    lead:   "/img/Battler/icon/B26_4.png",
    behind: "/img/Battler/icon/B26_5.png",
    win:    "/img/Battler/icon/B26_4.png",
    lose:   "/img/Battler/icon/B26_3.png",
    draw:   "/img/Battler/icon/B26_7.png",
  },
  quotes: {
    battleStart: { text: "「ぼくが、アヒルバトル？　うまくできるかなぁ……」", icon: "start" },
    turn: {
      even: { text: "「ドキドキするね……！」", icon: "even" },
      lead: { text: "「わっ、いいかんじ！」", icon: "lead" },
      behind: { text: "「ふえっ、ま、まけちゃいそう……」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「すごいすごい！シスターにじまん、しなきゃ！」", icon: "win" },
      lose: { text: "「わぁ……！つよいねぇ！かっこいい！」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS26",
    name: "",
    description: "自分アヒルに【３】を追加",
    effect: { type: "addDice", target: "self", values: [3] },
  },
bSkill: {
  id: "BS26",
  name: "",
  description: "自分アヒルが6以上の通常ダメージを受けた時、自分アヒルのAPの数だけHPを回復（最大10）",
  trigger: "afterTakeDamage",
  when: { all: [ { left:"attack.kind", op:"==", right:"normalAttack" }, { left:"attack.damage", op:">=", right:6 } ] },
  effect: { type:"heal", target:"self", amount:{ read:"self.ap" }, max: 10 },
},
},

{
  id: "B26-2",
  name: "箱入りケヴィン",
  description: "",
  icons: {
    full: "/img/Battler/B26-2.png",
    neutral: "/img/Battler/icon/B26-2_1.png",
    start:  "/img/Battler/icon/B26-2_2.png",
    even:   "/img/Battler/icon/B26-2_1.png",
    lead:   "/img/Battler/icon/B26-2_3.png",
    behind: "/img/Battler/icon/B26-2_5.png",
    win:    "/img/Battler/icon/B26-2_4.png",
    lose:   "/img/Battler/icon/B26-2_3.png",
    draw:   "/img/Battler/icon/B26-2_7.png",
  },
  quotes: {
    battleStart: { text: "「ぼくが、アヒルバトル？　うまくできるかなぁ……」", icon: "start" },
    turn: {
      even: { text: "「ドキドキするね……！」", icon: "even" },
      lead: { text: "「わっ、いいかんじ！」", icon: "lead" },
      behind: { text: "「ふえっ、ま、まけちゃいそう……」", icon: "behind" },
    },
    battleEnd: {
      win: { text: "「すごいすごい！シスターにじまん、しなきゃ！」", icon: "win" },
      lose: { text: "「わぁ……！つよいねぇ！かっこいい！」", icon: "lose" },
      draw: { text: "", icon: "draw" },
    },
  },
  dSkill: {
    id: "DS26-2",
    name: "",
    description: "自分アヒルに【３】を追加",
    effect: { type: "addDice", target: "self", values: [3] },
  },
bSkill: {
  id: "BS26-2",
  name: "",
  description: "自分アヒルが6以上の通常ダメージを受けた時、自分アヒルのAPの数だけHPを回復（最大10）",
  trigger: "afterTakeDamage",
  when: { all: [ { left:"attack.kind", op:"==", right:"normalAttack" }, { left:"attack.damage", op:">=", right:6 } ] },
  effect: { type:"heal", target:"self", amount:{ read:"self.ap" }, max: 10 },
},
},
];

// Ducks（アヒル）
const DUCKS = [

{
id:"D01",
name:"トリップ・オア・デビル",
description:"",
icons:{ icon:"/img/Duck/D01.png"},
stats:{ maxHP:0, AT:3, DF:5, SP:1 },
dice:[3,3,4,5,5,5],
aSkill:{
id:"AS01",
name:"",
description:"出目５が出た時、通常攻撃をキャンセルし相手にランダムな状態異常を2付与＆自分にランダムな状態強化を2付与",
trigger:"onDice= 5",
effect:[{type:"changeValue",target:"self",key:"attackTimesOverride",op:"set",value:0},{type:"changeStatus",target:"enemy",status:"@debuff",op:"add",value:2},{type:"changeStatus",target:"self",status:"@buff",op:"add",value:2}]
},
cSkill:{
  id:"CS01",
  name:"（スキル名）",
  costAP:6,
  description:"自分のＨＰを50回復＆相手にすべての状態異常を２ずつ付与",
  effect:[{ type:"heal", target:"self", amount:50, source:"CS01" },
    { type:"changeStatus", target:"enemy", status:"crack", op:"add", value:2 },{ type:"changeStatus", target:"enemy", status:"steam", op:"add", value:2 },
    { type:"changeStatus", target:"enemy", status:"roughWave", op:"add", value:2 },{ type:"changeStatus", target:"enemy", status:"Headwind", op:"add", value:2 }]
},
},

{
id:"D02",
name:"ナインテイルズ",
description:"",
icons:{ icon:"/img/Duck/D02.png"},
stats:{ maxHP:0, AT:4, DF:2, SP:3 },
dice:[1,1,2,2,2,3],
aSkill:{
id:"AS02",
name:"",
description:"出目２が出た時、通常攻撃回数がさらに+1",
trigger:"onDice=2",
effect:{type:"changeValue",target:"self",key:"attackTimesAdd",op:"add",value:1}
},

cSkill: {
  id: "CS02",
  name: "（スキル名）",
  costAP: 7,
  description: "相手に命中率50％の固定9ダメージを9回",
  effect: [
    {
      type: "fixedDamage",
      target: "enemy",
      amount: 9,
      chance: 0.5,
      repeat: 9,
      source: "CS02"
    }
  ]
},
},

{
id:"D03",
name:"エレクトリック・サンダーバード",
description:"",
icons:{ icon:"/img/Duck/D03.png"},
stats:{ maxHP:0, AT:3, DF:3, SP:3 },
dice:[1,2,2,2,4,4],
aSkill:{
id:"AS03",
name:"",
description:"出目２以下が出た時、相手に亀裂を1付与",
trigger:"onDice<= 2",
effect:{type:"changeStatus",target:"enemy",status:"crack",op:"add",value:1}
},
cSkill:{
  id:"CS03",
  name:"（スキル名）",
  costAP:6,
  description:"相手に命中率80％の固定80ダメージ＆失敗した場合は相手に固定30ダメージ",
  effect:[{ type:"fixedDamage", target:"enemy", amount:70, chance:0.8, source:"CS03", onFail:{ type:"fixedDamage", target:"enemy", amount:30, source:"CS03" } }]
},
},

{
id:"D04",
name:"フォルスマスカレード",
description:"",
icons:{ icon:"/img/Duck/D04.png"},
stats:{ maxHP:0, AT:2, DF:4, SP:3 },
dice:[1,2,4,4,5,5],
aSkill:{
id:"AS04",
name:"",
description:"出目４以上が出た時、相手に逆風を1付与",
trigger:"onDice>=4",
effect:{type:"changeStatus",target:"enemy",status:"Headwind",op:"add",value:1}
},
cSkill:{
  id:"CS04",
  name:"（スキル名）",
  costAP:5,
  description:"相手に固定40ダメージ＆相手に荒波を3付与＆3ターンの間、相手のDF-2",
  effect:[{ type:"fixedDamage", target:"enemy", amount:40, source:"CS04" },{ type:"changeStatus", target:"enemy", status:"roughWave", op:"add", value:3 },{ type:"addBuff", target:"enemy", stat:"DF", amount:-2, turns:3 }]
},
},

{
id:"D05",
name:"エンジェルパール",
description:"",
icons:{ icon:"/img/Duck/D05.png"},
stats:{ maxHP:0, AT:2, DF:5, SP:2 },
dice:[2,3,3,3,4,4],
aSkill:{
id:"AS05",
name:"",
description:"出目３が出た時、通常攻撃をキャンセルして自分のHP10回復＆自分と相手に清潔を1付与",
trigger:"onDice= 3",
effect:[{type:"changeValue",target:"self",key:"attackTimesOverride",op:"set",value:0},{type:"heal",target:"self",amount:10},{type:"changeStatus",target:"self",status:"clean",op:"add",value:1},{type:"changeStatus",target:"enemy",status:"clean",op:"add",value:1}]
},
cSkill:{
  id:"CS05",
  name:"（スキル名）",
  costAP:8,
  description:"自分のHPを70回復＆状態異常をすべて解除",
  effect:[
    { type:"heal", target:"self", amount:70, source:"CS05" },
    { type:"changeStatus", target:"self", status:"crack", op:"set", value:0 },
    { type:"changeStatus", target:"self", status:"roughWave", op:"set", value:0 },
    { type:"changeStatus", target:"self", status:"steam", op:"set", value:0 },
    { type:"changeStatus", target:"self", status:"Headwind", op:"set", value:0 }
  ]
},
},

{
id:"D06",
name:"オリジン・カイザー",
description:"",
icons:{ icon:"/img/Duck/D06.png"},
stats:{ maxHP:0, AT:5, DF:1, SP:3 },
dice:[1,4,4,6,6,6],
aSkill:{
id:"AS06",
name:"",
description:"出目６が出た時、与える通常ダメージがAT+3＋相手の反撃を全て解除",
trigger:"onDice=6",
effect:[{type:"changeValue",target:"self",key:"nextAttackATPlus",op:"add",value:3},{type:"changeStatus",target:"enemy",status:"counter",op:"set",value:0}]
},
cSkill:{
  id:"CS06",
  name:"（スキル名）",
  costAP:6,
  description:"相手に固定60ダメージ＆2ターンの間、自分のAT+2",
  effect:[
    { type:"fixedDamage", target:"enemy", amount:60, source:"CS06" },
    { type:"addBuff", target:"self", stat:"AT", amount:2, turns:2 }
  ]
},
},

{
id:"D07",
name:"チョワヒルくん",
description:"",
icons:{ icon:"/img/Duck/D07.png"},
stats:{ maxHP:0, AT:6, DF:2, SP:1 },
dice:[4,4,5,6,6,6],
aSkill:{
id:"AS07",
name:"",
description:"出目６が出た時、与える通常ダメージがAT+5＆自分に逆風を1付与",
trigger:"onDice= 6",
effect:[{type:"changeValue",target:"self",key:"nextAttackATPlus",op:"add",value:5},{type:"changeStatus",target:"self",status:"Headwind",op:"add",value:1}]
},
cSkill:{
  id:"CS07",
  name:"（スキル名）",
  costAP:8,
  description:"相手に固定80ダメージ＆相手と自分に荒波を3付与",
  effect:[
    { type:"fixedDamage", target:"enemy", amount:80, source:"CS07" },
    { type:"changeStatus", target:"enemy", status:"roughWave", op:"add", value:3 },
    { type:"changeStatus", target:"self", status:"roughWave", op:"add", value:3 }
  ]
},
},


{
id:"D08",
name:"バブル・アクアマリン",
description:"",
icons:{ icon:"/img/Duck/D08.png"},
stats:{ maxHP:0, AT:2, DF:6, SP:1 },
dice:[3,4,4,4,5,5],
aSkill:{
id:"AS08",
name:"",
description:"出目４が出た時、自分に清潔を2付与",
trigger:"onDice= 4",
effect:{type:"changeStatus",target:"self",status:"clean",op:"add",value:2}
},
cSkill:{
  id:"CS08",
  name:"（スキル名）",
  costAP:7,
  description:"相手に固定60ダメージ＆湯気を3付与＆自分に清潔を3付与",
  effect:[{ type:"fixedDamage", target:"enemy", amount:60, source:"CS08" },{ type:"changeStatus", target:"enemy", status:"steam", op:"add", value:3 },{ type:"changeStatus", target:"self", status:"clean", op:"add", value:3 }]
},

},

{
id:"D09",
name:"アクア",
description:"",
icons:{ icon:"/img/Duck/D09.png"},
stats:{ maxHP:0, AT:4, DF:3, SP:2 },
dice:[1,1,1,2,4,4],
aSkill:{
id:"AS09",
name:"",
description:"出目１が出た時、通常攻撃をキャンセルして自分のHP5回復",
trigger:"onDice= 1",
effect:[{type:"changeValue",target:"self",key:"attackTimesOverride",op:"set",value:0},{type:"heal",target:"self",amount:5}]
},
cSkill:{
  id:"CS09",
  name:"（スキル名）",
  costAP:7,
  description:"相手に固定50ダメージ＆自分のHPを20回復",
  effect:[
    { type:"fixedDamage", target:"enemy", amount:50, source:"CS09" },
    { type:"heal", target:"self", amount:20, source:"CS09" }
  ]
},

},

{
id:"D10",
name:"フェニックス＝フォルネウス",
description:"",
icons:{ icon:"/img/Duck/D10.png"},
stats:{ maxHP:0, AT:3, DF:4, SP:2 },
dice:[4,4,4,5,5,6],
aSkill:{
id:"AS10",
name:"",
description:"出目４以下が出た時、通常攻撃をキャンセルして次に与える通常ダメージがAT+5",
trigger:"onDice<= 4",
effect:[{type:"changeValue",target:"self",key:"attackTimesOverride",op:"set",value:0},{type:"changeValue",target:"self",key:"nextAttackATPlus",op:"add",value:5}]
},
cSkill:{
  id:"CS10",
  name:"（スキル名）",
  costAP:5,
  trigger:"beforeTurnEnd",
  description:"敗北時、１度だけHP150で復活＆3ターンの間、自分のAT+3・DF+3",
  effect:[
    { type:"revive", target:"self", hp:150, once:true, flagKey:"revive_once_CS10" },
    { type:"addBuff", target:"self", stat:"AT", amount:3, turns:3, once:true, flagKey:"revive_buff_CS10" },
    { type:"addBuff", target:"self", stat:"DF", amount:3, turns:3, once:true, flagKey:"revive_buff_CS10" }
  ]
},
},

{
id:"D11",
name:"オッカム&テセウス",
description:"",
icons:{ icon:"/img/Duck/D11.png"},
stats:{ maxHP:0, AT:4, DF:3, SP:2 },
dice:[1,2,2,2,4,5],
aSkill:{
id:"AS11",
name:"",
description:"出目２が出た時、通常攻撃の回数-1＆相手に固定6ダメージ",
trigger:"onDice= 2",
effect:[{type:"changeValue",target:"self",key:"attackTimesAdd",op:"add",value:-1},{type:"fixedDamage",target:"enemy",amount:6}]
},
cSkill:{
  id:"CS11",
  name:"（スキル名）",
  costAP:5,
  description:"どちらかの効果が発動する：①相手に固定60ダメージ ②相手に固定40ダメージ＆自分に反撃を3付与",
  effect:[{ type:"randomPick", picks:[{ type:"fixedDamage", target:"enemy", amount:60, source:"CS11" },
         [{ type:"fixedDamage", target:"enemy", amount:40, source:"CS11" },{ type:"changeStatus", target:"self", status:"counter", op:"add", value:3 }]]}]
},
},

{
id:"D12",
name:"ギアス・ロギア",
description:"",
icons:{ icon:"/img/Duck/D12.png"},
stats:{ maxHP:0, AT:6, DF:2, SP:1 },
dice:[4,4,5,5,5,6],
aSkill:{
id:"AS12",
name:"",
description:"出目４が出た時、相手に湯気を2付与",
trigger:"onDice= 4",
effect:{type:"changeStatus",target:"enemy",status:"steam",op:"add",value:2}
},
cSkill:{
  id:"CS12",
  name:"（スキル名）",
  costAP:7,
  description:"相手に固定60ダメージ＆相手に亀裂を3付与＆4ターンの間、自分のAT+2",
  effect:[{ type:"fixedDamage", target:"enemy", amount:60, source:"CS12" },{ type:"changeStatus", target:"enemy", status:"crack", op:"add", value:3 },{ type:"addBuff", target:"self", stat:"AT", amount:2, turns:4 }]
},
},

{
id:"D13",
name:"Ｄ・クォーツ",
description:"",
icons:{ icon:"/img/Duck/D13.png"},
stats:{ maxHP:0, AT:3, DF:5, SP:1 },
dice:[3,3,4,5,5,5],
aSkill:{
id:"AS13",
name:"",
description:"出目５が出た時、相手のAPをさらに-1",
trigger:"onDice=5",
effect:{type:"changeValue",target:"enemy",key:"ap",op:"add",value:-1}
},

cSkill:{
  id:"CS13",
  name:"（スキル名）",
  costAP:7,
  description:"相手に固定60ダメージ＆4ターンの間、相手のAT-1・DF-2",
  effect:[
    { type:"fixedDamage", target:"enemy", amount:60, source:"CS13" },
    { type:"addBuff", target:"enemy", stat:"AT", amount:-1, turns:4 },
    { type:"addBuff", target:"enemy", stat:"DF", amount:-2, turns:4 }
  ]
},
},

{
id:"D14",
name:"マッドダック",
description:"",
icons:{ icon:"/img/Duck/D14.png"},
stats:{ maxHP:0, AT:2, DF:4, SP:3 },
dice:[1,2,2,5,5,5],
aSkill:{
id:"AS14",
name:"",
description:"出目２以下が出た時、相手が次に与える通常ダメージがAT-2",
trigger:"onDice<= 2",
effect:{type:"changeValue",target:"enemy",key:"nextAttackATPlus",op:"add",value:-2}
},
cSkill:{
  id:"CS14",
  name:"（スキル名）",
  costAP:7,
  description:"相手に固定60ダメージ＆自分に追風を3付与",
  effect:[{ type:"fixedDamage", target:"enemy", amount:60, source:"CS14" },{ type:"changeStatus", target:"self", status:"tailwind", op:"add", value:3 }]
},
},

{
id:"D15",
name:"イピン・シュショットマン",
description:"",
icons:{ icon:"/img/Duck/D15.png"},
stats:{ maxHP:0, AT:3, DF:3, SP:3 },
dice:[1,4,4,4,5,5],
aSkill:{
id:"AS15",
name:"",
description:"出目４が出た時、この攻撃フェイズ中相手のDF-2",
trigger:"onDice= 4",
effect:{type:"changeValue",target:"enemy",key:"tempDfPlus",op:"add",value:-2}
},
cSkill:{
  id:"CS15",
  name:"（スキル名）",
  costAP:6,
  description:"相手にそれぞれ75％の確率で全ての状態異常を3ずつ付与＆相手に付与されている状態異常の総数×5の固定ダメージ",
  effect:[
    { type:"changeStatus", target:"enemy", status:"crack", op:"add", value:3, chance:0.75 },
    { type:"changeStatus", target:"enemy", status:"roughWave", op:"add", value:3, chance:0.75 },
    { type:"changeStatus", target:"enemy", status:"Headwind", op:"add", value:3, chance:0.75 },
    { type:"changeStatus", target:"enemy", status:"steam", op:"add", value:3, chance:0.75 },
    { type:"fixedDamage", target:"enemy", byStatusCount:{ n:5, statuses:["crack","roughWave","Headwind","steam"] }, source:"CS15" }
  ]
},
},

{
id:"D16",
name:"ピーコック・グリーン",
description:"",
icons:{ icon:"/img/Duck/D16.png"},
stats:{ maxHP:0, AT:3, DF:4, SP:2 },
dice:[1,1,2,2,4,4],
aSkill:{
id:"AS16",
name:"",
description:"出目４が出た時、反撃をさらに1付与",
trigger:"onDice= 4",
effect:{type:"changeStatus",target:"self",status:"counter",op:"add",value:1}
},
cSkill:{
  id:"CS16",
  name:"（スキル名）",
  costAP:5,
  description:"相手に固定10ダメージ（5ターン毎に与えるダメージが10増える）＆2ターンの間、自分のDF+2",
  effect:[
    { type:"fixedDamage", target:"enemy", amount:10, turnStep:{ every:5, add:10 }, source:"CS16" },{ type:"addBuff", target:"self", stat:"DF", amount:2, turns:2, source:"CS16" }]
},
},

{
id:"D17",
name:"テンペスト・マーダック",
description:"",
icons:{ icon:"/img/Duck/D17.png"},
stats:{ maxHP:0, AT:5, DF:2, SP:2 },
dice:[4,4,4,5,5,6],
aSkill:{
id:"AS17",
name:"",
description:"出目５が出た時、相手に逆風と荒波を１付与",
trigger:"onDice= 5",
effect:[{type:"changeStatus",target:"enemy",status:"Headwind",op:"add",value:1},{type:"changeStatus",target:"enemy",status:"roughWave",op:"add",value:1}]
},
cSkill:{
  id:"CS17",
  name:"（スキル名）",
  costAP:7,
  description:"相手に固定60ダメージ＆相手に荒波・逆風を3ずつ付与＆自分に荒波・逆風を1ずつ付与",
  effect:[{ type:"fixedDamage", target:"enemy", amount:60, source:"CS17" },{ type:"changeStatus", target:"enemy", status:"roughWave", op:"add", value:3 },{ type:"changeStatus", target:"enemy", status:"Headwind", op:"add", value:3 },{ type:"changeStatus", target:"self", status:"roughWave", op:"add", value:1 },{ type:"changeStatus", target:"self", status:"Headwind", op:"add", value:1 }]
},
},

{
id:"D18",
name:"ソレイユ・ルヴァン",
description:"",
icons:{ icon:"/img/Duck/D18.png"},
stats:{ maxHP:0, AT:3, DF:4, SP:2 },
dice:[3,3,3,4,5,5],
aSkill:{
id:"AS18",
name:"",
description:"出目３が出た時、相手に逆風を2付与",
trigger:"onDice= 3",
effect:{type:"changeStatus",target:"enemy",status:"Headwind",op:"add",value:2}
},
cSkill:{
  id:"CS18",
  name:"（スキル名）",
  costAP:6,
  description:"いずれかの効果が発動する：①相手に固定60ダメージ ②自分のHPを50回復＆清潔を３付与 ③4ターンの間、相手のDF-3＆自分のAT+3",
effect:[{ type:"randomPick", picks:[
  { type:"fixedDamage", target:"enemy", amount:60, source:"CS18" },
  [{ type:"heal", target:"self", amount:50, source:"CS18" },
    { type:"changeStatus", target:"self", status:"clean", op:"add", value:3 }],
  [{ type:"addBuff", target:"enemy", stat:"DF", amount:-3, turns:4 },
    { type:"addBuff", target:"self", stat:"AT", amount:3, turns:4 }]]}]
},
},

{
id:"D19",
name:"アグロアングラー",
description:"",
icons:{ icon:"/img/Duck/D19.png"},
stats:{ maxHP:0, AT:3, DF:5, SP:1 },
dice:[1,1,3,3,4,4],
aSkill:{
id:"AS19",
name:"",
description:"出目３以下が出た時、通常攻撃をキャンセルしてAP+2",
trigger:"onDice<= 3",
effect:[{type:"changeValue",target:"self",key:"attackTimesOverride",op:"set",value:0},{type:"changeValue",target:"self",key:"ap",op:"add",value:2}]
},
cSkill:{
  id:"CS19",
  name:"（スキル名）",
  costAP:15,
  description:"相手に相手HPの50％割合固定ダメージ",
  effect:[
    { type:"fixedDamage", target:"enemy", amountPct:0.50, source:"CS19" }
  ]
},
},

//D20は欠番

{
id:"D21",
name:"水影丸",
description:"",
icons:{ icon:"/img/Duck/D21.png"},
stats:{ maxHP:0, AT:4, DF:2, SP:3 },
dice:[1,2,3,4,5,6],
aSkill:{
id:"AS21",
name:"",
description:"全ての出目で、50％の確率で相手にランダムな状態異常を2付与",
trigger:"onDice>= 0",
effect:{type:"changeStatus",target:"enemy",status:"@debuff",op:"add",value:2,chance:0.5}
},
cSkill:{
  id:"CS21",
  name:"（スキル名）",
  costAP:5,
  description:"相手に固定40ダメージ＆相手にランダムな状態異常を3付与＆自分にランダムな状態強化を3付与",
  effect:[
    { type:"fixedDamage", target:"enemy", amount:40, source:"CS21" },
    { type:"changeStatus", target:"enemy", status:"@debuff", op:"add", value:3 },
    { type:"changeStatus", target:"self", status:"@buff", op:"add", value:3 }
  ]
},
},

{
id:"D22",
name:"アヒルのきーちゃん",
description:"",
icons:{ icon:"/img/Duck/D22.png"},
stats:{ maxHP:0, AT:3, DF:5, SP:1 },
dice:[3,4,4,6,6,6],
aSkill:{
id:"AS22",
name:"",
description:"出目６が出た時、反動ダメージを0にする",
trigger:"onDice=6",
effect:{type:"changeValue",target:"self",key:"recoilMinus",op:"add",value:3}
},
cSkill:{
  id:"CS22",
  name:"（スキル名）",
  costAP:5,
  trigger:"beforeTurnEnd",
  description:"敗北時、1度だけHP200で復活＆5ターンの間、自分のDF+2",
  effect:[
    { type:"revive", target:"self", hp:200, once:true, flagKey:"revive_once_CS22" },
    { type:"addBuff", target:"self", stat:"DF", amount:2, turns:5, once:true, flagKey:"revive_buff_CS22" }
  ]
},
},

{
id:"D23",
name:"Ａ・ペンペラー",
description:"",
icons:{ icon:"/img/Duck/D23.png"},
stats:{ maxHP:0, AT:5, DF:3, SP:1 },
dice:[1,3,4,4,5,5],
aSkill:{
id:"AS23",
name:"",
description:"出目５が出た時、自分に追風を1付与",
trigger:"onDice=5",
effect:{type:"changeStatus",target:"self",status:"tailwind",op:"add",value:1}
},
cSkill:{
  id:"CS23",
  name:"（スキル名）",
  costAP:6,
  description:"自分HPが50%以上なら相手に固定70ダメージ＆自分HPが49%以下ならHP50回復",
  effect:[{ type:"fixedDamage", target:"enemy", amount:60, source:"CS23", when:{ left:"self.hpPct", op:">=", right:0.5 } },{ type:"heal", target:"self", amount:50, source:"CS23", when:{ left:"self.hpPct", op:"<=", right:0.49 } }]
},
},

{
id:"D24",
name:"アヒルちゃんＪＳ",
description:"",
icons:{ icon:"/img/Duck/D24.png"},
stats:{ maxHP:0, AT:4, DF:2, SP:3 },
dice:[1,1,1,2,3,3],
aSkill:{
id:"AS24",
name:"",
description:"出目１が出た時、さらにAP+1",
trigger:"onDice=1",
effect:{type:"changeValue",target:"self",key:"ap",op:"add",value:1}
},
cSkill:{
  id:"CS24",
  name:"（スキル名）",
  costAP:10,
  description:"相手に相手HPの20・30%・40％いずれかの割合ダメージ",
  effect:[{ type:"randomPick", picks:[{ type:"fixedDamage", target:"enemy", amountPct:0.2, source:"CS24" },{ type:"fixedDamage", target:"enemy", amountPct:0.3, source:"CS24" },{ type:"fixedDamage", target:"enemy", amountPct:0.4, source:"CS24" }]}]
},
},

{
id:"D25",
name:"エコーゴースト",
description:"",
icons:{ icon:"/img/Duck/D25.png"},
stats:{ maxHP:0, AT:3, DF:4, SP:2 },
dice:[1,4,4,4,5,5],
aSkill:{
id:"AS25",
name:"",
description:"出目５が出た時、与える通常ダメージが0.5倍になるが攻撃回数+2",
trigger:"onDice= 5",
effect:[{type:"changeAttack",op:"mulDamage",value:0.5},{type:"changeValue",target:"self",key:"attackTimesAdd",op:"add",value:2}]
},
cSkill:{
  id:"CS25",
  name:"（スキル名）",
  costAP:6,
  description:"相手に固定40ダメージ（10ターン毎に与える固定ダメージが10増える）＆4ターンの間、相手のDF-2",
  effect:[
    { type:"fixedDamage", target:"enemy", amount:40, turnStep:{ every:10, add:10 }, source:"CS25" },
    { type:"addBuff", target:"enemy", stat:"DF", amount:-2, turns:4 }
  ]
},
},

{
id:"D26",
name:"シスター・ダックメア",
description:"",
icons:{ icon:"/img/Duck/D26.png"},
stats:{ maxHP:0, AT:4, DF:4, SP:1 },
dice:[0,0,0,0,0,0],
aSkill:{
id:"AS26",
name:"",
description:"全ての出目で、通常攻撃をキャンセルして相手に荒波・逆風・湯気を2ずつ付与",
trigger:"onDice>= 0",
effect:[{type:"changeValue",target:"self",key:"attackTimesOverride",op:"set",value:0},{type:"changeStatus",target:"enemy",status:"roughWave",op:"add",value:2},{type:"changeStatus",target:"enemy",status:"Headwind",op:"add",value:2},{type:"changeStatus",target:"enemy",status:"steam",op:"add",value:2}]
},
cSkill:{
  id:"CS26",
  name:"（スキル名）",
  costAP:20,
  description:"相手に相手HPの100％割合固定ダメージ",
  effect:[
    { type:"fixedDamage", target:"enemy", amountPct:1.0, source:"CS26" }
  ]
},
},

];


export { BATTLERS, DUCKS };
