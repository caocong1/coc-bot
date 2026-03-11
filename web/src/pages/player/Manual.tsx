import { type Component } from 'solid-js';
import styles from './Player.module.css';

const Manual: Component = () => (
  <div class={styles.manual}>
    <h2>指令速查</h2>

    <section class={styles.manualSection}>
      <h3>掷骰指令</h3>
      <table class={styles.cmdTable}>
        <thead><tr><th>指令</th><th>说明</th><th>示例</th></tr></thead>
        <tbody>
          <tr><td>.r</td><td>通用掷骰</td><td>.r 3d6 .r 1d100</td></tr>
          <tr><td>.ra 技能</td><td>技能检定（普通/困难/极难）</td><td>.ra 图书馆使用 .ra 困难 侦查</td></tr>
          <tr><td>.rc 技能</td><td>对抗检定</td><td>.rc 说服</td></tr>
          <tr><td>.rb</td><td>奖励骰</td><td>.rb 侦查</td></tr>
          <tr><td>.rp</td><td>惩罚骰</td><td>.rp 侦查</td></tr>
          <tr><td>.sc 成功/失败</td><td>理智检定</td><td>.sc 0/1d6</td></tr>
        </tbody>
      </table>
    </section>

    <section class={styles.manualSection}>
      <h3>角色卡指令</h3>
      <table class={styles.cmdTable}>
        <thead><tr><th>指令</th><th>说明</th><th>示例</th></tr></thead>
        <tbody>
          <tr><td>.pc</td><td>查看/切换角色卡</td><td>.pc .pc 爱丽丝</td></tr>
          <tr><td>.pc new 名字</td><td>新建角色卡</td><td>.pc new 爱丽丝</td></tr>
          <tr><td>.pc del 名字</td><td>删除角色卡</td><td>.pc del 爱丽丝</td></tr>
          <tr><td>.st 属性:值</td><td>录入属性（可批量）</td><td>.st 力量:60 敏捷:70</td></tr>
          <tr><td>.st &lt;&lt;属性:增量</td><td>属性增量修改</td><td>.st &lt;&lt;HP:-3</td></tr>
          <tr><td>.coc</td><td>自动生成属性（随机车卡）</td><td>.coc .coc 7</td></tr>
          <tr><td>.en 技能</td><td>技能成长检定</td><td>.en 侦查</td></tr>
          <tr><td>.setcoc</td><td>查看/设置房规</td><td>.setcoc 1</td></tr>
        </tbody>
      </table>
    </section>

    <section class={styles.manualSection}>
      <h3>跑团指令</h3>
      <table class={styles.cmdTable}>
        <thead><tr><th>指令</th><th>说明</th></tr></thead>
        <tbody>
          <tr><td>.campaign start [模板]</td><td>开始跑团，可选模板：serious / humorous / creative / freeform / strict / old-school</td></tr>
          <tr><td>.campaign pause</td><td>暂停跑团（保留全部进度）</td></tr>
          <tr><td>.campaign resume</td><td>继续上次暂停的跑团</td></tr>
          <tr><td>.campaign stop</td><td>彻底结束本次跑团（注意：不等于"结团"，只是关闭 Bot）</td></tr>
          <tr><td>.campaign load 文件名</td><td>加载模组文本（KP 使用）</td></tr>
          <tr><td>.web login</td><td>获取 Web 控制台个人登录链接</td></tr>
        </tbody>
      </table>
    </section>

    <section class={styles.manualSection}>
      <h3>其他指令</h3>
      <table class={styles.cmdTable}>
        <thead><tr><th>指令</th><th>说明</th></tr></thead>
        <tbody>
          <tr><td>.jrrp</td><td>今日人品（每人每天固定，AI 生成评语）</td></tr>
          <tr><td>.ti</td><td>随机临时疯狂症状</td></tr>
          <tr><td>.li</td><td>随机总结性疯狂症状</td></tr>
          <tr><td>.help</td><td>查看全部指令帮助</td></tr>
        </tbody>
      </table>
    </section>

    <h2 style={{ 'margin-top': '2.5rem' }}>CoC7 快速规则参考</h2>

    <section class={styles.manualSection}>
      <h3>检定等级</h3>
      <table class={styles.cmdTable}>
        <thead><tr><th>等级</th><th>成功条件</th><th>说明</th></tr></thead>
        <tbody>
          <tr><td>普通成功</td><td>≤ 技能值</td><td>基本成功</td></tr>
          <tr><td>困难成功</td><td>≤ 技能值 ÷ 2</td><td>出色表现</td></tr>
          <tr><td>极难成功</td><td>≤ 技能值 ÷ 5</td><td>近乎完美</td></tr>
          <tr><td>大成功</td><td>骰出 01–05</td><td>最佳结果</td></tr>
          <tr><td>大失败</td><td>骰出 96–100（技能≤50：96+失败；技能>50：100失败）</td><td>最糟结果</td></tr>
        </tbody>
      </table>
    </section>

    <section class={styles.manualSection}>
      <h3>理智检定 (SAN)</h3>
      <ul class={styles.ruleList}>
        <li>遭遇神话生物、超自然事件、暴力死亡时，KP 会要求 <code>.sc 成功损失/失败损失</code></li>
        <li>单次 SAN 损失 ≥ 5 点 → 临时疯狂（使用 <code>.ti</code> 查看症状）</li>
        <li>一场游戏中 SAN 损失 ≥ 当前 SAN/5 → 不定性疯狂</li>
        <li>SAN 归零 → 永久疯狂，角色退出故事</li>
        <li>克苏鲁神话技能 > 当前 SAN 时：所有 SAN 损失减半（精神固化）</li>
      </ul>
    </section>

    <section class={styles.manualSection}>
      <h3>战斗流程</h3>
      <ul class={styles.ruleList}>
        <li>KP 宣告敌方行动意图 → 玩家投骰（斗殴/武器/闪避） → KP 叙述结果</li>
        <li>大成功：造成最大伤害</li>
        <li>困难成功：穿刺武器可造成额外伤害</li>
        <li>闪避失败：被命中，承受伤害</li>
        <li>HP 降至重伤值（HP最大值÷2）→ 重伤状态，行动受限</li>
        <li>HP 归零 → 昏迷/濒死，需队友急救（1小时内成功则稳定）</li>
        <li><strong>克苏鲁精神：逃跑永远是正确选择。</strong></li>
      </ul>
    </section>

    <section class={styles.manualSection}>
      <h3>OOC（跳出叙事）</h3>
      <p class={styles.dim}>用 <code>（括号）</code> 或消息开头写 <code>OOC:</code>，KP 会跳出角色直接答疑，不算作故事内容。</p>
    </section>

    <h2 style={{ 'margin-top': '2.5rem' }}>常见问题 FAQ</h2>
    <section class={styles.manualSection}>
      <div class={styles.faqItem}>
        <strong>Q：我想做什么，需要 KP 来裁定吗？</strong>
        <p>直接描述你的行动，KP 会判断是否需要检定。不用提前询问。</p>
      </div>
      <div class={styles.faqItem}>
        <strong>Q：我想和 NPC 说话怎么做？</strong>
        <p>直接用对话形式写出来，KP 会以 NPC 身份回应。</p>
      </div>
      <div class={styles.faqItem}>
        <strong>Q：KP 叫我投某个技能，怎么投？</strong>
        <p>发 <code>.ra 技能名</code>，如 <code>.ra 侦查</code>，机器人会用你的当前角色卡计算。</p>
      </div>
      <div class={styles.faqItem}>
        <strong>Q：暂停后再继续，之前的进度还在吗？</strong>
        <p>全部保留。<code>.campaign resume</code> 后 KP 会给一段简要回顾，帮助大家找回状态。</p>
      </div>
      <div class={styles.faqItem}>
        <strong>Q：我的角色挂了怎么办？</strong>
        <p>KP 不会轻易判定角色死亡——HP 归零是昏迷/濒死，队友可以急救。真正的死亡需要明确的故事逻辑。</p>
      </div>
    </section>
  </div>
);

export default Manual;
