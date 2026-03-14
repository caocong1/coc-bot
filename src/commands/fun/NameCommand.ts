/**
 * 随机姓名生成：.name (cn/jp/en) ([数量])
 *
 * 示例：
 *   .name          随机中文名
 *   .name cn 5     5个中文名
 *   .name en       1个英文名
 *   .name jp 3     3个日文名
 */

import type { CommandHandler, CommandContext, CommandResult } from '../CommandRegistry';
import type { ParsedCommand } from '../CommandParser';

// ── 中文名 ────────────────────────────────────────────────────────────────────

const CN_SURNAMES = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于傅皮卞齐康伍余元卜顾孟平黄和穆萧尹'.split('');
const CN_GIVEN_POOL = '伟芳娜敏静秀娟英华慧巧美淑惠珠翠雅芝玉萍红娥玲芬燕彩春菊兰凤洁梅琳素云莲真雪荣爱霞香月媛艳凡佳嘉琼勤珍莉桂晶妍茜秋珊莎锦青倩婷婉瑾颖露瑶怡婵雁蓓仪荷丹蓉眉琴蕊薇菁梦岚苑婕馨琰韵融艺咏卿聪澜纯毓悦昭冰爽琬茗羽希宁欣斌磊强军平东文辉力明永健世广志义兴良海山仁波宁贵福生龙元全国胜学祥才发武新利清飞彪富顺信子杰涛昌成康星光天达安岩中茂进林有坚和博诚先敬震振壮会豪心邦承乐绍功松善厚庆民友裕河哲江超浩亮政谦奇固翰朗伯宏言若鸣朋梁栋维启克翔旭鹏泽晨士以建家致树炎德行时泰盛雄琛钧冠策腾楠榕风航弘轩宇涵睿浩然天佑博'.split('');
const CN_GIVEN_CHARS_2 = '子轩宇涵睿嘉浩然佑文博雪梅婉清思远语嫣晓雯若曦梦琪心怡'.split('');

// ── 日文名 ────────────────────────────────────────────────────────────────────

const JP_SURNAMES = ['佐藤','鈴木','高橋','田中','渡辺','伊藤','山本','中村','小林','加藤','吉田','山田','佐々木','山口','松本','井上','木村','清水','斎藤','林','山下','西山','小川','近藤','藤田','中島','岡田','村上','阿部','長谷川','坂本','石川','遠藤','青木','柴田','池田','橋本','中野','浜田','今井','桑原','宮崎','松田','菊地','三浦','安田','太田','石田','杉山','菅原'];
const JP_GIVEN_M = ['蓮','湊','陽翔','樹','悠斗','大翔','朝陽','翼','晴','颯','陸','翔','雄大','直樹','健一','誠','拓也','大輔','翔太','慎二'];
const JP_GIVEN_F = ['咲','葵','凛','桜','美咲','陽菜','結衣','愛','七海','心春','奈々','優花','あおい','さくら','つばき','ゆき','るい','まな','ことね','ひより'];

// ── 英文名 ────────────────────────────────────────────────────────────────────

const EN_GIVEN_M = ['Arthur','Edwin','Harold','Walter','Frank','George','Henry','Albert','Ernest','Herbert','Leonard','Frederick','Ralph','Raymond','Clarence','Roy','Carl','Howard','Oscar','Stanley','Victor','Wilbur','Norman','Cecil','Reginald','Clifford','Everett','Lloyd','Elmer','James','Robert','John','William','Charles','Thomas','Daniel'];
const EN_GIVEN_F = ['Dorothy','Helen','Margaret','Ruth','Mildred','Anna','Elizabeth','Frances','Marie','Alice','Florence','Ethel','Grace','Lillian','Edna','Emma','Rose','Bessie','Hazel','Pearl','Bertha','Gladys','Alma','Ida','Martha','Irene','Mabel','Louise','Gertrude','Nora','Mary','Patricia','Barbara','Susan','Jessica'];
const EN_SURNAMES = ['Smith','Johnson','Williams','Jones','Brown','Davis','Miller','Wilson','Moore','Taylor','Anderson','Thomas','Jackson','White','Harris','Martin','Thompson','Garcia','Martinez','Robinson','Clark','Lewis','Lee','Walker','Hall','Allen','Young','Nelson','Carter','Mitchell','Roberts','Turner','Phillips','Campbell','Parker','Evans','Edwards','Collins','Stewart','Morris','Rogers','Reed','Cook','Morgan','Bell','Murphy','Bailey','Rivera'];

// ── 工具 ─────────────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomChinese(): string {
  const surname = pick(CN_SURNAMES);
  const double = Math.random() < 0.6;
  const given = double
    ? pick(CN_GIVEN_POOL) + pick(CN_GIVEN_CHARS_2)
    : pick(CN_GIVEN_POOL);
  return surname + given;
}

function randomJapanese(): string {
  const surname = pick(JP_SURNAMES);
  const female = Math.random() < 0.5;
  const given = pick(female ? JP_GIVEN_F : JP_GIVEN_M);
  return `${surname} ${given}`;
}

function randomEnglish(): string {
  const female = Math.random() < 0.5;
  const given = pick(female ? EN_GIVEN_F : EN_GIVEN_M);
  return `${given} ${pick(EN_SURNAMES)}`;
}

// ── 命令 ─────────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = { cn: '中文', jp: '日文', en: '英文' };

export class NameCommand implements CommandHandler {
  name = 'name';
  aliases = [];
  description = '随机姓名：.name (cn/jp/en) ([数量，最多10])';

  async handle(_ctx: CommandContext, cmd: ParsedCommand): Promise<CommandResult> {
    const args = cmd.args.filter(Boolean).map((a) => a.toLowerCase());

    let type = 'cn';
    let count = 1;

    for (const a of args) {
      if (['cn', 'jp', 'en'].includes(a)) {
        type = a;
      } else {
        const n = parseInt(a);
        if (!isNaN(n)) count = Math.min(Math.max(n, 1), 10);
      }
    }

    const gen = type === 'jp' ? randomJapanese : type === 'en' ? randomEnglish : randomChinese;
    const names = Array.from({ length: count }, gen);

    const label = TYPE_LABELS[type];
    return {
      text: count === 1
        ? `🎲 随机${label}姓名：${names[0]}`
        : `🎲 随机${label}姓名 ×${count}：\n${names.join('\n')}`,
    };
  }
}
