/**
 * KP 守护规则
 * 
 * 定义 AI KP 的行为边界和约束
 */

/**
 * KP 守护规则检查结果
 */
export interface GuardrailCheckResult {
  passed: boolean;
  reason?: string;
}

/**
 * KP 守护规则
 */
export class KPGuardrails {
  /**
   * 检查是否泄露了 keeper_only 信息
   */
  checkSecretLeak(content: string, allowedVisibility: string[]): GuardrailCheckResult {
    // TODO: 实现秘密泄露检查
    // 检查内容中是否包含 keeper_only 标记的信息
    
    return { passed: true };
  }
  
  /**
   * 检查是否替玩家做了决定
   */
  checkPlayerDecisionOverride(content: string): GuardrailCheckResult {
    // TODO: 实现玩家决定覆盖检查
    // 检查是否包含"你决定"、"你选择"等强制决定的内容
    
    return { passed: true };
  }
  
  /**
   * 检查是否让关键线索因一次失败永久消失
   */
  checkClueDeadEnd(content: string): GuardrailCheckResult {
    // TODO: 实现线索死胡同检查
    // 检查是否因为一次失败就完全无法继续调查
    
    return { passed: true };
  }
  
  /**
   * 综合检查
   */
  checkAll(content: string, allowedVisibility: string[]): GuardrailCheckResult {
    const checks = [
      this.checkSecretLeak(content, allowedVisibility),
      this.checkPlayerDecisionOverride(content),
      this.checkClueDeadEnd(content),
    ];
    
    const failed = checks.find(c => !c.passed);
    if (failed) {
      return failed;
    }
    
    return { passed: true };
  }
}
