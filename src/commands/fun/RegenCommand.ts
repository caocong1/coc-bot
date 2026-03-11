/**
 * .regen <imgId> — 重新生成图片
 *
 * 玩家在收到 AI KP 发出的图片后，若对效果不满意，
 * 可用此命令按原提示词重新生成一次。
 *
 * 仅在有 AI 客户端时生效；仅对 source='generated' 的图片有效。
 */

import type { CommandContext, CommandResult } from '../CommandRegistry';
import type { ParsedCommand } from '../CommandParser';
import { ImageLibrary } from '../../knowledge/images/ImageLibrary';
import type { DashScopeClient } from '../../ai/client/DashScopeClient';
import type { NapCatActionClient } from '../../adapters/napcat/NapCatActionClient';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

export class RegenCommand {
  readonly name = 'regen';
  readonly aliases = [];
  readonly description = '重新生成图片（.regen <图片ID>）';

  private readonly library = new ImageLibrary();

  constructor(
    private readonly aiClient: DashScopeClient | null,
    private readonly napcat: NapCatActionClient,
  ) {}

  async handle(ctx: CommandContext, cmd: ParsedCommand): Promise<CommandResult> {
    if (!this.aiClient) {
      return { text: 'AI 客户端未配置，无法生成图片。' };
    }

    const imgId = cmd.args?.[0]?.trim();
    if (!imgId) {
      return { text: '用法：.regen <图片ID>  （ID 见图片说明末尾）' };
    }

    const entry = this.library.getById(imgId);
    if (!entry) {
      return { text: `未找到图片 ${imgId}，请确认 ID 是否正确。` };
    }
    if (entry.source !== 'generated') {
      return { text: `${imgId} 是从文档提取的图片，不支持重新生成。` };
    }

    const prompt = entry.optimizedPrompt ?? entry.generatedPrompt;
    if (!prompt) {
      return { text: `${imgId} 没有保存生成提示词，无法重新生成。` };
    }

    if (!ctx.groupId) {
      return { text: '此命令仅在群聊中使用。' };
    }

    // 异步生成（不阻塞消息回复），先发提示
    const groupId = ctx.groupId;
    this.doRegen(imgId, prompt, entry.generatedPrompt ?? prompt, groupId).catch((err) => {
      console.error('[RegenCommand] 重新生成失败:', err);
      this.napcat.sendGroupMessage(groupId, `⚠️ 图片 ${imgId} 重新生成失败：${String(err)}`).catch(() => {});
    });

    return { text: `⏳ 正在重新生成图片 ${imgId}，完成后自动发送（约 30-60 秒）...` };
  }

  private async doRegen(
    imgId: string,
    optimizedPrompt: string,
    originalDesc: string,
    groupId: number,
  ): Promise<void> {
    const imageUrl = await this.aiClient!.generateImage(optimizedPrompt);

    const genDir = resolve('data/knowledge/images/generated');
    mkdirSync(genDir, { recursive: true });

    const newImgId = ImageLibrary.generateId();
    const imgPath = resolve(`${genDir}/${newImgId}.jpg`);
    const imgRelPath = `data/knowledge/images/generated/${newImgId}.jpg`;

    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) throw new Error(`下载图片失败: ${imgResp.status}`);
    writeFileSync(imgPath, Buffer.from(await imgResp.arrayBuffer()));

    // 存入图片库（新 ID，保留原提示词引用）
    this.library.upsert({
      id: newImgId,
      source: 'generated',
      relativePath: imgRelPath,
      mimeType: 'image/jpeg',
      caption: originalDesc,
      playerVisible: true,
      generatedPrompt: originalDesc,
      optimizedPrompt,
      createdAt: new Date().toISOString(),
    });

    const caption = `📷 ${originalDesc}（ID: ${newImgId}，可用 .regen ${newImgId} 再次生成）`;
    await this.napcat.sendGroupImage(groupId, imgPath, caption);

    console.log(`[RegenCommand] 重新生成完成: ${imgId} → ${newImgId}`);
  }
}
