/**
 * CoC7 第七版职业列表
 *
 * 数据来源：[调查员手册]克苏鲁的呼唤第七版调查员手册
 * 涵盖经典（1920年代）和现代两个时代的职业。
 *
 * formula: 职业技能点计算公式
 * coreSkills: 本职技能（用于在技能表中标 ★）
 * creditRange: 信用评级范围
 * era: 'classic'=1920s专用, 'modern'=现代专用, 'any'=两者均可
 */

export interface OccupationDef {
  id: number;
  name: string;
  formula: string;
  creditRange: string;
  coreSkills: string[];
  description: string;
  era?: 'classic' | 'modern' | 'any';
}

export const OCCUPATIONS: OccupationDef[] = [
  // ─── A ───────────────────────────────────────────────────────────────────
  {
    id: 1, name: '会计师', formula: 'EDU*4', creditRange: '30-70',
    description: '审查财务记录，侦测欺诈，常受雇于企业或政府机构。',
    coreSkills: ['会计', '法律', '图书馆使用', '说服', '侦查', '聆听', '心理学'],
  },
  {
    id: 2, name: '杂技演员', formula: 'EDU*2+DEX*2', creditRange: '9-20',
    description: '受过专业训练的马戏或舞台杂技表演者，身手敏捷。',
    coreSkills: ['攀爬', '闪避', '跳跃', '聆听', '心理学', '侦查', '投掷', '格斗：斗殴'],
  },
  {
    id: 3, name: '演员', formula: 'EDU*2+APP*2', creditRange: '9-90',
    description: '舞台或银幕上的表演艺术家，擅长扮演角色与感染观众。',
    coreSkills: ['技艺①', '乔装', '历史', '心理学', '话术', '魅惑', '聆听'],
  },
  {
    id: 4, name: '人类学家', formula: 'EDU*4', creditRange: '10-40',
    description: '研究人类文化与社会的学者，常深入原始部落进行田野调查。',
    coreSkills: ['人类学', '考古学', '图书馆使用', '历史', '外语①', '母语', '聆听', '说服'],
  },
  {
    id: 5, name: '古董商', formula: 'EDU*4', creditRange: '30-50',
    description: '鉴别与买卖古董艺术品，熟知历史与市场行情。',
    coreSkills: ['会计', '技艺①', '历史', '图书馆使用', '估价', '说服', '侦查'],
  },
  {
    id: 6, name: '考古学家', formula: 'EDU*4', creditRange: '10-40',
    description: '发掘古代遗址，破译远古文字，追寻失落的文明。',
    coreSkills: ['考古学', '历史', '图书馆使用', '博物学', '外语①', '侦查', '估价'],
  },
  {
    id: 7, name: '建筑师', formula: 'EDU*4', creditRange: '30-70',
    description: '设计建筑物与工程结构，熟悉建筑法规与材料力学。',
    coreSkills: ['技艺①', '图书馆使用', '博物学', '说服', '侦查', '机械维修', '历史'],
  },
  {
    id: 8, name: '艺术家', formula: 'EDU*2+MAX(DEX*2,POW*2)', creditRange: '9-50',
    description: '以创作为生，拥有独特的感知与表达能力，涵盖画家、雕塑家等。',
    coreSkills: ['技艺①', '技艺②', '历史', '神秘学', '心理学', '侦查', '聆听'],
  },
  {
    id: 9, name: '精神病院看护', formula: 'EDU*2+MAX(STR*2,DEX*2)', creditRange: '8-20',
    description: '在精神病院照料患者，日常接触各类精神疾患，能有效约束危险行为。',
    coreSkills: ['急救', '聆听', '医学', '恐吓', '心理学', '说服', '格斗：斗殴'],
  },
  {
    id: 10, name: '运动员', formula: 'EDU*2+MAX(STR*2,DEX*2)', creditRange: '9-70',
    description: '职业竞技运动员，体格强健，反应敏捷，精于特定运动项目。',
    coreSkills: ['攀爬', '跳跃', '格斗：斗殴', '骑术', '射击①', '游泳', '投掷'],
  },
  {
    id: 11, name: '作家', formula: 'EDU*4', creditRange: '9-30',
    description: '以写作为职业的人，著有小说、非虚构作品或新闻报道。',
    coreSkills: ['技艺①', '历史', '图书馆使用', '神秘学', '心理学', '母语', '说服'],
  },

  // ─── B ───────────────────────────────────────────────────────────────────
  {
    id: 20, name: '酒保/招待', formula: 'EDU*2+APP*2', creditRange: '8-25',
    description: '在酒吧或餐厅工作，见闻广博，善于察言观色。',
    coreSkills: ['会计', '话术', '格斗：斗殴', '图书馆使用', '聆听', '心理学', '侦查'],
  },
  {
    id: 21, name: '猎人（大型猎物）', formula: 'EDU*2+MAX(STR*2,DEX*2)', creditRange: '20-50',
    description: '深入荒野追踪危险猎物，擅长荒野生存与远程射击。',
    era: 'classic',
    coreSkills: ['格斗：斗殴', '急救', '聆听', '博物学', '领航', '射击①', '生存', '追踪'],
  },
  {
    id: 22, name: '书商', formula: 'EDU*4', creditRange: '20-40',
    description: '经营书店，广泛涉猎各类文献，对珍本古籍有鉴别能力。',
    coreSkills: ['会计', '历史', '图书馆使用', '神秘学', '说服', '侦查', '外语①'],
  },
  {
    id: 23, name: '赏金猎人', formula: 'EDU*2+MAX(STR*2,DEX*2)', creditRange: '9-30',
    description: '追捕逃犯或逃债者，依法或在法律灰色地带行事。',
    coreSkills: ['格斗：斗殴', '乔装', '话术', '恐吓', '法律', '心理学', '侦查', '追踪'],
  },
  {
    id: 24, name: '拳击手/摔跤手', formula: 'EDU*2+STR*2', creditRange: '9-60',
    description: '职业格斗运动员，以体力和战斗技术为生。',
    coreSkills: ['格斗：斗殴', '跳跃', '心理学', '恐吓', '侦查', '聆听', '急救'],
  },
  {
    id: 25, name: '管家/男仆', formula: 'EDU*4', creditRange: '9-40',
    description: '服务于上流家庭，总揽家务，熟知礼仪规范与主人的一切秘密。',
    coreSkills: ['会计', '急救', '聆听', '心理学', '侦查', '估价', '母语', '说服'],
  },

  // ─── C ───────────────────────────────────────────────────────────────────
  {
    id: 30, name: '神职人员', formula: 'EDU*4', creditRange: '9-60',
    description: '宗教权威，给予精神慰藉与信仰指引，掌管仪式与教众。',
    coreSkills: ['会计', '历史', '图书馆使用', '聆听', '神秘学', '说服', '心理学'],
  },
  {
    id: 31, name: '计算机程序员/黑客', formula: 'EDU*4', creditRange: '10-70',
    description: '精通计算机系统与网络，能入侵或开发复杂软件。',
    era: 'modern',
    coreSkills: ['会计', '计算机使用', '电气维修', '电子学', '图书馆使用', '侦查', '说服'],
  },
  {
    id: 32, name: '牛仔/牧人', formula: 'EDU*2+MAX(STR*2,DEX*2)', creditRange: '9-20',
    description: '在牧场或草原工作，驾驭牲畜，熟悉荒野生存。',
    coreSkills: ['格斗：斗殴', '急救', '骑术', '驯兽', '射击①', '生存', '追踪', '汽车驾驶'],
  },
  {
    id: 33, name: '工匠/手艺人', formula: 'EDU*2+DEX*2', creditRange: '10-40',
    description: '以手工技艺为生，制作或修缮特定物品，精于一行。',
    coreSkills: ['技艺①', '技艺②', '估价', '机械维修', '聆听', '说服', '侦查'],
  },

  // ─── Criminal subtypes ────────────────────────────────────────────────────
  {
    id: 40, name: '罪犯·刺客', formula: 'EDU*2+MAX(STR*2,DEX*2)', creditRange: '30-60',
    description: '职业杀手，以暗杀为酬劳，精通伪装、追踪与近战格斗。',
    coreSkills: ['格斗：斗殴', '射击①', '乔装', '侦查', '潜行', '追踪', '心理学', '聆听'],
  },
  {
    id: 41, name: '罪犯·走私者', formula: 'EDU*2+MAX(APP*2,DEX*2)', creditRange: '20-60',
    description: '非法运输禁忌货物，精通伪装与欺骗，人脉广泛。',
    coreSkills: ['汽车驾驶', '乔装', '话术', '聆听', '领航', '说服', '侦查'],
  },
  {
    id: 42, name: '罪犯·窃贼', formula: 'EDU*2+DEX*2', creditRange: '5-40',
    description: '以盗窃为生，精通渗透、开锁与快速撤退。',
    coreSkills: ['攀爬', '汽车驾驶', '电气维修', '话术', '锁匠', '聆听', '侦查', '妙手', '潜行'],
  },
  {
    id: 43, name: '罪犯·欺诈师', formula: 'EDU*2+APP*2', creditRange: '10-65',
    description: '靠谎言与骗局谋生，擅长扮演虚假身份，行骗于各类人群。',
    coreSkills: ['会计', '乔装', '话术', '图书馆使用', '心理学', '说服', '侦查'],
  },
  {
    id: 44, name: '罪犯·打手/暴徒', formula: 'EDU*2+STR*2', creditRange: '5-30',
    description: '依靠暴力和恐吓讨生活，可能受雇于黑帮或独立行事。',
    coreSkills: ['格斗：斗殴', '射击：手枪', '汽车驾驶', '恐吓', '聆听', '心理学', '侦查'],
  },
  {
    id: 45, name: '罪犯·赝品制造者', formula: 'EDU*4', creditRange: '20-60',
    description: '伪造货币、文件或艺术品，需要高超的技艺和广博的知识。',
    coreSkills: ['技艺①', '技艺②', '历史', '图书馆使用', '侦查', '母语', '外语①'],
  },

  // ─── D ───────────────────────────────────────────────────────────────────
  {
    id: 50, name: '教团首领', formula: 'EDU*4', creditRange: '30-60',
    description: '宗教或神秘团体的领袖，以精神权威控制信众。',
    coreSkills: ['历史', '聆听', '神秘学', '心理学', '说服', '话术', '魅惑'],
  },
  {
    id: 51, name: '设计师', formula: 'EDU*4', creditRange: '20-60',
    description: '从事视觉、工业或时装设计，将美学与功能性结合。',
    coreSkills: ['技艺①', '技艺②', '历史', '图书馆使用', '说服', '心理学', '侦查'],
  },
  {
    id: 52, name: '业余爱好者（富家子）', formula: 'EDU*2+APP*2', creditRange: '50-99',
    description: '富有的社会名流，游遍世界，以好奇心涉足各类领域，无固定职业。',
    era: 'classic',
    coreSkills: ['技艺①', '骑术', '历史', '图书馆使用', '聆听', '外语①', '说服', '技艺②'],
  },
  {
    id: 53, name: '潜水员', formula: 'EDU*2+DEX*2', creditRange: '9-30',
    description: '精通水下作业，无论是为了打捞、科研还是军事任务。',
    coreSkills: ['急救', '博物学', '机械维修', '侦查', '潜水', '游泳', '驾驶', '科学①'],
  },
  {
    id: 54, name: '医生', formula: 'EDU*4', creditRange: '30-80',
    description: '救死扶伤，精通医学与人体解剖，诊断并治疗疾病。',
    coreSkills: ['急救', '医学', '心理学', '科学①', '说服', '聆听', '图书馆使用'],
  },
  {
    id: 55, name: '流浪者/浪人', formula: 'EDU*2+MAX(STR*2,DEX*2,APP*2)', creditRange: '0-5',
    description: '居无定所，见多识广，靠机智和随机应变生存于社会边缘。',
    coreSkills: ['格斗：斗殴', '话术', '聆听', '博物学', '心理学', '侦查', '潜行', '追踪'],
  },
  {
    id: 56, name: '司机·私人司机', formula: 'EDU*2+DEX*2', creditRange: '10-40',
    description: '为雇主提供专属驾驶服务，熟悉城市道路并擅长保护乘客隐私。',
    coreSkills: ['汽车驾驶', '机械维修', '领航', '聆听', '心理学', '侦查', '话术'],
  },
  {
    id: 57, name: '司机·出租车', formula: 'EDU*2+DEX*2', creditRange: '9-30',
    description: '在城市中驾驶出租车，认识形形色色的人，熟知街道与地下消息。',
    coreSkills: ['汽车驾驶', '话术', '聆听', '领航', '心理学', '侦查', '说服'],
  },

  // ─── E ───────────────────────────────────────────────────────────────────
  {
    id: 60, name: '编辑', formula: 'EDU*4', creditRange: '10-30',
    description: '审校出版内容，与作者合作，把控文字品质与方向。',
    coreSkills: ['技艺①', '历史', '图书馆使用', '母语', '心理学', '侦查', '说服'],
  },
  {
    id: 61, name: '政府官员/民选官员', formula: 'EDU*2+APP*2', creditRange: '20-90',
    description: '担任政府职务，掌握行政权力，处理公共政策与选民关系。',
    coreSkills: ['会计', '图书馆使用', '法律', '聆听', '说服', '侦查', '心理学'],
  },
  {
    id: 62, name: '工程师', formula: 'EDU*4', creditRange: '30-60',
    description: '设计与建造机械、电气或土木工程系统，以科学方法解决实际问题。',
    coreSkills: ['图书馆使用', '机械维修', '电气维修', '操作重型机械', '科学①', '侦查'],
  },
  {
    id: 63, name: '艺人/表演者', formula: 'EDU*2+APP*2', creditRange: '9-70',
    description: '通过表演才艺娱乐观众，包括歌手、喜剧演员、杂耍者等。',
    coreSkills: ['技艺①', '乔装', '话术', '魅惑', '聆听', '心理学', '侦查'],
  },
  {
    id: 64, name: '探险家', formula: 'EDU*2+MAX(STR*2,DEX*2,APP*2)', creditRange: '55-80',
    description: '进入未知领域，探索荒野或遗址，追求发现与冒险。',
    era: 'classic',
    coreSkills: ['攀爬', '急救', '历史', '跳跃', '博物学', '领航', '说服', '射击①', '生存'],
  },

  // ─── F ───────────────────────────────────────────────────────────────────
  {
    id: 70, name: '农民', formula: 'EDU*2+MAX(STR*2,DEX*2)', creditRange: '9-30',
    description: '靠土地为生，了解自然与农业知识，擅长户外劳作。',
    coreSkills: ['技艺①', '机械维修', '博物学', '汽车驾驶', '生存', '追踪', '驯兽'],
  },
  {
    id: 71, name: '联邦探员', formula: 'EDU*4', creditRange: '20-40',
    description: '服务于联邦执法机构（如FBI），调查跨州犯罪与政治案件。',
    era: 'classic',
    coreSkills: ['话术', '急救', '恐吓', '法律', '聆听', '心理学', '射击：手枪', '侦查'],
  },
  {
    id: 72, name: '消防员', formula: 'EDU*2+MAX(STR*2,DEX*2)', creditRange: '9-30',
    description: '扑灭火灾、救援被困者，在高压环境下保持冷静。',
    coreSkills: ['攀爬', '急救', '格斗：斗殴', '恐吓', '机械维修', '操作重型机械', '侦查'],
  },
  {
    id: 73, name: '法医', formula: 'EDU*4', creditRange: '40-60',
    description: '通过尸检和科学分析确定死因，为刑事调查提供法医证据。',
    coreSkills: ['历史', '图书馆使用', '医学', '心理学', '科学①', '科学②', '侦查'],
  },
  {
    id: 74, name: '外国记者/驻外记者', formula: 'EDU*4', creditRange: '10-40',
    description: '在异国他乡采访报道，常深入危险地区，拥有广泛的国际人脉。',
    coreSkills: ['技艺①', '历史', '图书馆使用', '聆听', '外语①', '说服', '侦查'],
  },

  // ─── G ───────────────────────────────────────────────────────────────────
  {
    id: 80, name: '赌徒', formula: 'EDU*2+MAX(APP*2,DEX*2)', creditRange: '8-50',
    description: '以博弈为生，擅长读人心理与概率计算，常在灰色地带活动。',
    coreSkills: ['会计', '话术', '聆听', '心理学', '侦查', '妙手', '说服'],
  },
  {
    id: 81, name: '黑帮老大', formula: 'EDU*2+APP*2', creditRange: '60-95',
    description: '犯罪组织的头目，控制地下经济，运用恐吓与腐化维持势力。',
    coreSkills: ['格斗：斗殴', '话术', '恐吓', '法律', '聆听', '心理学', '说服', '侦查'],
  },
  {
    id: 82, name: '黑帮马仔', formula: 'EDU*2+MAX(STR*2,DEX*2)', creditRange: '9-20',
    description: '犯罪组织的底层成员，为老大执行暴力或跑腿任务。',
    coreSkills: ['格斗：斗殴', '射击：手枪', '汽车驾驶', '恐吓', '聆听', '侦查', '潜行'],
  },
  {
    id: 83, name: '绅士/淑女', formula: 'EDU*2+APP*2', creditRange: '40-90',
    description: '上流社会成员，拥有良好教育与社交手腕，出入高档场合。',
    coreSkills: ['技艺①', '骑术', '历史', '图书馆使用', '聆听', '外语①', '说服'],
  },
  {
    id: 84, name: '游民/乞丐', formula: 'EDU*2+MAX(APP*2,DEX*2)', creditRange: '0-5',
    description: '社会底层，靠乞讨或小聪明生存，但往往见闻甚广，隐于市井。',
    coreSkills: ['话术', '聆听', '心理学', '侦查', '潜行', '妙手', '追踪'],
  },
  {
    id: 85, name: '保镖/护卫', formula: 'EDU*2+MAX(STR*2,DEX*2)', creditRange: '10-40',
    description: '受雇保护特定目标，精通近身格斗与威胁识别。',
    coreSkills: ['格斗：斗殴', '急救', '恐吓', '聆听', '射击：手枪', '侦查', '心理学'],
  },

  // ─── I–J ─────────────────────────────────────────────────────────────────
  {
    id: 90, name: '记者·调查记者', formula: 'EDU*4', creditRange: '9-30',
    description: '深入调查腐败与犯罪的记者，不畏强权，追求真相。',
    coreSkills: ['技艺①', '历史', '图书馆使用', '聆听', '心理学', '侦查', '母语', '说服'],
  },
  {
    id: 91, name: '记者·通讯记者', formula: 'EDU*4', creditRange: '9-30',
    description: '报道突发新闻，奔走于现场，快速整理并发回稿件。',
    coreSkills: ['技艺①', '历史', '图书馆使用', '聆听', '母语', '说服', '侦查'],
  },
  {
    id: 92, name: '法官', formula: 'EDU*4', creditRange: '50-80',
    description: '主持法庭审判，精通法律，掌握公正裁决的权威。',
    coreSkills: ['历史', '恐吓', '图书馆使用', '法律', '聆听', '心理学', '说服'],
  },

  // ─── L ───────────────────────────────────────────────────────────────────
  {
    id: 100, name: '实验室助手', formula: 'EDU*4', creditRange: '10-30',
    description: '协助科学家进行实验研究，熟悉实验室规程与设备操作。',
    coreSkills: ['计算机使用', '电气维修', '图书馆使用', '科学①', '科学②', '侦查'],
  },
  {
    id: 101, name: '工人·非熟练工', formula: 'EDU*2+MAX(STR*2,DEX*2)', creditRange: '9-30',
    description: '从事体力劳动，力气大，经得住艰苦环境。',
    coreSkills: ['格斗：斗殴', '急救', '机械维修', '操作重型机械', '生存', '游泳', '侦查'],
  },
  {
    id: 102, name: '工人·伐木工', formula: 'EDU*2+MAX(STR*2,DEX*2)', creditRange: '9-30',
    description: '在林场砍伐木材，体格强健，熟悉荒野与林地生存。',
    coreSkills: ['格斗：斗殴', '急救', '机械维修', '博物学', '生存', '追踪', '侦查'],
  },
  {
    id: 103, name: '律师', formula: 'EDU*4', creditRange: '30-80',
    description: '精通法律，代理诉讼，善于在法庭辩论与庭外谈判。',
    coreSkills: ['会计', '图书馆使用', '法律', '聆听', '心理学', '说服', '母语'],
  },
  {
    id: 104, name: '图书管理员', formula: 'EDU*4', creditRange: '9-35',
    description: '管理书籍与档案，知识渊博，善于检索信息。',
    coreSkills: ['图书馆使用', '历史', '聆听', '博物学', '说服', '侦查', '外语①'],
  },

  // ─── M ───────────────────────────────────────────────────────────────────
  {
    id: 110, name: '技师/维修工', formula: 'EDU*4', creditRange: '9-40',
    description: '精通机械或电气设备的维修与安装，动手能力极强。',
    coreSkills: ['电气维修', '机械维修', '操作重型机械', '科学①', '侦查', '聆听'],
  },
  {
    id: 111, name: '军官', formula: 'EDU*2+MAX(STR*2,DEX*2)', creditRange: '20-70',
    description: '指挥军队作战的军事领袖，受过严格训练，擅长战术与领导。',
    coreSkills: ['格斗：斗殴', '急救', '恐吓', '聆听', '领航', '射击①', '侦查', '说服'],
  },
  {
    id: 112, name: '传教士', formula: 'EDU*2+APP*2', creditRange: '0-30',
    description: '传播宗教信仰，深入偏远地区，常与不同文化打交道。',
    coreSkills: ['急救', '历史', '图书馆使用', '聆听', '博物学', '说服', '外语①'],
  },
  {
    id: 113, name: '登山家', formula: 'EDU*2+MAX(STR*2,DEX*2)', creditRange: '30-60',
    description: '攀登极限地形，有丰富的户外探险与高海拔生存经验。',
    coreSkills: ['攀爬', '急救', '跳跃', '博物学', '领航', '生存', '侦查'],
  },
  {
    id: 114, name: '博物馆馆员', formula: 'EDU*4', creditRange: '10-30',
    description: '管理与研究博物馆藏品，精通文物鉴定与历史考证。',
    coreSkills: ['历史', '图书馆使用', '估价', '神秘学', '说服', '侦查', '外语①'],
  },
  {
    id: 115, name: '音乐家', formula: 'EDU*2+MAX(POW*2,DEX*2)', creditRange: '9-30',
    description: '以演奏或创作音乐为业，对声音与情绪极为敏感。',
    coreSkills: ['技艺①', '历史', '聆听', '心理学', '侦查', '魅惑'],
  },
  {
    id: 116, name: '士兵', formula: 'EDU*2+MAX(STR*2,DEX*2)', creditRange: '9-30',
    description: '受过军事训练的普通士兵，服从命令，擅长战斗与团队协作。',
    coreSkills: ['格斗：斗殴', '急救', '恐吓', '聆听', '领航', '射击①', '生存', '侦查'],
  },
  {
    id: 117, name: '护士', formula: 'EDU*4', creditRange: '9-30',
    description: '照料病患，协助医生诊治，具备扎实的医学基础知识。',
    coreSkills: ['急救', '图书馆使用', '医学', '聆听', '精神分析', '心理学', '说服'],
  },

  // ─── O ───────────────────────────────────────────────────────────────────
  {
    id: 120, name: '神秘学家', formula: 'EDU*4', creditRange: '9-65',
    description: '研究神秘与超自然现象，熟知古代秘术与隐藏知识。',
    coreSkills: ['人类学', '历史', '图书馆使用', '神秘学', '科学①', '外语①', '侦查'],
  },
  {
    id: 121, name: '超心理学家', formula: 'EDU*4', creditRange: '9-30',
    description: '研究超自然心理现象，如心灵感应、鬼魂附身等边缘科学。',
    coreSkills: ['图书馆使用', '神秘学', '聆听', '心理学', '科学①', '说服', '侦查'],
  },
  {
    id: 122, name: '户外猎人/旅行家', formula: 'EDU*2+MAX(STR*2,DEX*2)', creditRange: '5-20',
    description: '在荒野中生活与旅行，精通捕猎、生存与识路技能。',
    coreSkills: ['格斗：斗殴', '急救', '博物学', '领航', '射击①', '生存', '追踪'],
  },

  // ─── P ───────────────────────────────────────────────────────────────────
  {
    id: 130, name: '药剂师', formula: 'EDU*4', creditRange: '35-75',
    description: '配制与出售药物，具备化学与医学知识，了解各种药物的效用与危险。',
    coreSkills: ['会计', '科学①', '图书馆使用', '医学', '说服', '侦查'],
  },
  {
    id: 131, name: '摄影师', formula: 'EDU*4', creditRange: '9-30',
    description: '以摄影为职业，善于构图与捕捉瞬间，可为各类媒体或客户服务。',
    coreSkills: ['技艺①', '图书馆使用', '心理学', '说服', '侦查', '聆听'],
  },
  {
    id: 132, name: '飞行员', formula: 'EDU*2+DEX*2', creditRange: '20-70',
    description: '驾驶飞机执行商业或军事任务，熟悉空中导航与机械维护。',
    coreSkills: ['电气维修', '急救', '机械维修', '领航', '驾驶', '侦查'],
  },
  {
    id: 133, name: '警探', formula: 'EDU*2+MAX(STR*2,DEX*2)', creditRange: '20-50',
    description: '侦破刑事案件的警察，善于审讯、追踪与收集证据。',
    coreSkills: ['急救', '话术', '恐吓', '法律', '聆听', '心理学', '射击：手枪', '侦查'],
  },
  {
    id: 134, name: '巡警', formula: 'EDU*2+MAX(STR*2,DEX*2)', creditRange: '9-30',
    description: '在街区执勤的普通警察，处理日常治安事务，熟悉辖区情况。',
    coreSkills: ['格斗：斗殴', '急救', '恐吓', '法律', '聆听', '心理学', '侦查'],
  },
  {
    id: 135, name: '私家侦探', formula: 'EDU*2+MAX(STR*2,DEX*2)', creditRange: '9-30',
    description: '受人雇佣调查私人案件，行动独立，处于法律边缘地带。',
    coreSkills: ['技艺①', '乔装', '话术', '法律', '图书馆使用', '心理学', '侦查', '聆听'],
  },
  {
    id: 136, name: '教授', formula: 'EDU*4', creditRange: '20-70',
    description: '学术机构的专家，精通特定领域，以研究与授课为业。',
    coreSkills: ['图书馆使用', '心理学', '侦查', '母语', '外语①', '历史', '说服'],
  },
  {
    id: 137, name: '精神病学家', formula: 'EDU*4', creditRange: '30-80',
    description: '治疗心理与精神疾病的医学专家，能分析人的行为与动机。',
    coreSkills: ['图书馆使用', '聆听', '医学', '精神分析', '心理学', '科学①', '侦查'],
  },
  {
    id: 138, name: '心理学家', formula: 'EDU*4', creditRange: '10-40',
    description: '研究人类心理与行为的学者，擅长测验、咨询与分析。',
    coreSkills: ['图书馆使用', '聆听', '医学', '精神分析', '心理学', '说服', '侦查'],
  },

  // ─── R–S ─────────────────────────────────────────────────────────────────
  {
    id: 140, name: '研究员', formula: 'EDU*4', creditRange: '9-30',
    description: '从事专业文献研究，擅长整理资料与深入分析特定课题。',
    coreSkills: ['图书馆使用', '历史', '聆听', '科学①', '说服', '侦查', '外语①'],
  },
  {
    id: 141, name: '水手·军舰', formula: 'EDU*2+MAX(STR*2,DEX*2)', creditRange: '9-30',
    description: '服役于军事舰艇的水手，受过战斗训练，熟悉海上作战。',
    coreSkills: ['格斗：斗殴', '急救', '机械维修', '领航', '射击①', '游泳', '炮术'],
  },
  {
    id: 142, name: '水手·商船', formula: 'EDU*2+MAX(STR*2,DEX*2)', creditRange: '20-40',
    description: '跑遍世界各大港口的商船水手，见多识广，擅长航海与求生。',
    coreSkills: ['格斗：斗殴', '急救', '机械维修', '领航', '博物学', '驾驶', '游泳', '追踪'],
  },
  {
    id: 143, name: '推销员', formula: 'EDU*2+APP*2', creditRange: '9-40',
    description: '推销商品或服务，擅长说服他人，人脉广泛。',
    coreSkills: ['话术', '汽车驾驶', '图书馆使用', '聆听', '心理学', '说服', '侦查'],
  },
  {
    id: 144, name: '科学家', formula: 'EDU*4', creditRange: '9-50',
    description: '从事科学研究，以实证为准则，精通特定科学领域。',
    coreSkills: ['图书馆使用', '博物学', '科学①', '科学②', '侦查', '母语', '外语①'],
  },
  {
    id: 145, name: '秘书/文员', formula: 'EDU*2+MAX(DEX*2,APP*2)', creditRange: '9-30',
    description: '处理文书事务，协助上级工作，组织能力强，行事谨慎。',
    coreSkills: ['会计', '技艺①', '图书馆使用', '聆听', '母语', '说服', '侦查'],
  },
  {
    id: 146, name: '店主/商人', formula: 'EDU*2+MAX(APP*2,DEX*2)', creditRange: '20-40',
    description: '经营小型商店或从事贸易，熟悉买卖之道与顾客心理。',
    coreSkills: ['会计', '话术', '聆听', '估价', '心理学', '说服', '侦查'],
  },
  {
    id: 147, name: '间谍', formula: 'EDU*2+MAX(APP*2,DEX*2)', creditRange: '20-60',
    description: '为国家或组织从事情报活动，精于伪装、渗透与信息收集。',
    coreSkills: ['乔装', '电气维修', '话术', '聆听', '心理学', '说服', '侦查', '外语①'],
  },
  {
    id: 148, name: '学生/实习生', formula: 'EDU*4', creditRange: '5-10',
    description: '在校学习的年轻人，拥有强烈的好奇心，但社会经验尚浅。',
    coreSkills: ['图书馆使用', '心理学', '科学①', '外语①', '侦查', '说服'],
  },
  {
    id: 149, name: '替身演员', formula: 'EDU*2+MAX(STR*2,DEX*2)', creditRange: '10-50',
    description: '代替明星完成危险动作场面，身手敏捷，对危险有极高的耐受力。',
    coreSkills: ['攀爬', '格斗：斗殴', '急救', '跳跃', '侦查', '游泳', '投掷'],
  },

  // ─── U–Z ─────────────────────────────────────────────────────────────────
  {
    id: 155, name: '殡仪员/验尸官', formula: 'EDU*4', creditRange: '20-40',
    description: '处理遗体的专业人员，对死亡与腐败过程有深入了解。',
    coreSkills: ['急救', '历史', '图书馆使用', '医学', '心理学', '说服', '侦查'],
  },
  {
    id: 156, name: '工会活动家', formula: 'EDU*4', creditRange: '5-50',
    description: '为工人权益奔走呼号，擅长组织动员与公开演讲。',
    coreSkills: ['会计', '图书馆使用', '法律', '聆听', '说服', '母语', '心理学'],
  },
  {
    id: 157, name: '职员/白领', formula: 'EDU*4', creditRange: '9-40',
    description: '在公司或机关从事行政管理工作，处理日常业务与文书。',
    coreSkills: ['会计', '图书馆使用', '聆听', '母语', '说服', '侦查', '心理学'],
  },
  {
    id: 158, name: '饲养员/动物训练师', formula: 'EDU*2+MAX(APP*2,POW*2)', creditRange: '10-40',
    description: '训练并照料动物，能解读动物行为，建立与动物的信任关系。',
    coreSkills: ['会计', '技艺①', '聆听', '博物学', '驯兽', '说服', '侦查'],
  },
  {
    id: 159, name: '狂热者/信徒', formula: 'EDU*2+MAX(APP*2,POW*2)', creditRange: '0-30',
    description: '对某种理念或信仰极度痴迷，为之不顾一切，甚至超越道德底线。',
    coreSkills: ['历史', '恐吓', '图书馆使用', '神秘学', '心理学', '说服', '聆听'],
  },
];
