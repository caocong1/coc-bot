import { type Component } from 'solid-js';

const Manual: Component = () => (
  <div>
    <h2 class="text-lg font-bold mb-5 pb-2 border-b border-border">指令速查</h2>

    <section class="mb-8">
      <h3 class="text-[0.9rem] text-text-dim mb-3">掷骰指令</h3>
      <table class="w-full border-collapse text-sm">
        <thead><tr><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">指令</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">说明</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">示例</th></tr></thead>
        <tbody>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.r</td><td class="px-3 py-1.5 border-b border-white/[0.04]">通用掷骰（无参数用 .set 设置的默认骰，默认 D100）</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.r 3d6 .r 1d100</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.r#N 表达式</td><td class="px-3 py-1.5 border-b border-white/[0.04]">多轮掷骰</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.r#3 1d6</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.rb / .rp</td><td class="px-3 py-1.5 border-b border-white/[0.04]">奖励骰 / 惩罚骰</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.rb 侦查 .rp 说服</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.rh 表达式</td><td class="px-3 py-1.5 border-b border-white/[0.04]">暗骰（结果私聊，群里只显示「进行了暗骰」）</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.rh 侦查</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.ra 技能</td><td class="px-3 py-1.5 border-b border-white/[0.04]">技能检定（普通/困难/极难自动判断）</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.ra 图书馆使用 .ra 困难 侦查</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.rc 技能</td><td class="px-3 py-1.5 border-b border-white/[0.04]">对抗检定</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.rc 说服</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.sc 成功/失败</td><td class="px-3 py-1.5 border-b border-white/[0.04]">理智检定</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.sc 0/1d6</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.ri [±加值] [名字]</td><td class="px-3 py-1.5 border-b border-white/[0.04]">先攻掷骰（D20），自动加入先攻列表</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.ri .ri +2 .ri -1 独眼怪</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.init</td><td class="px-3 py-1.5 border-b border-white/[0.04]">查看先攻顺序列表</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.init</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.init clr</td><td class="px-3 py-1.5 border-b border-white/[0.04]">清空先攻列表</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.init clr</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.set [面数]</td><td class="px-3 py-1.5 border-b border-white/[0.04]">设置个人默认骰子面数（.set 重置为D100）</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.set 20</td></tr>
        </tbody>
      </table>
    </section>

    <section class="mb-8">
      <h3 class="text-[0.9rem] text-text-dim mb-3">角色卡指令</h3>
      <table class="w-full border-collapse text-sm">
        <thead><tr><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">指令</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">说明</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">示例</th></tr></thead>
        <tbody>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.pc</td><td class="px-3 py-1.5 border-b border-white/[0.04]">查看/切换角色卡</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.pc .pc 爱丽丝</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.pc new 名字</td><td class="px-3 py-1.5 border-b border-white/[0.04]">新建角色卡</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.pc new 爱丽丝</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.pc del 名字</td><td class="px-3 py-1.5 border-b border-white/[0.04]">删除角色卡</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.pc del 爱丽丝</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.st 属性:值</td><td class="px-3 py-1.5 border-b border-white/[0.04]">录入属性（可批量）</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.st 力量:60 敏捷:70</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.st &lt;&lt;属性:增量</td><td class="px-3 py-1.5 border-b border-white/[0.04]">属性增量修改</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.st &lt;&lt;HP:-3</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.coc</td><td class="px-3 py-1.5 border-b border-white/[0.04]">自动生成属性（随机车卡）</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.coc .coc 7</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.en 技能</td><td class="px-3 py-1.5 border-b border-white/[0.04]">技能成长检定</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.en 侦查</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.setcoc</td><td class="px-3 py-1.5 border-b border-white/[0.04]">查看/设置房规</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.setcoc 1</td></tr>
        </tbody>
      </table>
    </section>

    <section class="mb-8">
      <h3 class="text-[0.9rem] text-text-dim mb-3">跑团房间指令</h3>
      <table class="w-full border-collapse text-sm">
        <thead><tr><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">指令</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">说明</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">示例</th></tr></thead>
        <tbody>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.mod list</td><td class="px-3 py-1.5 border-b border-white/[0.04]">查看可用模组列表（含模组 ID）</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.mod list</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.room create &lt;名称&gt; [模组ID]</td><td class="px-3 py-1.5 border-b border-white/[0.04]">创建跑团房间，可选绑定模组</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.room create 与苏珊共进晚餐 abc12345</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.room join &lt;房间ID&gt;</td><td class="px-3 py-1.5 border-b border-white/[0.04]">加入房间，私发 Web 车卡链接</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.room join f3a9c1b2</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.room start &lt;房间ID&gt;</td><td class="px-3 py-1.5 border-b border-white/[0.04]">在当前群开始跑团（需创建者）</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.room start f3a9c1b2</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.room pause</td><td class="px-3 py-1.5 border-b border-white/[0.04]">暂停当前群的跑团（保留全部进度）</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.room pause</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.room resume</td><td class="px-3 py-1.5 border-b border-white/[0.04]">继续当前群暂停的跑团</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.room resume</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.room stop</td><td class="px-3 py-1.5 border-b border-white/[0.04]">彻底结束当前群的跑团</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.room stop</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.room list</td><td class="px-3 py-1.5 border-b border-white/[0.04]">查看我参与的活跃房间</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.room list</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.room info &lt;房间ID&gt;</td><td class="px-3 py-1.5 border-b border-white/[0.04]">查看房间成员/状态</td><td class="px-3 py-1.5 border-b border-white/[0.04]">.room info f3a9c1b2</td></tr>
        </tbody>
      </table>
      <p class="text-text-dim" style={{ 'font-size': '0.82rem', 'margin-top': '0.5rem' }}>
        流程：<code>.room create</code> → 群友 <code>.room join</code>（点链接车卡）→ <code>.room start</code>
      </p>
    </section>

    <section class="mb-8">
      <h3 class="text-[0.9rem] text-text-dim mb-3">Web 控制台</h3>
      <table class="w-full border-collapse text-sm">
        <thead><tr><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">指令</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">说明</th></tr></thead>
        <tbody>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.web login（私聊机器人）</td><td class="px-3 py-1.5 border-b border-white/[0.04]">获取 Web 控制台个人登录链接（仅私聊有效）</td></tr>
        </tbody>
      </table>
    </section>

    <section class="mb-8">
      <h3 class="text-[0.9rem] text-text-dim mb-3">其他指令</h3>
      <table class="w-full border-collapse text-sm">
        <thead><tr><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">指令</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">说明</th></tr></thead>
        <tbody>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.name (cn/jp/en) [数量]</td><td class="px-3 py-1.5 border-b border-white/[0.04]">随机生成中文/日文/英文姓名（默认中文，最多10个）</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.nn 昵称</td><td class="px-3 py-1.5 border-b border-white/[0.04]">设置骰子对你的称呼（AI KP 会用这个叫你）</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.nn del</td><td class="px-3 py-1.5 border-b border-white/[0.04]">删除当前群/私聊的称呼</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.nn clr</td><td class="px-3 py-1.5 border-b border-white/[0.04]">清除所有称呼</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.kp [内容]</td><td class="px-3 py-1.5 border-b border-white/[0.04]">强制 KP 介入推进剧情（跑团中发送，保底用）</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.gugu [玩家名]</td><td class="px-3 py-1.5 border-b border-white/[0.04]">随机生成鸽子理由（AI 创作，不填名字则用自己）</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.jrrp</td><td class="px-3 py-1.5 border-b border-white/[0.04]">今日人品（每人每天固定，AI 生成评语）</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.ti</td><td class="px-3 py-1.5 border-b border-white/[0.04]">随机临时疯狂症状</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.li</td><td class="px-3 py-1.5 border-b border-white/[0.04]">随机总结性疯狂症状</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">.help</td><td class="px-3 py-1.5 border-b border-white/[0.04]">查看全部指令帮助</td></tr>
        </tbody>
      </table>
    </section>

    <h2 class="text-lg font-bold mb-5 pb-2 border-b border-border" style={{ 'margin-top': '2.5rem' }}>CoC7 快速规则参考</h2>

    <section class="mb-8">
      <h3 class="text-[0.9rem] text-text-dim mb-3">检定等级</h3>
      <table class="w-full border-collapse text-sm">
        <thead><tr><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">等级</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">成功条件</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">说明</th></tr></thead>
        <tbody>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">普通成功</td><td class="px-3 py-1.5 border-b border-white/[0.04]">&le; 技能值</td><td class="px-3 py-1.5 border-b border-white/[0.04]">基本成功</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">困难成功</td><td class="px-3 py-1.5 border-b border-white/[0.04]">&le; 技能值 &divide; 2</td><td class="px-3 py-1.5 border-b border-white/[0.04]">出色表现</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">极难成功</td><td class="px-3 py-1.5 border-b border-white/[0.04]">&le; 技能值 &divide; 5</td><td class="px-3 py-1.5 border-b border-white/[0.04]">近乎完美</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">大成功</td><td class="px-3 py-1.5 border-b border-white/[0.04]">骰出 01–05</td><td class="px-3 py-1.5 border-b border-white/[0.04]">最佳结果</td></tr>
          <tr><td class="px-3 py-1.5 border-b border-white/[0.04] font-mono text-accent">大失败</td><td class="px-3 py-1.5 border-b border-white/[0.04]">骰出 96–100（技能≤50：96+失败；技能&gt;50：100失败）</td><td class="px-3 py-1.5 border-b border-white/[0.04]">最糟结果</td></tr>
        </tbody>
      </table>
    </section>

    <section class="mb-8">
      <h3 class="text-[0.9rem] text-text-dim mb-3">理智检定 (SAN)</h3>
      <ul class="list-none flex flex-col gap-2">
        <li class="text-[0.88rem] pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-accent">遭遇神话生物、超自然事件、暴力死亡时，KP 会要求 <code>.sc 成功损失/失败损失</code></li>
        <li class="text-[0.88rem] pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-accent">单次 SAN 损失 &ge; 5 点 → 临时疯狂（使用 <code>.ti</code> 查看症状）</li>
        <li class="text-[0.88rem] pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-accent">一场游戏中 SAN 损失 &ge; 当前 SAN/5 → 不定性疯狂</li>
        <li class="text-[0.88rem] pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-accent">SAN 归零 → 永久疯狂，角色退出故事</li>
        <li class="text-[0.88rem] pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-accent">克苏鲁神话技能 &gt; 当前 SAN 时：所有 SAN 损失减半（精神固化）</li>
      </ul>
    </section>

    <section class="mb-8">
      <h3 class="text-[0.9rem] text-text-dim mb-3">战斗流程</h3>
      <ul class="list-none flex flex-col gap-2">
        <li class="text-[0.88rem] pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-accent">KP 宣告敌方行动意图 → 玩家投骰（斗殴/武器/闪避） → KP 叙述结果</li>
        <li class="text-[0.88rem] pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-accent">大成功：造成最大伤害</li>
        <li class="text-[0.88rem] pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-accent">困难成功：穿刺武器可造成额外伤害</li>
        <li class="text-[0.88rem] pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-accent">闪避失败：被命中，承受伤害</li>
        <li class="text-[0.88rem] pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-accent">HP 降至重伤值（HP最大值&divide;2）→ 重伤状态，行动受限</li>
        <li class="text-[0.88rem] pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-accent">HP 归零 → 昏迷/濒死，需队友急救（1小时内成功则稳定）</li>
        <li class="text-[0.88rem] pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-accent"><strong>克苏鲁精神：逃跑永远是正确选择。</strong></li>
      </ul>
    </section>

    <section class="mb-8">
      <h3 class="text-[0.9rem] text-text-dim mb-3">OOC（跳出叙事）</h3>
      <p class="text-text-dim">用 <code>（括号）</code> 或消息开头写 <code>OOC:</code>，KP 会跳出角色直接答疑，不算作故事内容。</p>
    </section>

    <h2 class="text-lg font-bold mb-5 pb-2 border-b border-border" style={{ 'margin-top': '2.5rem' }}>常见问题 FAQ</h2>
    <section class="mb-8">
      <div class="mb-5">
        <strong class="block mb-1">Q：我想做什么，需要 KP 来裁定吗？</strong>
        <p class="text-[0.88rem] text-text-dim">直接描述你的行动，KP 会判断是否需要检定。不用提前询问。</p>
      </div>
      <div class="mb-5">
        <strong class="block mb-1">Q：我想和 NPC 说话怎么做？</strong>
        <p class="text-[0.88rem] text-text-dim">直接用对话形式写出来，KP 会以 NPC 身份回应。</p>
      </div>
      <div class="mb-5">
        <strong class="block mb-1">Q：KP 叫我投某个技能，怎么投？</strong>
        <p class="text-[0.88rem] text-text-dim">发 <code>.ra 技能名</code>，如 <code>.ra 侦查</code>，机器人会用你的当前角色卡计算。</p>
      </div>
      <div class="mb-5">
        <strong class="block mb-1">Q：暂停后再继续，之前的进度还在吗？</strong>
        <p class="text-[0.88rem] text-text-dim">全部保留。<code>.room resume</code> 后 KP 会给一段简要回顾，帮助大家找回状态。</p>
      </div>
      <div class="mb-5">
        <strong class="block mb-1">Q：我的角色挂了怎么办？</strong>
        <p class="text-[0.88rem] text-text-dim">KP 不会轻易判定角色死亡——HP 归零是昏迷/濒死，队友可以急救。真正的死亡需要明确的故事逻辑。</p>
      </div>
    </section>
  </div>
);

export default Manual;
